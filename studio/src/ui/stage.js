/**
 * ScrollScore Studio — stage
 *
 * Owns the scrollable preview surface, the DOM mirror of every layer, and the
 * live scrub engine that drives it. The stage is a *scoped* scroller: the
 * engine is given a `scrollSource` instead of reading `window`, which keeps the
 * rest of the studio (timeline, inspector) perfectly still while the document
 * scrolls.
 */
import { createScrubEngine } from '@scrub/engine.js';

const DESIGN_WIDTH = 1280;
// Breathing room below the last layer. Kept small so the end of the scroll
// still shows content instead of a blank band.

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Allow a tiny inline subset so layer copy can break lines and emphasise words,
 * while everything else (including script tags) is neutralised. The studio is a
 * local tool, but exported HTML is meant to be pasted into real pages.
 */
const ALLOWED_INLINE = /<\/?(?:br|b|i|em|strong|span|small)\s*\/?>/gi;

function sanitizeInline(value) {
  const raw = String(value ?? '');
  const parts = [];
  let last = 0;
  let match;
  ALLOWED_INLINE.lastIndex = 0;
  while ((match = ALLOWED_INLINE.exec(raw)) !== null) {
    parts.push(escapeHtml(raw.slice(last, match.index)));
    parts.push(match[0].toLowerCase().replace(/\s*\/>$/, '>'));
    last = match.index + match[0].length;
  }
  parts.push(escapeHtml(raw.slice(last)));
  return parts.join('').replace(/\n/g, '<br/>');
}

const px = (v) => `calc(${v}px * var(--ss-scale))`;

function panelMarkup(content) {
  const lines = String(content || '').split('\n');
  const [label = '', value = '', hint = ''] = lines;
  return `<div class="panel-inner">
    <span class="panel-inner__label">${escapeHtml(label)}</span>
    <strong class="panel-inner__value">${escapeHtml(value)}</strong>
    <span class="panel-inner__hint">${escapeHtml(hint)}</span>
  </div>`;
}

function layerMarkup(layer) {
  const s = layer.style;
  const style = [
    `left:${px(s.x)}`,
    `top:${px(s.y)}`,
    `width:${px(s.w)}`,
    `height:${px(s.h)}`,
    `font-size:${px(s.fontSize)}`,
    `color:${s.color}`,
    s.background && s.background !== 'transparent' ? `background:${s.background}` : '',
    s.radius ? `border-radius:${px(s.radius)}` : '',
    `text-align:${s.align}`
  ]
    .filter(Boolean)
    .join(';');

  const inner =
    layer.type === 'panel'
      ? panelMarkup(layer.content)
      : sanitizeInline(layer.content);

  return `<div class="doc-layer" data-type="${layer.type}" data-ss="${layer.id}" style="${style}">${inner}</div>`;
}

export function createStage({ store, els, onMetrics }) {
  const scrollEl = els.scroll;
  const docEl = els.doc;
  const frameEl = els.frame;
  const sizeEl = els.size;
  const percentEl = els.percent;

  let signature = '';
  let designHeight = 2200;
  let contentBottom = 1390;
  let rafPending = false;
  let started = false;

  const engine = createScrubEngine({
    scrollSource: () => ({
      scrollY: scrollEl.scrollTop,
      viewportH: scrollEl.clientHeight,
      docH: docEl.scrollHeight
    }),
    onFrame: (metrics) => {
      // Push progress back into the store from the single rAF authority, so the
      // timeline playhead and the layers can never drift apart.
      const span = scrollEl.scrollHeight - scrollEl.clientHeight;
      const p = span > 0 ? scrollEl.scrollTop / span : 0;
      if (Math.abs(p - store.progress) > 0.0005) store.setProgress(p);
      if (onMetrics) onMetrics(metrics);
    }
  });

  function computeScale() {
    const available = frameEl.clientWidth - 36;
    return Math.max(0.24, Math.min(1, available / DESIGN_WIDTH));
  }

  function applyScale() {
    const scale = computeScale();
    document.documentElement.style.setProperty('--ss-scale', String(scale));
    // Tail length = exactly one viewport, so 100% progress shows the last layer
    // flush with the bottom of the stage rather than empty canvas.
    const viewportH = scrollEl.clientHeight || 600;
    designHeight = Math.max(1200, contentBottom + viewportH / scale);
    docEl.style.height = px(designHeight);
    sizeEl.textContent = `${DESIGN_WIDTH} × ${Math.round(designHeight)}  @${Math.round(scale * 100)}%`;
  }

  function build(project) {
    contentBottom = Math.max(
      900,
      project.layers.reduce((max, l) => Math.max(max, l.style.y + l.style.h), 0)
    );

    docEl.innerHTML =
      '<div class="stage__doc-grid" aria-hidden="true"></div>' +
      project.layers.map(layerMarkup).join('');

    applyScale();
    syncEngine(project);
    applySelection();
  }

  function syncEngine(project) {
    engine.clear();
    for (const layer of project.layers) {
      const node = docEl.querySelector(`[data-ss="${layer.id}"]`);
      if (!node) continue;
      engine.register({
        id: layer.id,
        node,
        mode: layer.motion.mode,
        range: layer.motion.range,
        ease: layer.motion.ease,
        offset: layer.motion.offset,
        pin: layer.motion.pin,
        tracks: layer.motion.tracks
      });
    }
    engine.measure();
    engine.tick();
    if (!started) {
      started = true;
      engine.start();
    }
  }

  function applySelection() {
    const id = store.selectedId;
    for (const node of docEl.querySelectorAll('.doc-layer')) {
      node.classList.toggle('is-selected', node.getAttribute('data-ss') === id);
    }
  }

  /** Structure signature: rebuild only when markup would actually change. */
  function computeSignature(project) {
    return project.layers
      .map((l) => `${l.id}:${l.type}:${JSON.stringify(l.style)}:${l.content}`)
      .join('|');
  }

  function render(project) {
    const next = computeSignature(project);
    if (next !== signature) {
      signature = next;
      build(project);
      return;
    }
    // Motion-only change: update entries in place, keep DOM and scroll offset.
    syncEngine(project);
    applySelection();
  }

  function scrollTo(progress) {
    const span = scrollEl.scrollHeight - scrollEl.clientHeight;
    scrollEl.scrollTop = Math.max(0, Math.min(span, progress * span));
    engine.tick();
  }

  function resetScroll() {
    scrollEl.scrollTop = 0;
    engine.tick();
    store.setProgress(0);
  }

  function setAutoplay(on) {
    if (on) {
      const step = () => {
        if (!scrollEl.dataset.autoplay) return;
        const span = scrollEl.scrollHeight - scrollEl.clientHeight;
        const next = scrollEl.scrollTop + Math.max(1.2, span / 900);
        if (next >= span) {
          scrollEl.scrollTop = span;
          delete scrollEl.dataset.autoplay;
          els.autoplayToggle.checked = false;
          return;
        }
        scrollEl.scrollTop = next;
        requestAnimationFrame(step);
      };
      scrollEl.dataset.autoplay = '1';
      requestAnimationFrame(step);
    } else {
      delete scrollEl.dataset.autoplay;
    }
  }

  function tick() {
    engine.tick();
  }

  function updatePercent(value) {
    percentEl.textContent = String(Math.round(value * 100));
  }

  window.addEventListener('resize', () => {
    applyScale();
    engine.measure();
    engine.tick();
  });

  return {
    engine,
    render,
    applySelection,
    scrollTo,
    resetScroll,
    setAutoplay,
    tick,
    updatePercent,
    applyScale
  };
}
