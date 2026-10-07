// Compares a scan with the previous production scan. Findings are keyed by
// rule + page + viewport, not by CSS selector: hashed class names change on
// every build and would make every run look like all-new issues.
import { isWaived } from './config.mjs';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

export function flatten(pages, cfg) {
  const rows = [];
  for (const p of pages) {
    for (const f of p.findings) {
      const waiver = isWaived(cfg, f.rule, p.path);
      rows.push({ key: `${f.rule}|${p.path}|${p.viewport}`, path: p.path, viewport: p.viewport, ...f, waived: waiver ? { reason: waiver.reason, approvedBy: waiver.approvedBy } : null });
    }
  }
  return rows;
}

// `scanned` is the set of "path|viewport" pairs this run actually loaded. A page
// that was not scanned (or failed to load) cannot count as fixed.
export function diff(currentRows, baselineRows, scanned) {
  if (!baselineRows) return { hasBaseline: false, added: currentRows.filter((r) => !r.waived), fixed: [], improved: [], ongoing: [] };
  const wasScanned = (r) => !scanned || scanned.has(`${r.path}|${r.viewport}`);
  const before = new Map(baselineRows.filter((r) => !r.waived).map((r) => [r.key, r]));
  const now = currentRows.filter((r) => !r.waived);
  const added = [];
  const improved = [];
  const ongoing = [];
  for (const r of now) {
    const prev = before.get(r.key);
    // More failing elements on a page than last time counts as new; fewer
    // (but not zero) counts as improved.
    if (!prev || r.count > prev.count) added.push({ ...r, previousCount: prev?.count ?? 0 });
    else if (r.count < prev.count) improved.push({ ...r, previousCount: prev.count });
    else ongoing.push(r);
  }
  const nowKeys = new Set(now.map((r) => r.key));
  const fixed = [...before.values()].filter((r) => !nowKeys.has(r.key) && wasScanned(r));
  return { hasBaseline: true, added, fixed, improved, ongoing };
}

export function summarize(rows) {
  const open = rows.filter((r) => !r.waived);
  const byImpact = Object.fromEntries(IMPACT_ORDER.map((i) => [i, open.filter((r) => r.impact === i).length]));
  return { total: open.length, waived: rows.length - open.length, byImpact, rules: new Set(open.map((r) => r.rule)).size, pages: new Set(open.map((r) => r.path)).size };
}

// Rows grouped by rule, most severe first, for the report.
export function groupByRule(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.rule)) groups.set(r.rule, { rule: r.rule, impact: r.impact, help: r.help, helpUrl: r.helpUrl, wcag: r.wcag, rows: [] });
    groups.get(r.rule).rows.push(r);
  }
  return [...groups.values()].sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) || b.rows.length - a.rows.length);
}

// The gate only looks at what is new, so existing debt never blocks a merge.
export function gateFailures(added, gate) {
  return added.filter((r) => gate.impacts.includes(r.impact) || gate.rules.includes(r.rule));
}

export function appendHistory(baselineHistory, entry, keep = 104) {
  return [...(baselineHistory || []), entry].slice(-keep);
}

// Third-party widgets and animations can make a single scan disagree with the
// last one by chance. Pages whose result changed are scanned twice; a finding
// counts as new only if both scans saw it, and as fixed only if neither did.
export function changedPages(d) {
  return new Set([...d.added, ...d.fixed, ...d.improved].map((r) => `${r.path}|${r.viewport}`));
}

export function confirmPages(firstPages, secondPages, baselineRows) {
  const second = new Map(secondPages.map((p) => [`${p.path}|${p.viewport}`, p]));
  const inBaseline = new Set((baselineRows || []).map((r) => r.key));
  return firstPages.map((p) => {
    const again = second.get(`${p.path}|${p.viewport}`);
    if (!again || again.error) return p;
    const a = new Map(p.findings.map((f) => [f.rule, f]));
    const b = new Map(again.findings.map((f) => [f.rule, f]));
    const findings = [];
    for (const rule of new Set([...a.keys(), ...b.keys()])) {
      const known = inBaseline.has(`${rule}|${p.path}|${p.viewport}`);
      const fa = a.get(rule);
      const fb = b.get(rule);
      if (known && (fa || fb)) findings.push(fa && fb ? (fa.count >= fb.count ? fb : fa) : fa || fb);
      else if (!known && fa && fb) findings.push(fa.count <= fb.count ? fa : fb);
    }
    return { ...p, findings, confirmed: true };
  });
}
