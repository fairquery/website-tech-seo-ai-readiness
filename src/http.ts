import { MAX_HTML_BYTES, USER_AGENT } from './types.js';

export class HttpError extends Error {
    constructor(
        message: string,
        public retryable: boolean,
        public status?: number,
    ) {
        super(message);
    }
}

export interface FetchResult {
    url: string;
    status: number;
    headers: Headers;
    body: string;
    ms: number;
    redirected: boolean;
}

export class Http {
    requestCount = 0;
    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    /** Raw streaming response (caller must consume or cancel the body). */
    async raw(url: string, accept: string, timeoutMs = 20_000): Promise<Response> {
        this.requestCount += 1;
        return this.fetchImpl(url, {
            redirect: 'follow',
            headers: { 'user-agent': USER_AGENT, accept },
            signal: AbortSignal.timeout(timeoutMs),
        });
    }

    async get(
        url: string,
        opts: { timeoutMs?: number; maxBytes?: number; accept?: string } = {},
    ): Promise<FetchResult> {
        this.requestCount += 1;
        const t0 = Date.now();
        let res: Response;
        try {
            res = await this.fetchImpl(url, {
                redirect: 'follow',
                headers: {
                    'user-agent': USER_AGENT,
                    accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
                    'accept-language': 'en;q=0.9,*;q=0.5',
                },
                signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
            });
        } catch (e) {
            const msg =
                e instanceof Error
                    ? `${e.message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause?: { code?: string } }).cause!.code})` : ''}`
                    : String(e);
            // ENOTFOUND = domain does not resolve: not worth retrying.
            throw new HttpError(`GET ${url} failed: ${msg}`, !msg.includes('ENOTFOUND'));
        }
        const body = await readCapped(res, opts.maxBytes ?? MAX_HTML_BYTES);
        return {
            url: res.url || url,
            status: res.status,
            headers: res.headers,
            body,
            ms: Date.now() - t0,
            redirected: res.redirected,
        };
    }
}

/**
 * Stream a sitemap and count <loc> entries without holding the body in memory.
 * Reads at most maxBytes; `truncated` is true when the cap was hit (count is then a lower bound).
 */
export async function streamSitemap(
    http: Http,
    url: string,
    maxBytes = 20_000_000,
): Promise<{
    url: string;
    status: number;
    isSitemap: boolean;
    isIndex: boolean;
    count: number;
    truncated: boolean;
} | null> {
    let res: Response;
    try {
        res = await http.raw(url, 'application/xml,text/xml,*/*;q=0.5');
    } catch {
        return null;
    }
    const out = {
        url: res.url || url,
        status: res.status,
        isSitemap: false,
        isIndex: false,
        count: 0,
        truncated: false,
    };
    if (res.status !== 200 || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return out;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let carry = '';
    let total = 0;
    let head = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        const chunk = dec.decode(value, { stream: true });
        const text = carry + chunk;
        if (head.length < 4096) {
            head += chunk;
            if (!out.isSitemap && /<(urlset|sitemapindex)[\s>]/i.test(head)) {
                out.isSitemap = true;
                out.isIndex = /<sitemapindex[\s>]/i.test(head);
            }
        }
        out.count += (text.match(/<loc>/gi) ?? []).length;
        carry = text.slice(-5); // '<loc>' may straddle chunks; keep tail shorter than the tag
        out.count -= (carry.match(/<loc>/gi) ?? []).length;
        if (total >= maxBytes) {
            out.truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
        }
        if (head.length >= 4096 && !out.isSitemap) {
            await reader.cancel().catch(() => undefined);
            break;
        }
    }
    out.count += (carry.match(/<loc>/gi) ?? []).length;
    return out;
}

async function readCapped(res: Response, max: number): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total >= max) {
            await reader.cancel();
            break;
        }
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/** Accepts "example.com", "https://example.com/path" and returns a normalized https URL. */
export function normalizeUrl(input: string): URL | null {
    let s = input.trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
        u.hash = '';
        return u;
    } catch {
        return null;
    }
}
