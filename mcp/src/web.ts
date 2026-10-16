/** Local (free) website analyses used by the web_* tools. No Apify calls. */
import { aiReadiness, extractPage, seoAudit } from './lib/page.js';
import { botStatus, looksLikeLlmsTxt, parseLlmsTxt, parseRobots } from './lib/robots.js';
import { detectTech } from './lib/tech.js';
import { AI_BOTS } from './lib/types.js';
import { type FetchOut, normalizeInput, tryFetch, webFetch } from './fetcher.js';

export const SNAPSHOT_SCHEMA = 'fairquery-web-snapshot/1';

function titleOf(html: string): string | null {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
}

function isHtml(f: FetchOut): boolean {
    return /html/i.test(f.content_type ?? '') || /^\s*<(!doctype|html)/i.test(f.body.slice(0, 200));
}

export async function quickCheck(input: string): Promise<Record<string, unknown>> {
    const f = await webFetch(input, { maxBytes: 300_000 });
    return {
        type: 'quick_check',
        input,
        requested_url: f.requested_url,
        final_url: f.final_url,
        status_code: f.status,
        ok: f.ok,
        https: f.final_url.startsWith('https:'),
        redirect_count: f.redirects.length,
        redirects: f.redirects,
        response_ms: f.response_ms,
        content_type: f.content_type,
        server: f.headers.get('server'),
        title: isHtml(f) ? titleOf(f.body) : null,
        checked_at: new Date().toISOString(),
    };
}

interface RobotsInfo {
    found: boolean;
    status: number | null;
    url: string;
    sitemaps: string[];
    text: string | null;
}

export async function getRobots(origin: string): Promise<RobotsInfo> {
    const url = `${origin}/robots.txt`;
    const r = await tryFetch(url, { accept: 'text/plain,*/*;q=0.5', maxBytes: 500_000 });
    const found = !!r && r.ok && !isHtml(r);
    const text = found ? r!.body : null;
    const sitemaps = text ? [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]) : [];
    return { found, status: r?.status ?? null, url, sitemaps, text };
}

async function probeLlms(url: string): Promise<Record<string, unknown>> {
    const r = await tryFetch(url, { accept: 'text/plain,text/markdown,*/*;q=0.5', maxBytes: 2_000_000 });
    const found = !!r && r.ok && looksLikeLlmsTxt(r.body, r.content_type);
    const parsed = found ? parseLlmsTxt(r!.body) : null;
    return { url, found, status: r?.status ?? null, bytes: found ? r!.bytes : 0, title: parsed?.title ?? null, links: parsed?.links ?? 0 };
}

export async function aiCrawlerAccess(input: string, bots?: string[]): Promise<Record<string, unknown>> {
    const origin = normalizeInput(input).origin;
    const [robots, llms, llmsFull] = await Promise.all([getRobots(origin), probeLlms(`${origin}/llms.txt`), probeLlms(`${origin}/llms-full.txt`)]);
    const list = bots?.length ? bots : [...AI_BOTS];
    const parsed = robots.text ? parseRobots(robots.text) : null;
    const ai_bots: Record<string, string> = {};
    for (const b of list) ai_bots[b] = parsed ? botStatus(parsed, b) : 'allowed';
    const vals = Object.values(ai_bots);
    return {
        type: 'ai_crawler_access',
        input,
        origin,
        robots_txt_url: robots.url,
        robots_txt_found: robots.found,
        robots_txt_status: robots.status,
        ai_bots,
        allowed_count: vals.filter((v) => v === 'allowed').length,
        partial_count: vals.filter((v) => v === 'partial').length,
        blocked_count: vals.filter((v) => v === 'blocked').length,
        note: robots.found ? 'allowed = no Disallow for the bot; partial = some paths disallowed; blocked = Disallow: /' : 'No robots.txt: all crawlers are allowed by default.',
        sitemaps_declared: robots.sitemaps,
        llms_txt: llms,
        llms_full_txt: llmsFull,
        checked_at: new Date().toISOString(),
    };
}

/** Full single-page SEO + AI-readiness snapshot (also the input format for web_compare_snapshots). */
export async function seoSnapshot(input: string, opts: { checkRobots?: boolean } = {}): Promise<Record<string, unknown>> {
    const f = await webFetch(input);
    const final = new URL(f.final_url);
    const html = isHtml(f) ? f.body : '';
    const p = extractPage(html, f.final_url);
    let robotsFound: boolean | null = null;
    let sitemapFound: boolean | null = null;
    let ai: Record<string, unknown> | null = null;
    if (opts.checkRobots !== false) {
        ai = await aiCrawlerAccess(final.origin);
        robotsFound = ai.robots_txt_found as boolean;
        const sm = (ai.sitemaps_declared as string[])[0] ?? `${final.origin}/sitemap.xml`;
        const s = await tryFetch(sm, { accept: 'application/xml,text/xml,*/*;q=0.5', maxBytes: 200_000 });
        sitemapFound = !!s && s.ok && /<(urlset|sitemapindex)[\s>]/i.test(s.body);
    }
    const audit = seoAudit(p, { https: final.protocol === 'https:', statusCode: f.status, robotsFound, sitemapFound });
    const aiBots = (ai?.ai_bots as Record<string, string>) ?? null;
    const ai_readiness_score = aiReadiness({
        llms: ai ? ((ai.llms_txt as { found: boolean }).found) : null,
        llmsFull: ai ? ((ai.llms_full_txt as { found: boolean }).found) : null,
        aiBots,
        jsonLd: p.json_ld_types.length,
        wordCount: p.word_count,
        sitemap: sitemapFound,
        metaDescription: !!p.meta_description,
        noindex: !!p.meta_robots && /noindex/i.test(p.meta_robots),
    });
    const { generator, ...facts } = p;
    return {
        type: 'seo_audit',
        snapshot_schema: SNAPSHOT_SCHEMA,
        input,
        final_url: f.final_url,
        status_code: f.status,
        https: final.protocol === 'https:',
        response_ms: f.response_ms,
        html_truncated: f.truncated,
        ...facts,
        generator,
        robots_txt_found: robotsFound,
        sitemap_found: sitemapFound,
        ai_bots: aiBots,
        llms_txt_found: ai ? (ai.llms_txt as { found: boolean }).found : null,
        llms_full_txt_found: ai ? (ai.llms_full_txt as { found: boolean }).found : null,
        seo_score: audit.score,
        seo_issues: audit.issues,
        ai_readiness_score,
        technologies: detectTech(html, f.headers, generator).map((t) => t.name),
        checked_at: new Date().toISOString(),
    };
}

export async function techStack(input: string): Promise<{ meta: Record<string, unknown>; items: Record<string, unknown>[] }> {
    const f = await webFetch(input);
    const html = isHtml(f) ? f.body : '';
    const gen = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ?? null;
    const hits = detectTech(html, f.headers, gen);
    return {
        meta: { input, final_url: f.final_url, status_code: f.status, generator: gen, server: f.headers.get('server'), x_powered_by: f.headers.get('x-powered-by'), note: 'Signature-based detection from one HTML response + headers; no JavaScript execution.' },
        items: hits.map((h) => ({ type: 'technology', ...h })),
    };
}

const SEC_HEADERS: { header: string; weight: number; check?: (v: string) => string | null }[] = [
    { header: 'strict-transport-security', weight: 25, check: (v) => (/max-age=(\d+)/i.exec(v) && Number(/max-age=(\d+)/i.exec(v)![1]) >= 15552000 ? null : 'max-age below 180 days') },
    { header: 'content-security-policy', weight: 25, check: (v) => (/unsafe-inline|unsafe-eval/.test(v) ? 'allows unsafe-inline/unsafe-eval' : null) },
    { header: 'x-content-type-options', weight: 15, check: (v) => (/nosniff/i.test(v) ? null : 'should be nosniff') },
    { header: 'x-frame-options', weight: 10 },
    { header: 'referrer-policy', weight: 10, check: (v) => (/unsafe-url/i.test(v) ? 'unsafe-url leaks full URLs' : null) },
    { header: 'permissions-policy', weight: 10 },
    { header: 'cross-origin-opener-policy', weight: 5 },
];

export async function securityHeaders(input: string): Promise<Record<string, unknown>> {
    const f = await webFetch(input, { maxBytes: 100_000 });
    const https = f.final_url.startsWith('https:');
    let score = 0;
    const headers: Record<string, unknown>[] = [];
    const csp = f.headers.get('content-security-policy') ?? '';
    for (const h of SEC_HEADERS) {
        let v = f.headers.get(h.header);
        // CSP frame-ancestors satisfies clickjacking protection
        if (!v && h.header === 'x-frame-options' && /frame-ancestors/i.test(csp)) v = '(via CSP frame-ancestors)';
        const warning = v && h.check ? h.check(v) : null;
        const present = !!v;
        if (present) score += warning ? Math.round(h.weight / 2) : h.weight;
        headers.push({ header: h.header, present, value: v ? v.slice(0, 500) : null, warning, weight: h.weight });
    }
    if (!https) score = Math.min(score, 40);
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
    const leaks = ['server', 'x-powered-by', 'x-aspnet-version'].map((n) => ({ header: n, value: f.headers.get(n) })).filter((x) => x.value);
    return {
        type: 'security_headers',
        input,
        final_url: f.final_url,
        status_code: f.status,
        https,
        score,
        grade,
        headers,
        missing: headers.filter((h) => !h.present).map((h) => h.header),
        info_disclosure_headers: leaks,
        checked_at: new Date().toISOString(),
    };
}

function locs(xml: string): { loc: string; lastmod: string | null }[] {
    const out: { loc: string; lastmod: string | null }[] = [];
    for (const m of xml.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        const loc = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i.exec(m[2])?.[1]?.trim();
        if (!loc) continue;
        const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(m[2])?.[1] ?? null;
        out.push({ loc: loc.replace(/&amp;/g, '&'), lastmod });
    }
    return out;
}

export async function sitemapInfo(input: string, sitemapUrl: string | undefined, maxChildSitemaps: number) {
    const first = await sitemapAt(normalizeInput(input).origin, sitemapUrl, maxChildSitemaps);
    if (first || sitemapUrl) return first;
    // Retry on the canonical origin (e.g. example.com -> www.example.com) after following homepage redirects.
    const home = await tryFetch(normalizeInput(input).origin + '/', { maxBytes: 10_000 });
    const canon = home ? new URL(home.final_url).origin : null;
    return canon && canon !== normalizeInput(input).origin ? sitemapAt(canon, undefined, maxChildSitemaps) : null;
}

async function sitemapAt(origin: string, sitemapUrl: string | undefined, maxChildSitemaps: number) {
    const robots = sitemapUrl ? null : await getRobots(origin);
    const candidates = sitemapUrl ? [sitemapUrl] : [...(robots!.sitemaps.length ? robots!.sitemaps : []), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    let root: FetchOut | null = null;
    let used: string | null = null;
    for (const c of [...new Set(candidates)].slice(0, 4)) {
        const r = await tryFetch(c, { accept: 'application/xml,text/xml,*/*;q=0.5', maxBytes: 10_000_000 });
        if (r && r.ok && /<(urlset|sitemapindex)[\s>]/i.test(r.body)) {
            root = r;
            used = c;
            break;
        }
    }
    if (!root) return null;
    const isIndex = /<sitemapindex[\s>]/i.test(root.body);
    const children = isIndex ? locs(root.body) : [];
    let urls: Record<string, unknown>[] = [];
    let truncated = root.truncated;
    const expanded: string[] = [];
    if (isIndex) {
        for (const ch of children.slice(0, maxChildSitemaps)) {
            const r = await tryFetch(ch.loc, { accept: 'application/xml,text/xml,*/*;q=0.5', maxBytes: 10_000_000 });
            if (!r || !r.ok) continue;
            expanded.push(ch.loc);
            truncated ||= r.truncated;
            urls.push(...locs(r.body).map((u) => ({ type: 'url', ...u, sitemap: ch.loc })));
        }
    } else urls = locs(root.body).map((u) => ({ type: 'url', ...u, sitemap: used }));
    return {
        meta: {
            origin,
            sitemap_url: root.final_url,
            declared_in_robots: robots?.sitemaps ?? null,
            is_index: isIndex,
            child_sitemap_count: children.length,
            child_sitemaps: children.slice(0, 200),
            expanded_child_sitemaps: expanded,
            truncated,
        },
        urls,
    };
}

/* ---------- comparison ---------- */

const COMPARE_FIELDS = [
    'status_code', 'final_url', 'https', 'title', 'meta_description', 'canonical', 'lang', 'meta_robots', 'viewport',
    'h1', 'word_count', 'images', 'images_missing_alt', 'json_ld_types', 'open_graph', 'twitter_card', 'hreflang',
    'robots_txt_found', 'sitemap_found', 'llms_txt_found', 'llms_full_txt_found', 'ai_bots', 'seo_score',
    'ai_readiness_score', 'technologies', 'response_ms',
];

const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>) {
    const changes: Record<string, unknown>[] = [];
    for (const k of COMPARE_FIELDS) {
        if (!(k in before) && !(k in after)) continue;
        if (k === 'response_ms') continue;
        const a = before[k];
        const b = after[k];
        if (eq(a, b)) continue;
        const row: Record<string, unknown> = { type: 'change', field: k, before: a ?? null, after: b ?? null };
        if (typeof a === 'number' && typeof b === 'number') row.delta = b - a;
        if (Array.isArray(a) || Array.isArray(b)) {
            const A = (Array.isArray(a) ? a : []).map((x) => JSON.stringify(x));
            const B = (Array.isArray(b) ? b : []).map((x) => JSON.stringify(x));
            row.added = B.filter((x) => !A.includes(x)).map((x) => JSON.parse(x));
            row.removed = A.filter((x) => !B.includes(x)).map((x) => JSON.parse(x));
        }
        changes.push(row);
    }
    const codes = (s: Record<string, unknown>) => ((s.seo_issues as { code: string }[] | undefined) ?? []).map((i) => i.code);
    const ib = codes(before);
    const ia = codes(after);
    for (const c of ia.filter((x) => !ib.includes(x))) changes.push({ type: 'issue_added', field: 'seo_issues', code: c });
    for (const c of ib.filter((x) => !ia.includes(x))) changes.push({ type: 'issue_resolved', field: 'seo_issues', code: c });
    const num = (s: Record<string, unknown>, k: string) => (typeof s[k] === 'number' ? (s[k] as number) : null);
    const d = (k: string) => (num(before, k) !== null && num(after, k) !== null ? num(after, k)! - num(before, k)! : null);
    return {
        summary: {
            before_url: before.final_url ?? before.input ?? null,
            after_url: after.final_url ?? after.input ?? null,
            before_checked_at: before.checked_at ?? null,
            after_checked_at: after.checked_at ?? null,
            seo_score_before: num(before, 'seo_score'),
            seo_score_after: num(after, 'seo_score'),
            seo_score_delta: d('seo_score'),
            ai_readiness_score_delta: d('ai_readiness_score'),
            issues_added: ia.filter((x) => !ib.includes(x)).length,
            issues_resolved: ib.filter((x) => !ia.includes(x)).length,
            changed_fields: changes.filter((c) => c.type === 'change').length,
        },
        changes,
    };
}
