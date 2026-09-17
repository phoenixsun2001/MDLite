/* ================= MDLite app ================= */
'use strict';

/* ---------- Tauri API ---------- */
const T = window.__TAURI__;
const invoke = T.core.invoke;
const convertFileSrc = T.core.convertFileSrc;
const listen = T.event.listen;

/* ---------- 工具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const basename = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const dirname = (p) => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i < 0 ? '' : p.slice(0, i); };
const extOf = (p) => (basename(p).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const DOC_EXT = ['md', 'markdown', 'mdown', 'mkd', 'txt'];

/* ---------- 状态 ---------- */
const state = {
  path: null,
  mtime: 0,
  md: '',                // 当前阅读内容（保存后的磁盘内容或切换回阅读时的编辑器内容）
  dirty: false,
  mode: 'read',          // 'read' | 'edit'
  navStack: [],
  settings: { theme: 'auto', width: 'narrow', fontSize: 17, outline: true, mode: 'read' },
  recents: [],
  activeHeadIdx: -1,
  mathStore: [],
};

/* ---------- DOM ---------- */
const bodyEl = document.body;
const scrollArea = $('#scroll-area');
const content = $('#content');
const editor = $('#editor');
const welcome = $('#welcome');
const olTree = $('#ol-tree');
const docStats = $('#doc-stats');
const fileNameEl = $('#file-name');
const findbar = $('#findbar');
const findInput = $('#find-input');
const findCount = $('#find-count');
const menuEl = $('#menu');
const modal = $('#modal');
const modalBody = $('#modal-body');

/* ================= 设置持久化 ================= */

function loadPersisted() {
  try {
    const s = JSON.parse(localStorage.getItem('mdlite.settings') || 'null');
    if (s) Object.assign(state.settings, s);
    state.recents = JSON.parse(localStorage.getItem('mdlite.recents') || '[]');
  } catch { /* 损坏则忽略 */ }
}
function saveSettings() { localStorage.setItem('mdlite.settings', JSON.stringify(state.settings)); }
function saveRecents() { localStorage.setItem('mdlite.recents', JSON.stringify(state.recents.slice(0, 10))); }

function addRecent(path) {
  state.recents = state.recents.filter(r => r.path !== path);
  state.recents.unshift({ path, name: basename(path), ts: Date.now() });
  saveRecents();
  renderRecentLists();
}

function renderRecentLists() {
  // 欢迎页
  const wr = $('#w-recent'), wl = $('#w-recent-list');
  const items = state.recents.slice(0, 8);
  wr.hidden = items.length === 0;
  wl.innerHTML = items.map(r =>
    `<div class="w-recent-item" data-path="${esc(r.path)}"><span class="r-name">${esc(r.name)}</span><span class="r-path">${esc(r.path)}</span></div>`).join('');
  // 菜单
  const mr = $('#menu-recents'), ml = $('#menu-recent-list');
  const mItems = state.recents.slice(0, 6);
  mr.hidden = mItems.length === 0;
  ml.innerHTML = mItems.map(r => `<button class="menu-recent-item" data-path="${esc(r.path)}" title="${esc(r.path)}">${esc(r.name)}</button>`).join('');
}

/* ================= 主题 / 外观 ================= */

const media = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_ICONS = {
  auto: '<circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 2.4v11.2A5.6 5.6 0 008 2.4z" fill="currentColor"/>',
  light: '<circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  dark: '<path d="M13.2 9.7A5.8 5.8 0 116.3 2.8a4.6 4.6 0 106.9 6.9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>',
};

function resolvedTheme() {
  const t = state.settings.theme;
  return t === 'auto' ? (media.matches ? 'dark' : 'light') : t;
}
function applyTheme() {
  const resolved = resolvedTheme();
  bodyEl.dataset.theme = resolved;
  $('#theme-icon').innerHTML = THEME_ICONS[state.settings.theme];
  $('#hljs-theme').href = resolved === 'dark' ? 'vendor/hljs-github-dark.css' : 'vendor/hljs-github.css';
  $$('#menu-theme button').forEach(b => b.classList.toggle('active', b.dataset.themeVal === state.settings.theme));
  saveSettings();
}
function cycleTheme() {
  state.settings.theme = state.settings.theme === 'auto' ? 'light' : state.settings.theme === 'light' ? 'dark' : 'auto';
  applyTheme();
  if (state.path || state.md) rerender();  // mermaid 需要按主题重绘
}
media.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });

function applyFontSize() {
  document.documentElement.style.setProperty('--fs', state.settings.fontSize + 'px');
  $('#menu-font-val').textContent = state.settings.fontSize;
  saveSettings();
}
function changeFontSize(delta) {
  state.settings.fontSize = Math.min(24, Math.max(14, state.settings.fontSize + delta));
  applyFontSize();
}
function applyWidth() {
  bodyEl.classList.toggle('wide', state.settings.width === 'wide');
  $('#menu-width-val').textContent = state.settings.width === 'wide' ? '宽' : '标准';
  saveSettings();
}
function toggleWidth() {
  state.settings.width = state.settings.width === 'wide' ? 'narrow' : 'wide';
  applyWidth();
}
function applyOutline() {
  bodyEl.classList.toggle('outline-open', state.settings.outline);
  saveSettings();
}

/* ================= 提示 ================= */

function toast(msg, kind = '', ms = 2600) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 320); }, ms);
}

/* ================= Markdown 渲染管线 ================= */

/* 先用占位符保护公式，避免被 marked 当作普通文本解析 */
const MATH_RE = /(\$\$[\s\S]+?\$\$(?!\$))|(\\\[[\s\S]+?\\\])|(\\\([\s\S]+?\\\))|(\$(?![\s$])[^$\n]+?\$)/g;

function mdToHtml(src) {
  state.mathStore = [];
  const protectedSrc = src.replace(MATH_RE, (m) => `\u0001M${state.mathStore.push(m) - 1}\u0001`);
  let html = '';
  try {
    html = marked.parse(protectedSrc, { gfm: true, breaks: false });
  } catch (e) {
    html = `<p>渲染失败：${esc(String(e))}</p>`;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-src'] });
}

/* 占位符 → KaTeX HTML */
function renderMathIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.includes('\u0001')) return NodeFilter.FILTER_REJECT;
      let p = n.parentElement;
      while (p && p !== root) {
        if (/^(CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of node.nodeValue.split(/(\u0001M\d+\u0001)/)) {
      const m = part.match(/^\u0001M(\d+)\u0001$/);
      if (!m) { if (part) frag.appendChild(document.createTextNode(part)); continue; }
      const tex = state.mathStore[+m[1]] || '';
      // MATH_RE 保证首尾为对称定界符（$$、\[..\]、\(..\) 长 2，$..$ 长 1）
      const startLen = tex.startsWith('$') && !tex.startsWith('$$') ? 1 : 2;
      const display = startLen === 2 && (tex.startsWith('$$') || tex.startsWith('\\['));
      const inner = tex.slice(startLen, -startLen).trim();
      const span = document.createElement('span');
      try {
        span.innerHTML = katex.renderToString(inner, { displayMode: display, throwOnError: false, strict: false });
      } catch { span.textContent = tex; }
      frag.appendChild(span);
    }
    node.replaceWith(frag);
  }
}

/* Mermaid 懒加载 */
let mermaidReady = false;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('加载失败: ' + src));
    document.head.appendChild(s);
  });
}
async function runMermaid(nodes) {
  if (!nodes.length) return;
  nodes.forEach(n => { n.dataset.src = n.textContent; });
  try {
    if (!mermaidReady) {
      await loadScript('vendor/mermaid.min.js');
      mermaidReady = true;
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: resolvedTheme() === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    await mermaid.run({ nodes });
  } catch {
    nodes.forEach(n => { n.textContent = n.dataset.src || n.textContent; n.classList.add('mermaid-err'); });
  }
}

/* 代码块：高亮 + 语言标签 + 复制按钮 */
function decorateCode(root) {
  for (const code of $$('pre > code', root)) {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1]?.toLowerCase();
    const block = document.createElement('div');
    block.className = 'code-block';
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = `<span>${esc(lang || 'text')}</span><button class="copy-btn">复制</button>`;
    pre.replaceWith(block);
    block.append(head, pre);
    if (lang === 'mermaid') {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = code.textContent;
      block.replaceWith(div);
      continue;
    }
    if (window.hljs && code.textContent.length < 200000) {
      try { hljs.highlightElement(code); } catch { /* 忽略高亮错误 */ }
    }
  }
}

/* 图片：相对路径 → asset 协议 */
async function fixImages(root) {
  for (const img of $$('img[src]', root)) {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:|asset:|blob:)/i.test(src)) continue;
    img.src = '';
    img.classList.add('img-broken');
    if (!state.path) continue;
    const abs = await invoke('resolve_link', { currentFile: state.path, href: src }).catch(() => null);
    if (abs) {
      img.classList.remove('img-broken');
      img.src = convertFileSrc(abs);
      img.loading = 'lazy';
    } else {
      img.alt = `图片未找到: ${src}`;
    }
  }
}

/* 标题 id + 大纲快照 */
function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[`*_~\[\]()#]/g, '')
    .replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '') || 'h';
}
function assignHeadingIds(root) {
  const seen = {};
  const snapshot = [];
  for (const h of $$('h1,h2,h3,h4,h5,h6', root)) {
    const base = slugify(h.textContent);
    seen[base] = (seen[base] || 0) + 1;
    const id = `${base}-${seen[base]}`;
    h.id = id;
    snapshot.push({ id, level: +h.tagName[1], text: h.textContent.trim() });
  }
  return snapshot;
}

/* 可折叠章节：倒序处理，先内后外 */
function buildSections(root) {
  const heads = $$('h1,h2,h3,h4,h5,h6', root);
  for (let i = heads.length - 1; i >= 0; i--) {
    const h = heads[i];
    const lvl = +h.tagName[1];
    const sec = document.createElement('section');
    sec.className = 'sec';
    sec.dataset.level = lvl;
    h.parentNode.insertBefore(sec, h);
    sec.appendChild(h);
    // h 已在 sec 内，后续内容应从 sec 的下一个兄弟开始收拢
    let n = sec.nextElementSibling;
    while (n) {
      const isHead = /^H[1-6]$/.test(n.tagName) && +n.tagName[1] <= lvl;
      const isSec = n.classList?.contains('sec') && +n.dataset.level <= lvl;
      if (isHead || isSec) break;
      sec.appendChild(n);
      n = sec.nextElementSibling;
    }
    const count = $$(':scope > *', sec).filter(el => el !== h && !el.classList.contains('sec')).length
      + $$(':scope > .sec', sec).length;
    const caret = document.createElement('span');
    caret.className = 'sec-caret';
    caret.textContent = '▸';
    const badge = document.createElement('span');
    badge.className = 'sec-count';
    badge.textContent = count + ' 块';
    h.append(caret, badge);
  }
}

/* 表格外包一层以便横向滚动 */
function wrapTables(root) {
  for (const t of $$('table', root)) {
    if (t.parentElement?.classList.contains('tbl-wrap')) continue;
    const w = document.createElement('div');
    w.className = 'tbl-wrap';
    t.replaceWith(w);
    w.appendChild(t);
  }
}

/* 大纲 */
function renderOutline(snapshot) {
  if (!snapshot.length) {
    olTree.innerHTML = '<div class="ol-empty">此文档没有标题</div>';
    return;
  }
  olTree.innerHTML = snapshot.map((h, i) =>
    `<button class="ol-item ol-l${h.level}" data-i="${i}" style="padding-left:${10 + (h.level - 1) * 13}px" data-target="${esc(h.id)}" title="${esc(h.text)}">${esc(h.text)}</button>`).join('');
}

/* 建立「标题 → 源码偏移」映射（按文档顺序单调向后匹配） */
function computeSourceOffsets(src, snapshot) {
  const lines = src.split('\n');
  const lineOff = [];
  let acc = 0;
  for (const l of lines) { lineOff.push(acc); acc += l.length + 1; }
  const norm = (s) => s.replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const out = [];
  let si = 0;
  for (const h of snapshot) {
    const re = new RegExp('^ {0,3}' + '#'.repeat(Math.min(h.level, 6)) + '(\\s|$)');
    const t = norm(h.text);
    let found = -1;
    for (let i = si; i < lines.length; i++) {
      if (re.test(lines[i]) && norm(lines[i]).includes(t)) { found = i; break; }
    }
    if (found < 0) {
      for (let i = si; i < lines.length; i++) {
        if (re.test(lines[i])) { found = i; break; }
      }
    }
    out.push(found >= 0 ? lineOff[found] : null);
    if (found >= 0) si = found + 1;
  }
  return out;
}
function updateStats(src) {
  if (!state.path) { docStats.textContent = ''; return; }
  const cjk = (src.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const words = (src.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9_']+/g) || []).length;
  const total = cjk + words;
  const mins = Math.max(1, Math.round(total / 400));
  const mtime = state.mtime ? new Date(state.mtime * 1000).toLocaleString() : '';
  docStats.innerHTML = `字数 ${total.toLocaleString()} · 约 ${mins} 分钟${mtime ? `<br>修改于 ${esc(mtime)}` : ''}${state.dirty ? '<br>● 有未保存更改' : ''}`;
}

/* 完整渲染 */
function renderDocument() {
  const src = state.mode === 'edit' ? editor.value : state.md;
  content.innerHTML = mdToHtml(src);
  renderMathIn(content);
  const snapshot = assignHeadingIds(content);
  buildSections(content);
  wrapTables(content);
  decorateCode(content);
  fixImages(content);
  renderOutline(snapshot);
  state.headOffsets = computeSourceOffsets(src, snapshot);
  state.headEls = $$('h1,h2,h3,h4,h5,h6', content);
  updateStats(src);
  if (findbar.hidden === false && findInput.value) scheduleFind();
  runMermaid($$('.mermaid', content));
}

/* 保留阅读位置的重渲染 */
function collectAnchor() {
  const idx = currentHeadIndex();
  if (idx >= 0) return { type: 'head', idx };
  const max = scrollArea.scrollHeight - scrollArea.clientHeight;
  return { type: 'ratio', r: max > 4 ? scrollArea.scrollTop / max : 0 };
}
function applyAnchor(a) {
  if (a?.type === 'head' && state.headEls?.[a.idx]) {
    state.headEls[a.idx].scrollIntoView({ block: 'start' });  // 标题自带 scroll-margin-top
  } else if (a?.type === 'ratio') {
    scrollArea.scrollTop = a.r * (scrollArea.scrollHeight - scrollArea.clientHeight);
  }
}
function rerender(preserve = true) {
  const a = preserve ? collectAnchor() : null;
  renderDocument();
  if (a) requestAnimationFrame(() => applyAnchor(a));
}

/* ================= 大纲交互 / 滚动监听 ================= */

function currentHeadIndex() {
  const els = state.headEls || [];
  let idx = -1;
  for (let i = 0; i < els.length; i++) {
    if (els[i].offsetParent === null) continue;  // 位于折叠章节内
    if (els[i].getBoundingClientRect().top <= 120) idx = i; else break;
  }
  return idx;
}
let scrollTick = false;
scrollArea.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    const idx = currentHeadIndex();
    state.activeHeadIdx = idx;
    $$('.ol-item.active', olTree).forEach(el => el.classList.remove('active'));
    if (idx >= 0) {
      const id = state.headEls[idx]?.id;
      const item = olTree.querySelector(`[data-target="${CSS.escape(id)}"]`);
      if (item) {
        item.classList.add('active');
        const r = item.getBoundingClientRect(), tr = olTree.getBoundingClientRect();
        if (r.top < tr.top + 8 || r.bottom > tr.bottom - 8) {
          olTree.scrollTop += r.top - (tr.top + tr.height / 2);
        }
      }
    }
  });
});

/* 编辑器滚动到源码偏移处：镜像元素测量（考虑 textarea 软换行） */
let editorMirror = null;
function editorScrollToOffset(offset) {
  if (offset == null) return;
  if (!editorMirror) {
    editorMirror = document.createElement('div');
    document.body.appendChild(editorMirror);
  }
  const cs = getComputedStyle(editor);
  const s = editorMirror.style;
  s.position = 'absolute';
  s.visibility = 'hidden';
  s.left = '-99999px';
  s.top = '0';
  s.boxSizing = 'border-box';
  s.width = (editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.lineHeight = cs.lineHeight;
  s.letterSpacing = cs.letterSpacing;
  s.tabSize = cs.tabSize;
  s.whiteSpace = 'pre-wrap';
  s.overflowWrap = 'break-word';
  s.padding = '0';
  s.border = '0';
  editorMirror.textContent = editor.value.slice(0, offset);
  const y = parseFloat(cs.paddingTop) + editorMirror.offsetHeight;
  suppressEditorSync = true;  // 大纲已精确定位预览，不要让比例同步再拉走它
  editor.scrollTop = Math.max(0, y - 30);
  setTimeout(() => { suppressEditorSync = false; }, 150);
}

olTree.addEventListener('click', (e) => {
  const item = e.target.closest('.ol-item');
  if (!item) return;
  const el = document.getElementById(item.dataset.target);
  if (!el) return;
  let p = el.parentElement;
  while (p && p !== content) { if (p.classList?.contains('sec')) p.classList.remove('folded'); p = p.parentElement; }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (state.mode === 'edit') {
    editorScrollToOffset(state.headOffsets?.[+item.dataset.i]);
  }
});

function setAllFolded(fold) {
  $$('.sec', content).forEach(s => s.classList.toggle('folded', fold));
}

/* 正文点击：折叠标题 / 复制按钮 / 链接 */
content.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) {
    const code = copyBtn.closest('.code-block')?.querySelector('pre code');
    const text = code?.textContent ?? '';
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = '已复制'; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); copyBtn.textContent = '已复制';
    }
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1400);
    return;
  }
  const head = e.target.closest('.sec > h1,.sec > h2,.sec > h3,.sec > h4,.sec > h5,.sec > h6');
  if (head && !e.target.closest('a')) {
    head.parentElement.classList.toggle('folded');
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (/^https?:/i.test(href)) {
    invoke('open_external', { url: href }).catch(err => toast(String(err), 'error'));
    return;
  }
  if (href.startsWith('#')) {
    const el = document.getElementById(decodeURIComponent(href.slice(1)));
    let p = el?.parentElement;
    while (p && p !== content) { if (p.classList?.contains('sec')) p.classList.remove('folded'); p = p.parentElement; }
    el?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  // 相对路径 → 文档跳转
  if (state.path) {
    const abs = await invoke('resolve_link', { currentFile: state.path, href }).catch(() => null);
    if (abs && DOC_EXT.includes(extOf(abs))) {
      state.navStack.push(state.path);
      openPath(abs);
    } else {
      toast('链接目标不存在: ' + href);
    }
  }
});

/* ================= 打开 / 保存 / 监听 ================= */

function updateTitle() {
  const name = state.path ? basename(state.path) : 'MDLite';
  fileNameEl.textContent = state.path ? name : 'MDLite';
  const title = `${state.dirty ? '● ' : ''}${name} — MDLite`;
  document.title = title;
  try { T.window.getCurrentWindow().setTitle(title); } catch { /* 忽略 */ }
}

async function openPath(path, { pushNav = false } = {}) {
  try {
    const f = await invoke('read_file', { path });
    if (pushNav && state.path) state.navStack.push(state.path);
    stopTeleprompter(true);
    state.path = path;
    state.mtime = f.mtime;
    state.md = f.text;
    state.dirty = false;
    editor.value = f.text;
    welcome.hidden = true;
    renderDocument();
    scrollArea.scrollTop = 0;
    invoke('watch_file', { path, mtime: f.mtime }).catch(() => {});
    addRecent(path);
    updateTitle();
  } catch (err) {
    toast('打开失败：' + err, 'error', 3600);
  }
}

async function saveDoc() {
  if (!state.path) { toast('没有可保存的文件'); return; }
  try {
    await invoke('write_file', { path: state.path, text: editor.value });
    state.md = editor.value;
    state.dirty = false;
    state.mtime = Math.floor(Date.now() / 1000);
    updateTitle();
    updateStats(state.md);
    toast('已保存', 'ok', 1400);
  } catch (err) {
    toast('保存失败：' + err, 'error');
  }
}

async function onFileChanged(ev) {
  const p = ev.payload;
  if (p !== state.path) return;
  if (state.mode === 'edit' && state.dirty) {
    toast('文件已在磁盘上被修改；Ctrl+S 保存将覆盖外部更改');
    return;
  }
  try {
    const f = await invoke('read_file', { path: state.path });
    state.mtime = f.mtime;
    if (state.mode === 'edit') {
      editor.value = f.text;
      state.md = f.text;
      state.dirty = false;
      updateTitle();
    } else {
      state.md = f.text;
      rerender(true);
    }
    toast('文件已更新，已重新加载', 'ok', 1600);
  } catch { /* 文件可能被暂时锁定，等下次变更 */ }
}

/* ================= 模式切换 / 编辑器 ================= */

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'read') state.md = editor.value;   // 未保存的编辑内容也进入预览
  state.mode = mode;
  state.settings.mode = mode;
  saveSettings();
  bodyEl.classList.toggle('mode-edit', mode === 'edit');
  $('#edit-toolbar').hidden = mode !== 'edit';
  $('#mode-read').classList.toggle('active', mode === 'read');
  $('#mode-edit').classList.toggle('active', mode === 'edit');
  renderDocument();
  if (mode === 'edit') editor.focus();
}

let lastSyncRatio = 0;
let suppressEditorSync = false;  // 大纲跳转时临时抑制编辑器→预览的比例同步
editor.addEventListener('input', debounce(() => {
  if (editor.value === state.md) return;  // IME 等造成的假 input
  state.dirty = true;
  updateTitle();
  rerender(true);
}, 220));
editor.addEventListener('scroll', () => {
  if (state.mode !== 'edit' || suppressEditorSync) return;
  const max = editor.scrollHeight - editor.clientHeight;
  if (max <= 4) return;
  const r = editor.scrollTop / max;
  if (Math.abs(r - lastSyncRatio) > 0.004) {
    lastSyncRatio = r;
    scrollArea.scrollTop = r * (scrollArea.scrollHeight - scrollArea.clientHeight);
  }
});
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
  }
});

/* 工具栏：插入 Markdown */
const MD_SNIPPETS = {
  h1: (s) => ['# ', s], h2: (s) => ['## ', s], h3: (s) => ['### ', s],
  bold: (s) => ['**', s || '粗体', '**'],
  italic: (s) => ['*', s || '斜体', '*'],
  strike: (s) => ['~~', s || '删除线', '~~'],
  code: (s) => ['`', s || '代码', '`'],
  ul: (s) => ['- ', s || '列表项'],
  task: (s) => ['- [ ] ', s || '任务'],
  quote: (s) => ['> ', s || '引用'],
  codeblock: (s) => ['```\n', s || '代码', '\n```'],
  table: () => ['\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n', ''],
  link: (s) => ['[', s || '链接文本', '](https://)'],
  math: (s) => ['$', s || 'E = mc^2', '$'],
  hr: () => ['\n\n---\n\n', ''],
};
$('#edit-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-md]');
  if (!btn) return;
  const fn = MD_SNIPPETS[btn.dataset.md];
  if (!fn) return;
  const [pre, mid, post] = fn(editor.value.slice(editor.selectionStart, editor.selectionEnd));
  editor.setRangeText(pre + mid + post, editor.selectionStart, editor.selectionEnd, pre.length ? 'end' : 'end');
  editor.focus();
  editor.dispatchEvent(new Event('input'));
});

/* ================= 查找 ================= */

const scheduleFind = debounce(() => runFind(findInput.value), 200);
function clearMarks() {
  for (const m of $$('mark.mk', content)) {
    const t = document.createTextNode(m.textContent);
    m.replaceWith(t);
  }
  // 合并相邻文本节点
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const parents = new Set();
  while (walker.nextNode()) parents.add(walker.currentNode.parentElement);
  parents.forEach(p => p?.normalize?.());
}
function runFind(q) {
  clearMarks();
  state.find = { matches: [], idx: -1, q };
  q = q.trim();
  if (!q) { findCount.textContent = '0 / 0'; return; }
  const lq = q.toLowerCase();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      return p.closest('.sec-count, .copy-btn, #findbar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const low = text.toLowerCase();
    let i = low.indexOf(lq);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    while (i >= 0) {
      frag.append(document.createTextNode(text.slice(pos, i)));
      const mk = document.createElement('mark');
      mk.className = 'mk';
      mk.textContent = text.slice(i, i + q.length);
      frag.append(mk);
      state.find.matches.push(mk);
      pos = i + q.length;
      i = low.indexOf(lq, pos);
    }
    frag.append(document.createTextNode(text.slice(pos)));
    node.replaceWith(frag);
  }
  findCount.textContent = state.find.matches.length ? `1 / ${state.find.matches.length}` : '0 / 0';
  if (state.find.matches.length) { state.find.idx = 0; markCurrent(); }
}
function markCurrent() {
  $$('.mk-current', content).forEach(m => m.classList.remove('mk-current'));
  const mk = state.find.matches[state.find.idx];
  if (mk) {
    mk.classList.add('mk-current');
    mk.scrollIntoView({ block: 'center' });
  }
  findCount.textContent = `${state.find.idx + 1} / ${state.find.matches.length}`;
}
function findStep(dir) {
  const n = state.find.matches.length;
  if (!n) return;
  state.find.idx = (state.find.idx + dir + n) % n;
  markCurrent();
}
function closeFind() {
  findbar.hidden = true;
  findInput.value = '';
  clearMarks();
  state.find = { matches: [], idx: -1, q: '' };
  if (state.mode === 'edit') editor.focus();
}
function openFind() {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(findInput.value);
}
findInput.addEventListener('input', scheduleFind);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') closeFind();
});
$('#find-next').addEventListener('click', () => findStep(1));
$('#find-prev').addEventListener('click', () => findStep(-1));
$('#find-close').addEventListener('click', closeFind);

/* ================= 打字机（自动滚动） ================= */

const tp = { raf: 0, playing: false, last: 0 };
function tpTick(ts) {
  if (!tp.playing) return;
  if (tp.last) {
    const speed = +$('#tp-speed').value;
    scrollArea.scrollTop += (speed * (ts - tp.last)) / 1000;
    if (scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 1) {
      stopTeleprompter();
      toast('已滚动到底部');
      return;
    }
  }
  tp.last = ts;
  tp.raf = requestAnimationFrame(tpTick);
}
function startTeleprompter() {
  $('#teleprompter').hidden = false;
  tp.playing = true;
  tp.last = 0;
  $('#tp-play').textContent = '⏸';
  tp.raf = requestAnimationFrame(tpTick);
}
function pauseTeleprompter() {
  tp.playing = false;
  cancelAnimationFrame(tp.raf);
  $('#tp-play').textContent = '▶';
}
function stopTeleprompter(silent = false) {
  pauseTeleprompter();
  $('#teleprompter').hidden = true;
  if (!silent) bodyEl.focus?.();
}
$('#tp-play').addEventListener('click', () => (tp.playing ? pauseTeleprompter() : startTeleprompter()));
$('#tp-close').addEventListener('click', () => stopTeleprompter());
$('#tp-speed').addEventListener('input', () => { $('#tp-speed-val').textContent = $('#tp-speed').value + ' px/s'; });

/* ================= 菜单 / 弹窗 ================= */

function openMenu() {
  renderRecentLists();
  menuEl.hidden = false;
}
function closeMenu() { menuEl.hidden = true; }
$('#btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  menuEl.hidden ? openMenu() : closeMenu();
});
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !e.target.closest('#menu') && !e.target.closest('#btn-menu')) closeMenu();
});

const HELP_HTML = `
<h2>快捷键与帮助</h2>
<h3>文件</h3>
<table>
  <tr><td>打开文件</td><td><kbd>Ctrl</kbd> <kbd>O</kbd></td></tr>
  <tr><td>保存（编辑模式）</td><td><kbd>Ctrl</kbd> <kbd>S</kbd></td></tr>
  <tr><td>返回上一文档</td><td><kbd>Alt</kbd> <kbd>←</kbd></td></tr>
</table>
<h3>视图</h3>
<table>
  <tr><td>阅读 / 编辑切换</td><td><kbd>Ctrl</kbd> <kbd>E</kbd></td></tr>
  <tr><td>大纲侧栏</td><td><kbd>Ctrl</kbd> <kbd>B</kbd></td></tr>
  <tr><td>在文档中查找</td><td><kbd>Ctrl</kbd> <kbd>F</kbd></td></tr>
  <tr><td>查找下一个 / 上一个</td><td><kbd>Enter</kbd> / <kbd>Shift+Enter</kbd></td></tr>
  <tr><td>禅模式</td><td><kbd>F8</kbd></td></tr>
  <tr><td>自动滚动（讲稿模式）</td><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>T</kbd></td></tr>
  <tr><td>关闭浮层</td><td><kbd>Esc</kbd></td></tr>
  <tr><td>帮助</td><td><kbd>F1</kbd></td></tr>
</table>
<h3>技巧</h3>
<p>· 点击任意标题可折叠 / 展开章节，标题右侧显示内容块数。<br>
· 将 <b>.md</b> 文件拖入窗口即可打开；同一文件在磁盘上被修改会自动重新加载。<br>
· 文档内的相对链接（如 <code>[下一章](ch2.md)</code>）可在应用内直接跳转；相对路径图片正常显示。<br>
· 编辑模式下左侧输入、右侧实时预览，<kbd>Ctrl</kbd> <kbd>S</kbd> 保存到磁盘。<br>
· 「导出为 HTML」生成可分享的单文件网页（含公式字体与主题样式）。</p>
`;

const ABOUT_HTML = `
<h2>MDLite <span class="muted">v1.0</span></h2>
<p>轻、快、离线的 Markdown 阅读器。</p>
<p class="muted">基于 MDLook 的功能与交互思路的轻量重制：<br>
· Tauri 2 + 系统自带 WebView（Windows: WebView2 / macOS: WKWebView），非 Electron<br>
· 单文件可执行程序，全部资源内嵌，启动即用<br>
· 完全离线：渲染引擎、代码高亮、KaTeX 公式、Mermaid 图表全部本地化<br>
· 支持：大纲导航、章节折叠、编辑实时预览、暗色模式、禅模式、自动滚动、导出 HTML、文件关联与单实例</p>
`;

function showModal(html) {
  modalBody.innerHTML = html;
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; }
$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

menuEl.addEventListener('click', (e) => {
  const recent = e.target.closest('.menu-recent-item');
  if (recent) { closeMenu(); openPath(recent.dataset.path); return; }
  const themeBtn = e.target.closest('#menu-theme button');
  if (themeBtn) {
    state.settings.theme = themeBtn.dataset.themeVal;
    applyTheme();
    if (state.path || state.md) rerender();
    return;
  }
  const item = e.target.closest('.menu-item, [data-act]');
  if (!item) return;
  closeMenu();
  switch (item.dataset.act) {
    case 'open': openDialog(); break;
    case 'fold-all': setAllFolded(true); break;
    case 'expand-all': setAllFolded(false); break;
    case 'export': exportHtml(); break;
    case 'reveal': if (state.path) invoke('reveal_in_folder', { path: state.path }).catch(() => {}); break;
    case 'teleprompter': tp.playing ? pauseTeleprompter() : startTeleprompter(); break;
    case 'font-minus': changeFontSize(-1); break;
    case 'font-plus': changeFontSize(1); break;
    case 'width-toggle': toggleWidth(); break;
    case 'help': showModal(HELP_HTML); break;
    case 'about': showModal(ABOUT_HTML); break;
  }
});

/* ================= 导出 HTML ================= */

async function inlineKatexCss() {
  try {
    let css = await (await fetch('vendor/katex/katex.min.css')).text();
    const fonts = [...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map(m => m[1]);
    for (const f of fonts) {
      const buf = await (await fetch('vendor/katex/' + f)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      css = css.split(`url(${f})`).join(`url(data:font/woff2;base64,${btoa(bin)})`);
    }
    return css;
  } catch { return ''; }
}

async function exportHtml() {
  if (!state.path && !state.md) { toast('先打开一个文件'); return; }
  const theme = resolvedTheme();
  const clone = content.cloneNode(true);
  clone.querySelectorAll('.sec-caret, .sec-count, .copy-btn, .code-head').forEach(el => el.remove());
  clone.querySelectorAll('mark.mk').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  const src = state.mode === 'edit' ? editor.value : state.md;
  const cjk = (src.match(/[\u4e00-\u9fff]/g) || []).length;
  const name = state.path ? basename(state.path).replace(/\.[^.]+$/, '') : 'untitled';
  const appCss = await (await fetch('style.css')).text();
  const hlCss = await (await fetch(theme === 'dark' ? 'vendor/hljs-github-dark.css' : 'vendor/hljs-github.css')).text();
  const katexCss = await inlineKatexCss();
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>${katexCss}</style><style>${hlCss}</style>
<style>${appCss}
/* 导出微调 */
body { display: block; height: auto; overflow: auto; background: var(--bg); }
#content { padding: 48px 24px 12vh; }
.md-body .sec.folded > *:not(:where(h1,h2,h3,h4,h5,h6)) { display: block; }
</style></head>
<body data-theme="${theme}"><article id="content" class="md-body">${clone.innerHTML}</article></body></html>`;
  try {
    const p = await invoke('save_export', { defaultName: `${name}.html`, content: html });
    if (p) toast('已导出：' + p, 'ok', 3400);
  } catch (err) { toast('导出失败：' + err, 'error'); }
}

/* ================= 拖放 ================= */

async function setupDragDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  const wv = T.webview.getCurrentWebview();
  await wv.onDragDropEvent((ev) => {
    const p = ev.payload ?? ev;
    if (p.type === 'enter' || p.type === 'over') {
      depth = Math.max(depth, 1);
      overlay.hidden = false;
    } else if (p.type === 'leave') {
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    } else if (p.type === 'drop') {
      depth = 0;
      overlay.hidden = true;
      const path = p.paths?.find(f => DOC_EXT.includes(extOf(f)));
      if (path) openPath(path);
      else if (p.paths?.length) toast('不支持的文件类型，请拖入 .md 文件');
    }
  });
}

/* ================= 全局快捷键 ================= */

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'F1') { e.preventDefault(); showModal(HELP_HTML); return; }
  if (e.key === 'F8') { e.preventDefault(); bodyEl.classList.toggle('zen'); return; }
  if (e.key === 'Escape') {
    if (!findbar.hidden) { closeFind(); return; }
    if (!menuEl.hidden) { closeMenu(); return; }
    if (!modal.hidden) { closeModal(); return; }
    if (!bodyEl.classList.contains('zen')) return;
    bodyEl.classList.remove('zen');
    return;
  }
  if (!ctrl) {
    if (e.altKey && e.key === 'ArrowLeft' && state.navStack.length) {
      openPath(state.navStack.pop());
    }
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'o': e.preventDefault(); openDialog(); break;
    case 's': e.preventDefault(); if (state.mode === 'edit') saveDoc(); break;
    case 'e': e.preventDefault(); setMode(state.mode === 'read' ? 'edit' : 'read'); break;
    case 'f': e.preventDefault(); openFind(); break;
    case 't':
      if (e.shiftKey) {
        e.preventDefault();
        tp.playing ? pauseTeleprompter() : startTeleprompter();
      }
      break;
    case 'b':
      e.preventDefault();
      if (state.mode === 'edit') {
        editor.setRangeText('**' + (editor.value.slice(editor.selectionStart, editor.selectionEnd) || '粗体') + '**',
          editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input'));
      } else {
        state.settings.outline = !state.settings.outline;
        applyOutline();
      }
      break;
  }
});

/* ================= 顶栏其余按钮 ================= */

function openDialog() {
  invoke('dialog_open_file').then((p) => { if (p) openPath(p); }).catch(() => {});
}
$('#btn-outline').addEventListener('click', () => { state.settings.outline = !state.settings.outline; applyOutline(); });
$('#ol-close').addEventListener('click', () => { state.settings.outline = false; applyOutline(); });
$('#ol-fold-all').addEventListener('click', () => setAllFolded(true));
$('#ol-expand-all').addEventListener('click', () => setAllFolded(false));
$('#mode-read').addEventListener('click', () => setMode('read'));
$('#mode-edit').addEventListener('click', () => setMode('edit'));
$('#btn-find').addEventListener('click', openFind);
$('#btn-font-minus').addEventListener('click', () => changeFontSize(-1));
$('#btn-font-plus').addEventListener('click', () => changeFontSize(1));
$('#btn-width').addEventListener('click', toggleWidth);
$('#btn-theme').addEventListener('click', cycleTheme);
$('#btn-zen').addEventListener('click', () => bodyEl.classList.toggle('zen'));
$('#w-open').addEventListener('click', openDialog);
$('#w-recent-list').addEventListener('click', (e) => {
  const item = e.target.closest('.w-recent-item');
  if (item) openPath(item.dataset.path);
});

/* ================= 启动 ================= */

async function boot() {
  loadPersisted();
  applyTheme();
  applyFontSize();
  applyWidth();
  applyOutline();
  renderRecentLists();
  updateTitle();
  // 启动始终进入阅读模式

  await listen('open-path', async () => {
    const p = await invoke('take_startup_file');
    if (p) openPath(p);
  });
  await listen('file-changed', onFileChanged);
  await setupDragDrop();

  // 命令行参数 / 二次启动传入的文件
  const startup = await invoke('take_startup_file');
  if (startup) {
    await openPath(startup);
  } else {
    welcome.hidden = false;
  }
}

boot();
