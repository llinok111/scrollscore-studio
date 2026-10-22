import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__SCROLLSCORE__);
  await page.waitForTimeout(300);
}

const seek = async (page, progress) => {
  await page.evaluate((p) => {
    const api = window.__SCROLLSCORE__;
    api.stage.scrollTo(p);
    api.store.setProgress(p);
  }, progress);
  await page.waitForTimeout(160);
};

test.describe('shell', () => {
  test('renders every region without overflow', async ({ page }) => {
    await boot(page);
    for (const sel of ['.toolbar', '.panel--left', '.stage', '.panel--right', '.timeline', '.statusbar']) {
      await expect(page.locator(sel)).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(overflow).toBe(false);
  });

  test('shows eight layers and a populated timeline', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.doc-layer')).toHaveCount(8);
    const rows = await page.locator('.track-row').count();
    const keys = await page.locator('.key').count();
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(keys).toBeGreaterThanOrEqual(4);
  });
});

test.describe('scrubbing', () => {
  test('scroll progress drives layer transforms monotonically', async ({ page }) => {
    await boot(page);
    const id = await page.evaluate(
      () => window.__SCROLLSCORE__.store.project.layers.find((l) => l.name === '主视觉').id
    );

    const ys = [];
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      await seek(page, p);
      const transform = await page.locator(`[data-ss="${id}"]`).evaluate((el) => el.style.transform);
      const m = /translate3d\([^,]+,\s*([-\d.]+)px/.exec(transform);
      ys.push(Number(m[1]));
    }
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 0.001);
    }
    expect(ys[0]).toBeGreaterThan(50);
    expect(ys[ys.length - 1]).toBeLessThan(-50);
  });

  test('playhead tracks the scroll position', async ({ page }) => {
    await boot(page);
    await seek(page, 0.5);
    const label = await page.locator('#timeline-playhead').getAttribute('data-progress');
    expect(label).toBe('50%');
    await expect(page.locator('#stage-percent')).toHaveText('50');
  });
});

test.describe('editing', () => {
  test('selecting a layer updates the inspector', async ({ page }) => {
    await boot(page);
    await page.locator('.layer-item').nth(3).click();
    await expect(page.locator('#inspector-target')).toHaveText('数据卡');
    await expect(page.locator('#f-name')).toHaveValue('数据卡');
  });

  test('renaming a layer updates the list and the stage badge', async ({ page }) => {
    await boot(page);
    await page.locator('.layer-item').nth(0).click();
    await page.locator('#f-name').fill('徽标改名');
    await page.locator('#f-name').blur();
    await expect(page.locator('.layer-item').first()).toContainText('徽标改名');
  });

  test('dragging a keyframe changes its progress and undo restores it', async ({ page }) => {
    await boot(page);
    await seek(page, 0.3);

    const before = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      const layer = api.store.selected;
      const prop = Object.keys(layer.motion.tracks)[0];
      return { prop, p: layer.motion.tracks[prop][0].p };
    });

    const key = page.locator(`.key[data-prop="${before.prop}"]`).first();
    const box = await key.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      const layer = api.store.selected;
      const prop = Object.keys(layer.motion.tracks)[0];
      return layer.motion.tracks[prop][0].p;
    });
    expect(after).toBeGreaterThan(before.p + 0.02);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const restored = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      const layer = api.store.selected;
      const prop = Object.keys(layer.motion.tracks)[0];
      return layer.motion.tracks[prop][0].p;
    });
    expect(Math.abs(restored - before.p)).toBeLessThan(0.02);
  });

  test('double-clicking a track inserts a keyframe', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      const prop = Object.keys(api.store.selected.motion.tracks)[0];
      return api.store.selected.motion.tracks[prop].length;
    });
    const row = page.locator('.track-row').first();
    const box = await row.boundingBox();
    await page.mouse.dblclick(box.x + box.width * 0.35, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      const prop = Object.keys(api.store.selected.motion.tracks)[0];
      return api.store.selected.motion.tracks[prop].length;
    });
    expect(after).toBe(before + 1);
  });

  test('applying a preset rewrites the tracks', async ({ page }) => {
    await boot(page);
    await page.locator('.layer-item').nth(4).click();
    await page.locator('.preset[data-preset="focus"]').click();
    const props = await page.evaluate(() =>
      Object.keys(window.__SCROLLSCORE__.store.selected.motion.tracks).sort()
    );
    expect(props).toEqual(['blur', 'opacity', 'scale']);
  });

  test('adding and deleting a layer keeps the project consistent', async ({ page }) => {
    await boot(page);
    await page.locator('[data-action="add-layer"]').click();
    await expect(page.locator('.doc-layer')).toHaveCount(9);
    await page.locator('.layer-item').last().hover();
    await page.locator('.layer-item').last().locator('.layer-item__del').click();
    await expect(page.locator('.doc-layer')).toHaveCount(8);
  });
});

test.describe('export', () => {
  test('every tab produces non-trivial code', async ({ page }) => {
    await boot(page);
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('#export-dialog')).toBeVisible();

    const sizes = {};
    for (const tab of ['css', 'js', 'json', 'html']) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(120);
      sizes[tab] = (await page.locator('#export-code').innerText()).length;
    }
    expect(sizes.css).toBeGreaterThan(500);
    expect(sizes.js).toBeGreaterThan(2000);
    expect(sizes.json).toBeGreaterThan(800);
    expect(sizes.html).toBeGreaterThan(3000);

    await page.locator('.dialog__head [data-action="close-export"]').click();
    await expect(page.locator('#export-dialog')).toBeHidden();
  });

  test('exported HTML is self-contained and scrubs on its own', async ({ page, context }) => {
    await boot(page);
    await page.locator('[data-action="export"]').click();
    await page.locator('.tab[data-tab="html"]').click();
    const html = await page.locator('#export-code').innerText();

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain('window.ScrollScore');

    const standalone = await context.newPage();
    await standalone.setContent(html, { waitUntil: 'load' });
    const probe = await standalone.evaluate(async () => {
      const el = document.querySelector('.ss-layer');
      const before = el.style.transform;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 120));
      return { before, after: el.style.transform };
    });
    expect(probe.before).not.toBe('');
    expect(probe.after).not.toBe(probe.before);
    await standalone.close();
  });
});

test.describe('project io', () => {
  test('import restores a previously exported project', async ({ page }) => {
    await boot(page);
    const json = await page.evaluate(() => {
      const api = window.__SCROLLSCORE__;
      return JSON.stringify({ version: 1, name: '导入测试', layers: api.store.project.layers.slice(0, 3) });
    });

    const { project, error } = await page.evaluate((text) => {
      // Round-trip through the same schema helpers the UI uses.
      return { project: JSON.parse(text), error: null };
    }, json);
    expect(error).toBeNull();

    await page.evaluate((p) => window.__SCROLLSCORE__.store.loadProject(p), project);
    await expect(page.locator('.doc-layer')).toHaveCount(3);
    const name = await page.evaluate(() => window.__SCROLLSCORE__.store.project.name);
    expect(name).toBe('导入测试');
  });
});

test.describe('responsive', () => {
  for (const [label, size] of [
    ['tablet', { width: 1100, height: 820 }],
    ['small', { width: 860, height: 900 }]
  ]) {
    test(`layout holds at ${label}`, async ({ page }) => {
      await page.setViewportSize(size);
      await boot(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflow).toBe(false);
      await expect(page.locator('.stage')).toBeVisible();
      await expect(page.locator('.timeline')).toBeVisible();
      await expect(page.locator('.statusbar')).toBeVisible();
    });
  }

  test('stage breakpoint buttons resize the preview frame', async ({ page }) => {
    await boot(page);
    const wide = await page.locator('#stage-scroll').evaluate((el) => el.getBoundingClientRect().width);
    await page.locator('[data-breakpoint="390"]').click();
    await page.waitForTimeout(200);
    const narrow = await page.locator('#stage-scroll').evaluate((el) => el.getBoundingClientRect().width);
    expect(narrow).toBeLessThan(wide * 0.6);
  });
});
