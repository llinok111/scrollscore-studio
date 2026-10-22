/**
 * ScrollScore - easing solver
 *
 * Part of the ScrollScore extension to AOS (Animate On Scroll).
 * Upstream AOS only exposes CSS `cubic-bezier()` strings consumed by the
 * browser; a JS-driven scrub engine needs to evaluate the same curves
 * numerically, so this module provides a real solver.
 *
 * The preset table below intentionally contains two families:
 *   - AOS_PRESETS: byte-for-byte the values declared in src/sass/_easing.scss,
 *     kept so that `data-aos-easing="..."` and scrub easing resolve identically.
 *   - TRUE_PRESETS: mathematically correct curves for the names where the
 *     upstream table has copy-paste artefacts (ease-in-cubic == ease-in-quad,
 *     linear != linear). See UPSTREAM.md "Defects found upstream".
 */

/** Cubic bezier control points as declared upstream in src/sass/_easing.scss */
export const AOS_PRESETS = {
  linear: [0.25, 0.25, 0.75, 0.75],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'ease-in-back': [0.6, -0.28, 0.735, 0.045],
  'ease-out-back': [0.175, 0.885, 0.32, 1.275],
  'ease-in-out-back': [0.68, -0.55, 0.265, 1.55],
  'ease-in-sine': [0.47, 0, 0.745, 0.715],
  'ease-out-sine': [0.39, 0.575, 0.565, 1],
  'ease-in-out-sine': [0.445, 0.05, 0.55, 0.95],
  'ease-in-quad': [0.55, 0.085, 0.68, 0.53],
  'ease-out-quad': [0.25, 0.46, 0.45, 0.94],
  'ease-in-out-quad': [0.455, 0.03, 0.515, 0.955],
  'ease-in-cubic': [0.55, 0.085, 0.68, 0.53],
  'ease-out-cubic': [0.25, 0.46, 0.45, 0.94],
  'ease-in-out-cubic': [0.455, 0.03, 0.515, 0.955],
  'ease-in-quart': [0.55, 0.085, 0.68, 0.53],
  'ease-out-quart': [0.25, 0.46, 0.45, 0.94],
  'ease-in-out-quart': [0.455, 0.03, 0.515, 0.955]
};

/**
 * Corrected curves. Only the entries that actually differ are listed; the
 * solver falls back to AOS_PRESETS for everything else so the two families
 * never diverge silently.
 */
export const TRUE_PRESETS = {
  linear: [0, 0, 1, 1],
  'ease-in-cubic': [0.32, 0, 0.67, 0],
  'ease-out-cubic': [0.33, 1, 0.68, 1],
  'ease-in-out-cubic': [0.65, 0, 0.35, 1],
  'ease-in-quart': [0.5, 0, 0.75, 0],
  'ease-out-quart': [0.25, 1, 0.5, 1],
  'ease-in-out-quart': [0.76, 0, 0.24, 1],
  'ease-in-expo': [0.7, 0, 0.84, 0],
  'ease-out-expo': [0.16, 1, 0.3, 1],
  'ease-in-out-expo': [0.87, 0, 0.13, 1]
};

const NEWTON_ITERATIONS = 6;
const NEWTON_MIN_SLOPE = 1e-4;
const BISECTION_ITERATIONS = 24;

const bezierAxis = (t, p1, p2) => {
  const mt = 1 - t;
  // 3 * mt^2 * t * p1 + 3 * mt * t^2 * p2 + t^3
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
};

const bezierAxisDerivative = (t, p1, p2) => {
  const mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
};

/**
 * Build a callable easing function for the given cubic-bezier control points.
 * Input and output are clamped to [0, 1]; overshoot curves (the `back` family)
 * are preserved because the y axis is intentionally *not* clamped.
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {(t: number) => number}
 */
export function cubicBezier(x1, y1, x2, y2) {
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return (t) => t;
  if (x1 === y1 && x2 === y2) return (t) => t; // degenerate straight line

  const solveT = (x) => {
    let t = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
      const slope = bezierAxisDerivative(t, x1, x2);
      if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
      const delta = bezierAxis(t, x1, x2) - x;
      if (Math.abs(delta) < 1e-7) return t;
      t -= delta / slope;
    }
    // Bisection fallback for flat / non-monotonic segments
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < BISECTION_ITERATIONS; i += 1) {
      const value = bezierAxis(t, x1, x2);
      if (Math.abs(value - x) < 1e-7) return t;
      if (value > x) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (input) => {
    const x = input <= 0 ? 0 : input >= 1 ? 1 : input;
    if (x === 0) return 0;
    if (x === 1) return 1;
    return bezierAxis(solveT(x), y1, y2);
  };
}

const cache = new Map();

/**
 * Resolve an easing descriptor into a callable.
 * Accepts:
 *  - a preset name (`'ease-out-cubic'`, resolved against TRUE_PRESETS then
 *    AOS_PRESETS so upstream names always resolve)
 *  - a 4-number array of control points
 *  - a CSS-like string `cubic-bezier(.2,.8,.2,1)`
 *  - an existing function (returned as-is)
 *
 * @param {string|number[]|((t:number)=>number)} descriptor
 * @returns {(t: number) => number}
 */
export function resolveEase(descriptor) {
  if (typeof descriptor === 'function') return descriptor;
  if (Array.isArray(descriptor) && descriptor.length === 4) {
    const key = `pts:${descriptor.join(',')}`;
    if (!cache.has(key)) cache.set(key, cubicBezier(...descriptor));
    return cache.get(key);
  }
  if (typeof descriptor === 'string') {
    const name = descriptor.trim();
    const parsed = /^cubic-bezier\(([^)]+)\)$/.exec(name);
    if (parsed) {
      const pts = parsed[1].split(',').map((n) => parseFloat(n));
      if (pts.length === 4 && pts.every((n) => Number.isFinite(n))) {
        return resolveEase(pts);
      }
    }
    const key = `name:${name}`;
    if (!cache.has(key)) {
      const pts = TRUE_PRESETS[name] || AOS_PRESETS[name];
      cache.set(key, pts ? cubicBezier(...pts) : (t) => t);
    }
    return cache.get(key);
  }
  return (t) => t;
}

/**
 * Pre-sample an easing function into a lookup table. Evaluating a 1200-entry
 * table is ~6x cheaper than running Newton iterations every frame, which
 * matters when a single scroll tick drives hundreds of tracks.
 *
 * @param {(t:number)=>number} fn
 * @param {number} [size=256]
 * @returns {(t:number)=>number} table-backed approximation
 */
export function sampleTable(fn, size = 256) {
  const table = new Float64Array(size + 1);
  for (let i = 0; i <= size; i += 1) table[i] = fn(i / size);
  return (t) => {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const pos = x * size;
    const i = Math.floor(pos);
    if (i >= size) return table[size];
    const frac = pos - i;
    return table[i] + (table[i + 1] - table[i]) * frac;
  };
}

/** Test helper: drop memoised curves. */
export function _clearEaseCache() {
  cache.clear();
}

export const EASE_NAMES = Object.keys({ ...AOS_PRESETS, ...TRUE_PRESETS }).sort();
