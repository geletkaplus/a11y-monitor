# a11y-monitor

Accessibility scanning and reporting for Geletka+ sites.

- **Per site:** after every production deploy, after content is published, and weekly, it scans every page in the sitemap with axe-core (WCAG 2.2 A + AA and best practice) at desktop and mobile widths, checks reflow at 320px and extra h1s, and compares with the last production scan.
- **Where results go:** an issue titled **Accessibility status** in the site's repo (label `a11y-status`). Every production scan rewrites its body with the current state. When something is new or fixed, the scan adds a comment that @mentions the people in `A11Y_MENTIONS`, and GitHub emails and notifies them. The full HTML report is attached to each run. No mail service is involved.
- **Once for all sites:** a monthly check of the current WCAG Recommendation, the WCAG 3 draft and axe-core releases. When one moves, it opens an issue in this repo that @mentions the same people.

It never blocks a deploy: scans run after the deploy finishes. Only production is scanned; preview deployments are skipped (they show as skipped runs, because GitHub can't filter deployment events by environment before a run starts).

Automated checks catch only part of WCAG. Keyboard, screen reader and content review still need people.

## Adding a site

1. Add `a11y.config.json` at the repo root:

   ```json
   { "site": "carbone", "baseUrl": "https://www.carbonefinefood.com" }
   ```

   Optional fields (defaults in `src/config.mjs`): `sitemap`, `paths`, `exclude` (exact paths or `prefix*`), `maxUrls`, `viewports`, `reflowWidth`, `tags`, `concurrency`, `waits`, `waivers`, `gate`, `notify`.

   `notify` sets when a scan comments (and so pings people): `{ "default": "changes", "preview": "changes" }`. Use `"always"` to get a comment after every production scan, or `"never"`.

   `waits` gives slow third-party widgets time to finish, e.g. `{ "/find-us": 8000 }` for a store locator. If a page's findings flip between runs, a wait usually fixes it.

2. Copy `templates/site-workflow.yml` to `.github/workflows/a11y.yml`.

3. **Content publishes** (Sanity sites). Most of our sites refresh content on a timer rather than rebuilding, so a publish does not create a deploy. Add a Sanity webhook (sanity.io/manage → API → Webhooks) that tells GitHub to scan:
   - URL: `https://api.github.com/repos/geletkaplus/<repo>/dispatches`
   - Trigger on: create, update, delete. Filter: `!(_id in path("drafts.**"))`
   - Projection: `{"event_type": "content-published", "client_payload": {"id": _id, "type": _type}}`
   - HTTP method: POST. Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`. The token is a fine-grained GitHub token with **Contents: read and write** on that one repo (that is what the dispatches endpoint requires).

   Publishes are debounced: each one starts a 5-minute wait, and a new publish during the wait cancels it and starts the wait again, so a session of edits produces one scan, 5 minutes after the last publish. Set the repo variable `A11Y_PUBLISH_DELAY` (seconds) to change the wait. The waiting run occupies a runner, so a long burst of publishes costs some Actions minutes even though only one scan runs.


## Org settings (set once in geletkaplus)

| Name | Kind | What |
|---|---|---|
| `A11Y_MENTIONS` | Variable | GitHub usernames to notify, space- or comma-separated, e.g. `jscarpelli3`. Each person must be able to see the site's repo, and gets GitHub's normal email and app notifications for mentions. |
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
- Findings are tracked per rule, page and viewport, not per element, because hashed class names change between builds. More failing elements on a page than last time counts as new.
- Third-party widgets (reviews, store locators, loyalty, checkout) are scanned where they render in the page, but not inside cross-origin iframes.

## Releasing

Sites call `scan.yml@v1`. After a change: run the tests, then move the `v1` tag (or cut `v2` for breaking config changes).
