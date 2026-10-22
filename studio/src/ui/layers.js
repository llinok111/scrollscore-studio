/**
 * ScrollScore Studio — layer list and motion preset grid.
 */
import { MOTION_PRESETS } from '@scrub/index.js';

const GLYPHS = {
  heading: '<path d="M3 3h2v7h6V3h2v14h-2v-5H5v5H3z" fill="currentColor"/>',
  text: '<path d="M3 4h14v2H3zM3 8h14v2H3zM3 12h10v2H3z" fill="currentColor"/>',
  panel: '<rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 14l4-4 3 3 3-4 2 3" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  badge: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>'
};

export function createLayerList({ store, els, toast }) {
  const listEl = els.list;
  const presetEl = els.presets;

  function render() {
    const project = store.project;
    listEl.innerHTML = project.layers
      .map((layer) => {
        const selected = layer.id === store.selectedId;
        const trackCount = Object.keys(layer.motion.tracks || {}).length;
        return `<li class="layer-item ${selected ? 'is-selected' : ''}" role="option"
            aria-selected="${selected}" data-id="${layer.id}" tabindex="0">
          <span class="layer-item__glyph"><svg viewBox="0 0 20 20" width="14" height="14">${
            GLYPHS[layer.type] || GLYPHS.text
          }</svg></span>
          <span class="layer-item__name">${escapeHtml(layer.name)}</span>
          <span class="layer-item__meta">${trackCount}</span>
          <button class="layer-item__del" data-delete="${layer.id}" title="删除图层" aria-label="删除 ${escapeHtml(
            layer.name
          )}">
            <svg viewBox="0 0 14 14" width="11" height="11"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
        </li>`;
      })
      .join('');

    presetEl.innerHTML = Object.entries(MOTION_PRESETS)
      .map(
        ([key, preset]) =>
          `<button class="preset" data-preset="${key}">
            <span class="preset__name">${preset.label}</span>
            <span class="preset__hint">${hintFor(key)}</span>
          </button>`
      )
      .join('');
  }

  listEl.addEventListener('click', (event) => {
    const del = event.target.closest('[data-delete]');
    if (del) {
      event.stopPropagation();
      const layer = store.getLayer(del.dataset.delete);
      store.removeLayer(del.dataset.delete);
      toast(`已删除「${layer ? layer.name : '图层'}」`, 'warn');
      return;
    }
    const item = event.target.closest('.layer-item');
    if (item) store.select(item.dataset.id);
  });

  listEl.addEventListener('keydown', (event) => {
    const item = event.target.closest('.layer-item');
    if (!item) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      store.select(item.dataset.id);
    }
  });

  presetEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-preset]');
    if (!btn) return;
    const layer = store.selected;
    if (!layer) {
      toast('先选中一个图层，再套用预设', 'warn');
      return;
    }
    store.applyPreset(layer.id, btn.dataset.preset);
    toast(`已套用「${MOTION_PRESETS[btn.dataset.preset].label}」`, 'ok');
  });

  return { render };
}

function hintFor(key) {
  return {
    fadeUp: 'opacity · y',
    parallax: 'y · scale',
    reveal: 'clipX · x',
    focus: 'scale · blur',
    tilt: 'rotate · y',
    stickyChapter: 'pin · letterSpacing'
  }[key] || '';
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
