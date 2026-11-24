# Tech Stack Detector, SEO & llms.txt Checker

## What does it do?

This **tech stack detector** returns **one structured row per website**: what it's built on (CMS, framework, analytics, chat, payments, CDN, hosting), its title, meta description, Open Graph and **JSON-LD**, an **SEO issue list with a 0–100 score**, **robots.txt rules for AI crawlers** (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot and more), the XML sitemap, **llms.txt / llms-full.txt**, security headers and a 0–100 AI-readiness score.

It uses plain HTTP with no browser, which suits lead enrichment and site audits. It checks the page you give it, not the whole site.

## How much does it cost?

Pay per event, no subscription. Prices per 1,000 sites:

| Event | Free plan | Starter (Bronze) | Scale (Silver) | Business (Gold) |
|---|---|---|---|---|
| `site-checked` (primary) | $1.50 | $1.35 | $1.20 | $1.00 |

The [Apify Free plan](https://apify.com/pricing) includes **$5 of usage every month**, no credit card needed, and this Actor's event charges come out of that $5. That covers about **3,300 websites a month** ($5 ÷ ($1.50/1,000)), plus a start fee of $0.05 per 1,000 runs. Sites that can't be fetched are never charged.

**Example (Free-plan prices):** 250 lead websites: 250 × ($1.50/1,000) = about **$0.38** ($375.00 per 1,000 such runs).

Paid Apify plans get the Store discount automatically: Starter = Bronze, Scale = Silver, Business = Gold. Set a maximum cost per run in the run options and the Actor stops cleanly at that limit.

## How to use it

1. Paste domains or URLs into **URLs** (for example `vercel.com`, `https://www.python.org`).
2. Keep robots.txt, sitemap and llms.txt checks on, or switch off what you don't need.
3. Click **Start** and export one row per site as CSV, Excel or JSON, or call it from Clay, n8n, Make or an AI agent.

**Example input**

```json
{
  "urls": [
    "apify.com",
    "https://www.python.org",
    "vercel.com"
  ]
}
```

**Example output** (one row from a real run on 2026-10-17, shortened to the main fields):

```json
{
  "input": "vercel.com",
  "final_url": "https://vercel.com/",
  "status_code": 200,
  "title": "Agentic Infrastructure - Vercel",
  "technologies": [
    {
      "name": "Next.js",
      "category": "JS framework"
    },
    {
      "name": "Tailwind CSS",
      "category": "CSS framework"
    },
    {
      "name": "Vercel",
      "category": "Hosting"
    }
  ],
  "server": "Vercel",
  "ai_bots": {
    "GPTBot": "partial",
    "ClaudeBot": "partial",
    "PerplexityBot": "partial",
    "Google-Extended": "partial"
  },
  "robots_txt_found": true,
  "sitemap_url_count": 8203,
  "llms_txt_found": true,
  "llms_full_txt_found": false,
  "seo_score": 100,
  "seo_issues": [],
  "ai_readiness_score": 85
}
```

## FAQ

### How can I find out what technology a website uses?

Add the site to **URLs** and run the Actor. The row lists detected technologies by category (CMS, framework, analytics, payments, CDN and more), read from the HTML, headers and scripts of that page.

### Does this site block GPTBot or ClaudeBot?

The row shows robots.txt rules per AI crawler (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot and others), plus whether the site serves llms.txt.

### How many websites can I check for free?

About 3,300 per month on Apify's Free plan, which includes $5 of usage.

### Does it crawl the whole site or render JavaScript?

No. It makes plain HTTP requests to the page you give it (plus robots.txt, sitemap and llms.txt). Single-page apps that render in the browser may show a `THIN_CONTENT` issue.

## Limits

Detection is heuristic (one request, no JavaScript). No Core Web Vitals or backlink data. robots.txt is respected by default.

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
| `site-checked` | $1.50 per 1,000 | Each website row returned |
| `apify-actor-start` | $0.05 per 1,000 runs | Once per run, per GB of memory (Apify default event) |

Error rows (`FETCH_FAILED`, `HTTP_ERROR`, `BLOCKED_OR_RATE_LIMITED`, `ROBOTS_DISALLOWED`, …) are **never charged**.

**Worked example:** 1,000 domains from a lead list where 60 cannot be fetched: 940 × ($1.50/1,000) = **$1.41**, plus $0.05 per 1,000 runs.

To cap spend, set a maximum cost per run in the run options; the Actor stops cleanly at the limit. `maxSites` caps how many sites one run checks. Prices are from the Store pricing tab (October 2026).

## Memory / runtime

Runs at a fixed **256 MB** (default and maximum; the check is network-bound, so more memory does not help), no browser, no proxy. Typically 1–3 s per site, 3 sites in parallel. Slow or rate-limiting sites take longer.

## MCP / Apify tools

Call from agents via [Apify MCP](https://mcp.apify.com) (`https://mcp.apify.com`, authenticated with your Apify token), Actor `fairquery/website-tech-seo-ai-readiness`:

```json
{ "actor": "fairquery/website-tech-seo-ai-readiness", "input": { "urls": ["stripe.com"] } }
```

Read dataset items (`type == "site"`) and `RUN_SUMMARY`.

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

$1.50 per 1,000 site rows, plus a start fee of $0.05 per 1,000 runs. Failed fetches are free.

**How do I limit spend?**

Set a maximum cost per run in the run options and/or lower `maxSites`.

**Does it crawl the whole site?**

No. Per site it fetches robots.txt, the given URL, the sitemap and `/llms.txt` + `/llms-full.txt`. Use a crawler for full-site audits.

**Can an AI agent call it?**

Yes, through [Apify MCP](https://mcp.apify.com) with Actor `fairquery/website-tech-seo-ai-readiness`.

## Fairquery family

Other Fairquery tools on the Apify Store. Each one returns structured rows with machine-readable error codes, and error rows are never charged:

- [Email Validator for Agents (MX, Disposable, Typo)](https://apify.com/fairquery/email-validator-mx-disposable): syntax, MX, disposable, role and typo checks without sending mail; $0.79 per 1,000 emails
- [Website Contact & Company Enricher](https://apify.com/fairquery/website-contact-company-enricher): domain in, public business emails, phones, socials and company details out; $3 per 1,000 domains
- [Sanctions & Watchlist Screener (OFAC, EU, UK, UN)](https://apify.com/fairquery/sanctions-watchlist-screener): fuzzy name screening against official sanctions lists; $3 per 1,000 names + $7.00 per 1,000 runs
- [LLM Data Guard: PII & Secret Redactor](https://apify.com/fairquery/llm-data-guard-pii-secrets): redact PII and secrets before text reaches an LLM; $1.50 per 1,000 documents + $0.20 per 1,000 findings
- [Dependency Vulnerability Check for Agents](https://apify.com/fairquery/osv-dependency-vulnerability-check): packages and lockfiles against OSV.dev; $0.50 per 1,000 packages + $1.50 per 1,000 vulnerabilities
- [EDGAR Company Facts & Filings for Agents](https://apify.com/fairquery/edgar-company-facts-filings): SEC filings and XBRL facts by ticker, CIK or name; $1.50 per 1,000 companies on the free plan; lower on paid Apify plans
- [Company Jobs Feed: Greenhouse, Lever & Ashby](https://apify.com/fairquery/company-jobs-feed): live jobs from employers' own ATS boards with age and repost signals; $0.99 per 1,000 jobs + $0.50 per 1,000 boards
- [Competitor Change Tracker: Pricing, Terms, Careers & Changelog](https://apify.com/fairquery/competitor-change-tracker): watch competitors' public pricing, terms, careers and changelog pages for real changes with plain-English summaries and webhook alerts; $0.30 per 1,000 pages + $4.90 per 1,000 changes
- [AI Exposure Scanner: Public Secrets, Files & AI-Crawler Policy](https://apify.com/fairquery/ai-exposure-scanner): passive, scored scan of your own domains and public GitHub repos for leaked secrets (masked), exposed files, AI-crawler policy, security headers and SPF/DMARC; $39.00 per 1,000 domains + $3.90 per 1,000 repos + $1.90 per 1,000 findings

All Fairquery Actors: https://apify.com/fairquery

## Disclaimer

Detection is heuristic (single request, no JS execution). Only publicly served files are read; robots.txt is respected by default.

## Links

- Apify Store: https://apify.com/fairquery/website-tech-seo-ai-readiness
- Contact: info@getfairquery.com
- License: MIT
