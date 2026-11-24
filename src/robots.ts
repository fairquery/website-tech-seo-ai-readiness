export interface RobotsGroup {
    agents: string[];
    rules: { allow: boolean; path: string }[];
}

export interface Robots {
    groups: RobotsGroup[];
    sitemaps: string[];
}

export function parseRobots(text: string): Robots {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let cur: RobotsGroup | null = null;
    let lastWasAgent = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'user-agent') {
            if (!cur || !lastWasAgent) {
                cur = { agents: [], rules: [] };
                groups.push(cur);
            }
            cur.agents.push(val.toLowerCase());
            lastWasAgent = true;
        } else if (key === 'allow' || key === 'disallow') {
            lastWasAgent = false;
            if (cur && (val || key === 'allow')) cur.rules.push({ allow: key === 'allow', path: val });
        } else if (key === 'sitemap') {
            if (val) sitemaps.push(val);
        } else {
            lastWasAgent = false;
        }
    }
    return { groups, sitemaps };
}

function pathMatches(pattern: string, path: string): number {
    // returns match length (specificity) or -1
    const anchored = pattern.endsWith('$');
    const p = anchored ? pattern.slice(0, -1) : pattern;
    const re = new RegExp(
        `^${p
            .split('*')
            .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*')}${anchored ? '$' : ''}`,
    );
    return re.test(path) ? pattern.length : -1;
}

/** Groups applying to an agent: most specific product-token match, else '*'. */
export function groupsFor(robots: Robots, agent: string): RobotsGroup[] {
    const a = agent.toLowerCase();
    const specific = robots.groups.filter((g) => g.agents.some((x) => x !== '*' && a.startsWith(x)));
    return specific.length ? specific : robots.groups.filter((g) => g.agents.includes('*'));
}

/** RFC 9309 longest-match evaluation; allow wins ties. */
export function isAllowed(robots: Robots, agent: string, path: string): boolean {
    const rules = groupsFor(robots, agent).flatMap((g) => g.rules);
    let best = -1;
    let allow = true;
    for (const r of rules) {
        const len = pathMatches(r.path, path);
        if (len > best || (len === best && r.allow)) {
            if (len >= 0) {
                best = len;
                allow = r.allow;
            }
        }
    }
    return allow;
}

/** 'blocked' if root disallowed, 'partial' if any disallow rule applies, else 'allowed'. */
export function botStatus(robots: Robots, agent: string): 'allowed' | 'blocked' | 'partial' {
    if (!isAllowed(robots, agent, '/')) return 'blocked';
    const rules = groupsFor(robots, agent).flatMap((g) => g.rules);
    return rules.some((r) => !r.allow && r.path) ? 'partial' : 'allowed';
}

export function parseSitemap(xml: string): { isIndex: boolean; count: number } {
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const count = (xml.match(/<loc>/gi) ?? []).length;
    return { isIndex, count };
}

export function parseLlmsTxt(text: string): { title: string | null; links: number } {
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
    const links = (text.match(/\[[^\]]*\]\([^)]+\)/g) ?? []).length;
    return { title, links };
}

/** Heuristic: llms.txt is markdown text, not an HTML soft-404 page. */
export function looksLikeLlmsTxt(body: string, contentType: string | null): boolean {
    if (contentType && /html/i.test(contentType)) return false;
    const t = body.trimStart();
    if (/^<(!doctype|html)/i.test(t)) return false;
    return t.length > 0 && /^#\s+\S/m.test(t);
}
