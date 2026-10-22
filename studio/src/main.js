/**
 * ScrollScore Studio — application entry
 */
import './styles/tokens.css';
import './styles/app.css';
import './styles/timeline.css';

import { createStore } from './core/store.js';
import { createDemoProject } from './preview/content.js';
import { createStage } from './ui/stage.js';
import { createTimeline } from './ui/timeline.js';
import { createInspector } from './ui/inspector.js';
import { createLayerList } from './ui/layers.js';
import { createExportDialog, download } from './ui/exportDialog.js';
import { parseProject, serializeProject } from '@scrub/schema.js';
// The upstream AOS build is loaded so the extension can be exercised against the
// real class-based API (see tests/e2e/upstream.spec.js), and so the studio can
// double as a live demo of the untouched `data-aos` behaviour.
import AOS from '@aos';

window.__AOS__ = AOS;

const $ = (id) => document.getElementById(id);

/* --------------------------------- toast --------------------------------- */

const toastStack = $('toast-stack');
export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 180ms ease, transform 180ms ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

/* --------------------------------- store --------------------------------- */

const store = createStore(createDemoProject());
// Start on the headline: it carries the richest track set, so the timeline has
// something worth looking at on first paint.
if (store.project.layers[1]) store.select(store.project.layers[1].id);

/* ---------------------------------- ui ----------------------------------- */

const stage = createStage({
  store,
  els: {
    scroll: $('stage-scroll'),
    doc: $('stage-doc'),
    frame: $('stage-frame'),
    size: $('stage-size'),
    percent: $('stage-percent'),
    autoplayToggle: $('autoplay')
  },
  onMetrics: (metrics) => {
    latestMetrics = metrics;
  }
});

let latestMetrics = null;

const timeline = createTimeline({
  store,
  els: {
    body: $('timeline-body'),
    gutter: $('timeline-gutter'),
    canvas: $('timeline-canvas'),
    ruler: $('timeline-ruler'),
    tracks: $('timeline-tracks'),
    playhead: $('timeline-playhead'),
    sub: $('timeline-sub')
  },
  onSeek: (progress) => {
    stage.scrollTo(progress);
    store.setProgress(progress);
  }
});

const inspector = createInspector({
  store,
  els: { inspector: $('inspector'), target: $('inspector-target') },
  onTrackFocus: (prop) => {
    store.setActiveProp(prop);
  }
});

const layerList = createLayerList({ store, els: { list: $('layer-list'), presets: $('preset-grid') }, toast });

const exportDialog = createExportDialog({
  store,
  els: {
    dialog: $('export-dialog'),
    tabs: $('export-tabs'),
    code: $('export-code'),
    note: $('export-note'),
    meta: $('export-meta')
  },
  toast
});

/* -------------------------------- render --------------------------------- */

function renderAll() {
  layerList.render();
  inspector.render();
  timeline.render();
  stage.render(store.project);
  stage.updatePercent(store.progress);
}

store.subscribe((api, reason) => {
  switch (reason) {
    case 'progress':
      timeline.renderPlayhead(api.progress);
      stage.updatePercent(api.progress);
      if (!document.hidden) stage.tick();
      break;
    case 'select':
    case 'load':
    case 'undo':
    case 'redo':
      renderAll();
      break;
    case 'move-key':
    case 'normalize-track':
    case 'gesture':
    case 'update':
      timeline.render();
      stage.render(store.project);
      stage.tick();
      break;
    case 'active-prop':
      timeline.refreshActive();
      break;
    case 'clean':
      break;
    default:
      renderAll();
      break;
  }
});

renderAll();

/* ------------------------------- statusbar ------------------------------- */

const statusFps = $('status-fps');
const statusFrame = $('status-frame');
const statusWrites = $('status-writes');
const statusSkips = $('status-skips');
const statusTracks = $('status-tracks');
const statusDot = document.querySelector('.statusbar .dot');

setInterval(() => {
  if (!latestMetrics) return;
  const fps = Math.round(latestMetrics.fps || 0);
  statusFps.textContent = `${fps} fps`;
  statusFrame.textContent = latestMetrics.lastFrameMs.toFixed(2);
  statusWrites.textContent = String(latestMetrics.writes);
  statusSkips.textContent = String(latestMetrics.skips);
  statusTracks.textContent = String(latestMetrics.lastActiveTracks);
  statusDot.classList.toggle('is-warn', latestMetrics.avgFrameMs > 4);
}, 240);

/* -------------------------------- toolbar -------------------------------- */

const importInput = $('import-input');

// Delegated at document level: the toolbar and the left panel both expose
// actions, and new panels may be added later.
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  // The export dialog owns its own action namespace.
  if (btn.closest('#export-dialog')) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'new':
      store.loadProject(createDemoProject());
      stage.resetScroll();
      toast('已新建示例工程', 'ok');
      break;
    case 'import':
      importInput.click();
      break;
    case 'save':
      download(
        `${store.project.name || 'scrollscore'}.json`,
        serializeProject(store.project),
        'application/json'
      );
      toast('工程 JSON 已下载', 'ok');
      break;
    case 'undo':
      if (!store.undo()) toast('没有可撤销的操作', 'warn');
      break;
    case 'redo':
      if (!store.redo()) toast('没有可重做的操作', 'warn');
      break;
    case 'reset-scroll':
      stage.resetScroll();
      break;
    case 'export':
      exportDialog.open();
      break;
    case 'add-layer': {
      const layer = store.addLayer({ name: `图层 ${store.project.layers.length + 1}` });
      toast(`已添加「${layer.name}」`, 'ok');
      break;
    }
    case 'add-key': {
      const layer = store.selected;
      const prop = store.activeProp;
      if (!layer) {
        toast('先选中一个图层', 'warn');
        break;
      }
      if (!prop) {
        toast('先在时间轴左侧选一条轨道', 'warn');
        break;
      }
      store.addKeyframe(layer.id, prop, store.progress);
      toast(`已在 ${Math.round(store.progress * 100)}% 添加关键帧`, 'ok');
      break;
    }
    case 'clear-keys': {
      const layer = store.selected;
      if (!layer) break;
      store.clearTracks(layer.id);
      toast('已清空该图层的轨道', 'warn');
      break;
    }
    default:
      break;
  }
});

importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  if (!file) return;
  const text = await file.text();
  const { project, error } = parseProject(text);
  if (error) {
    toast(error === 'invalid-json' ? 'JSON 解析失败，已载入空工程' : '工程版本较新，已尽力兼容', 'err');
  } else {
    toast('工程已导入', 'ok');
  }
  store.loadProject(project);
  stage.resetScroll();
  importInput.value = '';
});

/* ------------------------------- breakpoints ----------------------------- */

document.querySelectorAll('[data-breakpoint]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-breakpoint]').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const width = Number(btn.dataset.breakpoint);
    const frame = $('stage-frame');
    frame.style.setProperty('--stage-w', `${width}px`);
    stage.applyScale();
    stage.tick();
  });
});

/* -------------------------------- autoplay ------------------------------- */

$('autoplay').addEventListener('change', (event) => {
  stage.setAutoplay(event.target.checked);
});

/* -------------------------------- keyboard ------------------------------- */

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    download(
      `${store.project.name || 'scrollscore'}.json`,
      serializeProject(store.project),
      'application/json'
    );
    toast('工程 JSON 已下载', 'ok');
    return;
  }

  if (typing) return;

  if (event.code === 'Space') {
    event.preventDefault();
    const toggle = $('autoplay');
    toggle.checked = !toggle.checked;
    stage.setAutoplay(toggle.checked);
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = event.key === 'ArrowDown' ? step : -step;
    stage.scrollTo(Math.max(0, Math.min(1, store.progress + delta)));
  }
});

/* ------------------------------ mobile panels ---------------------------- */

if (window.matchMedia('(max-width: 820px)').matches) {
  document.querySelector('.stage').addEventListener('dblclick', () => {
    $('panel-left').classList.toggle('is-open');
  });
}

/* --------------------------- test / debug surface ------------------------ */

window.__SCROLLSCORE__ = {
  store,
  stage,
  timeline,
  inspector,
  exportDialog,
  version: '1.0.0'
};
