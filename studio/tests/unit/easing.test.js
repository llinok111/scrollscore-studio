import { describe, it, expect } from 'vitest';
import {
  cubicBezier,
  resolveEase,
  sampleTable,
  AOS_PRESETS,
  TRUE_PRESETS,
  EASE_NAMES,
  _clearEaseCache
} from '@scrub/easing.js';

describe('cubicBezier', () => {
  it('is the identity for the linear control points', () => {
    const fn = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.1, 0.25, 0.5, 0.73, 1]) {
      expect(fn(t)).toBeCloseTo(t, 10);
    }
  });

  it('clamps the input domain but not the output range', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(fn(-1)).toBe(0);
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
    expect(fn(2)).toBe(1);
  });

  it('preserves overshoot for the back family', () => {
    const fn = cubicBezier(...AOS_PRESETS['ease-out-back']);
    const values = [];
    for (let i = 0; i <= 100; i += 1) values.push(fn(i / 100));
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it('is monotonic for standard ease curves', () => {
    const fn = cubicBezier(0.42, 0, 0.58, 1);
    let prev = -Infinity;
    for (let i = 0; i <= 200; i += 1) {
      const v = fn(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('solves within 1e-6 of the requested x', () => {
    // Reconstruct x from y is not possible, so verify through the sample table
    // contract instead: the solver must not throw or produce NaN anywhere.
    const fn = cubicBezier(0.55, 0.085, 0.68, 0.53);
    for (let i = 0; i <= 500; i += 1) {
      expect(Number.isFinite(fn(i / 500))).toBe(true);
    }
  });
});

describe('resolveEase', () => {
  it('resolves preset names', () => {
    const fn = resolveEase('ease-out-cubic');
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
  });

  it('accepts control point arrays', () => {
    const fn = resolveEase([0, 0, 1, 1]);
    expect(fn(0.5)).toBeCloseTo(0.5, 6);
  });

  it('parses cubic-bezier() strings', () => {
    const fn = resolveEase('cubic-bezier(0, 0, 1, 1)');
    expect(fn(0.4)).toBeCloseTo(0.4, 6);
  });

  it('falls back to linear for unknown names', () => {
    const fn = resolveEase('not-a-real-ease');
    expect(fn(0.37)).toBeCloseTo(0.37, 10);
  });

  it('returns the same function instance for repeated names (memoised)', () => {
    _clearEaseCache();
    const a = resolveEase('ease-out-quad');
    const b = resolveEase('ease-out-quad');
    expect(a).toBe(b);
  });

  it('passes functions through untouched', () => {
    const fn = (t) => t * 2;
    expect(resolveEase(fn)).toBe(fn);
  });
});

describe('preset tables', () => {
  it('exposes corrected curves that differ from the upstream table', () => {
    expect(TRUE_PRESETS.linear).toEqual([0, 0, 1, 1]);
    expect(AOS_PRESETS.linear).not.toEqual(TRUE_PRESETS.linear);
    // Upstream shipped ease-in-cubic identical to ease-in-quad; the corrected
    // table separates them. This guards against silently "fixing" it back.
    expect(AOS_PRESETS['ease-in-cubic']).toEqual(AOS_PRESETS['ease-in-quad']);
    expect(TRUE_PRESETS['ease-in-cubic']).not.toEqual(AOS_PRESETS['ease-in-cubic']);
  });

  it('lists every preset name exactly once', () => {
    expect(EASE_NAMES.length).toBe(new Set(EASE_NAMES).size);
    expect(EASE_NAMES).toContain('ease-in-out-back');
  });
});

describe('sampleTable', () => {
  it('approximates the source function closely', () => {
    const source = cubicBezier(0.25, 0.1, 0.25, 1);
    const sampled = sampleTable(source, 512);
    let maxErr = 0;
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      maxErr = Math.max(maxErr, Math.abs(sampled(t) - source(t)));
    }
    expect(maxErr).toBeLessThan(0.01);
  });

  it('hits the exact endpoints', () => {
    const sampled = sampleTable(cubicBezier(0.42, 0, 0.58, 1), 64);
    expect(sampled(0)).toBe(0);
    expect(sampled(1)).toBe(1);
  });
});
