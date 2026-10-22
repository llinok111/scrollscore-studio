import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Performance suite.
 *
 * Everything here is measured in the same headless Chromium instance, so the
 * numbers are comparable with each other but are NOT a claim about real display
 * refresh rates. The report file records the raw samples so the README can quote
 * them verbatim.
 *
 * Baseline: a hand-written loop that writes the same CSS surfaces without the
 * engine (no keyframe evaluation, no diffing). It is the floor, not a rival.
 */

const OUT = path.resolve('tests/e2e/.perf.json');

test('scrub cost stays inside budget over a 240-frame sweep', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__SCROLLSCORE__);
  await page.waitForTimeout(400);

  const result = await page.evaluate(async () => {
    const api = window.__SCROLLSCORE__;
    const engine = api.stage.engine;
    const scroll = document.getElementById('stage-scroll');
    const layers = Array.from(document.querySelectorAll('.doc-layer'));

    const sweep = async (frames) => {
      const span = scroll.scrollHeight - scroll.clientHeight;
      const gaps = [];
      let last = 0;
      for (let i = 0; i < frames; i += 1) {
        scroll.scrollTop = (i / (frames - 1)) * span;
        await new Promise((resolve) =>
          requestAnimationFrame((ts) => {
            if (last) gaps.push(ts - last);
            last = ts;
            resolve();
          })
        );
      }
      gaps.sort((a, b) => a - b);
      const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
      return {
        avg: gaps.reduce((a, b) => a + b, 0) / gaps.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: gaps[gaps.length - 1]
      };
    };

    // --- engine sweep -------------------------------------------------------
    api.stage.scrollTo(0);
    const before = { ...engine.metrics };
    const t0 = performance.now();
    const engineGaps = await sweep(240);
    const engineElapsed = performance.now() - t0;
    const after = { ...engine.metrics };

    // --- baseline sweep (no engine; same surfaces, fixed values) ------------
    engine.stop();
    const t1 = performance.now();
    const baselineGaps = await (async () => {
      const span = scroll.scrollHeight - scroll.clientHeight;
      const gaps = [];
      let last = 0;
      for (let i = 0; i < 240; i += 1) {
        scroll.scrollTop = (i / 239) * span;
        const t = i / 239;
        for (const el of layers) {
          el.style.transform = `translate3d(0px, ${(1 - t) * 100}px, 0px)`;
          el.style.opacity = String(t);
        }
        await new Promise((resolve) =>
          requestAnimationFrame((ts) => {
            if (last) gaps.push(ts - last);
            last = ts;
            resolve();
          })
        );
      }
      gaps.sort((a, b) => a - b);
      const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
      return {
        avg: gaps.reduce((a, b) => a + b, 0) / gaps.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: gaps[gaps.length - 1]
      };
    })();
    const baselineElapsed = performance.now() - t1;
    engine.start();

    // --- isolated tick cost (no layout, no paint) --------------------------
    const tickSamples = [];
    for (let i = 0; i < 400; i += 1) {
      const s = performance.now();
      engine.tick((i / 399) * (scroll.scrollHeight - scroll.clientHeight));
      tickSamples.push(performance.now() - s);
    }
    tickSamples.sort((a, b) => a - b);

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      layers: layers.length,
      engine: {
        frames: after.frames - before.frames,
        elapsed: +engineElapsed.toFixed(1),
        gaps: {
          avg: +engineGaps.avg.toFixed(2),
          p50: +engineGaps.p50.toFixed(2),
          p95: +engineGaps.p95.toFixed(2),
          p99: +engineGaps.p99.toFixed(2),
          max: +engineGaps.max.toFixed(2)
        },
        writes: after.writes - before.writes,
        skips: after.skips - before.skips,
        longFrames: after.longFrames - before.longFrames,
        tickAvgMs: +((after.totalFrameMs - before.totalFrameMs) / Math.max(1, after.frames - before.frames)).toFixed(3),
        tickMaxMs: +after.maxFrameMs.toFixed(3)
      },
      baseline: {
        elapsed: +baselineElapsed.toFixed(1),
        gaps: {
          avg: +baselineGaps.avg.toFixed(2),
          p50: +baselineGaps.p50.toFixed(2),
          p95: +baselineGaps.p95.toFixed(2),
          p99: +baselineGaps.p99.toFixed(2),
          max: +baselineGaps.max.toFixed(2)
        }
      },
      isolatedTick: {
        samples: tickSamples.length,
        p50: +tickSamples[Math.floor(tickSamples.length * 0.5)].toFixed(3),
        p95: +tickSamples[Math.floor(tickSamples.length * 0.95)].toFixed(3),
        max: +tickSamples[tickSamples.length - 1].toFixed(3)
      }
    };
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

  // Budgets are intentionally loose: this runs in a software-rendered headless
  // browser where the frame gap is dominated by the compositor, not by the
  // engine. The tight assertion is on the isolated tick cost.
  expect(result.isolatedTick.p95).toBeLessThan(2);
  expect(result.engine.tickAvgMs).toBeLessThan(1.5);
  expect(result.engine.longFrames).toBeLessThan(result.engine.frames * 0.05);
  expect(result.engine.writes).toBeGreaterThan(0);
  // Diffing must actually skip work when a frame lands on an unchanged value.
  expect(result.engine.skips).toBeGreaterThan(0);
});
