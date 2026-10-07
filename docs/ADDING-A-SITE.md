# Adding a site to a11y-monitor

How to put a Geletka+ site under automated accessibility monitoring. Carbone
(`geletkaplus/carbonefinefood`) was the first site and is the reference
setup. Expect about 30 minutes, plus one full scan.

**What the site gets:**

- A full scan after every production deploy, after content is published
  (optional, step 4), every Monday, and on demand.
- An **Accessibility status** issue in the site's repo, rewritten after every
  production scan, listing open problems split into "our code" and
  "third-party vendors".
- A comment on that issue, @mentioning chosen people, whenever a problem is
  new, fixed or improved. GitHub sends the emails; no mail service is needed.
- Nothing ever blocks a deploy. Scans run after the deploy finishes.

## 0. Decide before you start

| Question | Why it matters |
|---|---|
| What is the production URL, and does `/sitemap.xml` list every page? | The scan covers the sitemap. With no sitemap, list pages in `paths`. |
| How does a content change reach the live site? | If every publish triggers a rebuild, deploy scans already cover content and you can skip step 4. If content goes live without a deploy (timed or per-request rendering), set up step 4. |
| Does the host report deployments to GitHub? | Vercel does (confirmed on Carbone, including redeploys from the Vercel dashboard); that's what starts deploy scans. For other hosts, check the repo's Deployments list on GitHub. Without it you only get scheduled, manual and publish scans. |
| Who should be pinged? | GitHub usernames. Each person needs access to the site's repo. |
| Is there Actions budget? | One full scan of about 100 pages at two widths takes about 15 Actions minutes. Private repos draw on the org's allowance. |
| Which third-party widgets are on the site? | Reviews, locators, loyalty, chat and signup widgets have their own problems. Known vendors are tagged automatically; add others in `vendors`. |

## 1. Add `a11y.config.json` at the repo root

Minimal:

```json
{ "site": "sitename", "baseUrl": "https://www.example.com" }
```

All options (defaults live in `src/config.mjs`):

| Field | Default | Use |
|---|---|---|
| `site` | required | Short name shown in reports. |
| `baseUrl` | required | Production origin, no trailing slash. |
| `sitemap` | `"/sitemap.xml"` | Path on the origin. `null` to use `paths` only. Absolute URLs in the sitemap are reduced to paths. |
| `paths` | `[]` | Extra pages to scan. |
| `exclude` | `[]` | Exact paths, or `"/prefix*"`. |
| `maxUrls` | `400` | Cap on pages per scan. |
| `viewports` | desktop 1440×900, mobile 390×844 | Widths to scan. |
| `reflowWidth` | `320` | Width for the sideways-scroll check (WCAG 1.4.10). `null` to skip. |
| `waits` | `{}` | Extra settle time in ms for slow widgets, e.g. `{ "/find-us": 8000 }`. Add one when a page's findings flip between runs. |
| `vendors` | `[]` | Extra third-party code to tag, added to the built-in list: `[{ "name": "Acme chat", "match": ["acme-"] }]`, matched against the failing element's markup. |
| `waivers` | `[]` | Accepted findings: `{ "rule", "paths"?, "reason", "approvedBy" }`. Without a reason and an approver, a waiver is ignored. |
| `notify` | `{ "default": "changes", "preview": "changes" }` | When to comment: `"changes"`, `"always"` or `"never"`. |
| `concurrency` | `4` | Pages scanned in parallel. Lower it if the host rate-limits. |

Carbone's config:

```json
{
  "site": "carbone",
  "baseUrl": "https://www.carbonefinefood.com",
  "waits": { "/find-us": 8000 }
}
```

## 2. Add the workflow

Copy [`templates/site-workflow.yml`](../templates/site-workflow.yml) to
`.github/workflows/a11y.yml` in the site repo, unchanged. It:

- scans after successful **production** deployments only; preview deployments
  show up as skipped runs;
- scans on `repository_dispatch` events of type `content-published` (step 4),
  waiting until publishing has been quiet for `A11Y_PUBLISH_DELAY` seconds
  (default 300). A newer publish cancels the waiting run;
- scans every Monday at 13:00 UTC, and from "Run workflow";
- asks for `issues: write` so it can post the status issue.

The workflow only takes effect once it's on the default branch.

## 3. Choose who gets pinged

Set the GitHub usernames as a variable: on the org if you're an org admin
(applies to every site), otherwise on the site repo:

```sh
gh variable set A11Y_MENTIONS --repo geletkaplus/<repo> --body "jscarpelli3 daleinen7 jgeletka"
```

Without it the status issue is still updated, but nobody is pinged.

## 4. Scans on content publish (optional)

Only needed when content goes live without a deploy (see step 0). Something
must POST a `content-published` event to GitHub:

```http
POST https://api.github.com/repos/geletkaplus/<repo>/dispatches
Authorization: Bearer <token>
Accept: application/vnd.github+json

{ "event_type": "content-published", "client_payload": { "id": "<doc id>", "type": "<doc type>" } }
```

**The token:** a fine-grained personal access token
(github.com/settings/personal-access-tokens/new). Resource owner `geletkaplus`,
only the one site repo, Repository permissions → **Contents: Read and write**
(what the dispatches endpoint requires), nothing else. Use the longest expiry
the org allows and **note the date**: when it lapses, publish scans stop
silently. Org policy may require an admin to approve it.

**Option A: the CMS webhook calls GitHub directly** (simplest). In Sanity:
sanity.io/manage → API → Webhooks → Create:

- URL: the dispatches endpoint above. Method: POST. Dataset: production.
- Trigger on: create, update, delete. Drafts: **off**.
- Filter: `!(_type in path("sanity.**")) && !(_type in path("system.**"))`
  (keeps preview-link secrets and other internal documents out).
- Projection: `{"event_type": "content-published", "client_payload": {"id": _id, "type": _type}}`
- Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`.

**Option B: piggyback on an existing on-publish route** (what Carbone does,
because its Sanity plan had no webhook slots left). The site's existing webhook
handler also calls GitHub after it has verified the webhook signature:

- Copy `src/lib/a11yScanDispatch.ts` and its test from `geletkaplus/carbonefinefood`.
  `requestA11yScan()` never throws and does nothing unless both env vars are set.
- Call it with `after()` from `next/server`, so it runs once the response has
  been sent: `after(() => requestA11yScan({ id, type }))`.
- Add the env vars in the host, **Production only**, server-side (no
  `NEXT_PUBLIC_`): `GITHUB_DISPATCH_TOKEN` (the token) and `A11Y_DISPATCH_REPO`
  (`geletkaplus/<repo>`). **Redeploy** after adding them; a running deployment
  doesn't pick them up.
- Make sure the webhook sends every document type the site renders, not just
  the ones the route originally handled. Carbone's projection ends `select()`
  with a default case, `{ "other": { _id, _type } }`, and the route returns 200
  for types it doesn't index.

Other CMSs: anything that can send a POST with a custom header on publish works.
Otherwise skip step 4; deploys and the weekly scan still cover the site.

## 5. First run

```sh
gh workflow run a11y.yml --repo geletkaplus/<repo>
gh run watch --repo geletkaplus/<repo>
```

The first run has nothing to compare with, so it reports everything and pings
everyone. Its results become the baseline for later scans.

## 6. Check it worked

- [ ] The run succeeded, and its artifact `a11y-results-production` exists.
- [ ] An issue titled **Accessibility status** (label `a11y-status`) exists and
      lists problems.
- [ ] The people in `A11Y_MENTIONS` got a GitHub notification for the comment.
- [ ] **Site-wide** problems make sense. They're usually a shared component (nav,
      footer, card) or a third-party script; fix those first, since each one
      clears every page.
- [ ] Vendor problems are tagged. If a widget's problems show under "our code",
      add it to `vendors`.
- [ ] Run it a second time. It should report 0 new and 0 fixed. If a page flips,
      give it a `waits` entry.
- [ ] If you did step 4: publish something real, then check that a
      `repository_dispatch` run appears and, about 5 minutes later, scans. With
      option A, check the webhook's attempt log for a 204.
- [ ] Add the "switch the scans off" box below to the site's README.

## Running it

**Pausing while making lots of changes.** Every deploy starts a full scan.
Before a day of many deploys, switch the workflow off and back on afterwards.
Put this box near the top of the site's README:

```markdown
> [!WARNING]
> **Making lots of changes or deploys in a row? Switch the accessibility scans off first.**
> **Off:** [a11y workflow](https://github.com/geletkaplus/<repo>/actions/workflows/a11y.yml) → "⋯" (top right) → Disable workflow, or `gh workflow disable a11y.yml -R geletkaplus/<repo>`
> **On again:** same menu → Enable workflow, then Run workflow, or `gh workflow enable a11y.yml -R geletkaplus/<repo> && gh workflow run a11y.yml -R geletkaplus/<repo>`
```

**Reading reports.** Lead with problems, not the raw count: the same failing
element on 100 pages at two widths is 1 problem, but 200 raw findings.
"Improved" means fewer failing elements than last time, but not zero yet.

**Baselines.** Each production scan's results are kept for 90 days, and the
weekly scan keeps that chain alive. If it lapses, the next scan starts a new
baseline, reports everything as new, and pings everyone once.

**Standards updates.** A monthly job in this repo watches the WCAG
Recommendation, the WCAG 3 draft and axe-core releases, and opens an issue here
when one changes. Sites pick up scanner changes when the `v1` tag moves.

## Troubleshooting (all seen on Carbone)

| Symptom | Cause | Fix |
|---|---|---|
| Run fails instantly: "The job was not started because recent account payments have failed or your spending limit needs to be increased" | The org's Actions minutes are used up and the budget is $0. It blocks every private repo, not just this one. | An org admin raises the Actions budget under Billing. |
| "No pages found at …/sitemap.xml" | The URL redirected to a login page (Vercel Deployment Protection on previews), or there's no sitemap. | Previews aren't scanned by the template. For production, check the sitemap or set `paths`. |
| A page's findings flip between new and fixed on alternate runs | A third-party widget renders late, so results depend on timing. | Add the page to `waits` (Carbone uses 8000 ms for its store locator). Changed pages are also rescanned automatically before being reported. |
| Contrast failures on text that looks fine | A fade-in caught mid-animation. CSS transitions are finished before checking, but JavaScript tweens aren't. | Rerun. If it persists, it's real. |
| Publishing doesn't start a scan | The webhook isn't sending the type, the token expired, or (option B) the env vars aren't in the running deployment. | Check the webhook attempt log, the token's expiry, and that you redeployed after adding env vars. |
| Requests to the site start returning 403 "Vercel Security Checkpoint" from your machine | Rapid repeated requests from one IP (we caused it by polling every 15 s for 10 minutes). | Wait it out, and don't poll the site in tight loops. GitHub's scan runners weren't affected. |
| A tap-target failure says "partially obscured" but the button works | An overlapping element's box, often an animated one, sits above it at some scroll positions. | Check with a real tap on a phone before fixing; it's often low priority. |
