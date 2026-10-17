# Website Tech, SEO & llms.txt Check for Agents

**Returns one row per website (tech stack, SEO score, robots.txt AI-crawler rules, sitemap and llms.txt) for $1.50 per 1,000 sites.** You pay $0.0015 per site row, and error rows are free. Example: auditing 250 lead websites costs 250 × $0.0015 = **$0.38**, plus Apify's $0.00005 Actor-start fee.

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
| `urls` | `string[]` | – (required; 3 sample sites are prefilled in the Console form) | Domains or URLs |
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

| Event | Price | When |
| --- | --- | --- |
| `site-checked` | $0.0015 | Each website row returned |
| `apify-actor-start` | $0.00005 | Once per run, per GB of memory (Apify default event) |

Error rows (`FETCH_FAILED`, `HTTP_ERROR`, `BLOCKED_OR_RATE_LIMITED`, `ROBOTS_DISALLOWED`, …) are **never charged**.

**Worked example:** 1,000 domains from a lead list where 60 cannot be fetched: 940 × $0.0015 = **$1.41**, plus $0.00005.

To cap spend, set a maximum cost per run in the run options; the Actor stops cleanly at the limit. `maxSites` caps how many sites one run checks. Prices are from the Store pricing tab (October 2026).

## Memory / runtime

Runs at a fixed **256 MB** (default and maximum; the check is network-bound, so more memory does not help), no browser, no proxy. Typically 1–3 s per site, 3 sites in parallel. Slow or rate-limiting sites take longer.

## MCP / Apify tools

Call from agents via [Apify MCP](https://mcp.apify.com) (`https://mcp.apify.com`, authenticated with your Apify token), Actor `fairquery/website-tech-seo-ai-readiness`:

```json
{ "actor": "fairquery/website-tech-seo-ai-readiness", "input": { "urls": ["stripe.com"] } }
```

Read dataset items (`type == "site"`) and `RUN_SUMMARY`. A standalone stdio MCP server lives in the GitHub repo under `mcp/`.

## Works well after

- [Google Maps Scraper](https://apify.com/compass/crawler-google-places) or [Google Search Results Scraper](https://apify.com/apify/google-search-scraper): pass the website URLs they return into `urls` to see each business's tech stack, SEO basics and AI-crawler rules.
- Pair it with the [Website Contact & Company Enricher](https://apify.com/fairquery/website-contact-company-enricher) on the same domain list to get contacts and tech in two rows per company.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Run fails at once with `INPUT_EMPTY` | `urls` was empty. The three sample sites in the Console form are prefill only and are not sent with API calls. |
| `BLOCKED_OR_RATE_LIMITED` (HTTP 403/429) | The site blocks datacenter traffic or bots. These rows are free; the Actor does not use proxies or browsers to get around blocks. |
| `ROBOTS_DISALLOWED` | robots.txt disallows the page for generic crawlers. Set `respectRobotsTxt` to `false` only if you have the right to fetch the page. |
| Low SEO score or `THIN_CONTENT` on a modern site | The page renders its content with JavaScript. The Actor reads the server HTML only (no browser). |
| Technology missing from the list | Detection uses about 75 signatures from a single response, so some tools (for example tag-manager-only scripts) are not visible. The list is heuristic. |

## FAQ

**Does it render JavaScript?**

No. It makes plain HTTP requests, which keeps it fast and cheap. Content injected by JavaScript is not seen.

**What does the AI-readiness score measure?**

llms.txt (25), llms-full.txt (5), AI bots allowed (up to 20), JSON-LD (15), at least 150 words of server-rendered text (15), sitemap (10) and meta description (10); minus 30 for `noindex`. It is a heuristic, not a ranking factor.

**How much does it cost?**

$0.0015 per site row ($1.50 per 1,000), plus a $0.00005 start fee. Failed fetches are free.

**How do I limit spend?**

Set a maximum cost per run in the run options and/or lower `maxSites`.

**Does it crawl the whole site?**

No. Per site it fetches robots.txt, the given URL, the sitemap and `/llms.txt` + `/llms-full.txt`. Use a crawler for full-site audits.

**Can an AI agent call it?**

Yes, through [Apify MCP](https://mcp.apify.com) with Actor `fairquery/website-tech-seo-ai-readiness`, or through the stdio MCP server in the GitHub repo, which also has free single-URL tools.

## Fairquery family

Other Fairquery tools on the Apify Store. Each one returns structured rows with machine-readable error codes, and error rows are never charged:

- [Email Validator for Agents (MX, Disposable, Typo)](https://apify.com/fairquery/email-validator-mx-disposable): syntax, MX, disposable, role and typo checks without sending mail; $0.79 per 1,000 emails
- [Website Contact & Company Enricher](https://apify.com/fairquery/website-contact-company-enricher): domain in, public business emails, phones, socials and company details out; $3 per 1,000 domains
- [Sanctions & Watchlist Screener (OFAC, EU, UK, UN)](https://apify.com/fairquery/sanctions-watchlist-screener): fuzzy name screening against official sanctions lists; $3 per 1,000 names + $0.007 per run
- [LLM Data Guard: PII & Secret Redactor](https://apify.com/fairquery/llm-data-guard-pii-secrets): redact PII and secrets before text reaches an LLM; $1.50 per 1,000 documents + $0.20 per 1,000 findings
- [Dependency Vulnerability Check for Agents](https://apify.com/fairquery/osv-dependency-vulnerability-check): packages and lockfiles against OSV.dev; $0.50 per 1,000 packages + $1.50 per 1,000 vulnerabilities
- [EDGAR Company Facts & Filings for Agents](https://apify.com/fairquery/edgar-company-facts-filings): SEC filings and XBRL facts by ticker, CIK or name; from $1.50 per 1,000 companies
- **MCP server** [`@fairquery/agent-trust-mcp`](https://www.npmjs.com/package/@fairquery/agent-trust-mcp): one MCP server for Claude Desktop, Cursor and VS Code (`npx -y @fairquery/agent-trust-mcp`). It has 7 free tools that need no token, plus paid tools that call the PII, email, sanctions and OSV Actors with your own Apify token.

All Fairquery Actors: https://apify.com/fairquery

## Kits & templates

Optional guides from Fairquery for wiring this Actor into agents and automations (the Actor works fine without them):

- [AI Agent Data Toolkit Quick-Start](https://fairquery.gumroad.com/l/qayngz) (PDF): MCP setup for Claude Desktop and Cursor, API calls, recipes, cost estimates.
- [n8n + Zapier Workflow Template Pack](https://fairquery.gumroad.com/l/koffbf): 10 importable n8n workflows for the four Fairquery Actors, plus Zapier setup guides.
- [Agent Prompt Pack for Research & Lead Ops](https://fairquery.gumroad.com/l/djdilu): 69 prompts for company research, lead cleaning, SEO and security reviews.
- [Agent Starter Kit: 10 copy-paste MCP + n8n recipes](https://fairquery.gumroad.com/l/idvrck) ($5): 10 copy-paste MCP + n8n recipes, with ready-made Claude/Cursor configs and 3 starter workflows.

## Disclaimer

Detection is heuristic (single request, no JS execution). Only publicly served files are read; robots.txt is respected by default.

## Links

- Apify Store: https://apify.com/fairquery/website-tech-seo-ai-readiness
- GitHub: https://github.com/fairquery/website-tech-seo-ai-readiness
- Contact: fairquery@proton.me
- License: MIT
