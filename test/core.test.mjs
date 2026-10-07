import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, isWaived, settleMs } from '../src/config.mjs';
import { pathsFromSitemapXml } from '../src/urls.mjs';
import { flatten, diff, summarize, gateFailures, appendHistory, changedPages, confirmPages } from '../src/diff.mjs';
import { shouldNotify, mentions } from '../src/notify.mjs';
import { renderIssueBody, renderComment } from '../src/report.mjs';
import { templateOf, problemKey, vendorFor, groupProblems, scopeLabel, problemSummary } from '../src/group.mjs';
import { parseW3cTr, compare } from '../src/standards.mjs';

function writeConfig(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-')), 'a11y.config.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

const page = (p, vp, findings) => ({ path: p, viewport: vp, findings });
const finding = (rule, impact, count = 1) => ({ rule, impact, help: rule, helpUrl: '', wcag: [], nodes: [], count });

test('config: defaults fill in and trailing slash is trimmed', () => {
  const cfg = loadConfig(writeConfig({ site: 'x', baseUrl: 'https://example.com/' }));
  assert.equal(cfg.baseUrl, 'https://example.com');
  assert.equal(cfg.reflowWidth, 320);
  assert.deepEqual(cfg.gate.impacts, ['critical']);
});

test('config: missing site or baseUrl is fatal', () => {
  assert.throws(() => loadConfig(writeConfig({ baseUrl: 'https://example.com' })), /site/);
  assert.throws(() => loadConfig(writeConfig({ site: 'x', baseUrl: 'example.com' })), /baseUrl/);
});

test('config: a waiver without an approver is dropped with a warning', () => {
  const cfg = loadConfig(writeConfig({ site: 'x', baseUrl: 'https://e.com', waivers: [{ rule: 'a', reason: 'r' }, { rule: 'b', reason: 'r', approvedBy: 'Pat' }] }));
  assert.equal(cfg.waivers.length, 1);
  assert.equal(cfg.warnings.length, 1);
});

test('waivers match exact paths and prefixes', () => {
  const cfg = { waivers: [{ rule: 'r', paths: ['/find-us', '/shop/*'], reason: 'x', approvedBy: 'y' }, { rule: 'all', reason: 'x', approvedBy: 'y' }] };
  assert.ok(isWaived(cfg, 'r', '/find-us'));
  assert.ok(isWaived(cfg, 'r', '/shop/sauces/marinara'));
  assert.equal(isWaived(cfg, 'r', '/about'), undefined);
  assert.ok(isWaived(cfg, 'all', '/anything'));
});

test('sitemap: absolute URLs become paths, query kept', () => {
  const xml = '<urlset><url><loc>https://www.e.com/</loc></url><url><loc> https://www.e.com/a?b=1 </loc></url></urlset>';
  assert.deepEqual(pathsFromSitemapXml(xml), ['/', '/a?b=1']);
});

test('diff: new, fixed, ongoing, and a count increase counts as new', () => {
  const cfg = { waivers: [] };
  const before = flatten([page('/a', 'desktop', [finding('x', 'serious'), finding('y', 'minor', 2)]), page('/b', 'desktop', [finding('z', 'moderate')])], cfg);
  const now = flatten([page('/a', 'desktop', [finding('x', 'serious'), finding('y', 'minor', 3)]), page('/c', 'desktop', [finding('w', 'critical')])], cfg);
  const d = diff(now, before);
  assert.deepEqual(d.added.map((r) => r.key).sort(), ['w|/c|desktop', 'y|/a|desktop']);
  assert.equal(d.added.find((r) => r.rule === 'y').previousCount, 2);
  assert.deepEqual(d.fixed.map((r) => r.key), ['z|/b|desktop']);
  assert.deepEqual(d.ongoing.map((r) => r.key), ['x|/a|desktop']);
});

test('diff: pages not scanned this run are not reported as fixed', () => {
  const cfg = { waivers: [] };
  const before = flatten([page('/a', 'desktop', [finding('x', 'serious')]), page('/b', 'desktop', [finding('z', 'moderate')])], cfg);
  const now = flatten([page('/a', 'desktop', [])], cfg);
  const d = diff(now, before, new Set(['/a|desktop']));
  assert.deepEqual(d.fixed.map((r) => r.key), ['x|/a|desktop']);
});

test('diff: with no baseline everything open is new and nothing is fixed', () => {
  const rows = flatten([page('/a', 'm', [finding('x', 'minor')])], { waivers: [] });
  const d = diff(rows, null);
  assert.equal(d.hasBaseline, false);
  assert.equal(d.added.length, 1);
  assert.equal(d.fixed.length, 0);
});

test('waived findings are excluded from diff and counts', () => {
  const cfg = { waivers: [{ rule: 'x', reason: 'vendor', approvedBy: 'Pat' }] };
  const rows = flatten([page('/a', 'm', [finding('x', 'critical'), finding('y', 'minor')])], cfg);
  const s = summarize(rows);
  assert.equal(s.total, 1);
  assert.equal(s.waived, 1);
  assert.equal(diff(rows, null).added.length, 1);
});

test('gate only looks at new findings matching impact or rule', () => {
  const added = [{ rule: 'a', impact: 'critical' }, { rule: 'b', impact: 'minor' }, { rule: 'c', impact: 'serious' }];
  assert.deepEqual(gateFailures(added, { impacts: ['critical'], rules: ['b'] }).map((r) => r.rule), ['a', 'b']);
  assert.equal(gateFailures([], { impacts: ['critical'], rules: [] }).length, 0);
});

test('history keeps the most recent entries', () => {
  const h = appendHistory(Array.from({ length: 5 }, (_, i) => ({ i })), { i: 5 }, 3);
  assert.deepEqual(h.map((e) => e.i), [3, 4, 5]);
});

test('notify: comments only on change by default; mentions are normalised', () => {
  const cfg = { notify: { preview: 'changes', default: 'changes' } };
  const quiet = { hasBaseline: true, added: [], fixed: [] };
  assert.equal(shouldNotify(cfg, 'preview', quiet), false);
  assert.equal(shouldNotify(cfg, 'production', quiet), false);
  assert.equal(shouldNotify(cfg, 'production', { ...quiet, fixed: [1] }), true);
  assert.equal(shouldNotify({ notify: { default: 'always' } }, 'production', quiet), true);
  assert.equal(mentions('@jon, doug  @john,'), '@jon @doug @john');
  assert.equal(mentions(undefined), '');
});

const problemsFor = (d, totalPages, viewports = ['desktop', 'mobile']) => {
  const o = { totalPages, viewports };
  const p = { open: groupProblems([...d.added, ...d.improved, ...d.ongoing], o), added: groupProblems(d.added, o), fixed: groupProblems(d.fixed, o), improved: groupProblems(d.improved, o) };
  p.summary = problemSummary(p.open);
  return p;
};
const run = { site: 'x', target: 'production', trigger: 'deploy', origin: 'https://e.com', date: '2026-10-05T12:00:00Z', axeVersion: '4.13.0', runUrl: 'https://run' };

test('markdown: comment carries mentions and new problems, and escapes pipes', () => {
  const cfg = { waivers: [] };
  const rows = flatten([page('/a|b', 'mobile', [{ ...finding('button-name', 'critical', 2), help: 'Buttons need | names', helpUrl: 'https://x', nodes: [{ target: 'button', html: '<button class="cta">' }] }])], cfg);
  const d = diff(rows, [], new Set(['/a|b|mobile']));
  const problems = problemsFor(d, 1);
  const c = renderComment({ run, summary: summarize(rows), d, problems }, '@jon @doug');
  assert.match(c, /^@jon @doug/);
  assert.match(c, /1 new, 0 fixed, 0 improved/);
  assert.match(c, /Buttons need \\\| names/);
  assert.match(renderIssueBody({ run, summary: summarize(rows), problems }), /button-name/);
});

test('standards: parses a W3C TR status line', () => {
  const html = '<title>Web Content Accessibility Guidelines (WCAG) 2.2</title> ... W3C Recommendation 12 December 2024 ...';
  assert.deepEqual(parseW3cTr(html), { title: 'Web Content Accessibility Guidelines (WCAG) 2.2', status: 'Recommendation', date: '12 December 2024' });
});

test('standards: first run records without flagging; later changes are flagged', () => {
  const cur = [{ id: 'wcag', title: 'WCAG 2.2', status: 'Recommendation', date: '1 Jan 2025' }, { id: 'axe', version: '4.13.0' }];
  assert.ok(compare(null, cur).every((c) => c.first));
  const prev = { wcag: { title: 'WCAG 2.2', status: 'Recommendation', date: '1 Jan 2025' }, axe: { version: '4.12.0' } };
  const ch = compare(prev, cur);
  assert.deepEqual(ch.map((c) => c.id), ['axe']);
  assert.deepEqual(ch[0].was, { version: '4.12.0' });
});

test('confirm: new needs both scans, fixed needs neither', () => {
  const cfg = { waivers: [] };
  const baseline = flatten([page('/a', 'm', [finding('known', 'serious'), finding('flaky-old', 'minor')])], cfg);
  const first = [page('/a', 'm', [finding('known', 'serious'), finding('flaky-new', 'serious'), finding('real-new', 'critical')])];
  const second = [page('/a', 'm', [finding('flaky-old', 'minor'), finding('real-new', 'critical')])];
  const merged = confirmPages(first, second, baseline);
  const rules = merged[0].findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['flaky-old', 'known', 'real-new']);
  const d = diff(flatten(merged, cfg), baseline, new Set(['/a|m']));
  assert.deepEqual(d.added.map((r) => r.rule), ['real-new']);
  assert.equal(d.fixed.length, 0);
  assert.deepEqual([...changedPages(diff(flatten(first, cfg), baseline))], ['/a|m']);
});

test('waits: exact path and prefix override the default settle time', () => {
  const cfg = { waits: { '/find-us': 8000, '/shop/*': 3000 } };
  assert.equal(settleMs(cfg, '/find-us', 1200), 8000);
  assert.equal(settleMs(cfg, '/shop/sauces', 1200), 3000);
  assert.equal(settleMs(cfg, '/about', 1200), 1200);
});

const node = (html, extra = {}) => ({ target: 'x', html, ...extra });

test('group: templateOf', () => {
  assert.equal(templateOf('/shop/sauces/marinara'), '/shop/sauces/*');
  assert.equal(templateOf('/about'), '/about');
  assert.equal(templateOf('/'), '/');
});

test('group: same component on many pages and widths is one problem; hash classes ignored', () => {
  const cfg = { waivers: [] };
  const mk = (p, vp, cls) => page(p, vp, [{ ...finding('image-redundant-alt', 'minor'), nodes: [node(`<img alt="t" class="object-cover ${cls}">`)] }]);
  const rows = flatten([mk('/a', 'desktop', 'css-1a2b3c'), mk('/a', 'mobile', 'css-9f8e7d'), mk('/b', 'desktop', 'css-000aaa')], cfg);
  const g = groupProblems(rows, { totalPages: 10, viewports: ['desktop', 'mobile'] });
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].pages, ['/a', '/b']);
  assert.equal(g[0].views, 3);
  assert.equal(g[0].widths, 'all widths');
  assert.equal(scopeLabel(g[0]), '2 pages');
});

test('group: reflow groups by template; one-off pages stay separate', () => {
  const cfg = { waivers: [] };
  const rf = (p, w) => page(p, 'mobile', [{ ...finding('gp-reflow', 'serious'), help: `Horizontal scroll (page is ${w}px wide)`, nodes: [node('', { target: `div right=${w}` })] }]);
  const g = groupProblems(flatten([rf('/shop/sauces/a', 332), rf('/shop/sauces/b', 340), rf('/privacy-policy', 354)], cfg), { totalPages: 50, viewports: ['desktop', 'mobile'] });
  assert.equal(g.length, 2);
  const tpl = g.find((p) => p.template === '/shop/sauces/*');
  assert.equal(scopeLabel(tpl), '/shop/sauces/* pages (2)');
  assert.equal(tpl.widths, 'mobile only');
});

test('group: site-wide at 80% of pages, and vendor tagged from h1 context', () => {
  const cfg = { waivers: [] };
  const h1 = (p) => page(p, 'desktop', [{ ...finding('gp-multiple-h1', 'moderate', 2), nodes: [node('Carbone', { context: 'nav' }), node('SUBSCRIBE', { context: 'div.klaviyo-form-abc' })] }]);
  const pages = Array.from({ length: 9 }, (_, i) => h1(`/p${i}`));
  const g = groupProblems(flatten(pages, cfg), { totalPages: 10, viewports: ['desktop'] });
  assert.equal(g.length, 1);
  assert.equal(g[0].siteWide, true);
  assert.equal(g[0].vendor, 'Klaviyo');
  assert.equal(scopeLabel(g[0]), 'site-wide (9 pages)');
  assert.equal(problemSummary(g).vendorProblems, 1);
});

test('group: vendorFor matches markup and site-specific vendors', () => {
  assert.equal(vendorFor({ nodes: [node('<button class="bv_main_container_row_flex">')] }), 'Bazaarvoice');
  assert.equal(vendorFor({ nodes: [node('<div class="ours">')] }), null);
  assert.equal(vendorFor({ nodes: [node('<div class="acme-widget">')] }, [{ name: 'Acme', match: ['acme-'] }]), 'Acme');
});

test('diff: fewer failing elements than before is improved, and notifies', () => {
  const cfg = { waivers: [] };
  const before = flatten([page('/t', 'desktop', [finding('heading-order', 'moderate', 2)])], cfg);
  const now = flatten([page('/t', 'desktop', [finding('heading-order', 'moderate', 1)])], cfg);
  const d = diff(now, before, new Set(['/t|desktop']));
  assert.equal(d.improved.length, 1);
  assert.equal(d.improved[0].previousCount, 2);
  assert.equal(d.added.length + d.fixed.length + d.ongoing.length, 0);
  assert.equal(shouldNotify({ notify: { default: 'changes' } }, 'production', d), true);
  const c = renderComment({ run, summary: summarize(now), d, problems: problemsFor(d, 1) });
  assert.match(c, /### Improved/);
  assert.match(c, /2 → 1 failing elements/);
});

test('group: a vendor failing one rule on desktop and mobile with different generated classes is one problem', () => {
  const cfg = { waivers: [] };
  const lm = (vp, cls) => page('/find-us', vp, [{ ...finding('landmark-main-is-top-level', 'moderate'), nodes: [node(`<main class="${cls}">`)] }]);
  const g = groupProblems(flatten([lm('desktop', 'destini-css-0'), lm('mobile', 'destini-css-1s7b6ww')], cfg), { totalPages: 5, viewports: ['desktop', 'mobile'] });
  assert.equal(g.length, 1);
  assert.equal(g[0].vendor, 'Destini');
  assert.equal(g[0].widths, 'all widths');
});
