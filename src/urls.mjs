// Builds the list of paths to scan from the sitemap plus any configured paths.
// Sitemaps usually hold absolute production URLs; we keep only the path so the
// same list works against a preview deployment.

export function pathsFromSitemapXml(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  return locs.map((loc) => {
    try {
      const u = new URL(loc);
      return u.pathname + u.search;
    } catch {
      return loc.startsWith('/') ? loc : null;
    }
  }).filter(Boolean);
}

async function fetchText(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

export async function discoverPaths(cfg, origin, headers = {}) {
  let paths = [];
  if (cfg.sitemap) {
    const xml = await fetchText(origin + cfg.sitemap, headers);
    paths = pathsFromSitemapXml(xml);
    // A sitemap index points at further sitemaps; follow one level.
    const nested = paths.filter((p) => /\.xml(\?|$)/.test(p));
    for (const n of nested) paths.push(...pathsFromSitemapXml(await fetchText(origin + n, headers)));
    paths = paths.filter((p) => !/\.xml(\?|$)/.test(p));
  }
  paths.push(...cfg.paths);
  const excluded = (p) => cfg.exclude.some((e) => (e.endsWith('*') ? p.startsWith(e.slice(0, -1)) : p === e));
  const unique = [...new Set(paths.map((p) => p || '/'))].filter((p) => !excluded(p));
  return unique.slice(0, cfg.maxUrls);
}
