import { describe, expect, it } from 'vitest';
import { Http, normalizeUrl } from '../src/http.js';
import { aiReadiness, extractPage, seoAudit } from '../src/page.js';
import { botStatus, isAllowed, looksLikeLlmsTxt, parseLlmsTxt, parseRobots, parseSitemap } from '../src/robots.js';
import { detectTech } from '../src/tech.js';

const HTML = `<!doctype html><html lang="en"><head>
<title>Acme Widgets – Best widgets</title>
<meta name="description" content="Acme makes widgets.">
<meta name="viewport" content="width=device-width">
<meta name="generator" content="WordPress 6.5">
<link rel="canonical" href="/home">
<link rel="icon" href="/favicon.ico">
<link rel="alternate" hreflang="de" href="/de">
<link rel="alternate" type="application/rss+xml" href="/feed">
<meta property="og:title" content="Acme"><meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script>
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
</head><body><h1>Widgets</h1><h2>A</h2>
<a href="/about">About</a><a href="https://acme.com/x">x</a><a href="https://other.org">o</a>
<a href="https://twitter.com/acme">t</a><a href="mailto:a@b.c">m</a>
<img src="a.png" alt="a"><img src="b.png">
<p>${'word '.repeat(200)}</p><script>var notCounted = 1;</script></body></html>`;

describe('extractPage', () => {
    const p = extractPage(HTML, 'https://www.acme.com/');
    it('extracts metadata', () => {
        expect(p.title).toBe('Acme Widgets – Best widgets');
        expect(p.meta_description).toBe('Acme makes widgets.');
        expect(p.canonical).toBe('https://www.acme.com/home');
        expect(p.lang).toBe('en');
        expect(p.viewport).toBe(true);
        expect(p.h1).toEqual(['Widgets']);
        expect(p.headings_count.h2).toBe(1);
        expect(p.open_graph).toEqual({ title: 'Acme' });
        expect(p.twitter_card).toEqual({ card: 'summary' });
        expect(p.json_ld_types.sort()).toEqual(['Organization', 'Thing', 'WebSite']);
        expect(p.hreflang).toEqual(['de']);
        expect(p.feeds).toEqual(['https://www.acme.com/feed']);
        expect(p.favicon).toBe('https://www.acme.com/favicon.ico');
        expect(p.generator).toBe('WordPress 6.5');
    });
    it('counts links, images and words', () => {
        expect(p.links_internal).toBe(2);
        expect(p.links_external).toBe(2);
        expect(p.social_links).toEqual(['https://twitter.com/acme']);
        expect(p.images).toBe(2);
        expect(p.images_missing_alt).toBe(1);
        expect(p.word_count).toBeGreaterThanOrEqual(200);
        expect(p.word_count).toBeLessThan(215);
    });
    it('audits SEO', () => {
        const a = seoAudit(p, { https: true, statusCode: 200, robotsFound: true, sitemapFound: false });
        expect(a.issues.map((i) => i.code).sort()).toEqual(['IMAGES_MISSING_ALT', 'MISSING_SITEMAP']);
        expect(a.score).toBe(84);
        const bad = seoAudit(extractPage('<html><body></body></html>', 'http://x.com/'), {
            https: false,
            statusCode: 200,
            robotsFound: false,
            sitemapFound: false,
        });
        expect(bad.issues.map((i) => i.code)).toEqual(
            expect.arrayContaining(['NO_HTTPS', 'MISSING_TITLE', 'MISSING_H1', 'THIN_CONTENT']),
        );
        expect(bad.score).toBeLessThanOrEqual(20);
    });
});

describe('detectTech', () => {
    it('detects from html, meta and headers', () => {
        const h = new Headers({ server: 'cloudflare', 'x-powered-by': 'PHP/8.2', 'cf-ray': 'x' });
        const names = detectTech(HTML, h, 'WordPress 6.5').map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['WordPress', 'Google Analytics', 'Cloudflare', 'PHP']));
        expect(names.filter((n) => n === 'Cloudflare')).toHaveLength(1);
        expect(detectTech('<html></html>', new Headers(), null)).toEqual([]);
    });
});

describe('robots', () => {
    const r = parseRobots(`# comment
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
User-agent: CCBot
Disallow: /private/
Allow: /private/ok$

User-agent: *
Disallow: /admin
Allow: /admin/public
Sitemap: https://x.com/sitemap.xml
`);
    it('parses groups and sitemaps', () => {
        expect(r.sitemaps).toEqual(['https://x.com/sitemap.xml']);
        expect(r.groups).toHaveLength(3);
        expect(r.groups[1].agents).toEqual(['claudebot', 'ccbot']);
    });
    it('evaluates longest match per RFC 9309', () => {
        expect(isAllowed(r, 'GPTBot', '/')).toBe(false);
        expect(isAllowed(r, 'ClaudeBot', '/private/x')).toBe(false);
        expect(isAllowed(r, 'ClaudeBot', '/private/ok')).toBe(true);
        expect(isAllowed(r, 'FairqueryBot', '/admin/x')).toBe(false);
        expect(isAllowed(r, 'FairqueryBot', '/admin/public/y')).toBe(true);
        expect(isAllowed(r, 'FairqueryBot', '/')).toBe(true);
        expect(botStatus(r, 'GPTBot')).toBe('blocked');
        expect(botStatus(r, 'CCBot')).toBe('partial');
        expect(botStatus(parseRobots(''), 'GPTBot')).toBe('allowed');
    });
});

describe('sitemap / llms.txt', () => {
    it('parses sitemap', () => {
        expect(parseSitemap('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>')).toEqual({
            isIndex: false,
            count: 2,
        });
        expect(parseSitemap('<sitemapindex><sitemap><loc>a</loc></sitemap></sitemapindex>').isIndex).toBe(true);
    });
    it('parses and validates llms.txt', () => {
        const t = '# Acme\n\n> Widgets\n\n## Docs\n- [API](https://acme.com/api.md): api\n- [Guide](/guide.md)\n';
        expect(parseLlmsTxt(t)).toEqual({ title: 'Acme', links: 2 });
        expect(looksLikeLlmsTxt(t, 'text/plain')).toBe(true);
        expect(looksLikeLlmsTxt('<!doctype html><h1>404</h1>', 'text/plain')).toBe(false);
        expect(looksLikeLlmsTxt(t, 'text/html; charset=utf-8')).toBe(false);
    });
    it('scores AI readiness', () => {
        const full = aiReadiness({
            llms: true,
            llmsFull: true,
            aiBots: { a: 'allowed' },
            jsonLd: 1,
            wordCount: 500,
            sitemap: true,
            metaDescription: true,
            noindex: false,
        });
        expect(full).toBe(100);
        expect(
            aiReadiness({
                llms: false,
                llmsFull: false,
                aiBots: { a: 'blocked', b: 'allowed' },
                jsonLd: 0,
                wordCount: 10,
                sitemap: false,
                metaDescription: false,
                noindex: false,
            }),
        ).toBe(10);
    });
});

describe('http', () => {
    it('normalizes URLs', () => {
        expect(normalizeUrl('example.com')?.href).toBe('https://example.com/');
        expect(normalizeUrl('http://a.io/x#y')?.href).toBe('http://a.io/x');
        expect(normalizeUrl('ftp://a.io')).toBeNull();
        expect(normalizeUrl('localhost')).toBeNull();
        expect(normalizeUrl('')).toBeNull();
    });
    it('caps body size', async () => {
        const stream = (): ReadableStream<Uint8Array> => {
            let n = 0;
            return new ReadableStream({
                pull(c) {
                    if (n++ < 10) c.enqueue(new TextEncoder().encode('x'.repeat(500)));
                    else c.close();
                },
            });
        };
        const fake = (async () => new Response(stream())) as unknown as typeof fetch;
        const r = await new Http(fake).get('https://a.io/', { maxBytes: 1000 });
        expect(r.body.length).toBeGreaterThanOrEqual(1000);
        expect(r.body.length).toBeLessThan(5000);
    });
});
