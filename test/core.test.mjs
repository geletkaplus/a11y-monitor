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

test('markdown: comment carries mentions, new findings and escapes pipes', () => {
  const cfg = { waivers: [] };
  const rows = flatten([page('/a|b', 'mobile', [{ ...finding('button-name', 'critical', 2), help: 'Buttons need | names', helpUrl: 'https://x' }])], cfg);
  const d = diff(rows, [], new Set(['/a|b|mobile']));
  const run = { target: 'production', trigger: 'deploy', origin: 'https://e.com', date: '2026-10-05T12:00:00Z', axeVersion: '4.13.0', runUrl: 'https://run' };
  const c = renderComment({ run, summary: summarize(rows), d }, '@jon @doug');
  assert.match(c, /^@jon @doug/);
  assert.match(c, /1 new, 0 fixed/);
  assert.match(c, /Buttons need \\\| names/);
  assert.match(renderIssueBody({ run, summary: summarize(rows), d }), /button-name/);
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
