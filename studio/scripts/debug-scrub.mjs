import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: EDGE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:4180/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const out = await page.evaluate(async () => {
  const api = window.__SCROLLSCORE__;
  const scroll = document.getElementById('stage-scroll');
  const layer = api.store.project.layers.find((l) => l.name === '主视觉');
  const node = document.querySelector(`[data-ss="${layer.id}"]`);
  const log = [];

  for (const p of [0, 0.15, 0.3, 0.45, 0.6]) {
    api.stage.scrollTo(p);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const entry = api.stage.engine.entries.find((e) => e.id === layer.id);
    log.push({
      requested: p,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      engineDocH: api.stage.engine.state.docH,
      engineVpH: api.stage.engine.state.viewportH,
      engineScrollY: api.stage.engine.state.scrollY,
      entryProgress: entry ? entry.progress : null,
      mode: layer.motion.mode,
      range: layer.motion.range,
      transform: node.style.transform
    });
  }
  return { log, docElHeight: document.getElementById('stage-doc').getBoundingClientRect().height };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
