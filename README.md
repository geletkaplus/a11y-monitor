# a11y-monitor

Accessibility scanning and reporting for Geletka+ sites.

- **Per site:** after every production deploy, after content is published, and weekly, it scans every page in the sitemap with axe-core (WCAG 2.2 A + AA and best practice) at desktop and mobile widths, checks reflow at 320px and extra h1s, and compares with the last production scan.
- **How results are counted:** reports lead with **problems**, not raw findings. The same element failing on many pages is one problem; one that fails on 80%+ of pages is marked **site-wide** (usually a shared component or a third-party script). Content that scrolls sideways at 320px is grouped by page template (e.g. `/shop/sauces/*`). Problems in known third-party code are tagged with the vendor and listed separately. A problem that gets better but isn't gone (2 failing elements → 1) is reported as **improved**. Raw per-page, per-width counts stay in the report as detail.
- **Where results go:** an issue titled **Accessibility status** in the site's repo (label `a11y-status`). Every production scan rewrites its body with the current state. When something is new or fixed, the scan adds a comment that @mentions the people in `A11Y_MENTIONS`, and GitHub emails and notifies them. The full HTML report is attached to each run. No mail service is involved.
- **Once for all sites:** a monthly check of the current WCAG Recommendation, the WCAG 3 draft and axe-core releases. When one moves, it opens an issue in this repo that @mentions the same people.

It never blocks a deploy: scans run after the deploy finishes. Only production is scanned; preview deployments are skipped (they show as skipped runs, because GitHub can't filter deployment events by environment before a run starts).

Automated checks catch only part of WCAG. Keyboard, screen reader and content review still need people.

## Adding a site

Follow **[docs/ADDING-A-SITE.md](docs/ADDING-A-SITE.md)**: the decisions to make, the config file and workflow, notifications, scans on content publish, a checklist, and troubleshooting. About 30 minutes per site.

## Org settings (set once in geletkaplus)

| Name | Kind | What |
|---|---|---|
| `A11Y_MENTIONS` | Variable (org, or per repo if you're not an org admin) | GitHub usernames to notify, space- or comma-separated, e.g. `jscarpelli3`. Each person must be able to see the site's repo, and gets GitHub's normal email and app notifications for mentions. |
| `A11Y_MONITOR_READ_TOKEN` | Secret | Read access to this repo, while it is private. Not needed if the repo is public or the org allows workflow access to it (Settings → Actions → Access). |

Without `A11Y_MENTIONS` the status issue is still updated; nobody is pinged.

## Waivers

A finding we have decided to accept goes in the config, with a reason and a named approver. Waivers without both are ignored and reported as config warnings. Waived findings are listed separately and don't count as open.

```json
"waivers": [
  { "rule": "color-contrast", "paths": ["/find-us"], "reason": "Destini locator, vendor ticket #123", "approvedBy": "Name" }
]
```

## Gate

Not used by the site template, which scans production only. A gate only makes sense on preview scans, before merging.

`"gate": { "impacts": ["critical"], "rules": ["button-name", "link-name", "label"] }` fails a run only for **new** findings that match an impact or rule, and only where the workflow passes `gate: true`. Existing debt never fails a run.

## Baselines and history

Each production scan is uploaded as the artifact `a11y-results-production` (kept 90 days). The next run downloads the latest one to compare against, and carries a trend of the last 104 production runs forward inside it. The weekly schedule keeps that chain from expiring.

## Running locally

```sh
pnpm install
pnpm exec playwright install chromium
node src/cli.mjs scan --config ../site/a11y.config.json --out a11y-report
node src/cli.mjs scan --config ../site/a11y.config.json --baseline old/results.json --origin https://preview.example.com --target preview
node src/cli.mjs standards --state standards-state.json --out standards-report
pnpm test
```

Exit codes: 0 ran (findings alone never fail), 1 gate failed, 2 the run could not complete.

## Known limits

- Content that fades in through JavaScript tweens (not CSS) can be caught mid-fade and show up as a contrast failure. CSS transitions are forced to their end state before axe runs.
- Findings are tracked per rule, page and viewport, not per element, because hashed class names change between builds. More failing elements on a page than last time counts as new; fewer counts as improved.
- Vendor tagging only sees the failing element and, for extra h1s, its ancestors. A problem a vendor causes in our own markup (e.g. a widget that adds a second `<main>`, making ours fail `landmark-no-duplicate-main`) still shows under our code.
- Third-party widgets (reviews, store locators, loyalty, checkout) are scanned where they render in the page, but not inside cross-origin iframes.

## Releasing

Sites call `scan.yml@v1`. After a change: run the tests, then move the `v1` tag (or cut `v2` for breaking config changes).
