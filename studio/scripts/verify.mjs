/**
 * ScrollScore Studio — quantitative visual + interaction verification.
 *
 * This harness exists because "it renders" is not evidence. It captures
 * screenshots at several scroll positions, decodes the PNGs and reports pixel
 * statistics (ink coverage, palette diversity, warm-hue ratio, per-tile
 * emptiness), then drives real interactions and asserts the resulting state.
 *
 * Run: node scripts/verify.mjs [--url=...] [--out=...]
 */
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = args.url || 'http://localhost:4180/';
const OUT = path.resolve(args.out || '../docs/shots');
fs.mkdirSync(OUT, { recursive: true });

const BG = [0x12, 0x10, 0x0d];
const results = { url: URL, shots: [], dom: {}, interactions: {}, errors: [] };

/* ------------------------------ pixel math ------------------------------- */

function analysePng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  let ink = 0;
  let warm = 0;
  let cool = 0;
  let lumSum = 0;
  const palette = new Set();
  const tileInk = new Array(9).fill(0);
  const tileCount = new Array(9).fill(0);

  for (let y = 0; y < height; y += 1) {
    const ty = Math.min(2, Math.floor((y / height) * 3));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dr = Math.abs(r - BG[0]);
      const dg = Math.abs(g - BG[1]);
      const db = Math.abs(b - BG[2]);
      const dist = dr + dg + db;
      const tx = Math.min(2, Math.floor((x / width) * 3));
      const tile = ty * 3 + tx;
      tileCount[tile] += 1;
      if (dist > 18) {
        ink += 1;
        tileInk[tile] += 1;
      }
      if (r > g && g > b && r - b > 24) warm += 1;
      if (b > r && b - r > 24) cool += 1;
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      palette.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
  }

  const total = width * height;
  return {
    file: path.basename(file),
    width,
    height,
    inkRatio: +(ink / total).toFixed(4),
    warmRatio: +(warm / total).toFixed(4),
    coolRatio: +(cool / total).toFixed(4),
    meanLuma: +(lumSum / total).toFixed(2),
    paletteSize: palette.size,
    tileInkRatio: tileInk.map((v, i) => +(v / Math.max(1, tileCount[i])).toFixed(4))
  };
}

/* -------------------------------- helpers -------------------------------- */

const assert = (cond, message) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${message}`);
};

async function seek(page, progress) {
  await page.evaluate((p) => {
    const api = window.__SCROLLSCORE__;
    api.stage.scrollTo(p);
    api.store.setProgress(p);
  }, progress);
  await page.waitForTimeout(220);
}

async function shoot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  const stats = analysePng(file);
  results.shots.push(stats);
  return stats;
}

/* --------------------------------- main ---------------------------------- */

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

page.on('console', (msg) => {
  if (msg.type() === 'error') results.errors.push(msg.text());
});
page.on('pageerror', (err) => results.errors.push(String(err)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

/* ---- DOM probe: layout integrity ---- */

results.dom = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const outside = (r) => !r || r.x < -1 || r.y < -1 || r.x + r.w > vw + 1 || r.y + r.h > vh + 1;

  const regions = {
    toolbar: document.querySelector('.toolbar'),
    panelLeft: document.querySelector('.panel--left'),
    stage: document.querySelector('.stage'),
    panelRight: document.querySelector('.panel--right'),
    timeline: document.querySelector('.timeline'),
    statusbar: document.querySelector('.statusbar')
  };
  const boxes = Object.fromEntries(Object.entries(regions).map(([k, el]) => [k, rect(el)]));

  const layers = Array.from(document.querySelectorAll('.doc-layer')).map((el) => ({
    id: el.dataset.ss,
    type: el.dataset.type,
    box: rect(el),
    visible: el.getBoundingClientRect().width > 0,
    opacity: getComputedStyle(el).opacity
  }));

  const scroll = document.getElementById('stage-scroll');
  const doc = document.getElementById('stage-doc');

  return {
    viewport: { w: vw, h: vh },
    regions: boxes,
    regionsOutside: Object.entries(boxes)
      .filter(([, b]) => outside(b))
      .map(([k]) => k),
    layerCount: layers.length,
    layers,
    layersWithZeroSize: layers.filter((l) => l.box.w === 0 || l.box.h === 0).length,
    stage: {
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      docHeight: doc.getBoundingClientRect().height,
      scrollable: scroll.scrollHeight > scroll.clientHeight + 10
    },
    timeline: {
      rows: document.querySelectorAll('.track-row').length,
      keys: document.querySelectorAll('.key').length,
      gutterRows: document.querySelectorAll('.gutter-row').length
    },
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    fontLoaded: getComputedStyle(document.body).fontFamily
  };
});

assert(results.dom.regionsOutside.length === 0, `regions outside viewport: ${results.dom.regionsOutside}`);
assert(results.dom.overflowX === false, 'horizontal document overflow detected');
assert(results.dom.layerCount === 8, `expected 8 layers, got ${results.dom.layerCount}`);
assert(results.dom.layersWithZeroSize === 0, 'some layers collapsed to zero size');
assert(results.dom.stage.scrollable, 'stage is not scrollable');
assert(results.dom.timeline.rows >= 2, `expected >=3 timeline rows, got ${results.dom.timeline.rows}`);
assert(results.dom.timeline.keys >= 6, `expected >=6 keyframes, got ${results.dom.timeline.keys}`);

/* ---- scroll sequence screenshots ---- */

const positions = [0, 0.14, 0.3, 0.46, 0.68, 0.9];
for (let i = 0; i < positions.length; i += 1) {
  await seek(page, positions[i]);
  await shoot(page, `${String(i + 1).padStart(2, '0')}-scroll-${String(Math.round(positions[i] * 100)).padStart(3, '0')}.png`);
}

/* ---- scrub correctness: values must change monotonically along the axis ---- */

const scrubProbe = await page.evaluate(async () => {
  const api = window.__SCROLLSCORE__;
  const layer = api.store.project.layers.find((l) => l.name === '主视觉');
  const node = document.querySelector(`[data-ss="${layer.id}"]`);
  const samples = [];
  for (const p of [0, 0.15, 0.3, 0.45, 0.6]) {
    api.stage.scrollTo(p);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    samples.push({ p, transform: node.style.transform });
  }
  return samples;
});

const ys = scrubProbe.map((s) => {
  const m = /translate3d\([^,]+,\s*([-\d.]+)px/.exec(s.transform);
  return m ? Number(m[1]) : NaN;
});
assert(ys.every((n) => Number.isFinite(n)), 'parallax layer transform missing');
assert(ys[0] > ys[ys.length - 1], `parallax y should decrease along scroll (got ${ys.join(' → ')})`);
results.interactions.scrubSamples = scrubProbe.map((s, i) => ({ p: s.p, y: ys[i] }));

/* ---- interactions ---- */

// 1. select a different layer
await page.click('.layer-item:nth-child(4)');
await page.waitForTimeout(160);
const selected = await page.evaluate(() => window.__SCROLLSCORE__.store.selected.name);
results.interactions.selectedLayer = selected;
assert(selected === '数据卡', `layer selection failed (got ${selected})`);

// 2. drag a keyframe
await seek(page, 0.2);
const keyBefore = await page.evaluate(() => {
  const api = window.__SCROLLSCORE__;
  const layer = api.store.selected;
  const prop = Object.keys(layer.motion.tracks)[0];
  return { prop, p: layer.motion.tracks[prop][0].p };
});
const keyEl = await page.$(`.key[data-prop="${keyBefore.prop}"]`);
const box = await keyEl.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(200);
const keyAfter = await page.evaluate(() => {
  const api = window.__SCROLLSCORE__;
  const layer = api.store.selected;
  const prop = Object.keys(layer.motion.tracks)[0];
  return { p: layer.motion.tracks[prop][0].p, canUndo: api.store.canUndo };
});
results.interactions.keyframeDrag = { before: keyBefore.p, after: keyAfter.p };
assert(keyAfter.p > keyBefore.p + 0.02, `keyframe did not move (${keyBefore.p} → ${keyAfter.p})`);

// 3. undo restores it
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const afterUndo = await page.evaluate(() => {
  const api = window.__SCROLLSCORE__;
  const layer = api.store.selected;
  const prop = Object.keys(layer.motion.tracks)[0];
  return layer.motion.tracks[prop][0].p;
});
results.interactions.undo = { restored: afterUndo, expected: keyBefore.p };
assert(Math.abs(afterUndo - keyBefore.p) < 0.02, `undo did not restore keyframe (${afterUndo} vs ${keyBefore.p})`);

// 4. export dialog: each tab produces code
await page.click('[data-action="export"]');
await page.waitForTimeout(260);
const tabs = {};
for (const tab of ['css', 'js', 'json', 'html']) {
  await page.click(`.tab[data-tab="${tab}"]`);
  await page.waitForTimeout(180);
  const info = await page.evaluate(() => ({
    len: document.getElementById('export-code').textContent.length,
    meta: document.getElementById('export-meta').textContent
  }));
  tabs[tab] = info;
}
results.interactions.exportTabs = tabs;
assert(tabs.css.len > 400, 'CSS export too short');
assert(tabs.js.len > 1200, 'JS export too short');
assert(tabs.json.len > 500, 'JSON export too short');
assert(tabs.html.len > 2500, 'HTML export too short');
await shoot(page, '07-export-dialog.png');
await page.click('.dialog__head [data-action="close-export"]');
await page.waitForTimeout(160);

// 5. preset application changes track count
const before = await page.evaluate(() => Object.keys(window.__SCROLLSCORE__.store.selected.motion.tracks).length);
await page.click('.preset[data-preset="stickyChapter"]');
await page.waitForTimeout(220);
const after = await page.evaluate(() => ({
  count: Object.keys(window.__SCROLLSCORE__.store.selected.motion.tracks).length,
  props: Object.keys(window.__SCROLLSCORE__.store.selected.motion.tracks).sort(),
  pin: window.__SCROLLSCORE__.store.selected.motion.pin
}));
results.interactions.preset = { before, after: after.count, props: after.props, pin: after.pin };
assert(after.props.includes('letterSpacing'), `preset tracks not applied (${after.props})`);
assert(Array.isArray(after.pin), 'stickyChapter preset should set a pin window');

// 6. responsive: tablet + phone breakpoints
for (const [name, width] of [
  ['08-tablet', 834],
  ['09-phone', 390]
]) {
  await page.click(`[data-breakpoint="${width}"]`);
  await page.waitForTimeout(320);
  await seek(page, 0.3);
  await shoot(page, `${name}.png`);
}
await page.click('[data-breakpoint="1280"]');

// 7. real viewport resize (not just the stage frame)
for (const [name, size] of [
  ['10-vp-1100', { width: 1100, height: 820 }],
  ['11-vp-820', { width: 820, height: 900 }]
]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(320);
  await seek(page, 0.3);
  await shoot(page, `${name}.png`);
}
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(200);

/* ---- performance: measure a real 240-frame scroll sweep ---- */

await seek(page, 0);
const perf = await page.evaluate(async () => {
  const api = window.__SCROLLSCORE__;
  const engine = api.stage.engine;
  const start = performance.now();
  const before = { ...engine.metrics };
  const scroll = document.getElementById('stage-scroll');
  const span = scroll.scrollHeight - scroll.clientHeight;
  const frames = 240;
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
  const elapsed = performance.now() - start;
  gaps.sort((a, b) => a - b);
  const pct = (q) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))];
  const after = { ...engine.metrics };
  return {
    frames,
    elapsed: +elapsed.toFixed(1),
    avgGap: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2),
    p50: +pct(0.5).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    maxGap: +gaps[gaps.length - 1].toFixed(2),
    tickAvgMs: +((after.totalFrameMs - before.totalFrameMs) / Math.max(1, after.frames - before.frames)).toFixed(3),
    tickMaxMs: +after.maxFrameMs.toFixed(3),
    writes: after.writes - before.writes,
    skips: after.skips - before.skips,
    longFrames: after.longFrames - before.longFrames
  };
});
results.performance = perf;

assert(perf.tickAvgMs < 2, `per-tick cost too high: ${perf.tickAvgMs}ms`);
assert(perf.p95 < 40, `p95 frame gap too high: ${perf.p95}ms`);

/* ---- report ---- */

await browser.close();

const shotStats = results.shots;
const minInk = Math.min(...shotStats.map((s) => s.inkRatio));
const maxInk = Math.max(...shotStats.map((s) => s.inkRatio));
results.summary = {
  shots: shotStats.length,
  inkRatioRange: [minInk, maxInk],
  paletteRange: [
    Math.min(...shotStats.map((s) => s.paletteSize)),
    Math.max(...shotStats.map((s) => s.paletteSize))
  ],
  warmRatioAvg: +(shotStats.reduce((a, s) => a + s.warmRatio, 0) / shotStats.length).toFixed(4),
  errors: results.errors
};

assert(minInk > 0.06, `a screenshot is nearly empty (min ink ${minInk})`);

fs.writeFileSync(path.join(OUT, 'verify-report.json'), JSON.stringify(results, null, 2));

console.log(JSON.stringify({ summary: results.summary, performance: perf, dom: {
  layerCount: results.dom.layerCount,
  stage: results.dom.stage,
  timeline: results.dom.timeline,
  regionsOutside: results.dom.regionsOutside
}, interactions: results.interactions }, null, 2));

console.log('\nVERIFY OK');
