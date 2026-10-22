/**
 * ScrollScore Studio — per-layer visual audit.
 *
 * The whole-page pixel statistics in verify.mjs prove "the app renders". This
 * script goes one level deeper and proves each individual layer renders *its own
 * content*: every layer is screenshotted in isolation and its ink coverage,
 * palette spread and contrast are measured.
 *
 * A layer that silently collapses (empty content, zero-size box, invisible
 * colour-on-colour) shows up here as a near-zero ink ratio.
 *
 * Run: node scripts/visual-audit.mjs [--url=...] [--out=...]
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
const OUT = path.resolve(args.out || '../docs/shots/layers');
fs.mkdirSync(OUT, { recursive: true });

function analyse(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const palette = new Set();
  let minL = 255;
  let maxL = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 8) continue;
    palette.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    minL = Math.min(minL, l);
    maxL = Math.max(maxL, l);
    sum += l;
  }
  const total = width * height;
  return {
    size: `${width}x${height}`,
    paletteSize: palette.size,
    meanLuma: +(sum / total).toFixed(1),
    // Local dynamic range is the honest "is there anything to see" signal for a
    // transparent layer: a flat fill has range 0, text has range > 100.
    dynamicRange: +(maxL - minL).toFixed(1)
  };
}

const browser = await chromium.launch({ executablePath: EDGE, args: ['--force-device-scale-factor=2'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const layers = await page.evaluate(() =>
  window.__SCROLLSCORE__.store.project.layers.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    tracks: Object.keys(l.motion.tracks),
    range: l.motion.range,
    pin: l.motion.pin
  }))
);

const report = [];
for (const layer of layers) {
  // Park the playhead at the midpoint of the layer's own window so its content
  // is at a representative opacity/transform.
  const mid = (layer.range[0] + layer.range[1]) / 2;
  await page.evaluate((p) => {
    const api = window.__SCROLLSCORE__;
    api.stage.scrollTo(p);
    api.store.setProgress(p);
  }, mid);
  await page.waitForTimeout(180);

  const el = page.locator(`[data-ss="${layer.id}"]`);
  const box = await el.boundingBox();
  if (!box || box.width < 2 || box.height < 2) {
    report.push({ ...layer, error: 'zero-size', box });
    continue;
  }

  const file = path.join(OUT, `${layer.type}-${layer.id}.png`);
  await el.screenshot({ path: file, omitBackground: true });
  report.push({ ...layer, box: { w: +box.width.toFixed(1), h: +box.height.toFixed(1) }, ...analyse(file) });
}

// Text contrast check against the stage background.
const contrast = await page.evaluate(() => {
  const parse = (rgb) => rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const rel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);
  const bg = parse(getComputedStyle(document.getElementById('stage-doc')).backgroundColor === 'rgba(0, 0, 0, 0)'
    ? 'rgb(23, 19, 15)'
    : getComputedStyle(document.getElementById('stage-doc')).backgroundColor);
  const out = [];
  for (const el of document.querySelectorAll('.doc-layer')) {
    const fg = parse(getComputedStyle(el).color);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({ type: el.dataset.type, color: getComputedStyle(el).color, ratio: +ratio.toFixed(2) });
  }
  return out;
});

await browser.close();

const failing = report.filter((r) => r.error || r.dynamicRange < 20);
const lowContrast = contrast.filter((c) => c.ratio < 3);

fs.writeFileSync(
  path.join(OUT, 'audit.json'),
  JSON.stringify({ layers: report, contrast }, null, 2)
);

console.log('layer audit');
for (const r of report) {
  console.log(
    `  ${r.type.padEnd(8)} ${String(r.name).padEnd(8)} box ${r.error ? 'ERR' : `${r.box.w}x${r.box.h}`}  palette ${r.paletteSize ?? '-'}  range ${r.dynamicRange ?? '-'}  luma ${r.meanLuma ?? '-'}  tracks ${r.tracks.join('/')}`
  );
}
console.log('\ncontrast (vs stage surface)');
for (const c of contrast) console.log(`  ${c.type.padEnd(8)} ${c.color.padEnd(20)} ${c.ratio}:1`);

if (failing.length) {
  console.error(`\nAUDIT FAILED: ${failing.length} layer(s) render nothing meaningful`, failing.map((f) => f.name));
  process.exit(1);
}
if (lowContrast.length) {
  console.error(`\nAUDIT FAILED: ${lowContrast.length} layer(s) below 3:1 contrast`, lowContrast);
  process.exit(1);
}

console.log('\nAUDIT OK');
