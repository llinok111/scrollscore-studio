import { test, expect } from '@playwright/test';

/**
 * Upstream compatibility suite.
 *
 * Runs against /upstream.html — a page that loads the unmodified AOS build the
 * same way a host site would (window scrolling, no studio shell). These cases
 * are the guard rail for the fork: if a refactor ever changes `data-aos`
 * semantics, this file fails first.
 */

async function boot(page) {
  await page.goto('/upstream.html');
  await page.waitForFunction(() => !!window.__AOS__);
  await page.waitForTimeout(250);
}

const scrollTo = async (page, ratio) => {
  await page.evaluate((r) => {
    const span = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, span * r));
  }, ratio);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  await page.waitForTimeout(120);
};

test.describe('upstream AOS behaviour (unchanged)', () => {
  test('data-aos gets aos-init, then aos-animate once in view', async ({ page }) => {
    await boot(page);

    const before = await page.locator('#aos-probe').evaluate((el) => ({
      init: el.classList.contains('aos-init'),
      animate: el.classList.contains('aos-animate')
    }));
    expect(before.init).toBe(true);
    expect(before.animate).toBe(false);

    // AOS throttles its scroll handler, so give the observer a beat to run.
    await page.evaluate(() =>
      document.getElementById('aos-probe').scrollIntoView({ block: 'center' })
    );
    await page.waitForTimeout(450);
    const after = await page.locator('#aos-probe').evaluate((el) =>
      el.classList.contains('aos-animate')
    );
    expect(after).toBe(true);
  });

  test('global easing/duration attributes are written on body', async ({ page }) => {
    await boot(page);
    const attrs = await page.evaluate(() => ({
      easing: document.body.getAttribute('data-aos-easing'),
      duration: document.body.getAttribute('data-aos-duration')
    }));
    expect(attrs.easing).toBe('ease');
    expect(attrs.duration).toBe('300');
  });

  test('the binary path never writes inline transforms', async ({ page }) => {
    await boot(page);
    await scrollTo(page, 0.1);
    const transform = await page.locator('#aos-probe').evaluate((el) => el.style.transform);
    expect(transform).toBe('');
  });

  test('refresh and refreshHard remain callable', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => {
      try {
        window.__AOS__.refresh();
        window.__AOS__.refreshHard();
        return 'ok';
      } catch (err) {
        return String(err);
      }
    });
    expect(result).toBe('ok');
  });
});

test.describe('ScrollScore opt-in entry points', () => {
  test('declarative data-aos-scrub drives continuous progress', async ({ page }) => {
    await boot(page);
    const el = page.locator('#scrub-probe');

    await scrollTo(page, 0);
    const top = await el.evaluate((node) => ({
      transform: node.style.transform,
      opacity: node.style.opacity
    }));
    expect(top.transform).toBe('translate3d(0px, 300px, 0px) scale(0.6)');
    expect(top.opacity).toBe('0');

    await scrollTo(page, 0.5);
    const mid = await el.evaluate((node) => ({
      transform: node.style.transform,
      opacity: node.style.opacity
    }));
    // The scroll container rounds to whole pixels, so progress at "50%" is only
    // approximate. Assert the interpolation within one pixel of tolerance.
    const y = Number(/translate3d\(0px, ([\d.]+)px/.exec(mid.transform)[1]);
    const scale = Number(/scale\(([\d.]+)\)/.exec(mid.transform)[1]);
    expect(y).toBeGreaterThan(148);
    expect(y).toBeLessThan(152);
    expect(scale).toBeCloseTo(0.8, 2);
    expect(Number(mid.opacity)).toBeCloseTo(0.5, 2);

    await scrollTo(page, 1);
    const bottom = await el.evaluate((node) => ({
      transform: node.style.transform,
      opacity: node.style.opacity
    }));
    expect(bottom.transform).toBe('translate3d(0px, 0px, 0px) scale(1)');
    expect(bottom.opacity).toBe('1');
  });

  test('a mapped range holds the value outside its window', async ({ page }) => {
    await boot(page);
    const el = page.locator('#scrub-card');

    await scrollTo(page, 0.05); // before 20%
    const before = await el.evaluate((node) => node.style.clipPath);
    // Chromium normalises the zero lengths to 0px.
    expect(before.replace(/0px/g, '0')).toBe('inset(0 100% 0 0)');

    await scrollTo(page, 0.5); // inside the window
    const inside = await el.evaluate((node) => node.style.clipPath);
    expect(inside).not.toBe(before);

    await scrollTo(page, 0.95); // after 80%
    const after = await el.evaluate((node) => node.style.clipPath);
    expect(after.replace(/0px/g, '0')).toBe('inset(0 0% 0 0)');
  });

  test('AOS.scrub() accepts a selector-based config', async ({ page }) => {
    await boot(page);

    const result = await page.evaluate(async () => {
      const el = document.createElement('div');
      el.className = 'cfg-probe';
      el.style.cssText = 'position:fixed;top:0;left:0;width:50px;height:50px';
      document.body.appendChild(el);

      const engine = window.__AOS__.scrub({
        entries: [
          {
            target: '.cfg-probe',
            mode: 'page',
            range: [0, 1],
            tracks: { scale: [{ p: 0, v: 1 }, { p: 1, v: 3 }] }
          }
        ]
      });

      const read = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.style.transform)))
        );

      window.scrollTo(0, 0);
      const atTop = await read();

      const span = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, span);
      const atBottom = await read();

      engine.destroy();
      el.remove();
      return { atTop, atBottom };
    });

    expect(result.atTop).toBe('scale(1)');
    expect(result.atBottom).toBe('scale(3)');
  });

  test('AOS.scrub() fans a selector out to every match', async ({ page }) => {
    await boot(page);
    const count = await page.evaluate(async () => {
      const host = document.createElement('div');
      for (let i = 0; i < 3; i += 1) {
        const el = document.createElement('span');
        el.className = 'fan-probe';
        host.appendChild(el);
      }
      document.body.appendChild(host);

      const engine = window.__AOS__.scrub({
        entries: [{ target: '.fan-probe', mode: 'page', tracks: { opacity: [{ p: 0, v: 1 }, { p: 1, v: 0 }] } }]
      });
      // The page already registers its own [data-aos-scrub] nodes, so measure
      // the delta rather than the absolute count.
      const registered = engine.entries.filter((e) => e.node.classList.contains('fan-probe')).length;
      engine.destroy();
      host.remove();
      return registered;
    });
    expect(count).toBe(3);
  });

  test('reduced motion snaps to the resting keyframe', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);

    const result = await page.evaluate(async () => {
      const el = document.createElement('div');
      el.className = 'rm-probe';
      el.style.cssText = 'position:fixed;top:0;left:0;width:50px;height:50px';
      document.body.appendChild(el);

      const engine = window.__AOS__.scrub({
        entries: [
          {
            target: '.rm-probe',
            mode: 'page',
            range: [0, 1],
            tracks: { y: [{ p: 0, v: 200 }, { p: 1, v: 0 }] }
          }
        ]
      });
      window.scrollTo(0, 0);
      const transform = await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.style.transform)))
      );
      engine.destroy();
      el.remove();
      return transform;
    });

    expect(result).toBe('translate3d(0px, 0px, 0px)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
});
