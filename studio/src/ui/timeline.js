/**
 * ScrollScore Studio — scroll timeline
 *
 * The horizontal axis is scroll progress, not time. That single inversion is
 * what makes the tool legible: dragging a keyframe to 40% means "this value is
 * reached at 40% of the way through the scroll", regardless of viewport height,
 * device speed, or how long the user takes to scroll there.
 *
 * Interactions
 *   click ruler / track      seek the preview
 *   drag keyframe            move it along the progress axis
 *   double-click track       insert a keyframe at that progress
 *   alt-click / right-click  delete a keyframe
 *   drag range handles       move the layer's mapping window
 */
import { PROPS } from '@scrub/keyframes.js';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const pct = (n) => `${(n * 100).toFixed(2)}%`;

export function createTimeline({ store, els, onSeek }) {
  const bodyEl = els.body;
  const gutterEl = els.gutter;
  const canvasEl = els.canvas;
  const rulerEl = els.ruler;
  const tracksEl = els.tracks;
  const playheadEl = els.playhead;
  const subEl = els.sub;

  let drag = null;

  function fractionFromEvent(event) {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((event.clientX - rect.left) / rect.width);
  }

  function renderRuler(layer) {
    const ticks = [];
    for (let i = 0; i <= 20; i += 1) {
      const p = i / 20;
      const major = i % 5 === 0;
      ticks.push(
        `<div class="ruler-tick ${major ? 'ruler-tick--major' : ''}" style="left:${pct(p)}"></div>`
      );
      if (major) {
        ticks.push(`<span class="ruler-label" style="left:${pct(p)}">${Math.round(p * 100)}%</span>`);
      }
    }

    const range = layer ? layer.motion.range : [0, 1];
    const handles = layer
      ? `<div class="ruler-range"></div>
         <div class="range-handle" data-handle="0" style="left:${pct(range[0])}" title="映射起点"></div>
         <div class="range-handle" data-handle="1" style="left:${pct(range[1])}" title="映射终点"></div>`
      : '';

    rulerEl.innerHTML = ticks.join('') + handles;
    bodyEl.style.setProperty('--range-a', pct(range[0]));
    bodyEl.style.setProperty('--range-b', pct(range[1]));
  }

  function renderTracks(layer) {
    if (!layer) {
      tracksEl.innerHTML = '';
      gutterEl.innerHTML = `<div class="gutter-empty">选中一个图层<br/>查看它的属性轨道</div>`;
      return;
    }
    const entries = Object.entries(layer.motion.tracks);
    if (entries.length === 0) {
      tracksEl.innerHTML = '';
      gutterEl.innerHTML = `<div class="gutter-empty">「${escapeHtml(
        layer.name
      )}」还没有轨道<br/>在右侧属性面板添加</div>`;
      return;
    }

    gutterEl.innerHTML = entries
      .map(([prop, keys]) => {
        const def = PROPS[prop];
        const active = store.activeProp === prop;
        return `<div class="gutter-row ${active ? 'is-active' : ''}" data-prop="${prop}" data-kind="${def.kind}" title="${prop}">
          <span class="gutter-row__name"><i class="gutter-row__swatch"></i>${def.label}
            <button class="gutter-row__remove" data-remove-track="${prop}" title="删除轨道" aria-label="删除 ${prop} 轨道">×</button>
          </span>
          <span class="gutter-row__value">${keys.length} 帧 · ${formatRange(keys)}</span>
        </div>`;
      })
      .join('');

    tracksEl.innerHTML = entries
      .map(([prop, keys]) => {
        const sorted = [...keys].sort((a, b) => a.p - b.p);
        const segs = [];
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const a = sorted[i];
          const b = sorted[i + 1];
          segs.push(
            `<div class="track-seg" style="left:${pct(a.p)};width:${pct(Math.max(0, b.p - a.p))}"></div>`
          );
        }
        const keysHtml = keys
          .map((key, index) => {
            const isSelected =
              store.activeProp === prop && Math.abs(key.p - store.progress) < 0.004;
            return `<button class="key ${isSelected ? 'is-selected' : ''}" data-prop="${prop}" data-index="${index}" style="left:${pct(
              key.p
            )}" aria-label="${PROPS[prop].label} 关键帧 ${Math.round(key.p * 100)}%">
              <span class="key__tip">${PROPS[prop].label} ${round(key.v)} @ ${Math.round(key.p * 100)}%</span>
            </button>`;
          })
          .join('');
        const active = store.activeProp === prop;
        return `<div class="track-row ${active ? 'is-active' : ''}" data-prop="${prop}">${segs}${keysHtml}</div>`;
      })
      .join('');
  }

  function renderPlayhead(progress) {
    playheadEl.style.left = pct(progress);
    playheadEl.dataset.progress = `${Math.round(progress * 100)}%`;
  }

  /**
   * Cheap highlight-only update. Used when the active property changes: a full
   * re-render would replace the DOM node currently under the pointer and break
   * pointer capture mid-drag.
   */
  function refreshActive() {
    for (const el of tracksEl.querySelectorAll('.track-row')) {
      el.classList.toggle('is-active', el.dataset.prop === store.activeProp);
    }
    for (const el of gutterEl.querySelectorAll('.gutter-row')) {
      el.classList.toggle('is-active', el.dataset.prop === store.activeProp);
    }
  }

  function render() {
    const layer = store.selected;
    renderRuler(layer);
    renderTracks(layer);
    renderPlayhead(store.progress);
    if (subEl) {
      const count = layer ? Object.keys(layer.motion.tracks).length : 0;
      subEl.textContent = layer
        ? `${layer.name} · ${count} 条轨道 · 播放头 ${Math.round(store.progress * 100)}%`
        : '0 – 100% 滚动进度';
    }
  }

  /* ------------------------------ gestures ------------------------------- */

  canvasEl.addEventListener('pointerdown', (event) => {
    const layer = store.selected;
    if (!layer) return;

    const keyEl = event.target.closest('.key');
    if (keyEl) {
      const prop = keyEl.dataset.prop;
      const index = Number(keyEl.dataset.index);

      if (event.altKey || event.button === 2) {
        store.removeKeyframe(layer.id, prop, index);
        return;
      }

      // Capture before any state change: the highlight update below must not
      // replace this node, otherwise the capture is lost mid-gesture.
      try {
        keyEl.setPointerCapture(event.pointerId);
      } catch (err) {
        /* capture is an optimisation; window listeners still receive moves */
      }
      keyEl.classList.add('is-dragging');
      drag = { type: 'key', prop, index, moved: false };
      store.beginTransaction();
      store.setActiveProp(prop);
      event.preventDefault();
      return;
    }

    const handle = event.target.closest('.range-handle');
    if (handle) {
      drag = { type: 'range', index: Number(handle.dataset.handle) };
      store.beginTransaction();
      event.preventDefault();
      return;
    }

    const row = event.target.closest('.track-row');
    const fraction = fractionFromEvent(event);
    if (row) store.setActiveProp(row.dataset.prop);
    if (onSeek) onSeek(fraction);
  });

  // Insert on a real dblclick rather than sniffing pointerdown detail, which
  // synthetic events (and some trackpads) report inconsistently.
  canvasEl.addEventListener('dblclick', (event) => {
    const layer = store.selected;
    const row = event.target.closest('.track-row');
    if (!layer || !row) return;
    store.addKeyframe(layer.id, row.dataset.prop, fractionFromEvent(event));
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const layer = store.selected;
    if (!layer) return;
    const fraction = fractionFromEvent(event);

    if (drag.type === 'key') {
      drag.moved = true;
      store.moveKeyframe(layer.id, drag.prop, drag.index, fraction);
      const el = tracksEl.querySelector(
        `.key[data-prop="${drag.prop}"][data-index="${drag.index}"]`
      );
      if (el) el.style.left = pct(fraction);
      if (onSeek) onSeek(fraction);
      return;
    }

    if (drag.type === 'range') {
      const range = [...layer.motion.range];
      range[drag.index] = fraction;
      const next = range[0] <= range[1] ? range : [range[1], range[0]];
      store.patchMotion(layer.id, { range: next }, 'range-drag');
    }
  });

  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const layer = store.selected;
    if (drag.type === 'key' && layer) {
      store.normalizeTrack(layer.id, drag.prop);
      const el = tracksEl.querySelector(`.key.is-dragging`);
      if (el) el.classList.remove('is-dragging');
    }
    drag = null;
    store.endTransaction('gesture');
  });

  canvasEl.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.key')) event.preventDefault();
  });

  gutterEl.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-track]');
    const layer = store.selected;
    if (!layer) return;
    if (remove) {
      store.removeTrack(layer.id, remove.dataset.removeTrack);
      return;
    }
    const row = event.target.closest('.gutter-row');
    if (row) store.setActiveProp(row.dataset.prop);
  });

  return { render, renderPlayhead, refreshActive };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatRange(keys) {
  const sorted = [...keys].sort((a, b) => a.p - b.p);
  if (sorted.length === 0) return '—';
  return `${round(sorted[0].v)} → ${round(sorted[sorted.length - 1].v)}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
