import { describe, it, expect, beforeEach } from 'vitest';
import {
  elementProgress,
  pageProgress,
  mapRange,
  pinPhase,
  parseRange,
  clamp01,
  measureElementBounds
} from '@scrub/progress.js';

describe('clamp01', () => {
  it('clamps both ends', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(5)).toBe(1);
  });
});

describe('elementProgress', () => {
  const bounds = { start: 0, end: 1000, top: 500, height: 500 };

  it('is 0 before the element enters', () => {
    expect(elementProgress(-100, bounds)).toBe(0);
    expect(elementProgress(0, bounds)).toBe(0);
  });

  it('is 0.5 halfway through the crossing', () => {
    expect(elementProgress(500, bounds)).toBeCloseTo(0.5, 6);
  });

  it('is 1 after the element leaves', () => {
    expect(elementProgress(1000, bounds)).toBe(1);
    expect(elementProgress(5000, bounds)).toBe(1);
  });

  it('degrades gracefully for zero-height windows', () => {
    const flat = { start: 100, end: 100, top: 100, height: 0 };
    expect(elementProgress(50, flat)).toBe(0);
    expect(elementProgress(150, flat)).toBe(1);
  });
});

describe('pageProgress', () => {
  it('maps the scrollable span to 0..1', () => {
    expect(pageProgress(0, 3000, 1000)).toBe(0);
    expect(pageProgress(1000, 3000, 1000)).toBeCloseTo(0.5, 6);
    expect(pageProgress(2000, 3000, 1000)).toBe(1);
  });

  it('returns 0 when the document cannot scroll', () => {
    expect(pageProgress(0, 800, 1000)).toBe(0);
    expect(pageProgress(400, 800, 1000)).toBe(0);
  });
});

describe('mapRange', () => {
  it('remaps a sub-window onto 0..1', () => {
    expect(mapRange(0.2, [0.2, 0.6])).toBe(0);
    expect(mapRange(0.4, [0.2, 0.6])).toBeCloseTo(0.5, 6);
    expect(mapRange(0.6, [0.2, 0.6])).toBe(1);
    expect(mapRange(0.9, [0.2, 0.6])).toBe(1);
  });

  it('passes through when the range is degenerate', () => {
    expect(mapRange(0.3, null)).toBeCloseTo(0.3, 6);
    expect(mapRange(0.3, [0.3, 0.3])).toBe(1);
  });
});

describe('pinPhase', () => {
  it('reports before / inside / after', () => {
    expect(pinPhase(0.1, [0.2, 0.8])).toEqual({ phase: 'before', t: 0 });
    expect(pinPhase(0.5, [0.2, 0.8])).toEqual({ phase: 'inside', t: expect.closeTo(0.5, 6) });
    expect(pinPhase(0.9, [0.2, 0.8])).toEqual({ phase: 'after', t: 1 });
  });

  it('handles a zero-width pin window', () => {
    expect(pinPhase(0.5, [0.5, 0.5]).phase).toBe('inside');
    expect(pinPhase(0.5, [0.5, 0.5]).t).toBe(1);
  });
});

describe('parseRange', () => {
  it('parses comma, semicolon and whitespace separated pairs', () => {
    expect(parseRange('0.2,0.8')).toEqual([0.2, 0.8]);
    expect(parseRange('0.2;0.8')).toEqual([0.2, 0.8]);
    expect(parseRange('0.2 0.8')).toEqual([0.2, 0.8]);
  });

  it('orders the pair', () => {
    expect(parseRange('0.8,0.2')).toEqual([0.2, 0.8]);
  });

  it('clamps into [0,1]', () => {
    expect(parseRange('-1,3')).toEqual([0, 1]);
  });

  it('falls back for malformed input', () => {
    expect(parseRange('nope', [0.1, 0.9])).toEqual([0.1, 0.9]);
    expect(parseRange('0.2', [0.1, 0.9])).toEqual([0.1, 0.9]);
    expect(parseRange(null, [0, 1])).toEqual([0, 1]);
  });
});

describe('measureElementBounds', () => {
  beforeEach(() => {
    window.scrollY = 0;
    window.pageYOffset = 0;
  });

  it('converts a viewport rect into document-space trigger edges', () => {
    const node = {
      getBoundingClientRect: () => ({ top: 200, height: 100 })
    };
    const bounds = measureElementBounds(node, 800, 0);
    expect(bounds.top).toBe(200);
    expect(bounds.height).toBe(100);
    // enters when the top edge reaches the viewport bottom
    expect(bounds.start).toBe(200 - 800);
    // leaves when the bottom edge reaches the viewport top
    expect(bounds.end).toBe(300);
  });

  it('applies the offset to both edges', () => {
    const node = { getBoundingClientRect: () => ({ top: 0, height: 50 }) };
    const bounds = measureElementBounds(node, 600, -100);
    expect(bounds.start).toBe(-700);
    expect(bounds.end).toBe(-50);
  });
});
