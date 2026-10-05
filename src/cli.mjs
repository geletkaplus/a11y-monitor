#!/usr/bin/env node
// a11y-monitor scan      --config a11y.config.json [--origin URL] [--target production|preview]
//                        [--trigger NAME] [--baseline results.json] [--out DIR] [--gate]
// a11y-monitor standards --state standards-state.json [--out DIR]
//
// Writes report.html, results.json, issue.md, comment.md and notify.json to --out.
// The workflow posts issue.md / comment.md to GitHub; this script sends nothing.
//
// Exit codes: 0 = ran (findings never fail a run on their own), 1 = --gate was set and
// a new finding matched the gate, 2 = the run itself could not complete.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.mjs';
import { discoverPaths } from './urls.mjs';
import { runScan } from './scan.mjs';
import { flatten, diff, summarize, gateFailures, appendHistory, changedPages, confirmPages } from './diff.mjs';
import { renderReport, subjectLine, renderIssueBody, renderComment } from './report.mjs';
import { shouldNotify, mentions } from './notify.mjs';
import { checkStandards, renderStandards } from './standards.mjs';

const require = createRequire(import.meta.url);
const AXE_VERSION = require('axe-core/package.json').version;

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', default: 'a11y.config.json' },
    origin: { type: 'string' },
    target: { type: 'string', default: 'production' },
    trigger: { type: 'string', default: 'manual' },
    baseline: { type: 'string' },
    out: { type: 'string', default: 'a11y-report' },
    'run-url': { type: 'string' },
    state: { type: 'string', default: 'standards-state.json' },
    gate: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

function bypassHeaders() {
  // Lets the scanner reach Vercel previews behind Deployment Protection.
  const s = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return s ? { 'x-vercel-protection-bypass': s, 'x-vercel-set-bypass-cookie': 'true' } : {};
}

async function scan() {
  const cfg = loadConfig(args.config);
  const origin = (args.origin || cfg.baseUrl).replace(/\/$/, '');
  const headers = bypassHeaders();
  const paths = await discoverPaths(cfg, origin, headers);
  if (!paths.length) throw new Error(`No pages found at ${origin}${cfg.sitemap}`);
  const log = args.quiet ? () => {} : (m) => console.log(m);
  log(`Scanning ${paths.length} pages on ${origin}`);
  let pages = await runScan(cfg, origin, paths, { headers, log });

  const baseline = args.baseline && fs.existsSync(args.baseline) ? JSON.parse(fs.readFileSync(args.baseline, 'utf8')) : null;
  const scanned = new Set(pages.filter((p) => !p.error).map((p) => `${p.path}|${p.viewport}`));
  if (baseline) {
    const toConfirm = changedPages(diff(flatten(pages, cfg), baseline.rows, scanned));
    if (toConfirm.size) {
      log(`Rescanning ${toConfirm.size} changed page views to confirm`);
      const again = [];
      for (const vp of cfg.viewports) {
        const vpPaths = [...toConfirm].filter((k) => k.endsWith(`|${vp.name}`)).map((k) => k.slice(0, -(vp.name.length + 1)));
        if (vpPaths.length) again.push(...(await runScan({ ...cfg, viewports: [vp] }, origin, vpPaths, { headers })));
      }
      pages = confirmPages(pages, again, baseline.rows);
    }
  }
  const rows = flatten(pages, cfg);
  const d = diff(rows, baseline?.rows, scanned);
  const summary = summarize(rows);
  const run = {
    site: cfg.site, origin, target: args.target, trigger: args.trigger, date: new Date().toISOString(),
    viewports: cfg.viewports.map((v) => v.name), axeVersion: AXE_VERSION, runUrl: args['run-url'] || null,
  };
  run.gateFailures = args.gate ? gateFailures(d.added, cfg.gate) : [];

  // Only production runs move the trend line; previews compare against it.
  const history = args.target === 'production'
    ? appendHistory(baseline?.history, { date: run.date, trigger: run.trigger, pages: paths.length, total: summary.total, byImpact: summary.byImpact })
    : baseline?.history || [];

  fs.mkdirSync(args.out, { recursive: true });
  const html = renderReport({ run, summary, d, rows, pages, history, warnings: cfg.warnings });
  fs.writeFileSync(path.join(args.out, 'results.json'), JSON.stringify({ run, summary, rows, pages, history }, null, 1));
  fs.writeFileSync(path.join(args.out, 'report.html'), html);
  const subject = subjectLine(run, d, summary);
  console.log(`\n${subject}\nReport: ${path.join(args.out, 'report.html')}`);

  const notify = shouldNotify(cfg, args.target, d);
  fs.writeFileSync(path.join(args.out, 'issue.md'), renderIssueBody({ run, summary, d }));
  fs.writeFileSync(path.join(args.out, 'comment.md'), renderComment({ run, summary, d }, mentions(process.env.A11Y_MENTIONS)));
  fs.writeFileSync(path.join(args.out, 'notify.json'), JSON.stringify({ comment: notify, subject, target: args.target, added: d.added.length, fixed: d.fixed.length, open: summary.total }));
  if (run.gateFailures.length) {
    console.error(`Gate: ${run.gateFailures.length} new finding(s) match ${JSON.stringify(cfg.gate)}`);
    return 1;
  }
  return 0;
}

async function standards() {
  const result = await checkStandards({ stateFile: args.state, pinnedAxe: AXE_VERSION });
  fs.mkdirSync(args.out, { recursive: true });
  const html = renderStandards(result);
  fs.writeFileSync(path.join(args.out, 'standards.html'), html);
  fs.writeFileSync(args.state, JSON.stringify(result.next, null, 2) + '\n');
  const real = result.changes.filter((c) => !c.first);
  const summary = { changed: real.map((c) => c.id), axeBehind: result.axeBehind, errors: result.errors.map((e) => e.id) };
  fs.writeFileSync(path.join(args.out, 'standards.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  return 0;
}

const commands = { scan, standards };
const cmd = commands[positionals[0]];
if (!cmd) {
  console.error('Usage: a11y-monitor <scan|standards> [options]');
  process.exit(2);
}
cmd().then((code) => process.exit(code), (e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
