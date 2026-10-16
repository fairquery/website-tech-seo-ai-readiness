import { Actor, log } from 'apify';

import { Emitter } from './emitter.js';
import { type FetchResult, Http, HttpError, normalizeUrl, streamSitemap } from './http.js';
import { aiReadiness, extractPage, seoAudit } from './page.js';
import { botStatus, isAllowed, looksLikeLlmsTxt, parseLlmsTxt, parseRobots, type Robots } from './robots.js';
import { detectTech } from './tech.js';
import {
    type ActorInput,
    AI_BOTS,
    BOT_TOKEN,
    CHARGE_EVENTS,
    type ErrorRow,
    type OutputRow,
    type RunSummary,
    SCHEMA_VERSION,
    SITE_CONCURRENCY,
    type SiteRow,
} from './types.js';

await Actor.init();

const aborting = { value: false };
const emitter = new Emitter();
Actor.on('aborting', async () => {
    aborting.value = true;
    await emitter.flush();
    log.warning('Aborting — finishing in-flight sites.');
});

const startedAt = new Date().toISOString();
const rawInput = (await Actor.getInput<ActorInput>()) ?? {};
const input: Required<ActorInput> = {
    urls: Array.isArray(rawInput.urls) ? rawInput.urls.map(String) : [],
    checkRobots: rawInput.checkRobots ?? true,
    checkSitemap: rawInput.checkSitemap ?? true,
    checkLlmsTxt: rawInput.checkLlmsTxt ?? true,
    respectRobotsTxt: rawInput.respectRobotsTxt ?? true,
    maxSites: rawInput.maxSites ?? 500,
};

const http = new Http();
const counters = { sites_checked: 0, errors: 0, llms_txt_found: 0 };
const seo: number[] = [];
const ai: number[] = [];

const targets: { input: string; url: URL }[] = [];
const seen = new Set<string>();
for (const raw of input.urls.flatMap((u) => u.split(/[\s,]+/)).filter(Boolean)) {
    const url = normalizeUrl(raw);
    if (!url) {
        await pushError({
            code: 'INVALID_URL',
            message: `Not a valid http(s) URL or domain: ${raw}`,
            retryable: false,
            input: raw,
        });
        continue;
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    targets.push({ input: raw, url });
}
if (targets.length > input.maxSites) {
    await pushError({
        code: 'MAX_SITES_EXCEEDED',
        message: `${targets.length} sites supplied; only the first ${input.maxSites} were checked.`,
        retryable: false,
        context: { found: targets.length, max: input.maxSites },
    });
    targets.length = input.maxSites;
}
if (!targets.length) {
    await pushError({
        code: 'INPUT_EMPTY',
        message: 'Input.urls must contain at least one domain or URL.',
        retryable: false,
    });
    await finish();
}

log.info('Website check starting', { sites: targets.length });
for (let i = 0; i < targets.length; i += SITE_CONCURRENCY) {
    if (aborting.value) break;
    await Promise.all(targets.slice(i, i + SITE_CONCURRENCY).map(async (t) => checkSite(t.input, t.url)));
}
log.info('Website check finished', counters);
await finish();

async function tryGet(url: string, accept: string, maxBytes = 2_000_000): Promise<FetchResult | null> {
    try {
        return await http.get(url, { accept, maxBytes, timeoutMs: 15_000 });
    } catch {
        return null;
    }
}

async function checkSite(inputStr: string, url: URL): Promise<void> {
    const { origin } = url;
    let robots: Robots | null = null;
    let robotsFound: boolean | null = null;
    let robotsUrl: string | null = null;
    if (input.checkRobots || input.respectRobotsTxt) {
        robotsUrl = `${origin}/robots.txt`;
        const r = await tryGet(robotsUrl, 'text/plain,*/*;q=0.5', 500_000);
        robotsFound = Boolean(r && r.status === 200 && !/^\s*<(!doctype|html)/i.test(r.body));
        robots = robotsFound && r ? parseRobots(r.body) : { groups: [], sitemaps: [] };
        if (r && r.status >= 500) robotsFound = null;
    }
    if (input.respectRobotsTxt && robots && !isAllowed(robots, BOT_TOKEN, url.pathname || '/')) {
        await pushError({
            code: 'ROBOTS_DISALLOWED',
            message: `robots.txt disallows ${url.pathname} for generic crawlers; skipped (set respectRobotsTxt=false to override).`,
            retryable: false,
            input: inputStr,
            context: { robots_url: robotsUrl },
        });
        return;
    }

    let page: FetchResult;
    try {
        page = await http.get(url.href);
    } catch (e) {
        await pushError({
            code: 'FETCH_FAILED',
            message: e instanceof Error ? e.message : String(e),
            retryable: e instanceof HttpError ? e.retryable : true,
            input: inputStr,
        });
        return;
    }
    if (page.status >= 400) {
        await pushError({
            code:
                page.status === 403 || page.status === 429 || page.status === 503
                    ? 'BLOCKED_OR_RATE_LIMITED'
                    : 'HTTP_ERROR',
            message: `GET ${url.href} returned HTTP ${page.status}.`,
            retryable: page.status === 429 || page.status >= 500,
            input: inputStr,
            status_code: page.status,
        });
        return;
    }
    const finalUrl = new URL(page.url);
    const ctype = page.headers.get('content-type');
    const facts = extractPage(page.body, page.url);

    // Sitemap
    let sitemapFound: boolean | null = null;
    let sitemapUrl: string | null = null;
    let sitemapCount: number | null = null;
    let sitemapIndex: boolean | null = null;
    let sitemapTruncated: boolean | null = null;
    if (input.checkSitemap) {
        const candidates = [
            ...(robots?.sitemaps ?? []),
            `${finalUrl.origin}/sitemap.xml`,
            `${finalUrl.origin}/sitemap_index.xml`,
        ];
        sitemapFound = false;
        for (const c of [...new Set(candidates)].slice(0, 4)) {
            const r = await streamSitemap(http, c);
            if (r && r.isSitemap) {
                sitemapFound = true;
                sitemapUrl = r.url;
                sitemapCount = r.count;
                sitemapIndex = r.isIndex;
                sitemapTruncated = r.truncated;
                break;
            }
        }
    }

    // llms.txt
    let llmsFound: boolean | null = null;
    let llmsUrl: string | null = null;
    let llmsTitle: string | null = null;
    let llmsLinks: number | null = null;
    let llmsFull: boolean | null = null;
    if (input.checkLlmsTxt) {
        const r = await tryGet(`${finalUrl.origin}/llms.txt`, 'text/plain,text/markdown,*/*;q=0.5', 300_000);
        llmsFound = Boolean(r && r.status === 200 && looksLikeLlmsTxt(r.body, r.headers.get('content-type')));
        if (llmsFound && r) {
            const p = parseLlmsTxt(r.body);
            llmsUrl = r.url;
            llmsTitle = p.title;
            llmsLinks = p.links;
            counters.llms_txt_found += 1;
        }
        const f = await tryGet(`${finalUrl.origin}/llms-full.txt`, 'text/plain,text/markdown,*/*;q=0.5', 200_000);
        llmsFull = Boolean(f && f.status === 200 && looksLikeLlmsTxt(f.body, f.headers.get('content-type')));
    }

    const aiBots =
        input.checkRobots && robots ? Object.fromEntries(AI_BOTS.map((b) => [b, botStatus(robots!, b)])) : null;
    const https = finalUrl.protocol === 'https:';
    const audit = seoAudit(facts, {
        https,
        statusCode: page.status,
        robotsFound: input.checkRobots ? robotsFound : null,
        sitemapFound,
    });
    const aiScore = aiReadiness({
        llms: llmsFound,
        llmsFull,
        aiBots,
        jsonLd: facts.json_ld_types.length,
        wordCount: facts.word_count,
        sitemap: sitemapFound,
        metaDescription: Boolean(facts.meta_description),
        noindex: Boolean(facts.meta_robots && /noindex/i.test(facts.meta_robots)),
    });
    const h = page.headers;
    const { generator, ...pageFields } = facts;
    const row: SiteRow = {
        schema_version: SCHEMA_VERSION,
        type: 'site',
        source_url: page.url,
        checked_at: new Date().toISOString(),
        input: inputStr,
        final_url: page.url,
        domain: finalUrl.hostname,
        status_code: page.status,
        redirected: page.redirected,
        https,
        response_ms: page.ms,
        content_type: ctype,
        html_bytes: Buffer.byteLength(page.body),
        ...pageFields,
        technologies: detectTech(page.body, h, generator),
        server: h.get('server'),
        security_headers: {
            strict_transport_security: h.has('strict-transport-security'),
            content_security_policy: h.has('content-security-policy'),
            x_frame_options: h.has('x-frame-options'),
            x_content_type_options: h.has('x-content-type-options'),
            referrer_policy: h.has('referrer-policy'),
            permissions_policy: h.has('permissions-policy'),
        },
        robots_txt_found: input.checkRobots ? robotsFound : null,
        robots_txt_url: input.checkRobots && robotsFound ? robotsUrl : null,
        sitemaps_declared: robots?.sitemaps ?? [],
        ai_bots: aiBots,
        sitemap_found: sitemapFound,
        sitemap_url: sitemapUrl,
        sitemap_url_count: sitemapCount,
        sitemap_is_index: sitemapIndex,
        sitemap_count_truncated: sitemapTruncated,
        llms_txt_found: llmsFound,
        llms_txt_url: llmsUrl,
        llms_txt_title: llmsTitle,
        llms_txt_links: llmsLinks,
        llms_full_txt_found: llmsFull,
        seo_score: audit.score,
        seo_issues: audit.issues,
        ai_readiness_score: aiScore,
    };
    await emit(row, CHARGE_EVENTS.siteChecked);
    counters.sites_checked += 1;
    seo.push(audit.score);
    ai.push(aiScore);
}

async function finish(): Promise<never> {
    const avg = (a: number[]): number | null => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const summary: RunSummary = {
        schema_version: SCHEMA_VERSION,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        urls_requested: input.urls.length,
        ...counters,
        http_requests: http.requestCount,
        avg_seo_score: avg(seo),
        avg_ai_readiness_score: avg(ai),
        input,
    };
    await emitter.flush();
    await Actor.setValue('RUN_SUMMARY', summary);
    await Actor.exit();
    return undefined as never;
}

async function emit(row: OutputRow, eventName: string): Promise<void> {
    // Batched push + charge; Actor.charge only runs when the run is pay-per-event (see emitter.ts).
    await emitter.emit(row, eventName);
    if (emitter.limitReached) aborting.value = true;
}

/** Error rows are never charged. */
async function pushError(
    partial: Omit<ErrorRow, 'schema_version' | 'type' | 'source_url' | 'checked_at'>,
): Promise<void> {
    counters.errors += 1;
    const u = partial.input ? normalizeUrl(partial.input) : null;
    const row: ErrorRow = {
        schema_version: SCHEMA_VERSION,
        type: 'error',
        source_url: u?.href ?? 'about:blank',
        checked_at: new Date().toISOString(),
        ...partial,
    };
    await emitter.emit(row, null); // error rows are never charged
}
