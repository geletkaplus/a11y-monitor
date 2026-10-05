// Decides whether a run should notify people. Notification itself is a GitHub
// issue comment posted by the workflow: GitHub emails and pings whoever the
// comment @mentions, so no mail service is needed.

export function shouldNotify(cfg, target, d) {
  const mode = target === 'preview' ? cfg.notify.preview : cfg.notify.default;
  if (mode === 'never') return false;
  if (mode === 'changes') return !d.hasBaseline || d.added.length > 0 || d.fixed.length > 0;
  return true;
}

// "@a, b ,@c" -> "@a @b @c"
export function mentions(list = '') {
  return list.split(/[\s,]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean).map((u) => `@${u}`).join(' ');
}
