/** Live test of every free tool against real public sites. Never prints APIFY_TOKEN. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const serverJs = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const env = { ...process.env }; delete env.APIFY_TOKEN;
const client = new Client({ name: 'fairquery-live', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverJs], env }));
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
let fails = 0;
async function t(name, args, check) {
  const r = await client.callTool({ name, arguments: args });
  const s = r.structuredContent ?? JSON.parse(r.content[0].text);
  let ok = !r.isError; let msg = '';
  try { msg = check(s); } catch (e) { ok = false; msg = e.message; }
  if (!ok) { fails++; msg += ' ' + JSON.stringify(s).slice(0, 300); }
  console.log(ok ? 'PASS' : 'FAIL', name, msg);
  return s;
}
async function expectErr(name, args, code) {
  const r = await client.callTool({ name, arguments: args });
  const ok = r.isError && r.content[0].text.includes(code);
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', name, 'error', code, ok ? '' : r.content[0].text.slice(0, 200));
}
await t('web_quick_check', { urls: ['https://python.org', 'example.com', 'http://127.0.0.1', 'nonexistent-domain-zz9.example'] }, (s) => {
  const [gh, ex, lo, nx] = s.items;
  if (gh.redirect_count < 1 || gh.status_code !== 200) throw new Error('redirect');
  if (lo.code !== 'BLOCKED_PRIVATE_ADDRESS') throw new Error('ssrf guard');
  if (nx.type !== 'error') throw new Error('dns');
  return `python.org ${gh.redirect_count} redirect -> ${gh.final_url} ${gh.response_ms}ms; example title=${JSON.stringify(ex.title)}; 127.0.0.1=${lo.code}; bad=${nx.code}`;
});
const snap = await t('web_seo_audit', { url: 'https://www.python.org/' }, (s) => { if (typeof s.seo_score !== 'number') throw new Error('score'); return `seo=${s.seo_score} ai=${s.ai_readiness_score} issues=${s.seo_issues.map((i) => i.code).join(',')} jsonld=${s.json_ld_types}`; });
await t('web_ai_crawler_access', { url: 'nytimes.com' }, (s) => `robots=${s.robots_txt_found} blocked=${s.blocked_count} GPTBot=${s.ai_bots.GPTBot} llms=${s.llms_txt.found}`);
await t('web_ai_crawler_access', { url: 'vercel.com', bots: ['GPTBot', 'Googlebot'] }, (s) => `custom bots ${JSON.stringify(s.ai_bots)} llms_title=${s.llms_txt.title}`);
await t('web_tech_stack', { url: 'vercel.com', limit: 3 }, (s) => { if (!s.total) throw new Error('no tech'); return `total=${s.total} next=${s.nextOffset} ${s.items.map((i) => i.name + '/' + i.category).join(', ')}`; });
await t('web_sitemap_info', { url: 'vercel.com', limit: 5, offset: 5, sort: 'lastmod_desc', contains: '/' }, (s) => { if (s.count !== 5) throw new Error('count'); return `index=${s.meta.is_index} total=${s.total} next=${s.nextOffset} first=${s.items[0].loc}`; });
await t('web_security_headers', { url: 'github.com' }, (s) => `grade=${s.grade} score=${s.score} missing=${s.missing.join(',')}`);
const modified = { ...snap, title: 'Old title', seo_score: snap.seo_score - 10, seo_issues: [...snap.seo_issues, { code: 'MISSING_H1', severity: 'medium', message: 'x' }], checked_at: '2026-01-01T00:00:00Z' };
await t('web_compare_snapshots', { before: modified, after: snap }, (s) => { if (s.summary.seo_score_delta !== 10) throw new Error('delta'); return `objects: delta=${s.summary.seo_score_delta} resolved=${s.summary.issues_resolved} changed=${s.summary.changed_fields}`; });
await t('web_compare_snapshots', { before: modified, url: 'https://www.python.org/' }, (s) => `follow-up: delta=${s.summary.seo_score_delta} changes=${s.changes.length}`);
await t('web_compare_snapshots', { url: 'example.com', compareUrl: 'example.org' }, (s) => `two urls: delta=${s.summary.seo_score_delta} changes=${s.changes.map((c) => c.field).join(',')}`);
await expectErr('web_compare_snapshots', { url: 'example.com' }, 'INVALID_ARGUMENTS');
await expectErr('web_seo_audit', { url: 'http://169.254.169.254/latest/meta-data/' }, 'BLOCKED_PRIVATE_ADDRESS');
await expectErr('web_security_headers', { url: 'localhost:8080' }, 'INVALID_URL');
await expectErr('web_sitemap_info', { url: 'example.com' }, 'SITEMAP_NOT_FOUND');
await expectErr('web_batch_audit', { urls: ['example.com'] }, 'APIFY_TOKEN_MISSING');
await client.close();
if (fails) { console.log('FAILURES', fails); process.exit(1); }
console.log('ALL PASS');
