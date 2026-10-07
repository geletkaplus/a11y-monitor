// Renders the report as one self-contained, accessible HTML page. The same HTML
// is attached to every CI run; the issue text comes from the Markdown renderers below.
import { groupByRule } from './diff.mjs';
import { scopeLabel } from './group.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COLORS = { critical: '#b3261e', serious: '#8a4a06', moderate: '#5c5000', minor: '#3d5a73' };

function ruleTable(groups, { showDelta = false } = {}) {
  if (!groups.length) return '<p>None.</p>';
  return groups.map((g) => `
    <h3 style="margin:1.25rem 0 0.25rem;font-size:1rem;">
      <span style="color:${COLORS[g.impact] || '#333'};text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em;">${esc(g.impact)}</span>
      ${esc(g.help)} <span style="font-weight:400;color:#555;">(${esc(g.rule)}${g.wcag?.length ? ', WCAG ' + esc(g.wcag.join(', ')) : ''})</span>
    </h3>
    <p style="margin:0 0 0.4rem;font-size:0.85rem;"><a href="${esc(g.helpUrl)}">How to fix</a> · ${g.rows.length} page view${g.rows.length === 1 ? '' : 's'}</p>
    <table style="border-collapse:collapse;width:100%;font-size:0.85rem;">
      <thead><tr>
        <th scope="col" style="text-align:left;border-bottom:1px solid #ccc;padding:0.25rem;">Page</th>
        <th scope="col" style="text-align:left;border-bottom:1px solid #ccc;padding:0.25rem;">Viewport</th>
        <th scope="col" style="text-align:left;border-bottom:1px solid #ccc;padding:0.25rem;">Elements</th>
        <th scope="col" style="text-align:left;border-bottom:1px solid #ccc;padding:0.25rem;">Example</th>
      </tr></thead>
      <tbody>${g.rows.slice(0, 25).map((r) => `<tr>
        <td style="padding:0.25rem;border-bottom:1px solid #eee;vertical-align:top;">${esc(r.path)}</td>
        <td style="padding:0.25rem;border-bottom:1px solid #eee;vertical-align:top;">${esc(r.viewport)}</td>
        <td style="padding:0.25rem;border-bottom:1px solid #eee;vertical-align:top;">${r.count}${showDelta && r.previousCount ? ` (was ${r.previousCount})` : ''}</td>
        <td style="padding:0.25rem;border-bottom:1px solid #eee;vertical-align:top;font-family:monospace;font-size:0.75rem;word-break:break-all;">${esc(r.nodes?.[0]?.target)}</td>
      </tr>`).join('')}</tbody>
    </table>${g.rows.length > 25 ? `<p style="font-size:0.8rem;">…and ${g.rows.length - 25} more in the full results.</p>` : ''}`).join('');
}

function htmlProblems(list) {
  if (!list.length) return '<p>None.</p>';
  const item = (p) => `<li><span style="color:${COLORS[p.impact] || '#333'};text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em;">${esc(p.impact)}</span> ${esc(p.help)} <span style="color:#555;">(${esc(p.rule)})</span> · ${esc(scopeLabel(p))} · ${esc(p.widths)}${p.siteWide || p.pages.length === 1 ? '' : ` · e.g. ${esc(p.pages[0])}`} · <a href="${esc(p.helpUrl)}">how to fix</a></li>`;
  const ours = list.filter((p) => !p.vendor);
  const theirs = list.filter((p) => p.vendor);
  return `<h3 style="font-size:1rem;">Our code (${ours.length})</h3><ul>${ours.map(item).join('') || '<li>None.</li>'}</ul>`
    + `<h3 style="font-size:1rem;">Third-party vendors (${theirs.length})</h3><ul>${theirs.map((p) => item(p).replace('<li>', `<li><strong>${esc(p.vendor)}:</strong> `)).join('') || '<li>None.</li>'}</ul>`;
}

function trend(history) {
  if (!history?.length) return '';
  const rows = history.slice(-8).map((h) => `<tr><td style="padding:0.2rem 0.5rem;">${esc(h.date.slice(0, 10))}</td><td style="padding:0.2rem 0.5rem;">${esc(h.trigger)}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.pages ?? ''}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.problems ?? '—'}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.total}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.byImpact.critical + h.byImpact.serious}</td></tr>`).join('');
  return `<h3>Trend (last ${Math.min(8, history.length)} production runs)</h3>
  <table style="border-collapse:collapse;font-size:0.85rem;"><thead><tr><th scope="col" style="text-align:left;padding:0.2rem 0.5rem;">Date</th><th scope="col" style="text-align:left;padding:0.2rem 0.5rem;">Trigger</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Pages</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Problems</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Raw findings</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Critical + serious</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function subjectLine(run, d, problems) {
  const ps = problems.summary;
  const what = d.hasBaseline
    ? `${problems.added.length} new, ${problems.fixed.length} fixed, ${problems.improved.length} improved · `
    : 'first run · ';
  return `[a11y] ${run.site} ${run.target}: ${what}${ps.problems} problems open (${ps.vendorProblems} from vendors)`;
}

export function renderReport({ run, summary, d, rows, pages, history, problems, warnings = [] }) {
  const errors = pages.filter((p) => p.error);
  const waived = rows.filter((r) => r.waived);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subjectLine(run, d, problems))}</title></head>
<body style="margin:0;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1a19;background:#fff;line-height:1.5;">
<main style="max-width:56rem;margin:0 auto;">
<h1 style="font-size:1.4rem;margin:0 0 0.25rem;">Accessibility report: ${esc(run.site)}</h1>
<p style="margin:0;color:#555;">${esc(run.target)} · ${esc(run.origin)} · triggered by ${esc(run.trigger)} · ${esc(run.date)}</p>
<p style="margin:0.25rem 0 0;color:#555;">${pages.length / run.viewports.length} pages × ${run.viewports.length} viewports (${esc(run.viewports.join(', '))}) · axe-core ${esc(run.axeVersion)} · WCAG 2.2 A + AA and best practice${run.runUrl ? ` · <a href="${esc(run.runUrl)}">full results</a>` : ''}</p>

<h2 style="font-size:1.15rem;margin-top:1.5rem;">Summary</h2>
<ul>
  <li><strong>${problems.summary.problems}</strong> open problems: ${problems.summary.vendorProblems} from third-party vendors, on ${problems.summary.pages} of ${pages.length / run.viewports.length} pages (critical ${problems.summary.byImpact.critical}, serious ${problems.summary.byImpact.serious}, moderate ${problems.summary.byImpact.moderate}, minor ${problems.summary.byImpact.minor})</li>
  <li>Since the last production scan: ${d.hasBaseline ? `<strong>${problems.added.length}</strong> new, <strong>${problems.fixed.length}</strong> fixed, <strong>${problems.improved.length}</strong> improved` : 'nothing to compare with (first run)'}</li>
  <li>Raw count: ${summary.total} failing checks, counting each page and width separately · ${summary.waived} waived by agreement${errors.length ? ` · <strong>${errors.length}</strong> page views failed to load` : ''}</li>
</ul>

<h2 style="font-size:1.15rem;margin-top:1.5rem;">Open problems</h2>
${htmlProblems(problems.open)}
${run.gateFailures?.length ? `<p style="padding:0.5rem 0.75rem;border-left:4px solid #b3261e;background:#fbeceb;"><strong>Gate failed:</strong> ${run.gateFailures.length} new finding(s) match the blocking rules for this run.</p>` : ''}
${warnings.length ? `<p style="color:#8a4a06;">Config warnings: ${warnings.map(esc).join(' ')}</p>` : ''}

<h2 style="font-size:1.15rem;margin-top:1.5rem;">New, page by page</h2>
${ruleTable(groupByRule(d.added), { showDelta: true })}

<h2 style="font-size:1.15rem;margin-top:1.5rem;">Fixed</h2>
${d.fixed.length ? `<ul>${groupByRule(d.fixed).map((g) => `<li>${esc(g.help)} (${esc(g.rule)}): ${g.rows.length} page view${g.rows.length === 1 ? '' : 's'}</li>`).join('')}</ul>` : '<p>None.</p>'}

<h2 style="font-size:1.15rem;margin-top:1.5rem;">Still open</h2>
${d.ongoing.length ? `<ul>${groupByRule(d.ongoing).map((g) => `<li><span style="color:${COLORS[g.impact] || '#333'};">${esc(g.impact)}</span> · ${esc(g.help)} (${esc(g.rule)}): ${g.rows.length} page view${g.rows.length === 1 ? '' : 's'}, e.g. ${esc(g.rows[0].path)}</li>`).join('')}</ul><p style="font-size:0.85rem;">Page-by-page detail is in the full results.</p>` : '<p>None.</p>'}

${waived.length ? `<h2 style="font-size:1.15rem;margin-top:1.5rem;">Waived</h2><ul>${[...new Map(waived.map((w) => [w.rule, w])).values()].map((w) => `<li>${esc(w.rule)}: ${esc(w.waived.reason)} (approved by ${esc(w.waived.approvedBy)})</li>`).join('')}</ul>` : ''}
${errors.length ? `<h2 style="font-size:1.15rem;margin-top:1.5rem;">Pages that failed to load</h2><ul>${errors.slice(0, 30).map((p) => `<li>${esc(p.path)} (${esc(p.viewport)}): ${esc(p.error)}</li>`).join('')}</ul>` : ''}
${trend(history)}
<p style="margin-top:2rem;font-size:0.8rem;color:#555;">Automated checks catch only part of what WCAG covers. Keyboard, screen reader and content checks still need a person. Sent by geletkaplus/a11y-monitor.</p>
</main></body></html>`;
}

// Markdown for GitHub: the status issue body (always current) and the comment
// posted when something changed. Both lead with problems (the same element
// failing on many pages counts once); raw per-page counts are a footnote.
// GitHub caps issue bodies at 65,536 characters.
const MAX_MD = 60000;
const mdEsc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const cap = (md) => (md.length > MAX_MD ? md.slice(0, MAX_MD) + '\n\n_Truncated. The full report is attached to the run._' : md);

function mdProblem(p, { change } = {}) {
  const vendor = p.vendor ? ` · **${p.vendor}**` : '';
  // Single-page problems already name the page in the scope label.
  const where = p.siteWide || p.pages.length === 1 ? '' : p.pages.length <= 3 ? ` · ${p.pages.map((x) => `\`${mdEsc(x)}\``).join(', ')}` : ` · e.g. \`${mdEsc(p.pages[0])}\``;
  let delta = '';
  if (change === 'improved') {
    const was = p.rows.reduce((n, r) => n + (r.previousCount || 0), 0);
    const now = p.rows.reduce((n, r) => n + r.count, 0);
    delta = ` · ${was} → ${now} failing elements`;
  }
  return `- **${p.impact}** · ${mdEsc(p.help)} (\`${p.rule}\`) · ${scopeLabel(p)} · ${p.widths}${vendor}${where}${delta} · [how to fix](${p.helpUrl})`;
}

function mdList(list, opts) {
  return list.length ? list.map((p) => mdProblem(p, opts)).join('\n') : '_None._';
}

function mdHeadline(problems, summary) {
  const ps = problems.summary;
  return `**${ps.problems} open problems** · ${problems.open.filter((p) => p.siteWide).length} site-wide · ${ps.vendorProblems} from third-party vendors · on ${ps.pages} pages
(critical ${ps.byImpact.critical}, serious ${ps.byImpact.serious}, moderate ${ps.byImpact.moderate}, minor ${ps.byImpact.minor})

<sub>Raw count: ${summary.total} failing checks, counting each page and width separately.${summary.waived ? ` ${summary.waived} waived by agreement.` : ''}</sub>`;
}

export function renderIssueBody({ run, summary, problems }) {
  const runLink = run.runUrl ? ` · [run and full report](${run.runUrl})` : '';
  const ours = problems.open.filter((p) => !p.vendor);
  const theirs = problems.open.filter((p) => p.vendor);
  return cap(`Updated after every production scan by a11y-monitor. Comments below record each change.

**Last scan:** ${run.date.slice(0, 16).replace('T', ' ')} UTC · ${run.trigger} · ${run.origin} · axe-core ${run.axeVersion}${runLink}

${mdHeadline(problems, summary)}

### Our code (${ours.length})
${mdList(ours)}

### Third-party vendors (${theirs.length})
${mdList(theirs)}

_A problem is one cause: the same element failing on many pages counts once. Automated checks catch only part of WCAG; keyboard, screen reader and content review still need people._
`);
}

export function renderComment({ run, summary, d, problems }, mentionLine = '') {
  const where = run.target === 'preview' ? `Preview ${run.origin}` : `Production (${run.trigger})`;
  const changes = d.hasBaseline
    ? `${problems.added.length} new, ${problems.fixed.length} fixed, ${problems.improved.length} improved`
    : 'first scan';
  const sections = [
    ['New', problems.added, {}],
    ['Improved', problems.improved, { change: 'improved' }],
    ['Fixed', problems.fixed, {}],
  ].filter(([, list]) => list.length).map(([title, list, opts]) => `### ${title}\n${mdList(list, opts)}`).join('\n\n');
  const gate = run.gateFailures?.length ? `\n\n:x: **Gate failed:** ${run.gateFailures.length} new finding(s) match the blocking rules.` : '';
  return cap(`${mentionLine ? mentionLine + '\n\n' : ''}**${where}:** ${changes} · ${problems.summary.problems} problems open.${run.runUrl ? ` [Run and full report](${run.runUrl})` : ''}${gate}

${mdHeadline(problems, summary)}

${sections || '_No changes._'}
`);
}
