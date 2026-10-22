import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createScrubEngine } from '@scrub/engine.js';

let source;

function makeEngine(overrides = {}) {
  return createScrubEngine({
    scrollSource: () => source,
    willChange: false,
    ...overrides
  });
}

function node() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const yTrack = [
  { p: 0, v: 100 },
  { p: 1, v: 0 }
];
const opacityTrack = [
  { p: 0, v: 0 },
  { p: 1, v: 1 }
];

beforeEach(() => {
  source = { scrollY: 0, viewportH: 500, docH: 1500 };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('registration', () => {
  it('requires a node', () => {
    const engine = makeEngine();
    expect(() => engine.register({ tracks: {} })).toThrow(/node is required/);
  });

  it('assigns an id when none is given', () => {
    const engine = makeEngine();
    const entry = engine.register({ node: node(), tracks: { y: yTrack } });
    expect(entry.id).toMatch(/^scrub-/);
  });

  it('replaces an entry with the same id instead of duplicating', () => {
    const engine = makeEngine();
    engine.register({ id: 'a', node: node(), tracks: { y: yTrack } });
    engine.register({ id: 'a', node: node(), tracks: { y: yTrack } });
    expect(engine.entries).toHaveLength(1);
  });

  it('unregister removes the entry and clears will-change', () => {
    const engine = createScrubEngine({ scrollSource: () => source, willChange: true });
    const el = node();
    engine.register({ id: 'a', node: el, tracks: { y: yTrack } });
    expect(el.style.willChange).toContain('transform');
    expect(engine.unregister('a')).toBe(true);
    expect(engine.entries).toHaveLength(0);
    expect(el.style.willChange).toBe('');
  });

  it('clear removes everything', () => {
    const engine = makeEngine();
    engine.register({ id: 'a', node: node(), tracks: { y: yTrack } });
    engine.register({ id: 'b', node: node(), tracks: { y: yTrack } });
    engine.clear();
    expect(engine.entries).toHaveLength(0);
  });
});

describe('page-mode scrubbing', () => {
  it('writes the start keyframe at progress 0', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.tick(0);
    expect(el.style.transform).toBe('translate3d(0px, 100px, 0px)');
  });

  it('writes the end keyframe at the bottom of the scroll', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.tick(1000); // docH 1500 - viewportH 500
    expect(el.style.transform).toBe('translate3d(0px, 0px, 0px)');
  });

  it('interpolates halfway', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.tick(500);
    expect(el.style.transform).toBe('translate3d(0px, 50px, 0px)');
  });

  it('honours the range sub-window', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({
      id: 'a',
      node: el,
      mode: 'page',
      range: [0.4, 0.6],
      tracks: { y: yTrack }
    });
    engine.tick(300); // progress 0.3 -> before window
    expect(el.style.transform).toBe('translate3d(0px, 100px, 0px)');
    engine.tick(500); // progress 0.5 -> middle of window
    expect(el.style.transform).toBe('translate3d(0px, 50px, 0px)');
    engine.tick(700); // progress 0.7 -> after window
    expect(el.style.transform).toBe('translate3d(0px, 0px, 0px)');
  });

  it('composes opacity alongside transform', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({
      id: 'a',
      node: el,
      mode: 'page',
      tracks: { y: yTrack, opacity: opacityTrack }
    });
    engine.tick(500);
    expect(el.style.transform).toBe('translate3d(0px, 50px, 0px)');
    expect(el.style.opacity).toBe('0.5');
  });
});

describe('write diffing', () => {
  it('skips identical writes and counts them', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.tick(0);
    const writesAfterFirst = engine.metrics.writes;
    const skipsAfterFirst = engine.metrics.skips;
    engine.tick(0);
    engine.tick(0);
    expect(engine.metrics.writes).toBe(writesAfterFirst);
    expect(engine.metrics.skips).toBe(skipsAfterFirst + 2);
  });

  it('writes again when the value changes', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.tick(0);
    const before = engine.metrics.writes;
    engine.tick(500);
    expect(engine.metrics.writes).toBe(before + 1);
  });
});

describe('reduced motion', () => {
  it('snaps to the resting keyframe instead of scrubbing', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.state.reduced = true;
    engine.tick(0);
    expect(el.style.transform).toBe('translate3d(0px, 0px, 0px)');
  });
});

describe('pin windows', () => {
  it('reports the pin phase and local progress', () => {
    const engine = makeEngine();
    const el = node();
    const entry = engine.register({
      id: 'a',
      node: el,
      mode: 'page',
      pin: [0.2, 0.6],
      tracks: { y: yTrack }
    });
    engine.tick(100); // progress 0.1
    expect(entry.pinPhase).toBe('before');
    engine.tick(400); // progress 0.4 -> inside
    expect(entry.pinPhase).toBe('inside');
    expect(entry.pinT).toBeCloseTo(0.5, 5);
    engine.tick(900); // progress 0.9
    expect(entry.pinPhase).toBe('after');
  });
});

describe('metrics', () => {
  it('counts frames and active tracks', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({
      id: 'a',
      node: el,
      mode: 'page',
      tracks: { y: yTrack, opacity: opacityTrack }
    });
    engine.tick(0);
    engine.tick(100);
    const m = engine.metrics;
    expect(m.frames).toBe(2);
    expect(m.lastActiveTracks).toBe(2);
    expect(m.totalFrameMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(m.avgFrameMs)).toBe(true);
  });
});

describe('scroll override', () => {
  it('uses the override value instead of the scroll source', () => {
    const engine = makeEngine();
    const el = node();
    engine.register({ id: 'a', node: el, mode: 'page', tracks: { y: yTrack } });
    engine.setProgressOverride(500);
    engine.tick();
    expect(el.style.transform).toBe('translate3d(0px, 50px, 0px)');
    engine.setProgressOverride(null);
  });
});

describe('lifecycle', () => {
  it('start/stop toggles the rAF loop without throwing', () => {
    const engine = makeEngine();
    engine.register({ id: 'a', node: node(), mode: 'page', tracks: { y: yTrack } });
    engine.start();
    engine.stop();
    engine.destroy();
    expect(engine.entries).toHaveLength(0);
  });
});
