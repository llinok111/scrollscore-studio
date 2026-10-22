/**
 * ScrollScore Studio — inspector
 *
 * Property sheet for the selected layer: geometry, type styling, motion
 * parameters, and the per-property track list. Every control is delegated, so
 * re-rendering the panel never leaks listeners.
 */
import { PROPS, PROP_NAMES, EASE_NAMES, LAYER_TYPES, MOTION_PRESETS } from '@scrub/index.js';

const TYPE_LABELS = {
  heading: '标题',
  text: '正文',
  panel: '面板',
  image: '图像',
  badge: '徽标'
};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const trackSummary = (keys) => {
  if (!keys || keys.length === 0) return '—';
  const first = keys[0].v;
  const last = keys[keys.length - 1].v;
  return `${first} → ${last} · ${keys.length} 帧`;
};

export function createInspector({ store, els, onTrackFocus }) {
  const root = els.inspector;
  const badge = els.target;

  function render() {
    const layer = store.selected;
    if (!layer) {
      badge.textContent = '未选中';
      root.innerHTML = `<div class="empty-hint">左侧选择一个图层<br/>或点击 <b>+ 添加</b> 新建</div>`;
      return;
    }

    badge.textContent = layer.name;
    const s = layer.style;
    const m = layer.motion;
    const trackEntries = Object.entries(m.tracks);

    root.innerHTML = `
      <fieldset class="fieldset">
        <legend class="fieldset__legend">图层</legend>
        <div class="field">
          <label for="f-name">名称</label>
          <input class="input" id="f-name" data-scope="layer" data-key="name" value="${escapeAttr(layer.name)}" />
        </div>
        <div class="field">
          <label for="f-type">类型</label>
          <select class="select" id="f-type" data-scope="layer" data-key="type">
            ${LAYER_TYPES.map(
              (t) => `<option value="${t}" ${t === layer.type ? 'selected' : ''}>${TYPE_LABELS[t] || t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field field--stack">
          <label for="f-content">内容（\\n 换行）</label>
          <textarea class="textarea" id="f-content" data-scope="layer" data-key="content">${escapeHtml(
            layer.content
          )}</textarea>
        </div>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset__legend">几何 · 设计稿 1280 宽</legend>
        <div class="field">
          <label>位置</label>
          <div class="field__row">
            <input class="input input--num" type="number" data-scope="style" data-key="x" value="${s.x}" title="X" />
            <input class="input input--num" type="number" data-scope="style" data-key="y" value="${s.y}" title="Y" />
          </div>
        </div>
        <div class="field">
          <label>尺寸</label>
          <div class="field__row">
            <input class="input input--num" type="number" data-scope="style" data-key="w" value="${s.w}" title="宽" />
            <input class="input input--num" type="number" data-scope="style" data-key="h" value="${s.h}" title="高" />
          </div>
        </div>
        <div class="field">
          <label>字号</label>
          <input class="input input--num" type="number" data-scope="style" data-key="fontSize" value="${s.fontSize}" />
        </div>
        <div class="field">
          <label>圆角</label>
          <input class="input input--num" type="number" data-scope="style" data-key="radius" value="${s.radius}" />
        </div>
        <div class="field">
          <label>文字色</label>
          <input class="input input--color" type="color" data-scope="style" data-key="color" value="${toHex(
            s.color
          )}" />
        </div>
        <div class="field">
          <label>对齐</label>
          <div class="chip-row" data-scope="style" data-key="align">
            ${['left', 'center', 'right']
              .map(
                (a) =>
                  `<button class="chip ${s.align === a ? 'is-active' : ''}" data-value="${a}">${
                    a === 'left' ? '左' : a === 'center' ? '中' : '右'
                  }</button>`
              )
              .join('')}
          </div>
        </div>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset__legend">动效</legend>
        <div class="field">
          <label>预设</label>
          <select class="select" data-scope="preset">
            <option value="">— 选择预设 —</option>
            ${Object.entries(MOTION_PRESETS)
              .map(([key, p]) => `<option value="${key}">${p.label}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field">
          <label>进度基准</label>
          <select class="select" data-scope="motion" data-key="mode">
            <option value="page" ${m.mode === 'page' ? 'selected' : ''}>整页进度</option>
            <option value="element" ${m.mode === 'element' ? 'selected' : ''}>元素进出视口</option>
          </select>
        </div>
        <div class="field">
          <label>映射区间</label>
          <div class="range-row">
            <input class="input input--num" type="number" step="0.01" min="0" max="1" data-scope="motion" data-key="range" data-index="0" value="${m.range[0]}" />
            <span>→</span>
            <input class="input input--num" type="number" step="0.01" min="0" max="1" data-scope="motion" data-key="range" data-index="1" value="${m.range[1]}" />
          </div>
        </div>
        <div class="field">
          <label>缓动</label>
          <select class="select" data-scope="motion" data-key="ease">
            ${EASE_NAMES.map((name) => `<option value="${name}" ${m.ease === name ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>触发偏移</label>
          <input class="input input--num" type="number" step="10" data-scope="motion" data-key="offset" value="${m.offset}" title="仅元素模式生效，负值提前触发" />
        </div>
        <div class="field">
          <label>钉住 pin</label>
          <div class="field__row" style="align-items:center">
            <label class="switch" style="height:27px;flex:0 0 auto">
              <input type="checkbox" data-scope="pin-toggle" ${m.pin ? 'checked' : ''} />
              <span>启用</span>
            </label>
            <input class="input input--num" type="number" step="0.01" min="0" max="1" data-scope="pin" data-index="0" value="${m.pin ? m.pin[0] : 0.1}" ${m.pin ? '' : 'disabled'} />
            <input class="input input--num" type="number" step="0.01" min="0" max="1" data-scope="pin" data-index="1" value="${m.pin ? m.pin[1] : 0.5}" ${m.pin ? '' : 'disabled'} />
          </div>
        </div>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset__legend">属性轨道 · ${trackEntries.length}</legend>
        <div class="field field--stack">
          <div class="chip-row" data-scope="add-track">
            ${PROP_NAMES.filter((n) => !m.tracks[n])
              .map((n) => `<button class="chip" data-prop="${n}">+ ${PROPS[n].label}</button>`)
              .join('') || '<span class="empty-hint" style="padding:4px 0">全部属性已启用</span>'}
          </div>
        </div>
        ${
          trackEntries.length
            ? trackEntries
                .map(
                  ([prop, keys]) => `
          <div class="field" data-prop-row="${prop}">
            <label title="${prop}">${PROPS[prop].label}</label>
            <div class="field__row" style="align-items:center">
              <span class="gutter-row__value" style="flex:1">${trackSummary(keys)}</span>
              <button class="btn btn--tiny" data-scope="focus-track" data-prop="${prop}" title="在时间轴中聚焦">定位</button>
              <button class="btn btn--tiny" data-scope="remove-track" data-prop="${prop}" title="删除轨道">×</button>
            </div>
          </div>`
                )
                .join('')
            : `<div class="empty-hint" style="padding:10px 0">还没有轨道。<br/>选一个属性，或直接套用预设。</div>`
        }
      </fieldset>
    `;
  }

  function readNumber(input) {
    const raw = input.value.trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  root.addEventListener('input', (event) => {
    const el = event.target;
    const scope = el.dataset.scope;
    const layer = store.selected;
    if (!layer || !scope) return;

    if (scope === 'layer') {
      const key = el.dataset.key;
      if (key === 'name') store.patchLayer(layer.id, { name: el.value }, 'rename');
      if (key === 'content') store.patchLayer(layer.id, { content: el.value }, 'content');
      return;
    }

    if (scope === 'style') {
      const key = el.dataset.key;
      if (key === 'color') store.patchStyle(layer.id, { color: el.value }, 'color');
      else if (key === 'align') return;
      else store.patchStyle(layer.id, { [key]: readNumber(el) }, 'geometry');
      return;
    }

    if (scope === 'motion') {
      const key = el.dataset.key;
      if (key === 'range') {
        const index = Number(el.dataset.index);
        const next = [...layer.motion.range];
        next[index] = Math.max(0, Math.min(1, readNumber(el)));
        if (next[0] > next[1]) next.sort((a, b) => a - b);
        store.patchMotion(layer.id, { range: next }, 'range');
      } else if (key === 'offset') {
        store.patchMotion(layer.id, { offset: readNumber(el) }, 'offset');
      } else {
        store.patchMotion(layer.id, { [key]: el.value }, 'motion-option');
      }
      return;
    }

    if (scope === 'pin') {
      const index = Number(el.dataset.index);
      const current = layer.motion.pin || [0.1, 0.5];
      const next = [...current];
      next[index] = Math.max(0, Math.min(1, readNumber(el)));
      if (next[0] > next[1]) next.sort((a, b) => a - b);
      store.patchMotion(layer.id, { pin: next }, 'pin');
    }
  });

  root.addEventListener('change', (event) => {
    const el = event.target;
    const layer = store.selected;
    if (!layer) return;

    if (el.dataset.scope === 'layer' && el.dataset.key === 'type') {
      store.patchLayer(layer.id, { type: el.value }, 'type');
      return;
    }

    if (el.dataset.scope === 'preset' && el.value) {
      store.applyPreset(layer.id, el.value);
      el.value = '';
      return;
    }

    if (el.dataset.scope === 'pin-toggle') {
      store.patchMotion(
        layer.id,
        { pin: el.checked ? layer.motion.range.slice() : null },
        'pin-toggle'
      );
    }
  });

  root.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope="style"][data-key="align"] .chip');
    const layer = store.selected;
    if (!layer) return;

    if (chip) {
      store.patchStyle(layer.id, { align: chip.dataset.value }, 'align');
      return;
    }

    const addBtn = event.target.closest('[data-scope="add-track"] .chip');
    if (addBtn) {
      store.addKeyframe(layer.id, addBtn.dataset.prop, 0);
      return;
    }

    const removeBtn = event.target.closest('[data-scope="remove-track"]');
    if (removeBtn) {
      store.removeTrack(layer.id, removeBtn.dataset.prop);
      return;
    }

    const focusBtn = event.target.closest('[data-scope="focus-track"]');
    if (focusBtn && onTrackFocus) {
      onTrackFocus(focusBtn.dataset.prop);
    }
  });

  return { render };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function toHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#f6ede1';
}
