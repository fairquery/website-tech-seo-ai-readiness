import type { TechHit } from './types.js';

interface Sig {
    name: string;
    category: string;
    html?: RegExp;
    header?: [string, RegExp];
    cookie?: RegExp;
    meta?: [string, RegExp];
}

/** Lightweight signature set (single-request detection, no JS execution). */
export const SIGNATURES: Sig[] = [
    // CMS / site builders
    { name: 'WordPress', category: 'CMS', html: /\/wp-(content|includes)\//i, meta: ['generator', /wordpress/i] },
    {
        name: 'Drupal',
        category: 'CMS',
        html: /\/sites\/(default|all)\/(files|themes)\//i,
        header: ['x-generator', /drupal/i],
    },
    { name: 'Joomla', category: 'CMS', meta: ['generator', /joomla/i] },
    { name: 'Ghost', category: 'CMS', meta: ['generator', /ghost/i] },
    {
        name: 'Wix',
        category: 'Site builder',
        html: /static\.wixstatic\.com|wix-bolt/i,
        header: ['x-wix-request-id', /./],
    },
    { name: 'Squarespace', category: 'Site builder', html: /static1\.squarespace\.com|squarespace-cdn/i },
    {
        name: 'Webflow',
        category: 'Site builder',
        html: /webflow\.(js|com)|data-wf-page/i,
        meta: ['generator', /webflow/i],
    },
    {
        name: 'Framer',
        category: 'Site builder',
        html: /framerusercontent\.com|framer\.com\/m\//i,
        meta: ['generator', /framer/i],
    },
    { name: 'HubSpot CMS', category: 'CMS', header: ['x-hs-hub-id', /./], html: /hs-sites\.com|hubspot-cms/i },
    { name: 'Contentful', category: 'Headless CMS', html: /ctfassets\.net/i },
    { name: 'Sanity', category: 'Headless CMS', html: /cdn\.sanity\.io/i },
    // E-commerce
    { name: 'Shopify', category: 'E-commerce', html: /cdn\.shopify\.com|Shopify\.theme/i, header: ['x-shopid', /./] },
    { name: 'WooCommerce', category: 'E-commerce', html: /woocommerce/i },
    { name: 'Magento', category: 'E-commerce', html: /mage\/cookies|Magento_/i, cookie: /X-Magento/i },
    { name: 'BigCommerce', category: 'E-commerce', html: /cdn\d*\.bigcommerce\.com/i },
    { name: 'PrestaShop', category: 'E-commerce', meta: ['generator', /prestashop/i] },
    // JS frameworks
    {
        name: 'Next.js',
        category: 'JS framework',
        html: /\/_next\/static|__NEXT_DATA__/,
        header: ['x-powered-by', /next\.js/i],
    },
    { name: 'Nuxt', category: 'JS framework', html: /\/_nuxt\/|__NUXT__/ },
    { name: 'Gatsby', category: 'JS framework', html: /___gatsby|gatsby-/i, meta: ['generator', /gatsby/i] },
    { name: 'Astro', category: 'JS framework', html: /astro-island|\/_astro\//, meta: ['generator', /astro/i] },
    { name: 'SvelteKit', category: 'JS framework', html: /__sveltekit|\/_app\/immutable\//i },
    { name: 'Remix', category: 'JS framework', html: /__remixContext|__remixManifest/ },
    { name: 'Angular', category: 'JS framework', html: /ng-version=|ng-app/ },
    { name: 'Vue.js', category: 'JS framework', html: /data-v-[0-9a-f]{8}|vue(\.min|\.runtime)?\.js/i },
    {
        name: 'React',
        category: 'JS library',
        html: /data-reactroot|react(-dom)?(\.production)?(\.min)?\.js|__NEXT_DATA__/i,
    },
    { name: 'jQuery', category: 'JS library', html: /jquery([.-][\d.]+)?(\.min)?\.js/i },
    { name: 'Docusaurus', category: 'Docs', meta: ['generator', /docusaurus/i] },
    { name: 'Hugo', category: 'Static site generator', meta: ['generator', /hugo/i] },
    { name: 'Jekyll', category: 'Static site generator', meta: ['generator', /jekyll/i] },
    // CSS
    {
        name: 'Tailwind CSS',
        category: 'CSS framework',
        html: /class="[^"]*\b(?:flex|grid) [^"]*\b(?:px|py|mt|mb)-\d[^"]*"/,
    },
    { name: 'Bootstrap', category: 'CSS framework', html: /bootstrap(\.min)?\.(css|js)/i },
    // Analytics / marketing
    {
        name: 'Google Analytics',
        category: 'Analytics',
        html: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(analytics|ga)\.js/i,
    },
    { name: 'Google Tag Manager', category: 'Tag manager', html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ },
    { name: 'Plausible', category: 'Analytics', html: /plausible\.io\/js/i },
    { name: 'Fathom', category: 'Analytics', html: /cdn\.usefathom\.com/i },
    { name: 'PostHog', category: 'Analytics', html: /posthog/i },
    { name: 'Mixpanel', category: 'Analytics', html: /cdn\.mxpnl\.com|mixpanel/i },
    { name: 'Segment', category: 'Analytics', html: /cdn\.segment\.com/i },
    { name: 'Hotjar', category: 'Analytics', html: /static\.hotjar\.com/i },
    { name: 'Microsoft Clarity', category: 'Analytics', html: /clarity\.ms\/tag/i },
    { name: 'Meta Pixel', category: 'Advertising', html: /connect\.facebook\.net\/[^"']*\/fbevents\.js/i },
    { name: 'LinkedIn Insight', category: 'Advertising', html: /snap\.licdn\.com/i },
    { name: 'HubSpot', category: 'Marketing automation', html: /js\.hs-scripts\.com|js\.hsforms\.net/i },
    { name: 'Intercom', category: 'Live chat', html: /widget\.intercom\.io|intercomSettings/i },
    { name: 'Drift', category: 'Live chat', html: /js\.driftt\.com/i },
    { name: 'Crisp', category: 'Live chat', html: /client\.crisp\.chat/i },
    { name: 'Zendesk', category: 'Support', html: /static\.zdassets\.com/i },
    { name: 'Stripe', category: 'Payments', html: /js\.stripe\.com/i },
    { name: 'PayPal', category: 'Payments', html: /paypal\.com\/sdk\/js|paypalobjects\.com/i },
    { name: 'Cookiebot', category: 'Consent', html: /consent\.cookiebot\.com/i },
    { name: 'OneTrust', category: 'Consent', html: /cdn\.cookielaw\.org|onetrust/i },
    { name: 'reCAPTCHA', category: 'Security', html: /google\.com\/recaptcha|recaptcha\/api\.js/i },
    { name: 'hCaptcha', category: 'Security', html: /hcaptcha\.com\/1\/api\.js/i },
    { name: 'Cloudflare Turnstile', category: 'Security', html: /challenges\.cloudflare\.com\/turnstile/i },
    // CDN / hosting / servers
    { name: 'Cloudflare', category: 'CDN', header: ['server', /cloudflare/i] },
    { name: 'Cloudflare', category: 'CDN', header: ['cf-ray', /./] },
    { name: 'Fastly', category: 'CDN', header: ['x-served-by', /cache-/i] },
    { name: 'Amazon CloudFront', category: 'CDN', header: ['x-amz-cf-id', /./] },
    { name: 'Akamai', category: 'CDN', header: ['x-akamai-transformed', /./] },
    { name: 'Vercel', category: 'Hosting', header: ['x-vercel-id', /./] },
    { name: 'Netlify', category: 'Hosting', header: ['x-nf-request-id', /./] },
    { name: 'GitHub Pages', category: 'Hosting', header: ['x-github-request-id', /./] },
    { name: 'Heroku', category: 'Hosting', header: ['via', /vegur/i] },
    { name: 'Fly.io', category: 'Hosting', header: ['fly-request-id', /./] },
    { name: 'Render', category: 'Hosting', header: ['rndr-id', /./] },
    { name: 'Nginx', category: 'Web server', header: ['server', /nginx/i] },
    { name: 'Apache', category: 'Web server', header: ['server', /apache/i] },
    { name: 'Microsoft IIS', category: 'Web server', header: ['server', /iis/i] },
    { name: 'LiteSpeed', category: 'Web server', header: ['server', /litespeed/i] },
    { name: 'Caddy', category: 'Web server', header: ['server', /caddy/i] },
    { name: 'PHP', category: 'Language', header: ['x-powered-by', /php/i], cookie: /PHPSESSID/ },
    { name: 'ASP.NET', category: 'Framework', header: ['x-powered-by', /asp\.net/i], cookie: /ASP\.NET_SessionId/ },
    { name: 'Express', category: 'Framework', header: ['x-powered-by', /express/i] },
    { name: 'Google Fonts', category: 'Fonts', html: /fonts\.googleapis\.com/i },
    { name: 'Font Awesome', category: 'Fonts', html: /font-?awesome/i },
];

export function detectTech(html: string, headers: Headers, generator: string | null): TechHit[] {
    const hits = new Map<string, TechHit>();
    const cookies = headers.get('set-cookie') ?? '';
    for (const s of SIGNATURES) {
        if (hits.has(s.name)) continue;
        let evidence: string | null = null;
        if (s.header) {
            const v = headers.get(s.header[0]);
            if (v !== null && s.header[1].test(v)) evidence = `header ${s.header[0]}`;
        }
        if (!evidence && s.meta && generator && s.meta[1].test(generator))
            evidence = `meta generator "${generator.slice(0, 60)}"`;
        if (!evidence && s.cookie && s.cookie.test(cookies)) evidence = 'cookie';
        if (!evidence && s.html) {
            const m = s.html.exec(html);
            if (m) evidence = `html "${m[0].slice(0, 60)}"`;
        }
        if (evidence) hits.set(s.name, { name: s.name, category: s.category, evidence });
    }
    return [...hits.values()];
}
