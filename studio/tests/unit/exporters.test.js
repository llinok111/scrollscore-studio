import { describe, it, expect } from 'vitest';
import {
  exportCSS,
  exportJS,
  exportHTML,
  collectStops,
  summarize
} from '@studio/core/exporters.js';
import { normalizeProject, createLayer } from '@scrub/schema.js';

const project = normalizeProject({
  name: '导出测试',
  layers: [
    createLayer({
      name: 'Hero',
      type: 'heading',
      content: '标题',
      style: { x: 10, y: 20, w: 400, h: 90 },
      motion: {
        mode: 'page',
        range: [0.1, 0.5],
        ease: 'ease-out-cubic',
        tracks: {
          opacity: [
            { p: 0, v: 0 },
            { p: 0.5, v: 1, ease: 'ease-out-cubic' }
          ],
          y: [
            { p: 0, v: 60 },
            { p: 1, v: 0, ease: 'ease-out-cubic' }
          ]
        }
      }
    }),
    createLayer({
      name: 'Pin',
      type: 'panel',
      content: 'A\nB\nC',
      motion: {
        mode: 'page',
        range: [0.2, 0.8],
        pin: [0.2, 0.8],
        tracks: { scale: [{ p: 0, v: 1 }, { p: 1, v: 1.2 }] }
      }
    })
  ]
});

describe('collectStops', () => {
  it('unions the keyframe progress of every track', () => {
    const stops = collectStops({
      opacity: [{ p: 0, v: 0 }, { p: 0.5, v: 1 }],
      y: [{ p: 0, v: 1 }, { p: 1, v: 0 }]
    });
    expect(stops).toEqual([0, 0.5, 1]);
  });

  it('always includes both endpoints', () => {
    expect(collectStops({ x: [{ p: 0.3, v: 1 }] })).toEqual([0, 0.3, 1]);
  });

  it('returns just the endpoints for an empty track set', () => {
    expect(collectStops({})).toEqual([0, 1]);
  });
});

describe('exportCSS', () => {
  const { code, warnings } = exportCSS(project);

  it('emits one @keyframes block per animated layer', () => {
    const blocks = code.match(/@keyframes /g) || [];
    expect(blocks).toHaveLength(2);
  });

  it('uses scroll-driven animation properties', () => {
    expect(code).toContain('animation-timeline: scroll(root block)');
    expect(code).toContain('animation-range: 10% 50%');
    expect(code).toContain('animation-fill-mode: both');
  });

  it('is guarded by @supports and prefers-reduced-motion', () => {
    expect(code).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(code).toContain('@supports (animation-timeline: scroll())');
  });

  it('writes percentage offsets matching the union of stops', () => {
    expect(code).toMatch(/\b0%/);
    expect(code).toMatch(/\b50%/);
    expect(code).toMatch(/\b100%/);
  });

  it('carries per-segment timing functions', () => {
    expect(code).toContain('animation-timing-function: cubic-bezier(');
  });

  it('warns that pin cannot be expressed in CSS', () => {
    expect(warnings.join(' ')).toContain('pin');
  });

  it('documents the markup contract', () => {
    expect(code).toContain('data-ss="');
    expect(code).toContain('AOS (MIT)');
  });

  it('handles a project with no tracks', () => {
    const empty = normalizeProject({
      layers: [createLayer({ motion: { tracks: {} } })]
    });
    const result = exportCSS(empty);
    expect(result.code).toContain('没有可导出的轨道');
  });
});

describe('exportJS', () => {
  const { code } = exportJS(project);

  it('is self-contained (no import statements)', () => {
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/require\(/);
  });

  it('inlines the project entries', () => {
    expect(code).toContain('data-ss=');
    expect(code).toContain('"target"');
  });

  it('inlines the easing table', () => {
    expect(code).toContain('"ease-out-cubic"');
    expect(code).toContain('"linear":[0,0,1,1]');
  });

  it('ships a requestAnimationFrame loop and a public refresh hook', () => {
    expect(code).toContain('requestAnimationFrame');
    expect(code).toContain('window.ScrollScore');
  });

  it('explains the pin contract when a pin window exists', () => {
    expect(code).toContain('position: sticky');
  });

  it('produces smaller output when minified', () => {
    const min = exportJS(project, { minify: true }).code;
    expect(min.length).toBeLessThan(code.length);
  });
});

describe('exportHTML', () => {
  const html = exportHTML(project);

  it('is a complete document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('contains markup for every layer', () => {
    for (const layer of project.layers) {
      expect(html).toContain(`data-ss="${layer.id}"`);
    }
  });

  it('embeds the runtime instead of linking it', () => {
    expect(html).toContain('window.ScrollScore');
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('escapes user content', () => {
    const risky = normalizeProject({
      layers: [createLayer({ type: 'text', content: '<img src=x onerror=alert(1)>' })]
    });
    const out = exportHTML(risky);
    // The payload must survive as inert text, never as a live tag.
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('summarize', () => {
  it('counts layers, tracks and keyframes', () => {
    const stats = summarize(project);
    expect(stats.layers).toBe(2);
    expect(stats.tracks).toBe(3);
    expect(stats.keys).toBe(6);
  });
});
