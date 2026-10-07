// Turns page-level findings (one per rule, page and viewport) into problems: the
// same element failing on many pages is one problem, not one per page and width.
// This is what the report leads with; the raw counts stay as detail.

// Third-party code recognised by its markup. A site can add its own in config.
export const DEFAULT_VENDORS = [
  { name: 'Klaviyo', match: ['klaviyo'] },
  { name: 'Bazaarvoice', match: ['bv_', 'bazaarvoice'] },
  { name: 'Destini', match: ['destini'] },
  { name: 'Amazon Buy with Prime', match: ['amazon-cart', 'amazon-purchase'] },
  { name: 'Digital to Retail', match: ['digitaltoretail'] },
];

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];
// A problem on at least this share of scanned pages is reported as site-wide.
const SITE_WIDE_SHARE = 0.8;

// "/shop/sauces/marinara" -> "/shop/sauces/*"; top-level pages stay as they are.
export function templateOf(path) {
  const segs = path.split('?')[0].split('/').filter(Boolean);
  return segs.length >= 2 ? `/${segs.slice(0, -1).join('/')}/*` : path;
}

// Tag plus classes from the element's markup, minus generated hash classes, so
// the same component matches across pages.
function elementKey(node) {
  const html = node?.html || '';
  const tag = html.match(/^<([a-z0-9-]+)/i)?.[1]?.toLowerCase();
  const cls = (html.match(/\bclass="([^"]*)/)?.[1] || '')
    .split(/\s+/)
    .filter((c) => c && !/(^css-|[0-9a-f]{6,}|\d{3,})/i.test(c))
    .sort()
    .join('.');
  if (tag) return `${tag}.${cls}`;
  return (node?.target || '').replace(/:nth-(child|of-type)\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
}

export function problemKey(row, vendors = DEFAULT_VENDORS) {
  if (row.rule === 'gp-reflow') return `gp-reflow|${templateOf(row.path)}`;
  if (row.rule === 'gp-multiple-h1') return `gp-multiple-h1|${row.nodes.map((n) => n.html).sort().join('|')}`;
  // Vendor markup often uses generated class names that differ per page or
  // width, so a vendor's failures of one rule count as one problem.
  const vendor = vendorFor(row, vendors);
  if (vendor) return `${row.rule}|vendor:${vendor}`;
  return `${row.rule}|${elementKey(row.nodes?.[0])}`;
}

export function vendorFor(row, vendors = DEFAULT_VENDORS) {
  const hay = (row.nodes || []).map((n) => `${n.target} ${n.html} ${n.context || ''}`).join(' ').toLowerCase();
  return vendors.find((v) => v.match.some((m) => hay.includes(m.toLowerCase())))?.name || null;
}

export function groupProblems(rows, { totalPages, viewports, vendors = DEFAULT_VENDORS }) {
  const groups = new Map();
  for (const r of rows) {
    const key = problemKey(r, vendors);
    if (!groups.has(key)) {
      groups.set(key, {
        key, rule: r.rule, impact: r.impact, help: r.help, helpUrl: r.helpUrl, wcag: r.wcag,
        vendor: vendorFor(r, vendors), pages: new Set(), viewports: new Set(), views: 0, rows: [],
        template: r.rule === 'gp-reflow' ? templateOf(r.path) : null,
      });
    }
    const g = groups.get(key);
    g.pages.add(r.path);
    g.viewports.add(r.viewport);
    g.views += 1;
    g.rows.push(r);
    g.vendor ||= vendorFor(r, vendors);
  }
  const siteWideAt = Math.max(3, Math.ceil(totalPages * SITE_WIDE_SHARE));
  return [...groups.values()]
    .map((g) => ({
      ...g,
      pages: [...g.pages].sort(),
      viewports: [...g.viewports],
      siteWide: g.pages.size >= siteWideAt,
      widths: viewports && g.viewports.size === viewports.length ? 'all widths' : `${[...g.viewports].join(', ')} only`,
    }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) || b.pages.length - a.pages.length);
}

// "site-wide" | "every /shop/sauces/* page (12)" | "3 pages" | "/about"
export function scopeLabel(p) {
  if (p.siteWide) return `site-wide (${p.pages.length} pages)`;
  if (p.template && p.template.endsWith('/*')) return `${p.template} pages (${p.pages.length})`;
  return p.pages.length === 1 ? p.pages[0] : `${p.pages.length} pages`;
}

export function problemSummary(problems) {
  const pages = new Set(problems.flatMap((p) => p.pages));
  return {
    problems: problems.length,
    vendorProblems: problems.filter((p) => p.vendor).length,
    pages: pages.size,
    byImpact: Object.fromEntries(IMPACT_ORDER.map((i) => [i, problems.filter((p) => p.impact === i).length])),
  };
}
