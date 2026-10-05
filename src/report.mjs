// Renders the report as one self-contained, accessible HTML page. The same HTML
// is attached to every CI run; the issue text comes from the Markdown renderers below.
import { groupByRule } from './diff.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COLORS = { critical: '#b3261e', serious: '#8a4a06', moderate: '#5c5000', minor: '#3d5a73' };

function ruleTable(groups, { showDelta = false } = {}) {
  if (!groups.length) return '<p>None.</p>';
  return groups.map((g) => `
    <h4 style="margin:1.25rem 0 0.25rem;font-size:1rem;">
      <span style="color:${COLORS[g.impact] || '#333'};text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em;">${esc(g.impact)}</span>
      ${esc(g.help)} <span style="font-weight:400;color:#555;">(${esc(g.rule)}${g.wcag?.length ? ', WCAG ' + esc(g.wcag.join(', ')) : ''})</span>
    </h4>
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

function trend(history) {
  if (!history?.length) return '';
  const rows = history.slice(-8).map((h) => `<tr><td style="padding:0.2rem 0.5rem;">${esc(h.date.slice(0, 10))}</td><td style="padding:0.2rem 0.5rem;">${esc(h.trigger)}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.pages ?? ''}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.total}</td><td style="padding:0.2rem 0.5rem;text-align:right;">${h.byImpact.critical + h.byImpact.serious}</td></tr>`).join('');
  return `<h3>Trend (last ${Math.min(8, history.length)} production runs)</h3>
  <table style="border-collapse:collapse;font-size:0.85rem;"><thead><tr><th scope="col" style="text-align:left;padding:0.2rem 0.5rem;">Date</th><th scope="col" style="text-align:left;padding:0.2rem 0.5rem;">Trigger</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Pages</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Open issues</th><th scope="col" style="text-align:right;padding:0.2rem 0.5rem;">Critical + serious</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function subjectLine(run, d, summary) {
  const what = d.hasBaseline ? `${d.added.length} new, ${d.fixed.length} fixed, ` : 'first run, ';
  return `[a11y] ${run.site} ${run.target}: ${what}${summary.total} open`;
}

export function renderReport({ run, summary, d, rows, pages, history, warnings = [] }) {
  const errors = pages.filter((p) => p.error);
  const waived = rows.filter((r) => r.waived);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subjectLine(run, d, summary))}</title></head>
<body style="margin:0;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1a19;background:#fff;line-height:1.5;">
<main style="max-width:56rem;margin:0 auto;">
<h1 style="font-size:1.4rem;margin:0 0 0.25rem;">Accessibility report: ${esc(run.site)}</h1>
<p style="margin:0;color:#555;">${esc(run.target)} · ${esc(run.origin)} · triggered by ${esc(run.trigger)} · ${esc(run.date)}</p>
<p style="margin:0.25rem 0 0;color:#555;">${pages.length / run.viewports.length} pages × ${run.viewports.length} viewports (${esc(run.viewports.join(', '))}) · axe-core ${esc(run.axeVersion)} · WCAG 2.2 A + AA and best practice${run.runUrl ? ` · <a href="${esc(run.runUrl)}">full results</a>` : ''}</p>

<h2 style="font-size:1.15rem;margin-top:1.5rem;">Summary</h2>
<ul>
  <li><strong>${d.hasBaseline ? d.added.length : '—'}</strong> new since the last production scan${d.hasBaseline ? '' : ' (no earlier scan to compare with)'}</li>
  <li><strong>${d.hasBaseline ? d.fixed.length : '—'}</strong> fixed since the last production scan</li>
  <li><strong>${summary.total}</strong> open (critical ${summary.byImpact.critical}, serious ${summary.byImpact.serious}, moderate ${summary.byImpact.moderate}, minor ${summary.byImpact.minor}) across ${summary.pages} pages</li>
  <li>${summary.waived} waived by agreement${errors.length ? ` · <strong>${errors.length}</strong> page views failed to load` : ''}</li>
</ul>
${run.gateFailures?.length ? `<p style="padding:0.5rem 0.75rem;border-left:4px solid #b3261e;background:#fbeceb;"><strong>Gate failed:</strong> ${run.gateFailures.length} new finding(s) match the blocking rules for this run.</p>` : ''}
${warnings.length ? `<p style="color:#8a4a06;">Config warnings: ${warnings.map(esc).join(' ')}</p>` : ''}

<h2 style="font-size:1.15rem;margin-top:1.5rem;">New</h2>
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
// posted when something changed. GitHub caps issue bodies at 65,536 characters.
const MAX_MD = 60000;
const mdEsc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function mdRules(groups, { limit = 15, delta = false } = {}) {
  if (!groups.length) return '_None._\n';
  return groups.map((g) => {
    const pages = g.rows.slice(0, limit).map((r) => `| \`${mdEsc(r.path)}\` | ${r.viewport} | ${r.count}${delta && r.previousCount ? ` (was ${r.previousCount})` : ''} |`).join('\n');
    const more = g.rows.length > limit ? `\n\n…and ${g.rows.length - limit} more page views.` : '';
    return `**${g.impact}** · ${mdEsc(g.help)} (\`${g.rule}\`${g.wcag?.length ? `, WCAG ${g.wcag.join(', ')}` : ''}) · [how to fix](${g.helpUrl})\n\n| Page | Viewport | Elements |\n|---|---|---|\n${pages}${more}\n`;
  }).join('\n');
}

function mdSummary(run, d, summary) {
  return [
    `- **${d.hasBaseline ? d.added.length : '—'}** new since the last production scan${d.hasBaseline ? '' : ' (first run, nothing to compare with)'}`,
    `- **${d.hasBaseline ? d.fixed.length : '—'}** fixed`,
    `- **${summary.total}** open: critical ${summary.byImpact.critical}, serious ${summary.byImpact.serious}, moderate ${summary.byImpact.moderate}, minor ${summary.byImpact.minor}, across ${summary.pages} pages`,
    summary.waived ? `- ${summary.waived} waived by agreement` : null,
    run.gateFailures?.length ? `- :x: **Gate failed:** ${run.gateFailures.length} new finding(s) match the blocking rules` : null,
  ].filter(Boolean).join('\n');
}

const cap = (md) => (md.length > MAX_MD ? md.slice(0, MAX_MD) + '\n\n_Truncated. The full report is attached to the run._' : md);

export function renderIssueBody({ run, summary, d }) {
  const runLink = run.runUrl ? ` · [run and full report](${run.runUrl})` : '';
  return cap(`Updated after every production scan by a11y-monitor. Comments below record each change.

**Last scan:** ${run.date.slice(0, 16).replace('T', ' ')} UTC · ${run.trigger} · ${run.origin} · axe-core ${run.axeVersion}${runLink}

${mdSummary(run, d, summary)}

### Open findings by rule
${groupByRule([...d.added, ...d.ongoing]).map((g) => `- **${g.impact}** · ${mdEsc(g.help)} (\`${g.rule}\`): ${g.rows.length} page view${g.rows.length === 1 ? '' : 's'}, e.g. \`${mdEsc(g.rows[0].path)}\``).join('\n') || '_None._'}

_Automated checks catch only part of WCAG. Keyboard, screen reader and content review still need people._
`);
}

export function renderComment({ run, summary, d }, mentionLine = '') {
  const where = run.target === 'preview' ? `Preview ${run.origin}` : `Production (${run.trigger})`;
  const fixed = groupByRule(d.fixed).map((g) => `- ${mdEsc(g.help)} (\`${g.rule}\`): ${g.rows.length} page view${g.rows.length === 1 ? '' : 's'}`).join('\n');
  return cap(`${mentionLine ? mentionLine + '\n\n' : ''}**${where}:** ${d.hasBaseline ? `${d.added.length} new, ${d.fixed.length} fixed` : 'first scan'}, ${summary.total} open.${run.runUrl ? ` [Run and full report](${run.runUrl})` : ''}

${mdSummary(run, d, summary)}

### New
${mdRules(groupByRule(d.added), { delta: true })}
${fixed ? `### Fixed\n${fixed}\n` : ''}`);
}
