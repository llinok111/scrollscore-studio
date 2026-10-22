/**
 * ScrollScore - keyframe tracks
 *
 * A track is a single animated property sampled across scroll progress:
 *   { p: 0, v: 0 }        -> at 0% of the mapped range the value is 0
 *   { p: 1, v: 240 }      -> at 100% it is 240
 * `p` is normalised scroll progress in [0, 1]; `v` is the raw property value.
 * An optional per-key `ease` shapes the segment *arriving* at that key, which
 * matches how CSS `@keyframes` + `animation-timing-function` behave.
 */
import { resolveEase } from './easing.js';

/**
 * Property registry. `kind` decides which CSS surface the value is written to,
 * which keeps the engine from ever touching layout-affecting properties.
 */
export const PROPS = {
  x: { kind: 'transform', unit: 'px', base: 0, label: 'X 位移' },
  y: { kind: 'transform', unit: 'px', base: 0, label: 'Y 位移' },
  z: { kind: 'transform', unit: 'px', base: 0, label: 'Z 位移' },
  scale: { kind: 'transform', unit: '', base: 1, label: '缩放' },
  rotate: { kind: 'transform', unit: 'deg', base: 0, label: '旋转' },
  opacity: { kind: 'opacity', unit: '', base: 1, label: '不透明度' },
  blur: { kind: 'filter', unit: 'px', base: 0, label: '模糊' },
  brightness: { kind: 'filter', unit: '', base: 1, label: '亮度' },
  saturate: { kind: 'filter', unit: '', base: 1, label: '饱和度' },
  clipX: { kind: 'clip', unit: '%', base: 100, label: '横向揭示' },
  radius: { kind: 'radius', unit: 'px', base: 0, label: '圆角' },
  letterSpacing: { kind: 'letterSpacing', unit: 'px', base: 0, label: '字距' }
};

export const PROP_NAMES = Object.keys(PROPS);

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Round to 3 decimals and strip trailing zeros so style strings stay stable. */
export function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/**
 * Normalise a keyframe list: drop invalid entries, clamp progress, sort, and
 * collapse duplicate progress values (last one wins, mirroring CSS).
 *
 * @param {Array<{p:number,v:number,ease?:string}>} keys
 * @returns {Array<{p:number,v:number,ease?:string}>}
 */
export function normalizeKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const cleaned = [];
  for (const key of keys) {
    if (!key || typeof key !== 'object') continue;
    const p = Number(key.p);
    const v = Number(key.v);
    if (!Number.isFinite(p) || !Number.isFinite(v)) continue;
    const entry = { p: clamp01(p), v };
    if (key.ease) entry.ease = String(key.ease);
    cleaned.push(entry);
  }
  cleaned.sort((a, b) => a.p - b.p);
  const deduped = [];
  for (const entry of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.p - entry.p) < 1e-9) deduped[deduped.length - 1] = entry;
    else deduped.push(entry);
  }
  return deduped;
}

/**
 * Evaluate one track at progress `t`.
 * Outside the keyframe domain the value is clamped to the nearest key (no
 * extrapolation) — same contract as `clamp()` in CSS.
 *
 * @param {Array<{p:number,v:number,ease?:string}>} keys normalised keys
 * @param {number} t progress in [0,1]
 * @param {string} [fallbackEase='linear'] ease used when a key omits one
 * @returns {number}
 */
export function evaluateTrack(keys, t, fallbackEase = 'linear') {
  if (!keys || keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].v;
  const x = clamp01(t);
  if (x <= keys[0].p) return keys[0].v;
  const last = keys[keys.length - 1];
  if (x >= last.p) return last.v;

  // Binary search for the segment containing x
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].p <= x) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b.p - a.p;
  if (span <= 0) return b.v;
  const local = (x - a.p) / span;
  const ease = resolveEase(b.ease || fallbackEase);
  return a.v + (b.v - a.v) * ease(local);
}

/**
 * Compose every track of a layer into a single CSS write payload.
 * Only the CSS surfaces that actually have tracks are emitted, so a layer that
 * animates nothing but `opacity` never receives a `transform` rule.
 *
 * @param {Record<string, Array<{p:number,v:number,ease?:string}>>} tracks
 * @param {number} t progress in [0,1]
 * @param {string} [fallbackEase='linear']
 * @returns {{transform: string|null, opacity: string|null, filter: string|null, clipPath: string|null, radius: string|null, letterSpacing: string|null, values: Record<string, number>}}
 */
export function composeStyles(tracks, t, fallbackEase = 'linear') {
  const values = {};
  const out = {
    transform: null,
    opacity: null,
    filter: null,
    clipPath: null,
    radius: null,
    letterSpacing: null,
    values
  };
  if (!tracks) return out;

  let hasTransform = false;
  let hasFilter = false;

  for (const name of Object.keys(tracks)) {
    const def = PROPS[name];
    if (!def) continue;
    const keys = tracks[name];
    if (!Array.isArray(keys) || keys.length === 0) continue;
    const v = evaluateTrack(keys, t, fallbackEase);
    values[name] = v;

    switch (def.kind) {
      case 'transform':
        hasTransform = true;
        break;
      case 'filter':
        hasFilter = true;
        break;
      case 'opacity':
        out.opacity = fmt(Math.max(0, Math.min(1, v)));
        break;
      case 'clip':
        out.clipPath = `inset(0 ${fmt(100 - Math.max(0, Math.min(100, v)))}% 0 0)`;
        break;
      case 'radius':
        out.radius = `${fmt(v)}px`;
        break;
      case 'letterSpacing':
        out.letterSpacing = `${fmt(v)}px`;
        break;
      default:
        break;
    }
  }

  if (hasTransform) {
    const parts = [];
    const x = values.x ?? 0;
    const y = values.y ?? 0;
    const z = values.z ?? 0;
    if ('x' in values || 'y' in values || 'z' in values) {
      parts.push(`translate3d(${fmt(x)}px, ${fmt(y)}px, ${fmt(z)}px)`);
    }
    if ('rotate' in values) parts.push(`rotate(${fmt(values.rotate)}deg)`);
    if ('scale' in values) parts.push(`scale(${fmt(values.scale)})`);
    out.transform = parts.join(' ');
  }

  if (hasFilter) {
    const parts = [];
    if ('blur' in values) parts.push(`blur(${fmt(values.blur)}px)`);
    if ('brightness' in values) parts.push(`brightness(${fmt(values.brightness)})`);
    if ('saturate' in values) parts.push(`saturate(${fmt(values.saturate)})`);
    out.filter = parts.join(' ');
  }

  return out;
}

/**
 * Build a default 2-key track from a from/to pair.
 * @param {number} from
 * @param {number} to
 * @param {string} [ease]
 */
export function twoKey(from, to, ease = 'ease-out-cubic') {
  return [
    { p: 0, v: from },
    { p: 1, v: to, ease }
  ];
}
