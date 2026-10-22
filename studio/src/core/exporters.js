/**
 * ScrollScore Studio — exporters
 *
 * Three targets, one source of truth:
 *
 *   CSS   `animation-timeline` keyframes. Zero JavaScript, degrades to the
 *         resting state when the browser lacks scroll-driven animations.
 *   JS    A self-contained ~5 KB runtime plus the project data. Works in every
 *         evergreen browser and is the only target that can express `pin`.
 *   HTML  A single file that opens straight from disk: runtime + markup + demo
 *         styling. Used for hand-off and for the screenshot harness.
 *
 * Everything is generated from the normalised project, so the CSS, the JS and
 * the studio preview can never disagree.
 */
import { composeStyles, PROPS, fmt } from '@scrub/keyframes.js';
import { resolveEase, AOS_PRESETS, TRUE_PRESETS } from '@scrub/easing.js';
import { normalizeProject } from '@scrub/schema.js';

const selectorFor = (layer) => `[data-ss="${layer.id}"]`;
const keyframeName = (layer) => `ss-${layer.id}`;

/** Union of every keyframe progress across all tracks of a layer. */
export function collectStops(tracks) {
  const set = new Set([0, 1]);
  for (const keys of Object.values(tracks || {})) {
    for (const key of keys) set.add(Math.round(key.p * 10000) / 10000);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Ease that governs the segment ending at `stop`. */
function easeForStop(keys, stop, fallback) {
  for (const key of keys) {
    if (Math.abs(key.p - stop) < 1e-6 && key.ease) return key.ease;
  }
  return fallback;
}

function cssEase(descriptor) {
  if (typeof descriptor === 'string') {
    const name = descriptor.trim();
    const parsed = /^cubic-bezier\(([^)]+)\)$/.exec(name);
    if (parsed) return `cubic-bezier(${parsed[1]})`;
    const pts = TRUE_PRESETS[name] || AOS_PRESETS[name];
    if (pts) return `cubic-bezier(${pts.map((n) => String(n)).join(', ')})`;
    return 'linear';
  }
  return 'linear';
}

function declarationsFor(payload) {
  const out = [];
  if (payload.transform) out.push(`transform: ${payload.transform};`);
  if (payload.opacity !== null) out.push(`opacity: ${payload.opacity};`);
  if (payload.filter) out.push(`filter: ${payload.filter};`);
  if (payload.clipPath) out.push(`clip-path: ${payload.clipPath};`);
  if (payload.radius !== null) out.push(`border-radius: ${payload.radius};`);
  if (payload.letterSpacing !== null) out.push(`letter-spacing: ${payload.letterSpacing};`);
  return out;
}

function timingFor(layer, stop, stops) {
  const tracks = layer.motion.tracks || {};
  const index = stops.indexOf(stop);
  if (index < 0 || index >= stops.length - 1) return null;
  const next = stops[index + 1];
  // A CSS keyframe's timing function shapes the segment *after* it, while our
  // model attaches easing to the key being arrived at. So the ease of the
  // upcoming key is the one to emit here.
  for (const keys of Object.values(tracks)) {
    const ease = easeForStop(keys, next, null);
    if (ease) return ease;
  }
  return layer.motion.ease || 'linear';
}

/**
 * Generate the CSS target.
 * @param {object} project
 * @returns {{code: string, warnings: string[]}}
 */
export function exportCSS(project) {
  const p = normalizeProject(project);
  const warnings = [];
  const blocks = [];

  for (const layer of p.layers) {
    const tracks = layer.motion.tracks || {};
    if (Object.keys(tracks).length === 0) continue;

    if (layer.motion.pin) {
      warnings.push(
        `图层「${layer.name}」使用了 pin（钉住），CSS 目标无法表达 sticky 容器，已导出为普通区间动画；需要钉住请使用 JS runtime。`
      );
    }

    const stops = collectStops(tracks);
    const frames = stops.map((stop) => {
      const payload = composeStyles(tracks, stop, layer.motion.ease);
      const decls = declarationsFor(payload).map((d) => `    ${d}`).join('\n');
      const timing = timingFor(layer, stop, stops);
      const timingLine = timing ? `\n    animation-timing-function: ${cssEase(timing)};` : '';
      return `  ${fmt(stop * 100)}% {\n${decls}${timingLine}\n  }`;
    });

    const isPage = layer.motion.mode === 'page';
    const [a, b] = layer.motion.range;
    const timeline = isPage ? 'scroll(root block)' : 'view()';
    const range = isPage
      ? `${fmt(a * 100)}% ${fmt(b * 100)}%`
      : `cover ${fmt(a * 100)}% cover ${fmt(b * 100)}%`;

    blocks.push(
      [
        `  ${selectorFor(layer)} {`,
        `    animation-name: ${keyframeName(layer)};`,
        `    animation-duration: 1s;`,
        `    animation-fill-mode: both;`,
        `    animation-timing-function: linear;`,
        `    animation-timeline: ${timeline};`,
        `    animation-range: ${range};`,
        `  }`,
        ``,
        `  @keyframes ${keyframeName(layer)} {`,
        frames.join('\n'),
        `  }`
      ].join('\n')
    );
  }

  const header = [
    '/* ------------------------------------------------------------------',
    ' * ScrollScore export — CSS target',
    ` * project: ${p.name}`,
    ` * layers : ${p.layers.length}`,
    ' *',
    ' * Requires a browser with scroll-driven animations',
    ' * (Chrome 115+, Edge 115+, Safari 26+, Firefox 144+).',
    ' * Older browsers fall through to the resting keyframe, which is the',
    ' * same contract the studio preview uses for prefers-reduced-motion.',
    ' *',
    ' * Markup contract: each animated node carries data-ss="<layer id>".',
    ' * Generated on top of AOS (MIT) — see NOTICE.',
    ' * ------------------------------------------------------------------ */'
  ].join('\n');

  const body = blocks.length
    ? `@media (prefers-reduced-motion: no-preference) {\n  @supports (animation-timeline: scroll()) {\n${blocks
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `  ${line}` : line))
        .join('\n')}\n  }\n}\n`
    : '/* 没有可导出的轨道：请先给图层添加关键帧。 */\n';

  return { code: `${header}\n\n${body}`, warnings };
}

/**
 * Serialise the tiny runtime used by both the JS and HTML targets.
 * Kept as a template (not imported) so the exported file has zero imports.
 */
const RUNTIME_SOURCE = String.raw`(function () {
  'use strict';
  var EASE = __EASE__;
  var cache = {};
  function bezier(x1, y1, x2, y2) {
    if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return function (t) { return t; };
    function ax(t) { var m = 1 - t; return 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t; }
    function ay(t) { var m = 1 - t; return 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t; }
    function dx(t) { var m = 1 - t; return 3 * m * m * x1 + 6 * m * t * (x2 - x1) + 3 * t * t * (1 - x2); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i, d, s;
      for (i = 0; i < 6; i++) {
        d = ax(t) - x;
        if (Math.abs(d) < 1e-7) return ay(t);
        s = dx(t);
        if (Math.abs(s) < 1e-4) break;
        t -= d / s;
      }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 24; i++) {
        d = ax(t);
        if (Math.abs(d - x) < 1e-7) break;
        if (d > x) hi = t; else lo = t;
        t = (lo + hi) / 2;
      }
      return ay(t);
    };
  }
  function ease(name) {
    if (cache[name]) return cache[name];
    var pts = EASE[name] || [0, 0, 1, 1];
    cache[name] = bezier(pts[0], pts[1], pts[2], pts[3]);
    return cache[name];
  }
  function evalTrack(keys, t, fallback) {
    if (!keys || !keys.length) return 0;
    if (keys.length === 1) return keys[0].v;
    if (t <= keys[0].p) return keys[0].v;
    var last = keys[keys.length - 1];
    if (t >= last.p) return last.v;
    var lo = 0, hi = keys.length - 1, mid;
    while (hi - lo > 1) { mid = (lo + hi) >> 1; if (keys[mid].p <= t) lo = mid; else hi = mid; }
    var a = keys[lo], b = keys[hi], span = b.p - a.p;
    if (span <= 0) return b.v;
    return a.v + (b.v - a.v) * ease(b.ease || fallback)((t - a.p) / span);
  }
  function fmt(n) { if (!isFinite(n)) return '0'; return String(Math.round(n * 1000) / 1000); }
  function apply(node, tracks, t, fallback) {
    var v = {}, hasT = false, hasF = false, name;
    for (name in tracks) { v[name] = evalTrack(tracks[name], t, fallback); if (name === 'x' || name === 'y' || name === 'z' || name === 'scale' || name === 'rotate') hasT = true; if (name === 'blur' || name === 'brightness' || name === 'saturate') hasF = true; }
    var s = node.style;
    if (hasT) {
      var parts = [];
      if ('x' in v || 'y' in v || 'z' in v) parts.push('translate3d(' + fmt(v.x || 0) + 'px,' + fmt(v.y || 0) + 'px,' + fmt(v.z || 0) + 'px)');
      if ('rotate' in v) parts.push('rotate(' + fmt(v.rotate) + 'deg)');
      if ('scale' in v) parts.push('scale(' + fmt(v.scale) + ')');
      s.transform = parts.join(' ');
    }
    if (hasF) {
      var f = [];
      if ('blur' in v) f.push('blur(' + fmt(v.blur) + 'px)');
      if ('brightness' in v) f.push('brightness(' + fmt(v.brightness) + ')');
      if ('saturate' in v) f.push('saturate(' + fmt(v.saturate) + ')');
      s.filter = f.join(' ');
    }
    if ('opacity' in v) s.opacity = fmt(Math.max(0, Math.min(1, v.opacity)));
    if ('clipX' in v) s.clipPath = 'inset(0 ' + fmt(100 - Math.max(0, Math.min(100, v.clipX))) + '% 0 0)';
    if ('radius' in v) s.borderRadius = fmt(v.radius) + 'px';
    if ('letterSpacing' in v) s.letterSpacing = fmt(v.letterSpacing) + 'px';
  }
  var ENTRIES = __ENTRIES__;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = [];
  ENTRIES.forEach(function (e) {
    var nodes = document.querySelectorAll(e.target);
    for (var i = 0; i < nodes.length; i++) {
      items.push({ node: nodes[i], e: e, bounds: null, pin: e.pin ? { node: nodes[i], wrap: nodes[i].parentElement } : null });
    }
  });
  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
  function measure() {
    var vh = window.innerHeight;
    var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    items.forEach(function (it) {
      var r = it.node.getBoundingClientRect();
      var top = r.top + window.scrollY;
      it.bounds = { start: top - vh + (it.e.offset || 0), end: top + r.height + (it.e.offset || 0) };
    });
    return { vh: vh, docH: docH };
  }
  var geo = measure();
  var lastY = -1;
  function frame() {
    var y = window.scrollY;
    if (y !== lastY) {
      lastY = y;
      var pageT = geo.docH - geo.vh > 0 ? clamp01(y / (geo.docH - geo.vh)) : 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i], e = it.e;
        var raw = e.mode === 'page' ? pageT : clamp01((y - it.bounds.start) / (it.bounds.end - it.bounds.start || 1));
        var a = e.range[0], b = e.range[1];
        var t = clamp01((raw - a) / (b - a || 1));
        apply(it.node, e.tracks, reduced ? 1 : t, e.ease);
      }
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { geo = measure(); lastY = -1; });
  window.addEventListener('load', function () { geo = measure(); lastY = -1; });
  requestAnimationFrame(frame);
  window.ScrollScore = { refresh: function () { geo = measure(); lastY = -1; } };
})();`;

function easeTable() {
  const merged = { ...AOS_PRESETS, ...TRUE_PRESETS, linear: [0, 0, 1, 1] };
  return `{${Object.entries(merged)
    .map(([k, v]) => `"${k}":[${v.join(',')}]`)
    .join(',')}}`;
}

function entriesForExport(project) {
  return normalizeProject(project).layers
    .filter((l) => Object.keys(l.motion.tracks || {}).length > 0)
    .map((l) => ({
      id: l.id,
      target: selectorFor(l),
      mode: l.motion.mode,
      range: l.motion.range,
      ease: l.motion.ease,
      offset: l.motion.offset,
      pin: l.motion.pin,
      tracks: l.motion.tracks
    }));
}

/**
 * Generate the JS runtime target.
 * @param {object} project
 * @param {{minify?: boolean}} [opts]
 */
export function exportJS(project, opts = {}) {
  const p = normalizeProject(project);
  const entries = entriesForExport(p);
  const data = JSON.stringify(entries, null, opts.minify ? 0 : 2);
  const code = RUNTIME_SOURCE.replace('__EASE__', easeTable()).replace('__ENTRIES__', data);
  const header = `/* ScrollScore runtime · project "${p.name}" · ${entries.length} entries
 * Drop this in a <script> tag after your markup. Nodes must carry
 * data-ss="<layer id>". No dependencies. Generated on top of AOS (MIT). */\n`;
  const pinNote = entries.some((e) => e.pin)
    ? `\n/* NOTE: pin windows are declared in the data; wrap each pinned node in a\n * spacer of height 100vh + (b - a) * scrollable distance and make the node\n * position: sticky; top: 0. See README "Pin 章节" for the exact recipe. */\n`
    : '';
  return { code: `${header}${pinNote}\n${code}\n`, warnings: [] };
}

/**
 * Generate a fully self-contained HTML file.
 * @param {object} project
 */
export function exportHTML(project) {
  const p = normalizeProject(project);
  const { code: runtime } = exportJS(p, { minify: true });
  const layerMarkup = p.layers
    .map((layer) => {
      const s = layer.style;
      const styles = [
        `left:${s.x}px`,
        `top:${s.y}px`,
        `width:${s.w}px`,
        `height:${s.h}px`,
        `font-size:${s.fontSize}px`,
        `color:${s.color}`,
        s.background !== 'transparent' ? `background:${s.background}` : '',
        s.radius ? `border-radius:${s.radius}px` : '',
        `text-align:${s.align}`
      ]
        .filter(Boolean)
        .join(';');
      const tag = layer.type === 'heading' ? 'h1' : layer.type === 'badge' ? 'span' : 'div';
      return `    <${tag} class="ss-layer ss-layer--${layer.type}" data-ss="${layer.id}" style="${styles}">${escapeHtml(
        layer.content
      )}</${tag}>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.name)} · ScrollScore</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #12100d; color: #f6ede1;
         font-family: "Segoe UI", "PingFang SC", system-ui, sans-serif; }
  .ss-doc { position: relative; width: 100%; max-width: ${p.viewport.width}px;
            margin: 0 auto; min-height: 320vh; }
  .ss-layer { position: absolute; will-change: transform, opacity; }
  .ss-layer--heading { font-family: Georgia, "Songti SC", serif; line-height: 1.1;
                       letter-spacing: -0.015em; font-weight: 600; }
  .ss-layer--text { line-height: 1.65; color: #c8b6a2; }
  .ss-layer--panel { background: linear-gradient(160deg, rgba(227,168,87,.1), rgba(201,97,60,.06));
                     border: 1px solid rgba(227,168,87,.22); }
  .ss-layer--badge { font-family: ui-monospace, Consolas, monospace; font-size: 11px;
                     letter-spacing: .14em; text-transform: uppercase; color: #f2c986;
                     border: 1px solid rgba(227,168,87,.4); border-radius: 99px;
                     padding: 4px 12px; width: auto !important; height: auto !important; }
  .ss-layer--image { background: repeating-linear-gradient(45deg, rgba(246,237,225,.05) 0 8px, transparent 8px 16px),
                     linear-gradient(140deg, #2b2118, #1a1510); border: 1px solid #3a2e25; }
  @media (prefers-reduced-motion: reduce) { .ss-layer { will-change: auto; } }
</style>
</head>
<body>
  <main class="ss-doc">
${layerMarkup}
  </main>
  <script>
${runtime}
  </script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Human-readable summary used in the export dialog footer.
 * @param {object} project
 */
export function summarize(project) {
  const p = normalizeProject(project);
  const tracks = p.layers.reduce((acc, l) => acc + Object.keys(l.motion.tracks || {}).length, 0);
  const keys = p.layers.reduce(
    (acc, l) => acc + Object.values(l.motion.tracks || {}).reduce((n, k) => n + k.length, 0),
    0
  );
  return { layers: p.layers.length, tracks, keys };
}

export const PROP_LABELS = Object.fromEntries(
  Object.entries(PROPS).map(([name, def]) => [name, def.label])
);
