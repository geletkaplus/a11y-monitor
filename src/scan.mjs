// Runs axe-core on every path at every viewport, plus two checks axe does not
// make: reflow at 320px (WCAG 1.4.10) and more than one exposed h1.
// Results are grouped per rule, page and viewport so they can be diffed.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { settleMs } from './config.mjs';

const SETTLE_MS = 1200;

async function scrollThrough(page) {
  // Lazy content and scroll-reveal sections only render once scrolled into view.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    // Text still part-transparent is usually a scroll-reveal that only runs while
    // in view. Bring each into view and give it time to finish.
    const effectiveOpacity = (el) => { let o = 1; for (let a = el; a; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
    const fading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,span')]
      .filter((el) => el.innerText?.trim() && el.checkVisibility() && effectiveOpacity(el) > 0 && effectiveOpacity(el) < 1)
      .slice(0, 40);
    for (const el of fading) {
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
    // Jump CSS transitions and Web Animations to their end state, so axe does not
    // measure text halfway through a fade-in. JS-driven tweens are not covered.
    for (const a of document.getAnimations()) {
      try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch {}
    }
  });
}

function wcagCriteria(tags) {
  // axe tags look like "wcag1410" -> 1.4.10
  return tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => {
    const d = t.slice(4);
    return `${d[0]}.${d[1]}.${d.slice(2)}`;
  });
}

async function scanPage(browser, origin, path, vp, cfg, headers) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, extraHTTPHeaders: headers });
  const page = await ctx.newPage();
  const result = { path, viewport: vp.name, findings: [] };
  try {
    const res = await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
    result.status = res?.status() ?? null;
    if (result.status && result.status >= 400) {
      result.error = `HTTP ${result.status}`;
      return result;
    }
    await page.waitForTimeout(settleMs(cfg, path, SETTLE_MS));
    await scrollThrough(page);
    await page.waitForTimeout(600);

    const axe = await new AxeBuilder({ page }).withTags(cfg.tags).analyze();
    for (const v of axe.violations) {
      result.findings.push({
        rule: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        wcag: wcagCriteria(v.tags),
        nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), why: (n.failureSummary || '').slice(0, 300) })),
        count: v.nodes.length,
      });
    }

    const h1s = await page.evaluate(() =>
      [...document.querySelectorAll('h1')]
        // checkVisibility() also catches an h1 hidden by a display:none ancestor (e.g. a desktop-only nav).
        .filter((h) => h.checkVisibility({ visibilityProperty: true }) && !h.closest('[aria-hidden="true"]'))
        .map((h) => (h.innerText || h.querySelector('img')?.alt || '').trim().slice(0, 60)),
    );
    if (h1s.length > 1) {
      result.findings.push({
        rule: 'gp-multiple-h1', impact: 'moderate', help: 'Page exposes more than one h1', wcag: ['1.3.1'],
        helpUrl: 'https://www.w3.org/WAI/tutorials/page-structure/headings/',
        nodes: h1s.map((t) => ({ target: 'h1', html: t, why: '' })), count: h1s.length,
      });
    }

    if (cfg.reflowWidth && vp.name === cfg.viewports[cfg.viewports.length - 1].name) {
      await page.setViewportSize({ width: cfg.reflowWidth, height: 640 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll('body *')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.right > W + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed';
        });
        const leaves = wide.filter((e) => !wide.some((x) => x !== e && e.contains(x)));
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: W,
          sample: leaves.slice(0, 5).map((e) => `${e.tagName.toLowerCase()} «${(e.innerText || '').trim().slice(0, 40)}» right=${Math.round(e.getBoundingClientRect().right)}`),
        };
      });
      if (overflow.scrollWidth > overflow.clientWidth) {
        result.findings.push({
          rule: 'gp-reflow', impact: 'serious', help: `Horizontal scroll at ${cfg.reflowWidth}px (page is ${overflow.scrollWidth}px wide)`, wcag: ['1.4.10'],
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
          nodes: overflow.sample.map((s) => ({ target: s, html: '', why: '' })), count: 1,
        });
      }
    }
  } catch (e) {
    result.error = String(e).slice(0, 300);
  } finally {
    await ctx.close();
  }
  return result;
}

export async function runScan(cfg, origin, paths, { headers = {}, log = () => {} } = {}) {
  const browser = await chromium.launch();
  const jobs = paths.flatMap((p) => cfg.viewports.map((vp) => [p, vp]));
  const pages = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [p, vp] = jobs[next++];
      const r = await scanPage(browser, origin, p, vp, cfg, headers);
      pages.push(r);
      log(`${pages.length}/${jobs.length} ${vp.name} ${p} ${r.error ? 'ERROR ' + r.error : r.findings.length + ' rules'}`);
    }
  }
  try {
    await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  } finally {
    await browser.close();
  }
  pages.sort((a, b) => a.path.localeCompare(b.path) || a.viewport.localeCompare(b.viewport));
  return pages;
}
