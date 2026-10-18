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
    'Fetching: GETs from this server with User-Agent "FairqueryBot ... Fairquery-MCP", 15 s timeout per request, body capped (1.5 MB HTML), max 5 redirects, no JavaScript rendering; URLs resolving to private/loopback/link-local addresses are refused (SSRF guard).';
const ERRORS =
    'Errors (isError=true, JSON {error, message, retryable}): INVALID_URL, BLOCKED_PRIVATE_ADDRESS, DNS_FAILED, FETCH_FAILED, TIMEOUT, TOO_MANY_REDIRECTS';

const urlArg = z.string().min(1).describe('Required. One public domain or http(s) URL (non-empty string), e.g. "vercel.com" or "https://www.python.org/about/". Bare domains are fetched over https; other schemes, credentials in the URL, dot-less hosts and private/loopback addresses are refused.');
const limitArg = (def: number, max: number) => z.number().int().min(1).max(max).optional().describe(`Optional page size: number of items to return, integer 1-${max} (default ${def}). Example: ${Math.min(def, 20)}`);
const offsetArg = z.number().int().min(0).optional().describe('Optional zero-based offset into the full result list, integer >= 0 (default 0); use nextOffset from the previous page, e.g. 50');

function fail(e: unknown): ToolResult {
    if (e instanceof WebError) return errorResult(e.code, e.message, e.retryable);
    return errorResult('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), true);
}

function errRow(input: string, e: unknown): Record<string, unknown> {
    const w = e instanceof WebError ? e : new WebError('FETCH_FAILED', e instanceof Error ? e.message : String(e), true);
    return { type: 'error', input, code: w.code, message: w.message, retryable: w.retryable };
}


function createServer(): McpServer {
    const server = new McpServer({ name: 'fairquery-web', version: '1.2.4' });

    server.registerTool(
        'web_quick_check',
        {
            title: 'Quick URL check: status, redirects, title, speed (free)',
            description: [
                'Lightweight reachability check for 1-20 URLs: final HTTP status, full redirect chain, response time (ms), content type, Server header and <title>.',
                'WHEN TO USE: "is this site up?", "where does this domain redirect?", cheap pre-filtering of a lead list before deeper audits. For SEO details use web_seo_audit; for hundreds/thousands of sites use web_batch_audit.',
                FETCH_BEHAVIOR + ' Only the first 300 KB of each page is read.',
                'RETURNS: one "quick_check" or "error" row per input (error codes INVALID_URL, BLOCKED_PRIVATE_ADDRESS, DNS_FAILED, FETCH_FAILED, TIMEOUT, TOO_MANY_REDIRECTS); per-URL errors never fail the whole call.',
                "WHEN NOT TO USE: not for SEO/meta analysis (web_seo_audit), security headers (web_security_headers) or >20 URLs (web_batch_audit, paid).",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: urls: each entry is normalized independently and returns exactly one row, in input order: surrounding whitespace is trimmed, an entry without scheme gets "https://" (write "http://..." explicitly to test the plain-HTTP redirect), the #fragment is dropped, and the path/query are kept, so "vercel.com" and "vercel.com/pricing" are different checks. Entries that are not http(s), contain user:password@, have no dot in the host (e.g. "localhost") or resolve to private/loopback/link-local IPs become per-URL error rows (INVALID_URL / BLOCKED_PRIVATE_ADDRESS) while the other URLs still run; duplicates are fetched twice. All URLs are fetched in parallel, so total latency is roughly the slowest URL (max 15 s each).',
                "EXAMPLE: {\"urls\":[\"vercel.com\"]} -> {count:1, items:[{type:\"quick_check\", final_url:\"https://vercel.com/\", status_code:200, ok:true, ...}]}",
            ].join('\n'),
            inputSchema: { urls: z.array(z.string().min(1)).min(1).max(20).describe('Required. 1-20 non-empty strings, each a public domain or http(s) URL (bare domains use https; path kept, #fragment dropped). Example: ["vercel.com","http://github.com","https://www.python.org/about/"]') },
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
                'WHEN TO USE: SEO health of a specific page, or to create a snapshot you can store and later pass to web_compare_snapshots for before/after tracking. For just one aspect use web_ai_crawler_access, web_tech_stack, web_sitemap_info or web_security_headers; for many sites use web_batch_audit.',
                FETCH_BEHAVIOR + ' Makes ~5 requests (page, robots.txt, sitemap, llms.txt, llms-full.txt) unless checkRobots=false.',
                'RETURNS: one "seo_audit" snapshot object (snapshot_schema "fairquery-web-snapshot/1") with the fields above plus input, final_url, status_code, https, response_ms, html_truncated, checked_at. ' + ERRORS + '.',
                "WHEN NOT TO USE: only need reachability (web_quick_check), only AI-bot rules (web_ai_crawler_access), only stack (web_tech_stack), or many sites (web_batch_audit, paid).",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: url: the exact page is audited (path and query matter: "python.org" audits the homepage, "python.org/about/" that page), after following up to 5 redirects; on-page fields describe the final_url, while robots.txt, sitemap and llms.txt are always taken from the final URL\'s origin. Pass "http://..." explicitly to get the NO_HTTPS check on a site that does not redirect. checkRobots=false fetches only the page (1 request instead of ~5): robots_txt_found, sitemap_found, llms_txt_found and ai_bots become null, MISSING_ROBOTS_TXT / MISSING_SITEMAP are never raised and ai_readiness_score is computed from page signals only - so seo_score can be higher and the snapshot is not comparable with a checkRobots=true one in web_compare_snapshots. Keep the default true for snapshots you intend to compare later.',
                "EXAMPLE: {\"url\":\"python.org/about/\"} -> {type:\"seo_audit\", seo_score:0-100, ai_readiness_score:0-100, seo_issues:[{code, severity, message}], ...}",
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                checkRobots: z.boolean().optional().describe('Optional boolean, default true. true also fetches robots.txt, the XML sitemap, /llms.txt and /llms-full.txt from the page origin (~5 requests); false = page only (1 request, faster; robots/sitemap/llms fields null and their issues skipped). Example: false'),
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
                'WHEN TO USE: "can ChatGPT/Claude/Perplexity crawl this site?", GEO/AI-visibility checks, llms.txt adoption. Uses only the origin of the URL.',
                FETCH_BEHAVIOR + ' 3 requests per site.',
                'RETURNS: one "ai_crawler_access" object: origin, robots_txt_url, robots_txt_found, robots_txt_status, ai_bots{bot: status}, allowed_count, partial_count, blocked_count, note, sitemaps_declared[], llms_txt{url,found,status,bytes,title,links}, llms_full_txt{...}, checked_at. ' + ERRORS + '.',
                "WHEN NOT TO USE: for full page SEO use web_seo_audit; for sitemap contents use web_sitemap_info; for many sites use web_batch_audit (paid).",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: url: only its origin (scheme + host + port) is used, so "nytimes.com/section/tech" and "nytimes.com" give the same result; www and non-www hosts are different origins with possibly different robots.txt files. bots replaces (does not extend) the default list - include the defaults you still want. Each token is matched like a crawler would: case-insensitively, against robots.txt User-agent groups whose name is a prefix of the token (so a "Googlebot" group also covers "Googlebot-Image"), falling back to the "*" group when no specific group exists; status is reported under the exact token you passed. If robots.txt is missing (or is an HTML soft-404) every bot is "allowed". bots does not affect the llms.txt / llms-full.txt checks.',
                "EXAMPLE: {\"url\":\"nytimes.com\",\"bots\":[\"GPTBot\",\"ClaudeBot\"]} -> {ai_bots:{GPTBot:\"allowed|partial|blocked\", ClaudeBot:...}, blocked_count, llms_txt, ...}",
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                bots: z.array(z.string().min(1)).max(50).optional().describe('Optional, default = the 13 AI bots listed in the description. 1-50 robots.txt user-agent tokens (case-insensitive) to evaluate instead of the defaults. Example: ["GPTBot","ClaudeBot","Googlebot"]'),
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
                'WHEN TO USE: lead enrichment ("what stack does this company use?"), competitor research. Signature-based on one response, so client-injected tools may be missed. For many sites use web_batch_audit.',
                FETCH_BEHAVIOR,
                'RETURNS: paged "technology" rows, each with the evidence that matched; meta.final_url is the page actually analysed. ' + ERRORS + '.',
                "WHEN NOT TO USE: for SEO metadata use web_seo_audit; for security headers use web_security_headers.",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: url: exactly that page is fetched (one request after redirects), so a marketing homepage and an app/shop subpage can show different stacks; meta.final_url shows what was analysed. category is a case-insensitive substring filter on the category name, applied before paging: existing categories are CMS, Headless CMS, Site builder, E-commerce, Payments, JS framework, JS library, Framework, CSS framework, Static site generator, Hosting, CDN, Web server, Security, Analytics, Tag manager, Advertising, Marketing automation, Consent, Live chat, Support, Docs, Fonts, Language - e.g. "cms" also matches "Headless CMS" and "framework" matches JS/CSS framework. An unmatched category returns an empty page (count 0), not an error. limit/offset page the filtered list; total = number of matching technologies.',
                "EXAMPLE: {\"url\":\"vercel.com\",\"category\":\"hosting\"} -> {count:1, items:[{type:\"technology\", name:\"Vercel\", category:\"hosting\", evidence:\"...\"}], ...}",
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                category: z.string().optional().describe('Optional, default omitted = all categories. Case-insensitive substring of the category name (e.g. "analytics", "cms", "cdn", "hosting", "e-commerce"). Example: "analytics"'),
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
                'Find a site\'s XML sitemap (robots.txt Sitemap: lines, then /sitemap.xml, /sitemap_index.xml, or an explicit sitemapUrl), report whether it is a sitemap index, list child sitemaps, and page through the contained URLs with lastmod.',
                'WHEN TO USE: count/inspect indexed pages, find recently modified URLs (filter with contains / sort), feed URLs into web_seo_audit.',
                FETCH_BEHAVIOR + ' Sitemap files are capped at 10 MB each (meta.truncated=true when cut).',
                'RETURNS: paged "url" rows (lastmod is null when the sitemap gives none); meta says which sitemap was used and whether it is an index. Errors: SITEMAP_NOT_FOUND plus ' + ERRORS.replace('Errors (isError=true, JSON {error, message, retryable}): ', '') + '.',
                "WHEN NOT TO USE: not a crawler and does not audit pages - pass selected URLs to web_seo_audit; for AI-bot robots.txt rules use web_ai_crawler_access.",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: url: only its origin is used for discovery (the path is ignored); discovery tries robots.txt Sitemap: lines, /sitemap.xml and /sitemap_index.xml (max 4 candidates) and, if nothing is found, retries once on the origin the homepage redirects to (example.com -> www.example.com). sitemapUrl skips discovery entirely (no robots.txt, no retry) - use it for sitemaps at non-standard paths; it must be an absolute http(s) URL. maxChildSitemaps only matters when the sitemap is an index: only the first N children (index order) are downloaded, so total counts URLs of those children only; 0 lists child_sitemaps without URLs. contains is a case-sensitive substring test on loc; sort "lastmod_desc" orders by lastmod (ISO strings) with undated URLs last. Both are applied before paging, so total reflects the filtered list; continue with offset = nextOffset.',
                "EXAMPLE: {\"url\":\"python.org\",\"contains\":\"/blog/\",\"sort\":\"lastmod_desc\",\"limit\":10} -> paged url rows with loc and lastmod.",
            ].join('\n'),
            inputSchema: {
                url: urlArg,
                sitemapUrl: z.string().url().optional().describe('Optional, default = auto-discovery. Absolute http(s) URL of a sitemap or sitemap index to use instead of discovery. Example: "https://www.python.org/sitemap.xml"'),
                maxChildSitemaps: z.number().int().min(0).max(20).optional().describe('Optional integer 0-20, default 3. For sitemap indexes only: number of child sitemaps (in index order) to fetch and list URLs from; 0 = list children only. Example: 10'),
                contains: z.string().optional().describe('Optional, default no filter. Case-sensitive substring that loc must contain. Example: "/blog/"'),
                sort: z.enum(['sitemap', 'lastmod_desc']).optional().describe('Optional, one of "sitemap" | "lastmod_desc", default "sitemap" (file order); "lastmod_desc" = most recently modified first, undated last'),
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
                'WHEN TO USE: quick security posture / hygiene check of a site.',
                FETCH_BEHAVIOR + ' One request (after redirects); headers are taken from the final response.',
                'RETURNS: one "security_headers" object: input, final_url, status_code, https, score, grade, headers[{header, present, value, warning, weight}], missing[], info_disclosure_headers[{header, value}], checked_at. ' + ERRORS + '.',
                "WHEN NOT TO USE: not a vulnerability/penetration scan; for dependency CVEs use an OSV tool; for SEO use web_seo_audit.",
                "COST: free - runs locally in this MCP server (direct HTTP GETs), no APIFY_TOKEN, no Apify billing.",
                'PARAMETERS: url: headers are read from the FINAL response after up to 5 redirects, so "github.com" grades https://github.com/ - the redirecting hop itself is not graded. Path matters when a site sets different headers per path (e.g. "/login" vs "/"); test the exact page you care about. A bare domain is requested over https; pass "http://..." explicitly to see whether plain HTTP redirects to HTTPS - a final response over plain HTTP caps the score at 40 (grade D at best). Only response headers are evaluated (one request, body capped at 100 KB), never page content.',
                "EXAMPLE: {\"url\":\"github.com\"} -> {type:\"security_headers\", score:0-100, grade:\"A\"..\"F\", missing:[...], ...}",
            ].join('\n'),
            inputSchema: { url: z.string().min(1).describe('Required. One public domain or http(s) URL (non-empty string), e.g. "github.com" or "http://example.com/login". Bare domains use https; headers come from the final response after redirects; private/loopback hosts are refused.') },
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
                'WHEN TO USE: track SEO regressions/improvements over time, verify a fix, compare competitors. Fetches like web_seo_audit (live modes only).',
                'RETURNS: {summary{before_url, after_url, before_checked_at, after_checked_at, seo_score_before, seo_score_after, seo_score_delta, ai_readiness_score_delta, issues_added, issues_resolved, changed_fields}, changes[{type:"change", field, before, after, delta?, added?, removed?} | {type:"issue_added"|"issue_resolved", code}], before, after (only fetched snapshots are echoed)}. Errors: INVALID_ARGUMENTS (wrong mode combination) plus ' + ERRORS.replace('Errors (isError=true, JSON {error, message, retryable}): ', '') + '.',
                "WHEN NOT TO USE: for a single audit without comparison use web_seo_audit.",
                "COST: free (local fetches, no APIFY_TOKEN).",
                'PARAMETERS: exactly one of three combinations is accepted, any other combination (including all four or a single field) returns INVALID_ARGUMENTS without fetching: {before, after} | {before, url} | {url, compareUrl}. before/after must be whole snapshot objects as returned (type "seo_audit" from web_seo_audit, or a "site" row from web_batch_audit) - pass them unmodified; missing fields are compared as null. In {before, url} the live side is re-audited with checkRobots=true, so compare it only with a snapshot also taken with checkRobots=true. In {url, compareUrl} url is the "before" side and compareUrl the "after" side, so seo_score_delta = compareUrl score minus url score. url and compareUrl follow the same rules as web_seo_audit url (bare domain -> https, exact page).',
                "EXAMPLE: {\"url\":\"mysite.com\",\"compareUrl\":\"competitor.com\"} -> {summary:{seo_score_delta, issues_added, ...}, changes:[...]}",
            ].join('\n'),
            inputSchema: {
                before: z.record(z.string(), z.unknown()).optional().describe('Optional; used with after or url. Earlier snapshot object, unmodified output of web_seo_audit (type "seo_audit") or a web_batch_audit "site" row. Example: {"type":"seo_audit","final_url":"https://example.com/","seo_score":72,...}'),
                after: z.record(z.string(), z.unknown()).optional().describe('Optional; used only with before. Later snapshot object of the same shape to compare against before'),
                url: z.string().min(1).optional().describe('Optional; used with before or compareUrl. Public domain or http(s) URL audited live: the "after" side (with before) or the "before" side (with compareUrl). Example: "mysite.com"'),
                compareUrl: z.string().min(1).optional().describe('Optional; used only with url. Second public domain or http(s) URL audited live as the "after" side. Example: "competitor.com"'),
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
                'WHEN TO USE: lists of 20+ sites (lead enrichment, portfolio/market scans) where you want server-side parallelism and a dataset. For one or a few sites prefer the free tools: web_quick_check, web_seo_audit, web_ai_crawler_access, web_tech_stack, web_sitemap_info, web_security_headers. Rows can be stored and later diffed with web_compare_snapshots.',
                'BEHAVIOR: runs the Actor via the Apify API (run-sync), a few polite GET requests per site, respects robots.txt by default, no JS rendering. Requires APIFY_TOKEN (never logged). Typical 2-10 s per site, parallel.',
                'COST: paid (billed to your Apify account, pay-per-event): $0.00005 per run + $0.0015 per site row; error rows are free. 50 sites ~ $0.08.',
                'RETURNS: one "site" row per unique URL (a snapshot web_compare_snapshots accepts) or free "error" rows: code (INPUT_EMPTY, INVALID_URL, MAX_SITES_EXCEEDED, ROBOTS_DISALLOWED, FETCH_FAILED, HTTP_ERROR, BLOCKED_OR_RATE_LIMITED), message, retryable, input. Tool-level errors: APIFY_TOKEN_MISSING, APIFY_ACTOR_RUN_FAILED.',
                "WHEN NOT TO USE: for 1-20 sites or interactive questions use the free tools above (same checks).",
                'PARAMETERS: urls: bare domains use https, entries are deduped, and each unique URL is one billed site row; invalid, robots-disallowed or unreachable entries become free error rows. maxSites (default 500) caps unique URLs per run and is therefore your spend cap; extras get one free MAX_SITES_EXCEEDED row. The check* flags only remove work and fields, never change the price: checkRobots=false sets ai_bots / robots_txt_found to null, checkSitemap=false sitemap_*, checkLlmsTxt=false llms_txt_*; MISSING_ROBOTS_TXT / MISSING_SITEMAP issues are then not raised, so seo_score is not comparable across different flag settings. respectRobotsTxt is independent of checkRobots: robots.txt is still fetched when it is true, and a disallowed page yields a free ROBOTS_DISALLOWED row instead of an audit; set false only for sites you own or may audit.',
                "EXAMPLE: {\"urls\":[\"vercel.com\",\"netlify.com\"],\"checkLlmsTxt\":false} -> {count:2, items:[{type:\"site\", domain:\"vercel.com\", seo_score:..., ...}, ...]}",
            ].join('\n'),
            inputSchema: {
                urls: z.array(z.string().min(1)).min(1).max(5000).describe('Required. 1-5000 domains or http(s) URLs; bare domains use https; one billed row per unique URL. Example: ["vercel.com","https://www.python.org/about/"]'),
                checkRobots: z.boolean().optional().describe('Optional boolean, default true. Fetch robots.txt and report allowed/partial/blocked per AI bot; false = ai_bots null'),
                checkSitemap: z.boolean().optional().describe('Optional boolean, default true. Find the XML sitemap and count its URLs; false = sitemap fields null'),
                checkLlmsTxt: z.boolean().optional().describe('Optional boolean, default true. Check /llms.txt and /llms-full.txt; false = llms_txt fields null'),
                respectRobotsTxt: z.boolean().optional().describe('Optional boolean, default true (recommended). Skip pages robots.txt disallows for generic crawlers, emitting a free ROBOTS_DISALLOWED row'),
                maxSites: z.number().int().min(1).max(10000).optional().describe('Optional integer 1-10000, default 500. Safety/spend cap on unique URLs per run; extras produce one free MAX_SITES_EXCEEDED error row. Example: 100'),
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
