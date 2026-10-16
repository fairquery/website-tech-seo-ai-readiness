#!/usr/bin/env node
/**
 * Fairquery Website Tech / SEO / AI-readiness stdio MCP server (v1.2.0).
 * Free local tools (no token): web_quick_check, web_seo_audit, web_ai_crawler_access, web_tech_stack,
 * web_sitemap_info, web_security_headers, web_compare_snapshots.
 * Paid bulk tool: web_batch_audit runs Apify Actor fairquery/website-tech-seo-ai-readiness (APIFY_TOKEN, pay-per-event).
 * initialize and tools/list work without any token. APIFY_TOKEN is never logged.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    READ_ONLY_OPEN_WORLD,
    type ToolResult,
    compact,
    errorResult,
    jsonResult,
    pagedOutputSchema,
    pagedResult,
    proxyActor,
    rowsOutputSchema,
    rowsResult,
} from './common.js';
import { WebError } from './fetcher.js';
import { aiCrawlerAccess, diffSnapshots, quickCheck, securityHeaders, seoSnapshot, sitemapInfo, techStack } from './web.js';

const ACTOR_ID = 'fairquery~website-tech-seo-ai-readiness';

const FETCH_BEHAVIOR =
    'Fetching: read-only GETs from this server with User-Agent "FairqueryBot ... Fairquery-MCP", 15 s timeout per request, body capped (1.5 MB HTML), max 5 redirects; URLs resolving to private/loopback/link-local addresses are refused (SSRF guard). Free, no token, no JavaScript rendering.';
const ERRORS =
    'Errors (isError=true, JSON {error, message, retryable}): INVALID_URL, BLOCKED_PRIVATE_ADDRESS, DNS_FAILED, FETCH_FAILED, TIMEOUT, TOO_MANY_REDIRECTS';

const urlArg = z.string().min(1).describe('Domain or URL, e.g. "vercel.com" or "https://www.python.org/about/". Bare domains use https.');
const limitArg = (def: number, max: number) => z.number().int().min(1).max(max).optional().describe(`Page size (default ${def}, max ${max})`);
const offsetArg = z.number().int().min(0).optional().describe('Zero-based offset into the full result list (default 0); use nextOffset from the previous page');

function fail(e: unknown): ToolResult {
    if (e instanceof WebError) return errorResult(e.code, e.message, e.retryable);
    return errorResult('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), true);
}

function errRow(input: string, e: unknown): Record<string, unknown> {
    const w = e instanceof WebError ? e : new WebError('FETCH_FAILED', e instanceof Error ? e.message : String(e), true);
    return { type: 'error', input, code: w.code, message: w.message, retryable: w.retryable };
}


function createServer(): McpServer {
    const server = new McpServer({ name: 'fairquery-web', version: '1.2.0' });

    server.registerTool(
        'web_quick_check',
        {
            title: 'Quick URL check: status, redirects, title, speed (free)',
            description: [
                'Lightweight reachability check for 1-20 URLs: final HTTP status, full redirect chain, response time (ms), content type, Server header and <title>.',
                'When to use: "is this site up?", "where does this domain redirect?", cheap pre-filtering of a lead list before deeper audits. For SEO details use web_seo_audit; for hundreds/thousands of sites use web_batch_audit.',
                FETCH_BEHAVIOR + ' Only the first 300 KB of each page is read. URLs are checked in parallel.',
                'Returns {count, items}: one "quick_check" row per input (input, requested_url, final_url, status_code, ok, https, redirect_count, redirects[{url,status}], response_ms, content_type, server, title, checked_at) or an "error" row (input, code, message, retryable) with codes INVALID_URL, BLOCKED_PRIVATE_ADDRESS, DNS_FAILED, FETCH_FAILED, TIMEOUT, TOO_MANY_REDIRECTS. Per-URL errors never fail the whole call.',
            ].join('\n'),
            inputSchema: { urls: z.array(z.string().min(1)).min(1).max(20).describe('1-20 domains or URLs, e.g. ["vercel.com","http://github.com"]') },
            outputSchema: rowsOutputSchema,
            annotations: { title: 'Quick URL check (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ urls }) => rowsResult(await Promise.all(urls.map((u) => quickCheck(u).catch((e) => errRow(u, e))))),
    );

    server.registerTool(
        'web_seo_audit',
        {
            title: 'Single-page SEO & AI-readiness audit with 0-100 score (free)',
            description: [
                'Full on-page audit of ONE URL: title, meta description, canonical, lang, meta robots, viewport, H1s, heading/word/link/image counts, images missing alt, Open Graph, Twitter card, JSON-LD @types, hreflang, feeds, social links, detected technologies, robots.txt/sitemap/llms.txt presence and AI-bot access, plus seo_score (0-100, deductions: high 15 / medium 8 / low 3) with seo_issues[{code, severity, message}] and ai_readiness_score (0-100).',
                'Issue codes: NO_HTTPS, MISSING_TITLE, TITLE_TOO_LONG, TITLE_TOO_SHORT, MISSING_META_DESCRIPTION, META_DESCRIPTION_TOO_LONG, MISSING_H1, MULTIPLE_H1, MISSING_CANONICAL, MISSING_LANG, MISSING_VIEWPORT, NOINDEX, MISSING_OPEN_GRAPH, MISSING_STRUCTURED_DATA, IMAGES_MISSING_ALT, THIN_CONTENT, MISSING_ROBOTS_TXT, MISSING_SITEMAP.',
                'When to use: SEO health of a specific page, or to create a snapshot you can store and later pass to web_compare_snapshots for before/after tracking. For just one aspect use web_ai_crawler_access, web_tech_stack, web_sitemap_info or web_security_headers; for many sites use web_batch_audit.',
                FETCH_BEHAVIOR + ' Makes ~5 requests (page, robots.txt, sitemap, llms.txt, llms-full.txt) unless checkRobots=false.',
                'Returns one "seo_audit" snapshot object (snapshot_schema "fairquery-web-snapshot/1") with the fields above plus input, final_url, status_code, https, response_ms, html_truncated, checked_at. ' + ERRORS + '.',
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                checkRobots: z.boolean().optional().describe('Also fetch robots.txt, sitemap and llms.txt for AI-bot/sitemap checks and scores (default true). false = page only, faster.'),
            },
            annotations: { title: 'Single-page SEO audit (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ url, checkRobots }) => {
            try {
                return jsonResult(await seoSnapshot(url, { checkRobots }));
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_ai_crawler_access',
        {
            title: 'AI crawler access: robots.txt AI-bot rules + llms.txt (free)',
            description: [
                'Report whether AI crawlers may access a site, from its robots.txt: per bot "allowed" (no Disallow), "partial" (some paths disallowed) or "blocked" (Disallow: /). Default bots: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, anthropic-ai, PerplexityBot, Google-Extended, CCBot, Bytespider, Applebot-Extended, Meta-ExternalAgent, Amazonbot. Also checks /llms.txt and /llms-full.txt (llmstxt.org): found, HTTP status, bytes, H1 title, link count (HTML soft-404s are not counted), and lists Sitemap: lines.',
                'When to use: "can ChatGPT/Claude/Perplexity crawl this site?", GEO/AI-visibility checks, llms.txt adoption. Uses only the origin of the URL.',
                FETCH_BEHAVIOR + ' 3 requests per site.',
                'Returns one "ai_crawler_access" object: origin, robots_txt_url, robots_txt_found, robots_txt_status, ai_bots{bot: status}, allowed_count, partial_count, blocked_count, note, sitemaps_declared[], llms_txt{url,found,status,bytes,title,links}, llms_full_txt{...}, checked_at. ' + ERRORS + '.',
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                bots: z.array(z.string().min(1)).max(50).optional().describe('User-agent tokens to evaluate instead of the default AI-bot list, e.g. ["GPTBot","Googlebot"]'),
            },
            annotations: { title: 'AI crawler access (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ url, bots }) => {
            try {
                return jsonResult(await aiCrawlerAccess(url, bots));
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_tech_stack',
        {
            title: 'Detect website technology stack (free)',
            description: [
                'Detect technologies used by one page from its HTML and HTTP headers: frameworks (Next.js, Nuxt, React, ...), CMS (WordPress, Shopify, Webflow, ...), hosting/CDN (Vercel, Cloudflare, Netlify, ...), analytics/tag managers, and more, each with category and evidence.',
                'When to use: lead enrichment ("what stack does this company use?"), competitor research. Signature-based, single request, no JavaScript execution, so client-injected tools may be missed. For many sites use web_batch_audit.',
                FETCH_BEHAVIOR,
                'Returns a paged list {count, total, offset, hasMore, nextOffset, meta{input, final_url, status_code, generator, server, x_powered_by, note}, items[{type:"technology", name, category, evidence}]}. Filter with category. ' + ERRORS + '.',
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                category: z.string().optional().describe('Only return technologies whose category contains this text (case-insensitive), e.g. "analytics", "cms", "cdn"'),
                limit: limitArg(50, 200),
                offset: offsetArg,
            },
            outputSchema: pagedOutputSchema,
            annotations: { title: 'Tech stack (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ url, category, limit, offset }) => {
            try {
                const r = await techStack(url);
                const items = category ? r.items.filter((i) => String(i.category).toLowerCase().includes(category.toLowerCase())) : r.items;
                return pagedResult(items, offset ?? 0, limit ?? 50, r.meta);
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_sitemap_info',
        {
            title: 'XML sitemap discovery and URL listing (free, paged)',
            description: [
                'Find a site\'s XML sitemap (robots.txt Sitemap: lines, then /sitemap.xml, /sitemap_index.xml, or an explicit sitemapUrl), report whether it is a sitemap index, list child sitemaps, and page through the contained URLs with lastmod. For an index, the first maxChildSitemaps children are expanded.',
                'When to use: count/inspect indexed pages, find recently modified URLs (filter with contains / sort), feed URLs into web_seo_audit. Not a crawler: only what the sitemap lists.',
                FETCH_BEHAVIOR + ' Sitemap files are capped at 10 MB each (meta.truncated=true when cut).',
                'Returns {count, total, offset, hasMore, nextOffset, meta{origin, sitemap_url, declared_in_robots, is_index, child_sitemap_count, child_sitemaps[], expanded_child_sitemaps[], truncated}, items[{type:"url", loc, lastmod, sitemap}]}. Errors: SITEMAP_NOT_FOUND plus ' + ERRORS.replace('Errors (isError=true, JSON {error, message, retryable}): ', '') + '.',
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                sitemapUrl: z.string().url().optional().describe('Explicit sitemap URL to use instead of auto-discovery'),
                maxChildSitemaps: z.number().int().min(0).max(20).optional().describe('For sitemap indexes: how many child sitemaps to fetch and list URLs from (default 3, max 20; 0 = list children only)'),
                contains: z.string().optional().describe('Only URLs containing this substring, e.g. "/blog/"'),
                sort: z.enum(['sitemap', 'lastmod_desc']).optional().describe('"sitemap" = file order (default); "lastmod_desc" = most recently modified first'),
                limit: limitArg(100, 1000),
                offset: offsetArg,
            },
            outputSchema: pagedOutputSchema,
            annotations: { title: 'Sitemap info (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ url, sitemapUrl, maxChildSitemaps, contains, sort, limit, offset }) => {
            try {
                const r = await sitemapInfo(url, sitemapUrl, maxChildSitemaps ?? 3);
                if (!r) return errorResult('SITEMAP_NOT_FOUND', `No XML sitemap found for ${url} (checked robots.txt Sitemap:, /sitemap.xml, /sitemap_index.xml)`);
                let items = contains ? r.urls.filter((u) => String(u.loc).includes(contains)) : r.urls;
                if (sort === 'lastmod_desc') items = [...items].sort((a, b) => String(b.lastmod ?? '').localeCompare(String(a.lastmod ?? '')));
                return pagedResult(items, offset ?? 0, limit ?? 100, r.meta);
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_security_headers',
        {
            title: 'HTTP security headers check with grade (free)',
            description: [
                'Check HTTP security response headers of one URL: Strict-Transport-Security (>=180 days), Content-Security-Policy (flags unsafe-inline/unsafe-eval), X-Content-Type-Options (nosniff), X-Frame-Options (or CSP frame-ancestors), Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy; plus information-disclosure headers (Server, X-Powered-By). Weighted score 0-100 and grade A-F (non-HTTPS capped at 40).',
                'When to use: quick security posture / hygiene check of a site. Not a vulnerability scanner.',
                FETCH_BEHAVIOR + ' One request (after redirects); headers are taken from the final response.',
                'Returns one "security_headers" object: input, final_url, status_code, https, score, grade, headers[{header, present, value, warning, weight}], missing[], info_disclosure_headers[{header, value}], checked_at. ' + ERRORS + '.',
            ].join('\n'),
            inputSchema: { url: urlArg },
            annotations: { title: 'Security headers (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ url }) => {
            try {
                return jsonResult(await securityHeaders(url));
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_compare_snapshots',
        {
            title: 'Compare two SEO audits: before/after or site vs site (free)',
            description: [
                'Diff two SEO/AI-readiness snapshots field by field: score deltas, issues added/resolved, and changes to title, meta description, canonical, H1s, JSON-LD types, Open Graph, technologies, AI-bot access, llms.txt, sitemap, status and more.',
                'Three modes: (1) before + after = two snapshot objects you saved earlier from web_seo_audit (or site rows from web_batch_audit) - no fetching; (2) before + url = historical follow-up: re-audits url now and compares with the saved snapshot; (3) url + compareUrl = audits two live URLs (e.g. competitor vs own site, staging vs production).',
                'When to use: track SEO regressions/improvements over time, verify a fix, compare competitors. ' + FETCH_BEHAVIOR,
                'Returns {summary{before_url, after_url, before_checked_at, after_checked_at, seo_score_before, seo_score_after, seo_score_delta, ai_readiness_score_delta, issues_added, issues_resolved, changed_fields}, changes[{type:"change", field, before, after, delta?, added?, removed?} | {type:"issue_added"|"issue_resolved", code}], before, after (only fetched snapshots are echoed)}. Errors: INVALID_ARGUMENTS (wrong mode combination) plus ' + ERRORS.replace('Errors (isError=true, JSON {error, message, retryable}): ', '') + '.',
            ].join('\n'),
            inputSchema: {
                before: z.record(z.string(), z.unknown()).optional().describe('Earlier snapshot object (output of web_seo_audit or a web_batch_audit site row)'),
                after: z.record(z.string(), z.unknown()).optional().describe('Later snapshot object to compare against before'),
                url: z.string().min(1).optional().describe('URL to audit live: the "after" side (with before) or the first side (with compareUrl)'),
                compareUrl: z.string().min(1).optional().describe('Second live URL to audit and compare against url'),
            },
            annotations: { title: 'Compare snapshots (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ before, after, url, compareUrl }) => {
            try {
                if (before && after && !url && !compareUrl) return jsonResult(diffSnapshots(before, after));
                if (before && url && !after && !compareUrl) {
                    const now = await seoSnapshot(url);
                    return jsonResult({ ...diffSnapshots(before, now), after: now });
                }
                if (url && compareUrl && !before && !after) {
                    const [a, b] = await Promise.all([seoSnapshot(url), seoSnapshot(compareUrl)]);
                    return jsonResult({ ...diffSnapshots(a, b), before: a, after: b });
                }
                return errorResult('INVALID_ARGUMENTS', 'Provide exactly one of: {before, after} | {before, url} | {url, compareUrl}.');
            } catch (e) {
                return fail(e);
            }
        },
    );

    server.registerTool(
        'web_batch_audit',
        {
            title: 'Bulk website tech, SEO & AI-readiness audit (Apify, paid)',
            description: [
                'Bulk audit up to thousands of websites in one call via the Fairquery Apify Actor fairquery/website-tech-seo-ai-readiness: technologies, on-page SEO, security headers, robots.txt AI-bot rules, XML sitemap, llms.txt, seo_score and ai_readiness_score per site.',
                'When to use: lists of 20+ sites (lead enrichment, portfolio/market scans) where you want server-side parallelism and a dataset. For one or a few sites prefer the free tools: web_quick_check, web_seo_audit, web_ai_crawler_access, web_tech_stack, web_sitemap_info, web_security_headers. Rows can be stored and later diffed with web_compare_snapshots.',
                'Behavior: read-only; runs the Actor via the Apify API (run-sync), a few polite GET requests per site, respects robots.txt by default, no JS rendering. Requires APIFY_TOKEN (never logged). Typical 2-10 s per site, parallel.',
                'Cost (billed to the Apify account): $0.00005 per run + $0.002 per site row; error rows are free. 50 sites ~ $0.10.',
                'Returns {count, items}. site rows: domain, status_code, https, response_ms, title, meta_description, canonical, lang, h1[], word_count, open_graph, json_ld_types, technologies[{name, category, evidence}], security_headers, robots_txt_found, ai_bots{bot: allowed|partial|blocked}, sitemap_found, sitemap_url_count, llms_txt_found, llms_txt_title, seo_score, seo_issues[{code, severity, message}], ai_readiness_score, source_url, checked_at. error rows: code (INPUT_EMPTY, INVALID_URL, MAX_SITES_EXCEEDED, ROBOTS_DISALLOWED, FETCH_FAILED, HTTP_ERROR, BLOCKED_OR_RATE_LIMITED), message, retryable, input. Tool-level errors: APIFY_TOKEN_MISSING, APIFY_ACTOR_RUN_FAILED.',
            ].join('\n'),
            inputSchema: {
                urls: z.array(z.string().min(1)).min(1).max(5000).describe('Domains or URLs, e.g. ["vercel.com","https://www.python.org/about/"]. Bare domains use https. One row per unique URL.'),
                checkRobots: z.boolean().optional().describe('Fetch robots.txt and report allow/partial/blocked per AI bot (default true)'),
                checkSitemap: z.boolean().optional().describe('Find the XML sitemap and count URLs (default true)'),
                checkLlmsTxt: z.boolean().optional().describe('Check /llms.txt and /llms-full.txt (default true)'),
                respectRobotsTxt: z.boolean().optional().describe('Skip pages robots.txt disallows for generic crawlers, emitting ROBOTS_DISALLOWED (default true, recommended)'),
                maxSites: z.number().int().min(1).max(10000).optional().describe('Safety cap on unique URLs per run (default 500); extras produce a MAX_SITES_EXCEEDED error row'),
            },
            outputSchema: rowsOutputSchema,
            annotations: { title: 'Bulk audit via Apify (paid)', ...READ_ONLY_OPEN_WORLD },
        },
        async (args) => proxyActor(ACTOR_ID, compact(args)),
    );

    return server;
}

async function main(): Promise<void> {
    await createServer().connect(new StdioServerTransport());
}

main().catch((err) => {
    console.error('fairquery-web MCP server failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
});
