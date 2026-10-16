#!/usr/bin/env node
/**
 * Fairquery Website Tech / SEO / AI-readiness stdio MCP server.
 * - check_websites: runs Apify Actor fairquery/website-tech-seo-ai-readiness (APIFY_TOKEN, pay-per-event).
 * - check_llms_txt: free direct check of /llms.txt and /llms-full.txt (no token).
 * initialize and tools/list work without any token.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { READ_ONLY_OPEN_WORLD, compact, proxyActor, rowsOutputSchema, rowsResult } from './common.js';

const ACTOR_ID = 'fairquery~website-tech-seo-ai-readiness';
const UA = 'FairqueryBot/1.0 (+https://apify.com/fairquery)';

function origin(input: string): string | null {
    try {
        const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
    } catch {
        return null;
    }
}

async function probe(url: string): Promise<{ found: boolean; status: number | null; bytes: number; title: string | null }> {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { found: false, status: res.status, bytes: 0, title: null };
        const text = (await res.text()).slice(0, 200_000);
        const ct = res.headers.get('content-type') ?? '';
        const looksHtml = ct.includes('html') || /^\s*<(!doctype|html)/i.test(text);
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
        return { found: !looksHtml && text.trim().length > 0, status: res.status, bytes: text.length, title: looksHtml ? null : title };
    } catch {
        return { found: false, status: null, bytes: 0, title: null };
    }
}

function createServer(): McpServer {
    const server = new McpServer({ name: 'fairquery-web', version: '1.1.0' });

    server.registerTool(
        'check_websites',
        {
            title: 'Website tech, SEO & AI-readiness audit',
            description: [
                'Audit websites: detect technologies (frameworks, CMS, hosting/CDN, analytics), on-page SEO (title, meta description, canonical, lang, H1s, Open Graph, JSON-LD types, word count, image alt), security headers, robots.txt rules for AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, ...), XML sitemap, and llms.txt / llms-full.txt, with an seo_score and ai_readiness_score (0-100).',
                'When to use: lead enrichment ("what stack does this site use?"), quick SEO health checks, or checking whether a site is visible to AI crawlers. For only an llms.txt check use check_llms_txt (free). Fetches the given page (plus robots.txt/sitemap/llms.txt), not a full crawl; no JavaScript rendering, so client-side-only content counts as thin.',
                'Behavior: read-only; runs the Fairquery Apify Actor fairquery/website-tech-seo-ai-readiness via the Apify API, making a few polite GET requests per site and respecting robots.txt by default. Requires APIFY_TOKEN. Typical 2-10 s per site, run in parallel.',
                'Cost (billed to the Apify account): $0.00005 per run + $0.002 per site row; error rows are free. 50 sites ~ $0.10.',
                'Returns {count, items}. site rows: domain, status_code, https, response_ms, title, meta_description, canonical, lang, h1[], word_count, open_graph, json_ld_types, technologies[{name, category, evidence}], security_headers, robots_txt_found, ai_bots{bot: allowed|partial|blocked}, sitemap_found, sitemap_url_count, llms_txt_found, llms_txt_title, seo_score, seo_issues[{code, severity, message}], ai_readiness_score, source_url, checked_at. error rows: code (INPUT_EMPTY, INVALID_URL, MAX_SITES_EXCEEDED, ROBOTS_DISALLOWED, FETCH_FAILED, HTTP_ERROR, BLOCKED_OR_RATE_LIMITED), message, retryable, input.',
            ].join('\n'),
            inputSchema: {
                urls: z
                    .array(z.string().min(1))
                    .min(1)
                    .max(5000)
                    .describe('Domains or URLs, e.g. ["vercel.com","https://www.python.org/about/"]. Bare domains use https. One row per unique URL.'),
                checkRobots: z
                    .boolean()
                    .optional()
                    .describe('Fetch robots.txt and report allow/partial/blocked per AI bot (default true)'),
                checkSitemap: z
                    .boolean()
                    .optional()
                    .describe('Find the XML sitemap (robots.txt Sitemap: or /sitemap.xml) and count URLs (default true)'),
                checkLlmsTxt: z.boolean().optional().describe('Check /llms.txt and /llms-full.txt (default true)'),
                respectRobotsTxt: z
                    .boolean()
                    .optional()
                    .describe('Skip pages robots.txt disallows for generic crawlers, emitting ROBOTS_DISALLOWED (default true, recommended)'),
                maxSites: z
                    .number()
                    .int()
                    .min(1)
                    .max(10000)
                    .optional()
                    .describe('Safety cap on unique URLs per run (default 500); extras produce a MAX_SITES_EXCEEDED error row'),
            },
            outputSchema: rowsOutputSchema,
            annotations: { title: 'Website tech, SEO & AI-readiness audit', ...READ_ONLY_OPEN_WORLD },
        },
        async (args) => proxyActor(ACTOR_ID, compact(args)),
    );

    server.registerTool(
        'check_llms_txt',
        {
            title: 'Check llms.txt presence (free)',
            description: [
                'Check whether sites publish /llms.txt and /llms-full.txt (llmstxt.org) at their origin and return the llms.txt H1 title.',
                'When to use: a quick, free yes/no on llms.txt support. For full SEO, technology, robots.txt AI-bot rules and scores use check_websites.',
                'Behavior: read-only; two HTTP GETs per site from this server (User-Agent FairqueryBot), 15 s timeout, no token, no cost. HTML responses (soft-404 pages) are not counted as found.',
                'Returns {count, items}: one "llms_txt" row per input with input, origin, llms_txt_url, llms_txt_found, llms_txt_status, llms_txt_bytes, llms_txt_title, llms_full_txt_found, llms_full_txt_status; or an "error" row with code INVALID_URL.',
            ].join('\n'),
            inputSchema: {
                urls: z.array(z.string().min(1)).min(1).max(20).describe('1-20 domains or URLs, e.g. ["vercel.com"]; only the origin is used'),
            },
            outputSchema: rowsOutputSchema,
            annotations: { title: 'Check llms.txt presence (free)', ...READ_ONLY_OPEN_WORLD },
        },
        async ({ urls }) => {
            const rows = await Promise.all(
                urls.map(async (input) => {
                    const o = origin(input);
                    if (!o) return { type: 'error', code: 'INVALID_URL', message: `Not a valid http(s) URL/domain: ${input}`, retryable: false, input };
                    const [a, b] = await Promise.all([probe(`${o}/llms.txt`), probe(`${o}/llms-full.txt`)]);
                    return {
                        type: 'llms_txt',
                        input,
                        origin: o,
                        llms_txt_url: `${o}/llms.txt`,
                        llms_txt_found: a.found,
                        llms_txt_status: a.status,
                        llms_txt_bytes: a.bytes,
                        llms_txt_title: a.title,
                        llms_full_txt_found: b.found,
                        llms_full_txt_status: b.status,
                    };
                }),
            );
            return rowsResult(rows);
        },
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
