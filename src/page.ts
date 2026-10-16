import * as cheerio from 'cheerio';

import type { SeoIssue, SiteRow } from './types.js';

export type PageFacts = Pick<
    SiteRow,
    | 'title'
    | 'meta_description'
    | 'canonical'
    | 'lang'
    | 'meta_robots'
    | 'viewport'
    | 'h1'
    | 'headings_count'
    | 'word_count'
    | 'links_internal'
    | 'links_external'
    | 'images'
    | 'images_missing_alt'
    | 'favicon'
    | 'open_graph'
    | 'twitter_card'
    | 'json_ld_types'
    | 'hreflang'
    | 'feeds'
    | 'social_links'
> & { generator: string | null };

const SOCIAL =
    /^(https?:)?\/\/(www\.)?(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|tiktok\.com|mastodon\.social|bsky\.app)\//i;

/** Drop inline script/style bodies (keeps JSON-LD) so the DOM is a fraction of the raw HTML size. */
export function slimHtml(html: string): string {
    return html
        .replace(/<script\b(?![^>]*application\/ld\+json)([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg></svg>')
        .replace(/<!--[\s\S]*?-->/g, '');
}

export function extractPage(html: string, pageUrl: string): PageFacts {
    const $ = cheerio.load(slimHtml(html));
    const base = new URL(pageUrl);
    const abs = (h: string | undefined): string | null => {
        if (!h) return null;
        try {
            return new URL(h, base).href;
        } catch {
            return null;
        }
    };
    const meta = (sel: string): string | null => $(sel).first().attr('content')?.trim() || null;

    const og: Record<string, string> = {};
    $('meta[property^="og:"]').each((_, el) => {
        const k = $(el).attr('property')!.slice(3);
        const v = $(el).attr('content');
        if (v && !(k in og)) og[k] = v.trim();
    });
    const tw: Record<string, string> = {};
    $('meta[name^="twitter:"]').each((_, el) => {
        const k = $(el).attr('name')!.slice(8);
        const v = $(el).attr('content');
        if (v && !(k in tw)) tw[k] = v.trim();
    });

    const types = new Set<string>();
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            collectTypes(JSON.parse($(el).text()), types);
        } catch {
            /* ignore invalid JSON-LD */
        }
    });

    const headings: Record<string, number> = {};
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) headings[h] = $(h).length;

    let internal = 0;
    let external = 0;
    const social = new Set<string>();
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href')!;
        if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return;
        const u = abs(href);
        if (!u) return;
        if (SOCIAL.test(u)) social.add(u.replace(/\/$/, ''));
        if (new URL(u).hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) internal += 1;
        else external += 1;
    });

    const imgs = $('img');
    let missingAlt = 0;
    imgs.each((_, el) => {
        if ($(el).attr('alt') === undefined) missingAlt += 1;
    });

    const bodyText = $('body').clone().find('script,style,noscript,template').remove().end().text();
    const words = bodyText.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;

    return {
        title: $('head > title').first().text().trim() || $('title').first().text().trim() || null,
        meta_description: meta('meta[name="description" i]'),
        canonical: abs($('link[rel="canonical" i]').first().attr('href')),
        lang: $('html').attr('lang')?.trim() || null,
        meta_robots: meta('meta[name="robots" i]'),
        viewport: $('meta[name="viewport" i]').length > 0,
        h1: $('h1')
            .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean)
            .slice(0, 5),
        headings_count: headings,
        word_count: words,
        links_internal: internal,
        links_external: external,
        images: imgs.length,
        images_missing_alt: missingAlt,
        favicon: abs($('link[rel~="icon" i]').first().attr('href')) ?? null,
        open_graph: og,
        twitter_card: tw,
        json_ld_types: [...types].slice(0, 30),
        hreflang: $('link[rel="alternate" i][hreflang]')
            .map((_, el) => $(el).attr('hreflang')!)
            .get()
            .slice(0, 50),
        feeds: $('link[rel="alternate" i][type*="rss" i], link[rel="alternate" i][type*="atom" i]')
            .map((_, el) => abs($(el).attr('href')))
            .get()
            .filter(Boolean) as string[],
        social_links: [...social].slice(0, 20),
        generator: meta('meta[name="generator" i]'),
    };
}

function collectTypes(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const n of node) collectTypes(n, out);
    } else if (node && typeof node === 'object') {
        const t = (node as Record<string, unknown>)['@type'];
        if (typeof t === 'string') out.add(t);
        else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
        for (const v of Object.values(node)) if (v && typeof v === 'object') collectTypes(v, out);
    }
}

const WEIGHT = { high: 15, medium: 8, low: 3 } as const;

export function seoAudit(
    p: PageFacts,
    ctx: { https: boolean; statusCode: number; robotsFound: boolean | null; sitemapFound: boolean | null },
): { score: number; issues: SeoIssue[] } {
    const issues: SeoIssue[] = [];
    const add = (code: string, severity: SeoIssue['severity'], message: string): void => {
        issues.push({ code, severity, message });
    };
    if (!ctx.https) add('NO_HTTPS', 'high', 'Final URL is not served over HTTPS.');
    if (!p.title) add('MISSING_TITLE', 'high', 'No <title> tag.');
    else if (p.title.length > 60) add('TITLE_TOO_LONG', 'low', `Title is ${p.title.length} chars (>60).`);
    else if (p.title.length < 10) add('TITLE_TOO_SHORT', 'low', `Title is ${p.title.length} chars (<10).`);
    if (!p.meta_description) add('MISSING_META_DESCRIPTION', 'medium', 'No meta description.');
    else if (p.meta_description.length > 160)
        add('META_DESCRIPTION_TOO_LONG', 'low', `Meta description is ${p.meta_description.length} chars (>160).`);
    if (!p.h1.length) add('MISSING_H1', 'medium', 'No <h1> heading.');
    else if (p.h1.length > 1) add('MULTIPLE_H1', 'low', `${p.h1.length} <h1> headings.`);
    if (!p.canonical) add('MISSING_CANONICAL', 'low', 'No rel=canonical link.');
    if (!p.lang) add('MISSING_LANG', 'low', 'No lang attribute on <html>.');
    if (!p.viewport) add('MISSING_VIEWPORT', 'medium', 'No mobile viewport meta tag.');
    if (p.meta_robots && /noindex/i.test(p.meta_robots)) add('NOINDEX', 'high', 'Page has meta robots noindex.');
    if (!Object.keys(p.open_graph).length) add('MISSING_OPEN_GRAPH', 'low', 'No Open Graph tags.');
    if (!p.json_ld_types.length) add('MISSING_STRUCTURED_DATA', 'low', 'No JSON-LD structured data.');
    if (p.images && p.images_missing_alt / p.images > 0.2)
        add('IMAGES_MISSING_ALT', 'medium', `${p.images_missing_alt}/${p.images} images lack alt.`);
    if (p.word_count < 150)
        add('THIN_CONTENT', 'low', `Only ${p.word_count} words of visible text (may be JS-rendered).`);
    if (ctx.robotsFound === false) add('MISSING_ROBOTS_TXT', 'low', 'No robots.txt.');
    if (ctx.sitemapFound === false)
        add('MISSING_SITEMAP', 'medium', 'No XML sitemap found (robots.txt or /sitemap.xml).');
    const score = Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHT[i.severity], 0));
    return { score, issues };
}

/** 0–100: can AI agents/LLMs find and read this site? */
export function aiReadiness(r: {
    llms: boolean | null;
    llmsFull: boolean | null;
    aiBots: Record<string, string> | null;
    jsonLd: number;
    wordCount: number;
    sitemap: boolean | null;
    metaDescription: boolean;
    noindex: boolean;
}): number {
    let s = 0;
    if (r.llms) s += 25;
    if (r.llmsFull) s += 5;
    if (r.aiBots) {
        const v = Object.values(r.aiBots);
        s += Math.round(
            (20 * v.filter((x) => x === 'allowed').length + 10 * v.filter((x) => x === 'partial').length) / v.length,
        );
    } else s += 20;
    if (r.jsonLd > 0) s += 15;
    if (r.wordCount >= 150) s += 15;
    if (r.sitemap) s += 10;
    if (r.metaDescription) s += 10;
    if (r.noindex) s = Math.max(0, s - 30);
    return Math.min(100, s);
}
