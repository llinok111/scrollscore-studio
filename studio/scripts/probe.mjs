import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.env.SS_URL || 'http://localhost:4180/';
const OUT = process.argv[2] || 'docs/shots';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, args: ['--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/01-overview.png` });

console.log('errors:', JSON.stringify(errors, null, 2));

// Scroll the stage to 42% and shoot again
await page.evaluate(() => {
  const scroll = document.getElementById('stage-scroll');
  const span = scroll.scrollHeight - scroll.clientHeight;
  scroll.scrollTop = span * 0.42;
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/02-scrolled.png` });

// Read a probe of computed styles
const probe = await page.evaluate(() => {
  const api = window.__SCROLLSCORE__;
  const layer = api.store.project.layers.find((l) => l.name === '主标题');
  const node = document.querySelector(`[data-ss="${layer.id}"]`);
  return {
    progress: api.store.progress,
    transform: node.style.transform,
    letterSpacing: node.style.letterSpacing,
    clipPath: node.style.clipPath,
    metrics: api.stage.engine.metrics
  };
});
console.log('probe:', JSON.stringify(probe, null, 2));

await browser.close();
