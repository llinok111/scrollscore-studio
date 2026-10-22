/**
 * ScrollScore Studio — export dialog
 *
 * Four targets share one project document: CSS, JS runtime, project JSON, and a
 * standalone HTML file that opens straight from disk.
 */
import { exportCSS, exportJS, exportHTML, summarize } from '../core/exporters.js';
import { serializeProject } from '@scrub/schema.js';

const TABS = {
  css: {
    label: '纯 CSS',
    file: (p) => `${slug(p.name)}.css`,
    mime: 'text/css',
    note: '零 JavaScript。依赖 scroll-driven animations（Chrome/Edge 115+、Safari 26+、Firefox 144+）。旧浏览器回落到静止关键帧。',
    build: (project) => exportCSS(project)
  },
  js: {
    label: 'JS runtime',
    file: (p) => `${slug(p.name)}.js`,
    mime: 'text/javascript',
    note: '自包含运行时，无依赖，全浏览器可用，也是唯一能表达 pin（钉住）的目标。',
    build: (project) => exportJS(project)
  },
  json: {
    label: '工程 JSON',
    file: (p) => `${slug(p.name)}.json`,
    mime: 'application/json',
    note: '完整工程数据，可再次导入本工作室继续编辑。',
    build: (project) => ({ code: serializeProject(project), warnings: [] })
  },
  html: {
    label: '独立 HTML',
    file: (p) => `${slug(p.name)}.html`,
    mime: 'text/html',
    note: '单文件，双击即开。含运行时、样式与全部图层。',
    build: (project) => ({ code: exportHTML(project), warnings: [] })
  }
};

function slug(name) {
  const base = String(name || 'scrollscore')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-');
  return base || 'scrollscore';
}

export function createExportDialog({ store, els, toast }) {
  const dialog = els.dialog;
  const tabsEl = els.tabs;
  const codeEl = els.code;
  const noteEl = els.note;
  const metaEl = els.meta;

  let active = 'css';
  let current = { code: '', file: 'scrollscore.txt', mime: 'text/plain' };

  function refresh() {
    const tab = TABS[active];
    const project = store.project;
    const { code, warnings } = tab.build(project);
    const stats = summarize(project);
    codeEl.textContent = code;
    noteEl.textContent = tab.note;
    const warnText = warnings.length ? ` · ⚠ ${warnings.join(' ')}` : '';
    metaEl.textContent = `${stats.layers} 图层 · ${stats.tracks} 轨道 · ${stats.keys} 关键帧 · ${(
      new Blob([code]).size / 1024
    ).toFixed(1)} KB${warnText}`;
    current = { code, file: tab.file(project), mime: tab.mime };
    for (const btn of tabsEl.querySelectorAll('.tab')) {
      btn.classList.toggle('is-active', btn.dataset.tab === active);
    }
  }

  function open() {
    dialog.hidden = false;
    refresh();
    codeEl.scrollTop = 0;
  }

  function close() {
    dialog.hidden = true;
  }

  tabsEl.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    active = tab.dataset.tab;
    refresh();
  });

  dialog.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const name = action.dataset.action;

    if (name === 'close-export') {
      close();
      return;
    }

    if (name === 'copy-export') {
      try {
        await navigator.clipboard.writeText(current.code);
        toast('已复制到剪贴板', 'ok');
      } catch (err) {
        // Clipboard API needs a secure context; fall back to a selection copy.
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        toast('已选中代码，按 Ctrl+C 复制', 'warn');
      }
      return;
    }

    if (name === 'download-export') {
      download(current.file, current.code, current.mime);
      toast(`已下载 ${current.file}`, 'ok');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) close();
  });

  return { open, close, refresh };
}

export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
