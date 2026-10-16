/** Shared types for Website Tech, SEO & AI-Readiness Check (Fairquery) */

export const SCHEMA_VERSION = '1.0.0';
export const USER_AGENT = 'Mozilla/5.0 (compatible; FairqueryBot/1.0; +https://apify.com/fairquery)';
export const BOT_TOKEN = 'FairqueryBot';
export const SITE_CONCURRENCY = 5;
export const MAX_HTML_BYTES = 3_000_000;

export const AI_BOTS = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'ClaudeBot',
    'Claude-User',
    'anthropic-ai',
    'PerplexityBot',
    'Google-Extended',
    'CCBot',
    'Bytespider',
    'Applebot-Extended',
    'Meta-ExternalAgent',
    'Amazonbot',
] as const;

export interface ActorInput {
    urls?: string[];
    checkRobots?: boolean;
    checkSitemap?: boolean;
    checkLlmsTxt?: boolean;
    respectRobotsTxt?: boolean;
    maxSites?: number;
}

export type RowType = 'site' | 'error';

export interface BaseRow {
    schema_version: string;
    type: RowType;
    source_url: string;
    checked_at: string;
}

export interface TechHit {
    name: string;
    category: string;
    evidence: string;
}

export interface SeoIssue {
    code: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
}

export interface SiteRow extends BaseRow {
    type: 'site';
    input: string;
    final_url: string;
    domain: string;
    status_code: number;
    redirected: boolean;
    https: boolean;
    response_ms: number;
    content_type: string | null;
    html_bytes: number;
    // metadata
    title: string | null;
    meta_description: string | null;
    canonical: string | null;
    lang: string | null;
    meta_robots: string | null;
    viewport: boolean;
    h1: string[];
    headings_count: Record<string, number>;
    word_count: number;
    links_internal: number;
    links_external: number;
    images: number;
    images_missing_alt: number;
    favicon: string | null;
    open_graph: Record<string, string>;
    twitter_card: Record<string, string>;
    json_ld_types: string[];
    hreflang: string[];
    feeds: string[];
    social_links: string[];
    // tech
    technologies: TechHit[];
    server: string | null;
    security_headers: Record<string, boolean>;
    // robots / sitemap / llms.txt
    robots_txt_found: boolean | null;
    robots_txt_url: string | null;
    sitemaps_declared: string[];
    ai_bots: Record<string, 'allowed' | 'blocked' | 'partial'> | null;
    sitemap_found: boolean | null;
    sitemap_url: string | null;
    sitemap_url_count: number | null;
    sitemap_is_index: boolean | null;
    llms_txt_found: boolean | null;
    llms_txt_url: string | null;
    llms_txt_title: string | null;
    llms_txt_links: number | null;
    llms_full_txt_found: boolean | null;
    // scores
    seo_score: number;
    seo_issues: SeoIssue[];
    ai_readiness_score: number;
}

export interface ErrorRow extends BaseRow {
    type: 'error';
    code: string;
    message: string;
    retryable: boolean;
    input?: string;
    status_code?: number;
    context?: Record<string, unknown>;
}

export type OutputRow = SiteRow | ErrorRow;

export interface RunSummary {
    schema_version: string;
    started_at: string;
    finished_at: string;
    urls_requested: number;
    sites_checked: number;
    errors: number;
    http_requests: number;
    avg_seo_score: number | null;
    avg_ai_readiness_score: number | null;
    llms_txt_found: number;
    input: ActorInput;
}

export const CHARGE_EVENTS = {
    siteChecked: 'site-checked',
} as const;
