/**
 * Default stage document.
 *
 * A short editorial scroll story, sized for the 1280 x 800 desktop breakpoint.
 * Every layer starts with a different motion recipe so the timeline has
 * something meaningful to show on first paint.
 */
import { createLayer, MOTION_PRESETS } from '@scrub/schema.js';
import { normalizeKeys } from '@scrub/keyframes.js';

const preset = (name) => MOTION_PRESETS[name].build();

export function createDemoProject() {
  const badge = createLayer({
    name: '徽标',
    type: 'badge',
    content: 'ScrollScore / 001',
    style: { x: 84, y: 96, w: 180, h: 28, fontSize: 11, color: '#f2c986' },
    motion: { ...preset('fadeUp'), range: [0.02, 0.16] }
  });

  const title = createLayer({
    name: '主标题',
    type: 'heading',
    content: '把滚动<br/>变成乐谱',
    style: { x: 84, y: 148, w: 620, h: 168, fontSize: 68, color: '#f6ede1' },
    motion: {
      ...preset('reveal'),
      range: [0.05, 0.3],
      tracks: {
        ...preset('reveal').tracks,
        letterSpacing: normalizeKeys([
          { p: 0, v: 10 },
          { p: 0.6, v: 0, ease: 'ease-out-quart' }
        ])
      }
    }
  });

  const lede = createLayer({
    name: '导语',
    type: 'text',
    content:
      '上游 AOS 只会在元素进入视口时切换一个 class。<br/>这里把同一条滚动轴改造成可编排的时间轴：每个属性都有独立关键帧，滚动到哪儿，画面就到哪儿。',
    style: { x: 84, y: 336, w: 470, h: 96, fontSize: 17, color: '#c8b6a2' },
    motion: { ...preset('fadeUp'), range: [0.12, 0.34] }
  });

  const card = createLayer({
    name: '数据卡',
    type: 'panel',
    content: '关键帧密度\n24\n8 图层 · 6 条属性轨道',
    style: { x: 84, y: 462, w: 470, h: 186, radius: 18, background: 'transparent' },
    motion: { ...preset('focus'), range: [0.16, 0.4] }
  });

  const hero = createLayer({
    name: '主视觉',
    type: 'image',
    content: '',
    style: { x: 640, y: 300, w: 470, h: 348, radius: 22 },
    motion: {
      ...preset('parallax'),
      range: [0.04, 0.55],
      tracks: {
        y: normalizeKeys([{ p: 0, v: 120 }, { p: 1, v: -120 }]),
        scale: normalizeKeys([{ p: 0, v: 1.08 }, { p: 1, v: 0.96 }]),
        rotate: normalizeKeys([{ p: 0, v: -2.5 }, { p: 1, v: 1.5 }])
      }
    }
  });

  const chapter = createLayer({
    name: '第二章标题',
    type: 'heading',
    content: '每一帧<br/>都可回溯',
    style: { x: 84, y: 880, w: 560, h: 168, fontSize: 56, color: '#f6ede1' },
    motion: { ...preset('tilt'), range: [0.42, 0.62] }
  });

  const body = createLayer({
    name: '正文',
    type: 'text',
    content:
      '关键帧挂在滚动进度上，不是挂在秒数上。改窗口高度、换断点，节奏依然成立；导出后 CSS 与 JS 两条路径读的是同一份工程数据。',
    style: { x: 84, y: 1056, w: 470, h: 96, fontSize: 16, color: '#c8b6a2' },
    motion: { ...preset('fadeUp'), range: [0.5, 0.68] }
  });

  const closing = createLayer({
    name: '收尾卡',
    type: 'panel',
    content: '导出目标\nCSS / JS / HTML\n同一份工程数据，三种落地方式',
    style: { x: 84, y: 1180, w: 1026, h: 210, radius: 22 },
    motion: { ...preset('reveal'), range: [0.62, 0.86] }
  });

  return {
    version: 1,
    name: '滚动乐谱 · 示例工程',
    viewport: { width: 1280, height: 800 },
    layers: [badge, title, lede, card, hero, chapter, body, closing]
  };
}
