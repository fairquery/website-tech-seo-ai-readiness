/**
 * Respectful, SSRF-safe HTTP client for the free tools.
 * - Brand User-Agent "Fairquery", 15 s timeout, response size cap, max 5 redirects.
 * - Every hop (including redirects) is DNS-resolved and refused if it points at a private,
 *   loopback, link-local, CGNAT, multicast or otherwise non-public address.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const USER_AGENT = 'Mozilla/5.0 (compatible; FairqueryBot/1.2; +https://github.com/fairquery) Fairquery-MCP';
export const TIMEOUT_MS = 15_000;
export const MAX_BYTES = 1_500_000;
export const MAX_REDIRECTS = 5;
/** Opt-in for fake-IP DNS environments (proxies/sandboxes mapping every host into 198.18.0.0/15). Off by default. */
const ALLOW_FAKE_IP = process.env.FAIRQUERY_ALLOW_FAKE_IP_DNS === '1';

export class WebError extends Error {
    constructor(
        public code: 'INVALID_URL' | 'BLOCKED_PRIVATE_ADDRESS' | 'DNS_FAILED' | 'FETCH_FAILED' | 'TIMEOUT' | 'TOO_MANY_REDIRECTS',
        message: string,
        public retryable = false,
    ) {
        super(message);
    }
}

export function normalizeInput(input: string): URL {
    const s = input.trim();
    let u: URL;
    try {
        u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
        throw new WebError('INVALID_URL', `Not a valid http(s) URL or domain: ${input}`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new WebError('INVALID_URL', `Only http(s) URLs are allowed: ${input}`);
    if (u.username || u.password) throw new WebError('INVALID_URL', 'URLs with credentials are not allowed');
    if (!u.hostname.includes('.') && !net.isIP(u.hostname.replace(/^\[|\]$/g, '')))
        throw new WebError('INVALID_URL', `Hostname must be a public domain: ${u.hostname}`);
    u.hash = '';
    return u;
}

function isPrivateV4(ip: string): boolean {
    const [a, b] = ip.split('.').map(Number);
    return (
        a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        ((a === 198 && (b === 18 || b === 19)) && !ALLOW_FAKE_IP)
    );
}

export function isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) return isPrivateV4(ip);
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateV4(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
}

async function assertPublic(u: URL): Promise<void> {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new WebError('BLOCKED_PRIVATE_ADDRESS', `Refusing to fetch non-public host ${host}`);
    let addrs: { address: string }[];
    if (net.isIP(host)) addrs = [{ address: host }];
    else {
        try {
            addrs = await lookup(host, { all: true });
        } catch {
            throw new WebError('DNS_FAILED', `DNS lookup failed for ${host}`, true);
        }
    }
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
        throw new WebError('BLOCKED_PRIVATE_ADDRESS', `Refusing to fetch ${host}: resolves to a private/reserved address`);
}

export interface Hop {
    url: string;
    status: number;
}

export interface FetchOut {
    requested_url: string;
    final_url: string;
    status: number;
    ok: boolean;
    headers: Headers;
    content_type: string | null;
    body: string;
    bytes: number;
    truncated: boolean;
    response_ms: number;
    redirects: Hop[];
}

/** GET with manual, re-validated redirects and a body size cap. */
export async function webFetch(input: string | URL, opts: { accept?: string; maxBytes?: number; method?: 'GET' | 'HEAD' } = {}): Promise<FetchOut> {
    let url = typeof input === 'string' ? normalizeInput(input) : input;
    const requested = url.toString();
    const redirects: Hop[] = [];
    const t0 = Date.now();
    const maxBytes = opts.maxBytes ?? MAX_BYTES;
    for (let i = 0; ; i++) {
        await assertPublic(url);
        let res: Response;
        try {
            res = await fetch(url, {
                method: opts.method ?? 'GET',
                redirect: 'manual',
                headers: { 'User-Agent': USER_AGENT, Accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            const name = (e as Error)?.name;
            if (name === 'TimeoutError' || name === 'AbortError') throw new WebError('TIMEOUT', `Timed out after ${TIMEOUT_MS} ms: ${url}`, true);
            throw new WebError('FETCH_FAILED', `Request failed for ${url}: ${(e as Error)?.message ?? e}`, true);
        }
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
            redirects.push({ url: url.toString(), status: res.status });
            await res.body?.cancel().catch(() => undefined);
            if (i >= MAX_REDIRECTS) throw new WebError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects from ${requested}`);
            let next: URL;
            try {
                next = new URL(loc, url);
            } catch {
                throw new WebError('FETCH_FAILED', `Invalid redirect Location: ${loc}`);
            }
            if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new WebError('INVALID_URL', `Redirect to non-http(s) URL: ${next}`);
            url = next;
            continue;
        }
        let bytes = 0;
        let truncated = false;
        const chunks: Uint8Array[] = [];
        if (res.body && (opts.method ?? 'GET') === 'GET') {
            const reader = res.body.getReader();
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (bytes + value.length > maxBytes) {
                        chunks.push(value.subarray(0, maxBytes - bytes));
                        bytes = maxBytes;
                        truncated = true;
                        await reader.cancel().catch(() => undefined);
                        break;
                    }
                    chunks.push(value);
                    bytes += value.length;
                }
            } catch (e) {
                const name = (e as Error)?.name;
                if (name === 'TimeoutError' || name === 'AbortError') throw new WebError('TIMEOUT', `Timed out reading ${url}`, true);
                throw new WebError('FETCH_FAILED', `Read failed for ${url}`, true);
            }
        }
        const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
        return {
            requested_url: requested,
            final_url: url.toString(),
            status: res.status,
            ok: res.ok,
            headers: res.headers,
            content_type: res.headers.get('content-type'),
            body,
            bytes,
            truncated,
            response_ms: Date.now() - t0,
            redirects,
        };
    }
}

/** Fetch that returns null instead of throwing (for optional resources like robots.txt). */
export async function tryFetch(input: string | URL, opts?: Parameters<typeof webFetch>[1]): Promise<FetchOut | null> {
    try {
        return await webFetch(input, opts);
    } catch {
        return null;
    }
}
