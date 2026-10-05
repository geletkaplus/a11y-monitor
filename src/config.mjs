// Loads and validates a site's a11y.config.json. Every field except `site` and
// `baseUrl` has a default, so a new site can start with a two-line config.
import fs from 'node:fs';

const DEFAULTS = {
  // Pages to scan. `sitemap` is a path on the scanned origin; `paths` are added to it.
  sitemap: '/sitemap.xml',
  paths: [],
  exclude: [],
  maxUrls: 400,
  viewports: [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ],
  // WCAG 1.4.10 tests reflow at 320 CSS px (1280px at 400% zoom). null turns it off.
  reflowWidth: 320,
  tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
  concurrency: 4,
  // Extra settle time (ms) for pages whose third-party widgets render late,
  // keyed by exact path or `prefix*`. Without it, results flip between runs.
  waits: {},
  // Known, accepted findings. Each needs a reason and a named approver, or it is ignored.
  waivers: [],
  // Report-only by default. A gate only applies where the workflow passes --gate.
  gate: { impacts: ['critical'], rules: [] },
  notify: {
    // When to comment on the status issue (which pings the people it mentions):
    // 'always', 'changes' (something new or fixed) or 'never'. The issue body is
    // updated on every run either way.
    preview: 'changes',
    default: 'changes',
  },
};

export function loadConfig(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...DEFAULTS, ...raw, gate: { ...DEFAULTS.gate, ...raw.gate }, notify: { ...DEFAULTS.notify, ...raw.notify } };
  const errors = [];
  if (!cfg.site) errors.push('`site` is required (a short name, e.g. "carbone").');
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) errors.push('`baseUrl` must be the production origin, e.g. "https://www.example.com".');
  cfg.waivers = cfg.waivers.filter((w, i) => {
    if (w.rule && w.reason && w.approvedBy) return true;
    errors.push(`waivers[${i}] is ignored: it needs rule, reason and approvedBy.`);
    return false;
  });
  // A bad waiver is a warning, not a stop: the scan should still run.
  const fatal = errors.filter((e) => !e.startsWith('waivers['));
  if (fatal.length) throw new Error(`Invalid ${file}:\n  ${fatal.join('\n  ')}`);
  cfg.warnings = errors.filter((e) => e.startsWith('waivers['));
  cfg.baseUrl = cfg.baseUrl.replace(/\/$/, '');
  return cfg;
}

export function isWaived(cfg, ruleId, path) {
  return cfg.waivers.find(
    (w) => w.rule === ruleId && (!w.paths || w.paths.some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p))),
  );
}

export function settleMs(cfg, path, fallback) {
  for (const [p, ms] of Object.entries(cfg.waits || {})) {
    if (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p) return ms;
  }
  return fallback;
}
