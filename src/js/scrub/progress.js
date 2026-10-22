/**
 * ScrollScore - scroll progress mapping
 *
 * Two progress modes are supported:
 *
 *   element  The classic "as this element crosses the viewport" reading.
 *            start = element top touches viewport bottom
 *            end   = element bottom touches viewport top
 *            An `offset` in pixels shifts both edges (negative = earlier).
 *
 *   page     Global document progress, 0 at the very top and 1 at the very
 *            bottom. This is the mode that makes `pin` (sticky) sequences
 *            predictable, because the pinned element no longer moves.
 *
 * All geometry is captured once by `measure()`; the per-frame path only reads
 * `scrollY`, so scrubbing never forces a synchronous layout.
 */

export const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * @typedef {{start:number, end:number, height:number, top:number}} Bounds
 */

/**
 * Capture document-space geometry for a node.
 * Must be called while the page is at rest (no in-flight sticky transform).
 *
 * @param {HTMLElement} node
 * @param {number} viewportH
 * @param {number} [offset=0] pixels to shift the trigger edges
 * @returns {Bounds}
 */
export function measureElementBounds(node, viewportH, offset = 0) {
  const rect = node.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const top = rect.top + scrollY;
  const height = rect.height;
  return {
    top,
    height,
    start: top - viewportH + offset,
    end: top + height + offset
  };
}

/**
 * Element-mode progress for a given scroll position.
 * @param {number} scrollY
 * @param {Bounds} bounds
 * @returns {number} 0..1
 */
export function elementProgress(scrollY, bounds) {
  const span = bounds.end - bounds.start;
  if (span <= 0) return scrollY >= bounds.start ? 1 : 0;
  return clamp01((scrollY - bounds.start) / span);
}

/**
 * Document-mode progress.
 * @param {number} scrollY
 * @param {number} docHeight
 * @param {number} viewportH
 * @returns {number} 0..1
 */
export function pageProgress(scrollY, docHeight, viewportH) {
  const span = docHeight - viewportH;
  if (span <= 0) return 0;
  return clamp01(scrollY / span);
}

/**
 * Re-map a global progress value into a sub-range, e.g. run an animation only
 * between 20% and 60% of the page.
 *
 * @param {number} progress
 * @param {[number, number]} range
 * @returns {number} 0..1
 */
export function mapRange(progress, range) {
  if (!Array.isArray(range) || range.length !== 2) return clamp01(progress);
  const [a, b] = range;
  const span = b - a;
  if (span <= 0) return progress >= b ? 1 : 0;
  return clamp01((progress - a) / span);
}

/**
 * Progress inside a pin window. Used by the studio to draw the pinned segment
 * and by the exporter to size the sticky spacer.
 *
 * @param {number} progress element/page progress before pinning
 * @param {[number, number]} window
 * @returns {{phase:'before'|'inside'|'after', t:number}}
 */
export function pinPhase(progress, window) {
  const [a, b] = window;
  if (progress < a) return { phase: 'before', t: 0 };
  if (progress > b) return { phase: 'after', t: 1 };
  const span = b - a;
  return { phase: 'inside', t: span <= 0 ? 1 : (progress - a) / span };
}

/**
 * Parse a `"0.2,0.8"` style attribute into a numeric range.
 * @param {string} raw
 * @param {[number, number]} [fallback=[0,1]]
 * @returns {[number, number]}
 */
export function parseRange(raw, fallback = [0, 1]) {
  if (typeof raw !== 'string') return fallback;
  const parts = raw.split(/[,;\s]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return fallback;
  const a = clamp01(Math.min(parts[0], parts[1]));
  const b = clamp01(Math.max(parts[0], parts[1]));
  return [a, b];
}
