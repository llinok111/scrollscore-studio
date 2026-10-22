/**
 * ScrollScore - scrub engine
 *
 * Turns AOS from a binary "add class when the element is in view" trigger into
 * a continuous, frame-batched style driver keyed on scroll progress.
 *
 * Design constraints (all of them are observable in the tests):
 *  1. Read/write separation. Geometry is read once in `measure()`; a frame only
 *     reads `scrollY` and then writes styles. No interleaved reads => no layout
 *     thrashing.
 *  2. Only compositor-friendly surfaces are written: transform, opacity,
 *     filter, clip-path, border-radius, letter-spacing.
 *  3. Writes are diffed. Re-writing an identical string is skipped and counted
 *     in `metrics.skips`.
 *  4. Opt-in. Nothing here runs unless the host explicitly enables it.
 */
import { composeStyles } from './keyframes.js';
import {
  measureElementBounds,
  elementProgress,
  pageProgress,
  mapRange,
  pinPhase
} from './progress.js';

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function readReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/**
 * @typedef {Object} ScrubEntry
 * @property {string} id
 * @property {HTMLElement} node
 * @property {'element'|'page'} [mode]
 * @property {[number, number]} [range]
 * @property {string} [ease]
 * @property {number} [offset]
 * @property {Record<string, Array<{p:number,v:number,ease?:string}>>} tracks
 * @property {[number, number]|null} [pin]
 */

export function createScrubEngine(options = {}) {
  const opts = {
    mode: 'raf',
    respectReducedMotion: true,
    willChange: true,
    onFrame: null,
    /**
     * Optional external scroll source. When provided it fully replaces the
     * window as the geometry authority, which is how the studio previews a
     * scoped, non-window scroller:
     *   scrollSource: () => ({ scrollY, viewportH, docH })
     */
    scrollSource: null,
    ...options
  };

  const state = {
    entries: [],
    byId: new Map(),
    running: false,
    rafId: 0,
    scrollY: 0,
    viewportH: 0,
    docH: 0,
    override: null,
    reduced: false,
    needsMeasure: true,
    metrics: {
      frames: 0,
      totalFrameMs: 0,
      maxFrameMs: 0,
      lastFrameMs: 0,
      lastFrameGap: 0,
      emaFrameGap: 0,
      writes: 0,
      skips: 0,
      longFrames: 0,
      lastActiveTracks: 0
    }
  };

  const readScroll = () => {
    if (state.override !== null) return state.override;
    if (opts.scrollSource) return opts.scrollSource().scrollY;
    return window.scrollY || window.pageYOffset || 0;
  };

  const readViewport = () => {
    if (opts.scrollSource) {
      const source = opts.scrollSource();
      state.viewportH = source.viewportH || 0;
      state.docH = source.docH || 0;
      return;
    }
    state.viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    state.docH = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
  };

  /**
   * Recompute document geometry for every entry. This is the only place that
   * forces layout, and it is never called from inside a frame.
   */
  function measure() {
    readViewport();
    const external = !!opts.scrollSource;
    for (const entry of state.entries) {
      if (entry.mode === 'page') continue;
      if (external) {
        // Scoped scrollers (the studio stage) cannot use viewport-relative
        // rects, so fall back to the layout offset inside the scroller.
        const top = entry.node.offsetTop;
        const height = entry.node.offsetHeight;
        const offset = entry.offset || 0;
        entry.bounds = {
          top,
          height,
          start: top - state.viewportH + offset,
          end: top + height + offset
        };
      } else {
        entry.bounds = measureElementBounds(entry.node, state.viewportH, entry.offset || 0);
      }
    }
    state.needsMeasure = false;
  }

  function writeStyles(entry, payload) {
    const style = entry.node.style;
    let wrote = false;
    const last = entry.lastWrite;

    if (payload.transform !== null && payload.transform !== last.transform) {
      style.transform = payload.transform;
      last.transform = payload.transform;
      wrote = true;
    }
    if (payload.opacity !== null && payload.opacity !== last.opacity) {
      style.opacity = payload.opacity;
      last.opacity = payload.opacity;
      wrote = true;
    }
    if (payload.filter !== null && payload.filter !== last.filter) {
      style.filter = payload.filter;
      last.filter = payload.filter;
      wrote = true;
    }
    if (payload.clipPath !== null && payload.clipPath !== last.clipPath) {
      style.clipPath = payload.clipPath;
      last.clipPath = payload.clipPath;
      wrote = true;
    }
    if (payload.radius !== null && payload.radius !== last.radius) {
      style.borderRadius = payload.radius;
      last.radius = payload.radius;
      wrote = true;
    }
    if (payload.letterSpacing !== null && payload.letterSpacing !== last.letterSpacing) {
      style.letterSpacing = payload.letterSpacing;
      last.letterSpacing = payload.letterSpacing;
      wrote = true;
    }

    if (wrote) state.metrics.writes += 1;
    else state.metrics.skips += 1;
    return wrote;
  }

  /**
   * Evaluate every registered entry for the current scroll position.
   * Exposed separately from the rAF loop so tests and the studio preview can
   * drive a frame deterministically.
   *
   * @param {number} [forcedScrollY]
   */
  function tick(forcedScrollY) {
    const t0 = now();
    if (state.needsMeasure) measure();
    // With an external scroll source the geometry comes from the caller and is
    // cheap to read, so keep it fresh every frame. Reading document.scrollHeight
    // on window mode would force layout, so that path stays measure()-only.
    else if (opts.scrollSource) readViewport();
    const scrollY = typeof forcedScrollY === 'number' ? forcedScrollY : readScroll();
    state.scrollY = scrollY;

    let activeTracks = 0;
    const pageT = pageProgress(scrollY, state.docH, state.viewportH);

    for (let i = 0; i < state.entries.length; i += 1) {
      const entry = state.entries[i];
      if (entry.disabled) continue;

      let raw = entry.mode === 'page' ? pageT : elementProgress(scrollY, entry.bounds);
      if (entry.pin) {
        const phase = pinPhase(raw, entry.pin);
        entry.pinPhase = phase.phase;
        entry.pinT = phase.t;
      }
      const t = mapRange(raw, entry.range);
      entry.progress = t;

      // Reduced motion: jump straight to the resting state instead of scrubbing.
      const effectiveT = state.reduced ? 1 : t;
      const payload = composeStyles(entry.tracks, effectiveT, entry.ease);
      activeTracks += Object.keys(entry.tracks || {}).length;
      writeStyles(entry, payload);
      entry.lastValues = payload.values;
    }

    const t1 = now();
    const frameMs = t1 - t0;
    const m = state.metrics;
    m.frames += 1;
    m.totalFrameMs += frameMs;
    m.lastFrameMs = frameMs;
    if (frameMs > m.maxFrameMs) m.maxFrameMs = frameMs;
    if (frameMs > 16.7) m.longFrames += 1;
    m.lastActiveTracks = activeTracks;

    if (opts.onFrame) opts.onFrame(state.metrics, state);
    return frameMs;
  }

  let lastTimestamp = 0;

  function loop(timestamp) {
    if (!state.running) return;
    const ts = typeof timestamp === 'number' ? timestamp : now();
    if (lastTimestamp) {
      const gap = ts - lastTimestamp;
      state.metrics.lastFrameGap = gap;
      state.metrics.emaFrameGap = state.metrics.emaFrameGap
        ? state.metrics.emaFrameGap * 0.88 + gap * 0.12
        : gap;
    }
    lastTimestamp = ts;
    tick();
    state.rafId = window.requestAnimationFrame(loop);
  }

  function start() {
    if (state.running) return;
    if (typeof window === 'undefined') return;
    state.running = true;
    readViewport();
    if (opts.respectReducedMotion) state.reduced = readReducedMotion();
    measure();
    if (opts.mode === 'raf') {
      state.rafId = window.requestAnimationFrame(loop);
    }
  }

  function stop() {
    state.running = false;
    if (state.rafId && typeof window !== 'undefined') {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  /**
   * Register (or replace) an entry.
   * @param {ScrubEntry} entry
   * @returns {ScrubEntry}
   */
  function register(entry) {
    if (!entry || !entry.node) throw new Error('ScrollScore: entry.node is required');
    const id = entry.id || `scrub-${state.entries.length + 1}-${Math.random().toString(36).slice(2, 7)}`;
    const normalised = {
      id,
      node: entry.node,
      mode: entry.mode === 'page' ? 'page' : 'element',
      range: entry.range || [0, 1],
      ease: entry.ease || 'linear',
      offset: entry.offset || 0,
      tracks: entry.tracks || {},
      pin: entry.pin || null,
      disabled: !!entry.disabled,
      progress: 0,
      pinPhase: 'before',
      pinT: 0,
      lastWrite: {
        transform: null,
        opacity: null,
        filter: null,
        clipPath: null,
        radius: null,
        letterSpacing: null
      },
      lastValues: {}
    };
    if (opts.willChange) normalised.node.style.willChange = 'transform, opacity, filter';

    const existing = state.byId.get(id);
    if (existing) {
      const index = state.entries.indexOf(existing);
      if (index >= 0) state.entries[index] = normalised;
    } else {
      state.entries.push(normalised);
    }
    state.byId.set(id, normalised);
    state.needsMeasure = true;
    return normalised;
  }

  function unregister(id) {
    const entry = state.byId.get(id);
    if (!entry) return false;
    const index = state.entries.indexOf(entry);
    if (index >= 0) state.entries.splice(index, 1);
    state.byId.delete(id);
    if (opts.willChange) entry.node.style.willChange = '';
    return true;
  }

  function clear() {
    for (const entry of state.entries.slice()) unregister(entry.id);
    state.entries.length = 0;
    state.byId.clear();
  }

  /** Override the scroll source (useful for virtualised scrollers and tests). */
  function setProgressOverride(value) {
    state.override = typeof value === 'number' ? value : null;
    if (state.override !== null) {
      // Treat the override as a document-level progress value.
      state.needsMeasure = false;
    }
    state.needsMeasure = state.override === null;
  }

  function destroy() {
    stop();
    clear();
    if (opts.willChange) {
      // nothing else to release
    }
  }

  return {
    register,
    unregister,
    clear,
    measure,
    tick,
    start,
    stop,
    destroy,
    setProgressOverride,
    get metrics() {
      const m = state.metrics;
      return {
        ...m,
        avgFrameMs: m.frames ? m.totalFrameMs / m.frames : 0,
        fps: m.emaFrameGap > 0 ? 1000 / m.emaFrameGap : 0
      };
    },
    get entries() {
      return state.entries.slice();
    },
    get state() {
      return state;
    }
  };
}
