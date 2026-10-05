// Watches the sources that change what "accessible" means for us:
// the current WCAG Recommendation, the WCAG 3 draft, and axe-core releases
// (new rules reach our scans through axe). Compares against a saved state
// file and reports anything that moved.
import fs from 'node:fs';

const SOURCES = [
  { id: 'wcag', label: 'WCAG (latest Recommendation)', url: 'https://www.w3.org/TR/WCAG/' },
  { id: 'wcag3', label: 'WCAG 3 (draft)', url: 'https://www.w3.org/TR/wcag-3.0/' },
];

// Pulls the title and the status/date line out of a W3C /TR/ page.
export function parseW3cTr(html) {
  const title = (html.match(/<title>([^<]+)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const status = (html.match(/W3C\s+(Recommendation|Candidate Recommendation(?: Snapshot| Draft)?|Proposed Recommendation|Working Draft|Group Draft Note|Note)\s*,?\s*(\d{1,2}\s+\w+\s+\d{4})/) || []);
  return { title, status: status[1] || null, date: status[2] || null };
}

async function fetchSource(src) {
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok) return { id: src.id, label: src.label, url: src.url, error: `HTTP ${res.status}` };
  return { id: src.id, label: src.label, url: src.url, ...parseW3cTr(await res.text()) };
}

async function axeLatest() {
  const res = await fetch('https://registry.npmjs.org/axe-core/latest');
  if (!res.ok) return { id: 'axe', label: 'axe-core latest release', error: `HTTP ${res.status}` };
  const j = await res.json();
  return { id: 'axe', label: 'axe-core latest release', url: 'https://github.com/dequelabs/axe-core/releases', version: j.version };
}

export function compare(previous, current) {
  const changes = [];
  for (const c of current) {
    if (c.error) continue;
    const p = previous?.[c.id];
    const fields = c.id === 'axe' ? ['version'] : ['title', 'status', 'date'];
    const moved = fields.filter((f) => p && p[f] !== c[f]);
    if (!p) changes.push({ ...c, first: true });
    else if (moved.length) changes.push({ ...c, was: Object.fromEntries(moved.map((f) => [f, p[f]])) });
  }
  return changes;
}

export async function checkStandards({ stateFile, pinnedAxe }) {
  const current = [...(await Promise.all(SOURCES.map(fetchSource))), await axeLatest()];
  const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const changes = compare(previous, current);
  const axe = current.find((c) => c.id === 'axe');
  const axeBehind = axe?.version && pinnedAxe && axe.version !== pinnedAxe;
  const next = Object.fromEntries(current.filter((c) => !c.error).map((c) => [c.id, c]));
  return { current, changes, axeBehind, pinnedAxe, next, errors: current.filter((c) => c.error) };
}

export function renderStandards({ current, changes, axeBehind, pinnedAxe, errors }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const real = changes.filter((c) => !c.first);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessibility standards check</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;padding:1rem;">
<main style="max-width:48rem;margin:0 auto;">
<h1 style="font-size:1.3rem;">Accessibility standards check</h1>
${real.length ? `<h2 style="font-size:1.1rem;">What changed</h2><ul>${real.map((c) => `<li><a href="${esc(c.url)}">${esc(c.label)}</a>: ${Object.entries(c.was).map(([k, v]) => `${esc(k)} was “${esc(v)}”, now “${esc(c[k])}”`).join('; ')}</li>`).join('')}</ul>` : '<p>No changes since the last check.</p>'}
${axeBehind ? `<p><strong>axe-core ${esc(current.find((c) => c.id === 'axe').version)} is out; the scanner pins ${esc(pinnedAxe)}.</strong> Read the release notes, bump the pin, and rerun every site so new rules show up.</p>` : ''}
<h2 style="font-size:1.1rem;">Current state</h2>
<ul>${current.map((c) => `<li>${esc(c.label)}: ${c.error ? 'could not fetch (' + esc(c.error) + ')' : esc(c.version || [c.title, c.status, c.date].filter(Boolean).join(' · '))}</li>`).join('')}</ul>
${errors.length ? '<p>Some sources could not be fetched; they are compared again next time.</p>' : ''}
</main></body></html>`;
}
