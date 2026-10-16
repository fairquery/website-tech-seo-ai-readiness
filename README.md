# Website Tech, SEO & llms.txt Check for Agents

**Fairquery** Apify Actor that returns **one structured row per website**: tech stack, title/meta/Open Graph/JSON-LD, an SEO issue list with a 0–100 score, **robots.txt rules for AI crawlers** (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, …), XML sitemap, **llms.txt / llms-full.txt**, security headers, and a 0–100 **AI-readiness score**. Plain HTTP (no browser), so it's fast and cheap.

## When to use this Actor (LLM / tool selection)

Use it when an agent needs to:

- Enrich a lead/company list with "what is this site built on?" (CMS, framework, analytics, chat, payments, CDN, hosting)
- Run a quick on-page SEO check of homepages or landing pages
- Answer "does this site have an llms.txt?" / "does it block GPTBot or ClaudeBot?"
- Get a site's title, description, social links, feeds and structured-data types before summarizing it

Do **not** use it for full-site crawls, JS-rendered content (single-page apps may show `THIN_CONTENT`), Core Web Vitals, or backlink data.

## How it works

Per site (max 3 in parallel): `GET /robots.txt` → `GET <url>` → sitemap (from robots `Sitemap:` or `/sitemap.xml`, `/sitemap_index.xml`) → `/llms.txt` and `/llms-full.txt`. Identifies as `FairqueryBot/1.0`; by default skips pages that robots.txt disallows for generic crawlers. Tech detection uses ~75 HTML/header/cookie/meta-generator signatures from a single response.

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `urls` | `string[]` | `apify.com`, `python.org`, `vercel.com` | Domains or URLs |
| `checkRobots` | `bool` | `true` | robots.txt + AI-bot access map |
| `checkSitemap` | `bool` | `true` | Find sitemap and count URLs |
| `checkLlmsTxt` | `bool` | `true` | Check `/llms.txt` and `/llms-full.txt` |
| `respectRobotsTxt` | `bool` | `true` | Skip URLs disallowed for generic crawlers |
| `maxSites` | `int` | `500` | Safety cap per run |

```json
{ "urls": ["stripe.com", "https://www.example.org/pricing"], "checkSitemap": false }
```

## Output

Every row has `schema_version` (`1.0.0`), `type` (`site` | `error`), `source_url` (final fetched URL), `checked_at`.

```json
{
  "type": "site", "domain": "vercel.com", "status_code": 200, "https": true, "response_ms": 310,
  "title": "Agentic Infrastructure - Vercel", "meta_description": "…", "canonical": "https://vercel.com/", "lang": "en",
  "h1": ["…"], "word_count": 256, "open_graph": { "title": "…", "image": "…" }, "json_ld_types": ["Organization", "WebSite"],
  "technologies": [{ "name": "Next.js", "category": "JS framework", "evidence": "html \"/_next/static\"" }, { "name": "Vercel", "category": "Hosting", "evidence": "header x-vercel-id" }],
  "security_headers": { "strict_transport_security": true, "content_security_policy": true },
  "robots_txt_found": true, "ai_bots": { "GPTBot": "partial", "ClaudeBot": "partial" },
  "sitemap_found": true, "sitemap_url_count": 8787, "llms_txt_found": true, "llms_txt_title": "Vercel",
  "seo_score": 100, "seo_issues": [], "ai_readiness_score": 85
}
```

- `ai_bots[bot]`: `allowed` (no rules), `partial` (some paths disallowed), `blocked` (root disallowed).
- `seo_issues[]`: `{code, severity, message}`; codes include `NO_HTTPS`, `MISSING_TITLE`, `TITLE_TOO_LONG`, `MISSING_META_DESCRIPTION`, `MISSING_H1`, `MULTIPLE_H1`, `MISSING_CANONICAL`, `MISSING_LANG`, `MISSING_VIEWPORT`, `NOINDEX`, `MISSING_OPEN_GRAPH`, `MISSING_STRUCTURED_DATA`, `IMAGES_MISSING_ALT`, `THIN_CONTENT`, `MISSING_ROBOTS_TXT`, `MISSING_SITEMAP`. Score = 100 − 15/8/3 per high/medium/low issue.
- `ai_readiness_score`: llms.txt 25, llms-full.txt 5, AI bots allowed up to 20, JSON-LD 15, ≥150 words of server-rendered text 15, sitemap 10, meta description 10; −30 if `noindex`.

### Error rows (machine-readable, never charged)

```json
{ "type": "error", "code": "BLOCKED_OR_RATE_LIMITED", "message": "GET https://x.com/ returned HTTP 403.", "retryable": false, "status_code": 403, "input": "x.com" }
```

Codes: `INPUT_EMPTY`, `INVALID_URL`, `MAX_SITES_EXCEEDED`, `ROBOTS_DISALLOWED`, `FETCH_FAILED`, `HTTP_ERROR`, `BLOCKED_OR_RATE_LIMITED`.

### Run summary

Key-value store record **`RUN_SUMMARY`**: sites checked, errors, HTTP request count, average SEO and AI-readiness scores, llms.txt count, echoed input.

## Pricing

Pay per event: `site-checked` per site row. Error rows are never charged. See the Store pricing tab.

## Memory / runtime

Default **256 MB**, no browser, no proxy. Typically 1–3 s per site.

## MCP / Apify tools

Call from agents via [Apify MCP](https://mcp.apify.com) (`https://mcp.apify.com`, authenticated with your Apify token), Actor `fairquery/website-tech-seo-ai-readiness`:

```json
{ "actor": "fairquery/website-tech-seo-ai-readiness", "input": { "urls": ["stripe.com"] } }
```

Read dataset items (`type == "site"`) and `RUN_SUMMARY`. A standalone stdio MCP server lives in the GitHub repo under `mcp/`.

## Local stdio MCP server

This repo ships a **stdio MCP server** (TypeScript, `@modelcontextprotocol/sdk`) under [`mcp/`](./mcp) exposing one tool, `check_websites`, which runs this Actor through the Apify API. `initialize` and `tools/list` work **without** a token; tool calls require `APIFY_TOKEN` (billed per the Store pricing).

```bash
cd mcp && npm install && npm run build
node scripts/smoke-test.mjs                          # initialize + tools/list, no token
APIFY_TOKEN=... node scripts/smoke-test.mjs --call   # real tool call
```

```json
{ "mcpServers": { "fairquery-web": { "command": "node", "args": ["/path/to/website-tech-seo-ai-readiness/mcp/dist/index.js"], "env": { "APIFY_TOKEN": "<your Apify token>" } } } }
```

Docker: `docker build -f Dockerfile.mcp -t fairquery-web-mcp .` (build context = repo root; also the Dockerfile for Glama). `glama.json` lists `fairquery` as maintainer.

## Links

- Apify Store: https://apify.com/fairquery/website-tech-seo-ai-readiness
- License: MIT

## Local development

```bash
npm install
npx apify run      # uses input defaults, or storage/key_value_stores/default/INPUT.json
npm test
```

## Kits & templates

Optional guides from Fairquery for wiring this Actor into agents and automations (the Actor works fine without them):

- [AI Agent Data Toolkit Quick-Start](https://fairquery.gumroad.com/l/qayngz) (PDF): MCP setup for Claude Desktop and Cursor, API calls, recipes, cost estimates.
- [n8n + Zapier Workflow Template Pack](https://fairquery.gumroad.com/l/koffbf): 10 importable n8n workflows for the four Fairquery Actors, plus Zapier setup guides.
- [Agent Prompt Pack for Research & Lead Ops](https://fairquery.gumroad.com/l/djdilu): 69 prompts for company research, lead cleaning, SEO and security reviews.
- [Fairquery Starter Kit](https://fairquery.gumroad.com/l/idvrck) ($5): a low-cost starting point with setup notes and sample inputs for the four Fairquery Actors.

## Disclaimer

Detection is heuristic (single request, no JS execution). Only publicly served files are read; robots.txt is respected by default.
