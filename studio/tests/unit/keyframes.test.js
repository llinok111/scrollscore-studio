import { describe, it, expect } from 'vitest';
import {
  normalizeKeys,
  evaluateTrack,
  composeStyles,
  twoKey,
  fmt,
  PROPS,
  PROP_NAMES
} from '@scrub/keyframes.js';

describe('normalizeKeys', () => {
  it('sorts by progress', () => {
    const keys = normalizeKeys([
      { p: 1, v: 10 },
      { p: 0, v: 0 },
      { p: 0.5, v: 5 }
    ]);
    expect(keys.map((k) => k.p)).toEqual([0, 0.5, 1]);
  });

  it('clamps progress into [0,1]', () => {
    const keys = normalizeKeys([
      { p: -2, v: 1 },
      { p: 3, v: 2 }
    ]);
    expect(keys[0].p).toBe(0);
    expect(keys[1].p).toBe(1);
  });

  it('collapses duplicate progress values, last wins', () => {
    const keys = normalizeKeys([
      { p: 0.5, v: 1 },
      { p: 0.5, v: 9 }
    ]);
    expect(keys).toHaveLength(1);
    expect(keys[0].v).toBe(9);
  });

  it('drops malformed entries', () => {
    const keys = normalizeKeys([
      { p: 0, v: 0 },
      { p: 'x', v: 3 },
      { p: 0.4 },
      null,
      'nope'
    ]);
    expect(keys).toHaveLength(1);
  });

  it('returns an empty array for non-arrays', () => {
    expect(normalizeKeys(null)).toEqual([]);
    expect(normalizeKeys(undefined)).toEqual([]);
    expect(normalizeKeys({})).toEqual([]);
  });
});

describe('evaluateTrack', () => {
  const linear = [
    { p: 0, v: 0 },
    { p: 1, v: 100 }
  ];

  it('interpolates linearly', () => {
    expect(evaluateTrack(linear, 0)).toBe(0);
    expect(evaluateTrack(linear, 0.25)).toBeCloseTo(25, 6);
    expect(evaluateTrack(linear, 0.5)).toBeCloseTo(50, 6);
    expect(evaluateTrack(linear, 1)).toBe(100);
  });

  it('clamps outside the keyframe domain', () => {
    expect(evaluateTrack(linear, -1)).toBe(0);
    expect(evaluateTrack(linear, 5)).toBe(100);
  });

  it('returns the constant for a single keyframe', () => {
    expect(evaluateTrack([{ p: 0.4, v: 42 }], 0)).toBe(42);
    expect(evaluateTrack([{ p: 0.4, v: 42 }], 1)).toBe(42);
  });

  it('respects per-key easing on the arriving segment', () => {
    const eased = [
      { p: 0, v: 0 },
      { p: 1, v: 100, ease: 'ease-in-cubic' }
    ];
    const mid = evaluateTrack(eased, 0.5);
    // ease-in curves stay below the linear midpoint
    expect(mid).toBeLessThan(50);
    expect(mid).toBeGreaterThan(0);
  });

  it('supports multi-segment tracks', () => {
    const keys = normalizeKeys([
      { p: 0, v: 0 },
      { p: 0.5, v: 100 },
      { p: 1, v: 0 }
    ]);
    expect(evaluateTrack(keys, 0.5)).toBeCloseTo(100, 6);
    expect(evaluateTrack(keys, 0.75)).toBeCloseTo(50, 6);
  });

  it('handles zero-length spans without dividing by zero', () => {
    const keys = [
      { p: 0.5, v: 10 },
      { p: 0.5, v: 20 }
    ];
    expect(Number.isFinite(evaluateTrack(keys, 0.5))).toBe(true);
  });
});

describe('composeStyles', () => {
  it('only emits surfaces that have tracks', () => {
    const out = composeStyles(
      { opacity: [{ p: 0, v: 0 }, { p: 1, v: 1 }] },
      0.5
    );
    expect(out.opacity).toBe('0.5');
    expect(out.transform).toBeNull();
    expect(out.filter).toBeNull();
    expect(out.clipPath).toBeNull();
  });

  it('composes a translate3d transform from x/y/z', () => {
    const out = composeStyles(
      {
        x: [{ p: 0, v: -40 }, { p: 1, v: 0 }],
        y: [{ p: 0, v: 60 }, { p: 1, v: 0 }]
      },
      0
    );
    expect(out.transform).toBe('translate3d(-40px, 60px, 0px)');
  });

  it('orders transform parts as translate → rotate → scale', () => {
    const out = composeStyles(
      {
        y: [{ p: 0, v: 10 }, { p: 1, v: 10 }],
        rotate: [{ p: 0, v: 45 }, { p: 1, v: 45 }],
        scale: [{ p: 0, v: 2 }, { p: 1, v: 2 }]
      },
      0
    );
    expect(out.transform).toBe('translate3d(0px, 10px, 0px) rotate(45deg) scale(2)');
  });

  it('builds an inset clip-path from clipX', () => {
    const out = composeStyles({ clipX: [{ p: 0, v: 25 }, { p: 1, v: 25 }] }, 0);
    expect(out.clipPath).toBe('inset(0 75% 0 0)');
  });

  it('clamps opacity into [0,1]', () => {
    const out = composeStyles({ opacity: [{ p: 0, v: -3 }, { p: 1, v: 5 }] }, 1);
    expect(out.opacity).toBe('1');
  });

  it('combines filter primitives', () => {
    const out = composeStyles(
      {
        blur: [{ p: 0, v: 8 }, { p: 1, v: 8 }],
        brightness: [{ p: 0, v: 1.2 }, { p: 1, v: 1.2 }]
      },
      0
    );
    expect(out.filter).toBe('blur(8px) brightness(1.2)');
  });

  it('ignores unknown property names', () => {
    const out = composeStyles({ notAProp: twoKey(0, 1) }, 0.5);
    expect(out.transform).toBeNull();
    expect(Object.keys(out.values)).toHaveLength(0);
  });
});

describe('fmt', () => {
  it('rounds to three decimals and strips trailing zeros', () => {
    expect(fmt(1.23456)).toBe('1.235');
    expect(fmt(1.5)).toBe('1.5');
    expect(fmt(2)).toBe('2');
    expect(fmt(-0.0004)).toBe('0');
  });

  it('never emits NaN or Infinity', () => {
    expect(fmt(NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
  });
});

describe('property registry', () => {
  it('declares a kind and base for every property', () => {
    for (const name of PROP_NAMES) {
      expect(PROPS[name].kind).toBeTruthy();
      expect(typeof PROPS[name].base).toBe('number');
    }
  });

  it('keeps transform properties in a single composited surface', () => {
    const transformProps = PROP_NAMES.filter((n) => PROPS[n].kind === 'transform');
    expect(transformProps).toEqual(expect.arrayContaining(['x', 'y', 'z', 'scale', 'rotate']));
  });
});
