/**
 * Shared visual mapping for Mneme memory strength + the forgetting-curve math,
 * kept in one place so the feed, panels, and charts all agree.
 *
 * Strength labels mirror the server (retrievabilityEngine.strengthLabel):
 *   solid >= 0.85, fading >= 0.6, slipping >= 0.35, else 'almost gone'.
 */

export const STRENGTH_META = {
  solid:         { label: 'solid',      badge: 'success', hex: '#4caf8c' },
  fading:        { label: 'fading',     badge: 'default', hex: '#6c8cff' },
  slipping:      { label: 'slipping',   badge: 'warning', hex: '#e5a456' },
  'almost gone': { label: 'almost gone', badge: 'danger', hex: '#e56b6f' },
};

export function strengthMeta(label) {
  return STRENGTH_META[label] || STRENGTH_META.fading;
}

export function pct(r) {
  return Math.round((r || 0) * 100);
}

/**
 * Forgetting curve: R(t) = 2^(-t / stability), t in days since the last review.
 * Returns points across a window so we can draw the decay and mark "now".
 *
 * @param {number} stabilityDays  memory half-life in days
 * @param {number} daysSinceReview  how long since it was last reinforced
 */
export function forgettingCurve(stabilityDays, daysSinceReview, { points = 40, horizon } = {}) {
  const s = Math.max(stabilityDays || 1, 0.1);
  // Show a window that comfortably contains "now" and a bit of the future.
  const span = horizon || Math.max(s * 4, (daysSinceReview || 0) * 1.4, 7);
  const data = [];
  for (let i = 0; i <= points; i += 1) {
    const t = (span * i) / points;
    data.push({ day: Math.round(t * 10) / 10, retention: Math.pow(2, -t / s) });
  }
  return { data, now: Math.min(daysSinceReview || 0, span), span };
}
