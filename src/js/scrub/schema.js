/**
 * ScrollScore - project schema
 *
 * The studio edits a plain JSON document; this module owns its shape,
 * validation and round-trip guarantees. Everything the engine consumes is
 * derived from here, so a hand-written project file and a studio-authored one
 * are indistinguishable at runtime.
 */
import { normalizeKeys, PROPS } from './keyframes.js';
import { parseRange } from './progress.js';

export const SCHEMA_VERSION = 1;

let seq = 0;
export function uid(prefix = 'ly') {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export const LAYER_TYPES = ['heading', 'text', 'panel', 'image', 'badge'];

const num = (value, fallback) => {
  // Note: Number(null) === 0 and Number('') === 0, both of which would silently
  // override a sensible default. Treat "absent" as absent.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Default motion block: a single opacity fade, nothing else. */
export function defaultMotion() {
  return {
    // 'page' is the studio's native axis: scroll progress of the document.
    // 'element' stays supported for hand-authored pages (see attributes.js).
    mode: 'page',
    range: [0, 1],
    ease: 'linear',
    offset: 0,
    pin: null,
    tracks: {
      opacity: normalizeKeys([
        { p: 0, v: 0 },
        { p: 1, v: 1, ease: 'ease-out-cubic' }
      ])
    }
  };
}

export function createLayer(partial = {}) {
  const type = LAYER_TYPES.includes(partial.type) ? partial.type : 'text';
  return {
    id: partial.id || uid(),
    name: partial.name || '新图层',
    type,
    content: partial.content ?? '在右侧编辑内容',
    style: {
      x: num(partial.style?.x, 80),
      y: num(partial.style?.y, 120),
      w: num(partial.style?.w, type === 'heading' ? 640 : 360),
      h: num(partial.style?.h, type === 'heading' ? 120 : 200),
      fontSize: num(partial.style?.fontSize, type === 'heading' ? 56 : 18),
      color: partial.style?.color || '#f6ede1',
      background: partial.style?.background || 'transparent',
      radius: num(partial.style?.radius, type === 'panel' ? 18 : 0),
      align: partial.style?.align || 'left'
    },
    motion: normalizeMotion(partial.motion)
  };
}

export function normalizeMotion(motion) {
  const base = defaultMotion();
  if (!motion || typeof motion !== 'object') return base;
  const tracks = {};
  const source = motion.tracks && typeof motion.tracks === 'object' ? motion.tracks : base.tracks;
  for (const [name, keys] of Object.entries(source)) {
    if (!PROPS[name]) continue;
    const normalised = normalizeKeys(keys);
    if (normalised.length > 0) tracks[name] = normalised;
  }
  return {
    // Default to the page axis; 'element' must be opted into explicitly.
    mode: motion.mode === 'element' ? 'element' : 'page',
    range: parseRange(
      Array.isArray(motion.range) ? motion.range.join(',') : motion.range,
      [0, 1]
    ),
    ease: typeof motion.ease === 'string' ? motion.ease : 'linear',
    offset: num(motion.offset, 0),
    pin: Array.isArray(motion.pin) && motion.pin.length === 2 ? parseRange(motion.pin.join(',')) : null,
    tracks
  };
}

export function normalizeProject(project) {
  const source = project && typeof project === 'object' ? project : {};
  const layers = Array.isArray(source.layers) ? source.layers.map((l) => createLayer(l)) : [];
  return {
    version: SCHEMA_VERSION,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : '未命名工程',
    viewport: {
      width: num(source.viewport?.width, 1280),
      height: num(source.viewport?.height, 800)
    },
    layers: layers.length > 0 ? layers : [createLayer({ name: '标题', type: 'heading', content: '滚动驱动动效' })]
  };
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

/**
 * Parse a project file. Never throws: malformed input degrades to a valid
 * empty project and reports the problem so the UI can toast it.
 *
 * @param {string} json
 * @returns {{project: object, error: string|null}}
 */
export function parseProject(json) {
  if (typeof json !== 'string' || json.trim() === '') {
    return { project: normalizeProject({}), error: 'empty' };
  }
  try {
    const parsed = JSON.parse(json);
    if (parsed.version && parsed.version > SCHEMA_VERSION) {
      return { project: normalizeProject(parsed), error: 'version-newer' };
    }
    return { project: normalizeProject(parsed), error: null };
  } catch (err) {
    return { project: normalizeProject({}), error: 'invalid-json' };
  }
}

/**
 * Convert a project into the flat entry list the engine registers.
 * @param {object} project
 * @returns {Array<object>}
 */
export function toEntries(project) {
  const normalised = normalizeProject(project);
  return normalised.layers.map((layer) => ({
    id: layer.id,
    mode: layer.motion.mode,
    range: layer.motion.range,
    ease: layer.motion.ease,
    offset: layer.motion.offset,
    pin: layer.motion.pin,
    tracks: layer.motion.tracks
  }));
}

/**
 * Ready-made motion recipes. Each returns a partial motion block so the studio
 * can apply it without discarding the layer's own range/ease.
 */
export const MOTION_PRESETS = {
  fadeUp: {
    label: '淡入上浮',
    build: () => ({
      tracks: {
        opacity: normalizeKeys([{ p: 0, v: 0 }, { p: 0.45, v: 1, ease: 'ease-out-cubic' }]),
        y: normalizeKeys([{ p: 0, v: 64 }, { p: 0.45, v: 0, ease: 'ease-out-cubic' }])
      }
    })
  },
  parallax: {
    label: '视差漂移',
    build: () => ({
      tracks: {
        y: normalizeKeys([{ p: 0, v: 90 }, { p: 1, v: -90 }]),
        scale: normalizeKeys([{ p: 0, v: 1.06 }, { p: 1, v: 0.94 }])
      }
    })
  },
  reveal: {
    label: '横向揭示',
    build: () => ({
      tracks: {
        clipX: normalizeKeys([{ p: 0, v: 0 }, { p: 0.6, v: 100, ease: 'ease-out-quart' }]),
        x: normalizeKeys([{ p: 0, v: -40 }, { p: 0.6, v: 0, ease: 'ease-out-quart' }])
      }
    })
  },
  focus: {
    label: '缩放聚焦',
    build: () => ({
      tracks: {
        scale: normalizeKeys([{ p: 0, v: 0.82 }, { p: 0.5, v: 1, ease: 'ease-out-back' }]),
        blur: normalizeKeys([{ p: 0, v: 14 }, { p: 0.5, v: 0, ease: 'ease-out-cubic' }]),
        opacity: normalizeKeys([{ p: 0, v: 0.2 }, { p: 0.5, v: 1 }])
      }
    })
  },
  tilt: {
    label: '透视倾斜',
    build: () => ({
      tracks: {
        rotate: normalizeKeys([{ p: 0, v: -6 }, { p: 0.5, v: 0, ease: 'ease-out-cubic' }, { p: 1, v: 3 }]),
        y: normalizeKeys([{ p: 0, v: 40 }, { p: 0.5, v: 0, ease: 'ease-out-cubic' }]),
        opacity: normalizeKeys([{ p: 0, v: 0 }, { p: 0.35, v: 1 }])
      }
    })
  },
  stickyChapter: {
    label: '钉住长卷',
    build: () => ({
      mode: 'page',
      range: [0.05, 0.45],
      pin: [0.05, 0.45],
      tracks: {
        opacity: normalizeKeys([{ p: 0, v: 1 }, { p: 0.7, v: 1 }, { p: 1, v: 0 }]),
        y: normalizeKeys([{ p: 0, v: 0 }, { p: 1, v: -120, ease: 'ease-in-out-cubic' }]),
        letterSpacing: normalizeKeys([{ p: 0, v: 6 }, { p: 1, v: 0 }])
      }
    })
  }
};

export const PRESET_NAMES = Object.keys(MOTION_PRESETS);
