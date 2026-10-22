import { describe, it, expect } from 'vitest';
import {
  normalizeProject,
  createLayer,
  defaultMotion,
  normalizeMotion,
  serializeProject,
  parseProject,
  toEntries,
  MOTION_PRESETS,
  PRESET_NAMES,
  SCHEMA_VERSION,
  LAYER_TYPES,
  uid
} from '@scrub/schema.js';
import { parseTrackAttr, readScrubAttributes } from '@scrub/attributes.js';

describe('createLayer', () => {
  it('fills every required field', () => {
    const layer = createLayer();
    expect(layer.id).toMatch(/^ly-/);
    expect(LAYER_TYPES).toContain(layer.type);
    expect(typeof layer.style.x).toBe('number');
    expect(typeof layer.style.fontSize).toBe('number');
    expect(layer.motion.tracks.opacity.length).toBeGreaterThanOrEqual(2);
  });

  it('honours the provided partial', () => {
    const layer = createLayer({ name: '标题', type: 'heading', style: { x: 12, fontSize: 40 } });
    expect(layer.name).toBe('标题');
    expect(layer.type).toBe('heading');
    expect(layer.style.x).toBe(12);
    expect(layer.style.fontSize).toBe(40);
  });

  it('falls back to a valid type for unknown values', () => {
    expect(createLayer({ type: 'hologram' }).type).toBe('text');
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid()));
    expect(ids.size).toBe(200);
  });
});

describe('normalizeMotion', () => {
  it('defaults to the page axis', () => {
    expect(defaultMotion().mode).toBe('page');
    expect(normalizeMotion({}).mode).toBe('page');
  });

  it('keeps element mode when explicitly requested', () => {
    expect(normalizeMotion({ mode: 'element' }).mode).toBe('element');
  });

  it('drops tracks for unknown properties', () => {
    const motion = normalizeMotion({
      tracks: {
        opacity: [{ p: 0, v: 0 }, { p: 1, v: 1 }],
        warpSpeed: [{ p: 0, v: 1 }, { p: 1, v: 9 }]
      }
    });
    expect(Object.keys(motion.tracks)).toEqual(['opacity']);
  });

  it('normalises the range and pin window', () => {
    const motion = normalizeMotion({ range: [0.6, 0.2], pin: [0.4, 0.1] });
    expect(motion.range).toEqual([0.2, 0.6]);
    expect(motion.pin).toEqual([0.1, 0.4]);
  });

  it('treats a malformed pin as absent', () => {
    expect(normalizeMotion({ pin: 'soon' }).pin).toBeNull();
    expect(normalizeMotion({ pin: [0.1] }).pin).toBeNull();
  });
});

describe('normalizeProject', () => {
  it('produces a usable project from nothing', () => {
    const project = normalizeProject(undefined);
    expect(project.version).toBe(SCHEMA_VERSION);
    expect(project.layers.length).toBe(1);
    expect(project.viewport.width).toBeGreaterThan(0);
  });

  it('keeps valid layers and repairs invalid ones', () => {
    const project = normalizeProject({
      name: '  我的工程  ',
      layers: [{ name: 'A', type: 'badge' }, { nonsense: true }]
    });
    expect(project.name).toBe('我的工程');
    expect(project.layers).toHaveLength(2);
    expect(project.layers[1].type).toBe('text');
  });

  it('coerces numeric viewport values', () => {
    const project = normalizeProject({ viewport: { width: '900', height: null } });
    expect(project.viewport.width).toBe(900);
    expect(project.viewport.height).toBe(800);
  });
});

describe('serialize / parse round trip', () => {
  it('preserves the document through a JSON round trip', () => {
    const original = normalizeProject({
      name: '往返',
      layers: [
        createLayer({
          name: 'A',
          motion: { range: [0.1, 0.7], tracks: { y: [{ p: 0, v: 40 }, { p: 1, v: 0 }] } }
        })
      ]
    });
    const json = serializeProject(original);
    const { project, error } = parseProject(json);
    expect(error).toBeNull();
    expect(project.name).toBe(original.name);
    expect(project.layers[0].motion.range).toEqual([0.1, 0.7]);
    expect(project.layers[0].motion.tracks.y).toHaveLength(2);
  });

  it('reports invalid JSON without throwing', () => {
    const { project, error } = parseProject('{not json');
    expect(error).toBe('invalid-json');
    expect(project.layers.length).toBe(1);
  });

  it('flags newer schema versions but still loads them', () => {
    const { project, error } = parseProject(JSON.stringify({ version: 99, name: 'future' }));
    expect(error).toBe('version-newer');
    expect(project.name).toBe('future');
  });

  it('treats empty input as empty', () => {
    expect(parseProject('').error).toBe('empty');
    expect(parseProject('   ').error).toBe('empty');
  });
});

describe('toEntries', () => {
  it('projects layers into engine entries', () => {
    const project = normalizeProject({
      layers: [createLayer({ motion: { mode: 'page', range: [0.2, 0.5] } })]
    });
    const entries = toEntries(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].mode).toBe('page');
    expect(entries[0].range).toEqual([0.2, 0.5]);
    expect(entries[0].tracks).toBeTruthy();
  });
});

describe('motion presets', () => {
  it('every preset builds valid, non-empty tracks', () => {
    for (const name of PRESET_NAMES) {
      const built = MOTION_PRESETS[name].build();
      expect(Object.keys(built.tracks).length).toBeGreaterThan(0);
      const motion = normalizeMotion(built);
      expect(Object.keys(motion.tracks).length).toBe(Object.keys(built.tracks).length);
      for (const keys of Object.values(motion.tracks)) {
        expect(keys.length).toBeGreaterThanOrEqual(2);
        expect(keys[0].p).toBe(0);
        // Tracks may finish early (e.g. a fade that completes at 45%); the
        // evaluator clamps beyond the last key, which is the intended contract.
        expect(keys[keys.length - 1].p).toBeLessThanOrEqual(1);
        expect(keys[keys.length - 1].p).toBeGreaterThan(0.3);
      }
    }
  });

  it('the sticky chapter preset declares a page-axis pin window', () => {
    const built = MOTION_PRESETS.stickyChapter.build();
    expect(built.mode).toBe('page');
    expect(Array.isArray(built.pin)).toBe(true);
    expect(built.pin[0]).toBeLessThan(built.pin[1]);
  });
});

describe('attribute parsing', () => {
  it('parses a track attribute list', () => {
    const tracks = parseTrackAttr('opacity:0>1;y:64>0;scale:0.94>1');
    expect(Object.keys(tracks).sort()).toEqual(['opacity', 'scale', 'y']);
    expect(tracks.y[0].v).toBe(64);
    expect(tracks.y[1].v).toBe(0);
  });

  it('ignores unknown properties and malformed chunks', () => {
    const tracks = parseTrackAttr('opacity:0>1;warp:1>2;broken;y:1');
    expect(Object.keys(tracks)).toEqual(['opacity']);
  });

  it('returns nothing for empty input', () => {
    expect(parseTrackAttr('')).toEqual({});
    expect(parseTrackAttr(null)).toEqual({});
  });

  it('reads the full attribute surface off a node', () => {
    const node = {
      getAttribute: (name) =>
        ({
          'data-aos-mode': 'page',
          'data-aos-range': '0.2,0.6',
          'data-aos-ease': 'ease-out-quart',
          'data-aos-offset': '-80',
          'data-aos-pin': '0.2,0.6',
          'data-aos-track': 'y:40>0'
        })[name] ?? null
    };
    const cfg = readScrubAttributes(node);
    expect(cfg.mode).toBe('page');
    expect(cfg.range).toEqual([0.2, 0.6]);
    expect(cfg.ease).toBe('ease-out-quart');
    expect(cfg.offset).toBe(-80);
    expect(cfg.pin).toEqual([0.2, 0.6]);
    expect(cfg.tracks.y[0].v).toBe(40);
  });
});
