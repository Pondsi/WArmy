/* R310①：回复增强内联运行时 —— 把宿主校验过的 A2UI 协议数据直接渲染进聊天气泡 DOM。
 * 与 a2ui-view.js（nm/浏览器宿主）共用同一安全目录与 STRICT_VALIDATION；
 * 只渲染受信组件树，不执行模型 HTML/JS。选中文本/右键/双击天然复用聊天区既有交互链。 */
import '@a2ui/lit';
import { MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core';
import { basicCatalog, injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1';

const CATALOG_ID = 'https://warmy.local/catalogs/a2ui-safe/1.json';
const COMPONENTS = ['Text', 'Icon', 'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'Image'];
const FUNCTIONS = ['required', 'regex', 'length', 'numeric', 'email', 'formatString', 'formatNumber', 'formatCurrency', 'formatDate', 'pluralize', 'and', 'or', 'not'];

let yangShiZhuRu = false;

/** 主题跟随宿主：直接引用宿主 CSS 变量，切换深浅色时内联面自动跟着变。 */
function zhuTiYingShe(host) {
  const she = (k, v) => { try { host.style.setProperty(k, v); } catch { /* noop */ } };
  she('--a2ui-color-background', 'var(--bg, #fff)');
  she('--a2ui-color-on-background', 'var(--ink, #333)');
  she('--a2ui-color-surface', 'var(--card, var(--bg, #fff))');
  she('--a2ui-color-on-surface', 'var(--ink, #333)');
  /* R318：primary/on-primary 不再映射主题色——与 nm 查看器同一安全目录默认蓝底白字按钮（用户报障：聊天内按钮不像按钮）。 */
  she('--a2ui-color-secondary', 'var(--hover, #ddd)');
  she('--a2ui-color-on-secondary', 'var(--ink, #333)');
  try {
    host.style.colorScheme = getComputedStyle(document.documentElement).colorScheme || 'light';
  } catch { /* noop */ }
}

/** 按钮动作反馈：优先宿主浮光提示；没有就就地小条（与 a2ui-view 同口径）。 */
function note(wen) {
  try {
    if (typeof window.__fuGuangTiShi === 'function') { window.__fuGuangTiShi(String(wen || ''), 4200); return; }
  } catch { /* noop */ }
  const box = document.createElement('div');
  box.className = 'a2ui-action-note';
  box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80vw;padding:8px 14px;border-radius:10px;background:rgba(30,28,26,.82);color:#fff;font:13px/1.5 system-ui;pointer-events:none;z-index:99';
  box.textContent = String(wen || '');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

/**
 * 渲染一块内联互动面。
 * @param host 宿主容器（.a2uiNeiLianHost）
 * @param jsonl 主进程完整性校验后的 surface.jsonl 原文
 * @param opts.onAction 按钮动作回传（返回 Promise<宿主结果>）
 * @returns {{dispose: () => void}}
 */
function render(host, jsonl, opts = {}) {
  if (!yangShiZhuRu) { injectBasicCatalogStyles(); yangShiZhuRu = true; }
  const catalog = basicCatalog.derive({ catalogId: CATALOG_ID, components: COMPONENTS, functions: FUNCTIONS });
  const messages = String(jsonl || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!messages.length) throw new Error('a2ui-empty');
  /* R315：安全目录无图标字体，Icon 会把 name 当裸文本渲染并与卡片标题重叠⇒渲染前剔除 Icon 节点。 */
  const qingIcon = (msgs) => msgs.map((m) => {
    const key = m.createSurface ? 'createSurface' : m.updateComponents ? 'updateComponents' : null;
    const body = key ? m[key] : null;
    if (!body || !Array.isArray(body.components)) return m;
    const iconIds = new Set(body.components.filter((c) => c && c.component === 'Icon').map((c) => c.id));
    if (!iconIds.size) return m;
    const comps = body.components.filter((c) => !(c && c.component === 'Icon')).map((c) => (c && Array.isArray(c.children) ? { ...c, children: c.children.filter((id) => !iconIds.has(id)) } : c));
    return { ...m, [key]: { ...body, components: comps } };
  });
  const clean = qingIcon(messages);
  const created = messages.find((m) => m && m.createSurface)?.createSurface;
  const surfaceId = String(created?.surfaceId || '');
  if (!surfaceId) throw new Error('a2ui-surface-missing');
  const processor = new MessageProcessor([catalog], (action, surfaceId2, componentId) => {
    try {
      const label = String((action && (action.label || action.name)) || '');
      const payload = {
        action, label, surfaceId: surfaceId2, componentId,
        text: host.innerText || '',
        sessionId: host.getAttribute('data-session') || '',
        messageId: host.getAttribute('data-message') || '',
        /* R318：带上数据模型快照与输入框当前值——「输入主题+重写」类按钮才能真正拿到用户输入。 */
        data: shuJuKuaiZhao(processor, surfaceId2),
        inputs: shuRuZhi(host),
        buttonText: anNiuWenBen(processor, surfaceId2, componentId),
      };
      if (typeof opts.onAction === 'function') {
        Promise.resolve(opts.onAction(payload)).then((r) => {
          if (r && r.ok) {
            if (r.dispatched) { note('已派活：交互内容已发给牛马'); return; }
            if (r.copied) { note('已复制到剪贴板'); return; }
            if (r.opened) { note('已打开：' + r.opened); return; }
            note(r.generic ? '按钮交互已执行' : ('已生成存档：' + ((r.files || []).join('、') || '完成')));
            return;
          }
          note('按钮动作未执行：' + String((r && r.error) || label || 'unknown'));
        }).catch((e) => note('按钮动作回传失败：' + String((e && e.message) || e)));
      } else {
        note('宿主桥不可用，按钮动作无法执行。');
      }
    } catch (e) {
      note('按钮动作处理失败：' + String((e && e.message) || e));
    }
  }, {
    version: '1.0', validationConfig: STRICT_VALIDATION, reportErrorsOnly: false,
  });
  processor.processMessages(clean);
  const surface = processor.getSurface(surfaceId);
  if (!surface || !surface.componentsModel.has(surface.rootId)) throw new Error('a2ui-root-missing');
  zhuTiYingShe(host);
  const view = document.createElement('a2ui-surface');
  view.surface = surface;
  host.appendChild(view);
  /* R318：Lit 异步渲染——同步跑 mdEmph 拿不到文本节点（星号裸显真因）；等 updateComplete＋观察子树补转。 */
  mdEmphDangJiuXu(view);
  return {
    dispose() {
      try { processor.dispose(); } catch { /* noop */ }
      try { view.remove(); } catch { /* noop */ }
    },
  };
}

window.warmyA2uiInline = { render };
/* R318：按钮可见文本（child Text/label），供宿主按语义派活（事件名仅为安全标识）。 */
function anNiuWenBen(processor, sid2, cid) {
  try {
    const s = processor.getSurface(sid2);
    const cm = s && s.componentsModel.get(cid);
    const p = cm && cm.properties || {};
    const child = p.child && s.componentsModel.get(String(p.child));
    return String((child && child.properties && child.properties.text) || p.label || '');
  } catch { return ''; }
}
/* R318：数据模型快照（TextField/CheckBox 的当前值都在里面）。 */
function shuJuKuaiZhao(processor, sid2) {
  try {
    const s = processor.getSurface(sid2);
    const d = s && s.dataModel && s.dataModel.get('/');
    return d && typeof d === 'object' ? d : undefined;
  } catch { return undefined; }
}
/* R318：输入框当前值（shadow DOM 里的 input/textarea），label 取 shadow 内 label 或 placeholder。 */
function shuRuZhi(root) {
  const out = [];
  try {
    root.querySelectorAll('*').forEach((el) => {
      const sr = el.shadowRoot; if (!sr) return;
      sr.querySelectorAll('input, textarea').forEach((inp) => {
        const v = String(inp.value || ''); if (!v.trim()) return;
        const lab = String((sr.querySelector('label') || {}).textContent || inp.placeholder || '').trim();
        out.push({ label: lab, value: v });
      });
    });
  } catch { /* noop */ }
  return out;
}
/* R318：等 Lit 渲染完再转星号强调，并观察子树（数据绑定更新后补转）。 */
function mdEmphDangJiuXu(root) {
  const run = () => { try { mdEmphSurface(root); } catch { /* noop */ } };
  run();
  try { Promise.resolve(root.updateComplete).then(run, run); } catch { run(); }
  try {
    const mo = new MutationObserver(() => run());
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { try { mo.disconnect(); } catch { /* noop */ } }, 15000);
  } catch { /* noop */ }
}
/* R316/R318：A2UI Text 为纯文本，星号强调会裸显；文本在嵌套 shadow DOM 里，需穿透 shadowRoot 收集再转 strong/em。 */
function mdEmphSurface(root) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmt = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const nodes = [];
  const walk = (n) => {
    if (!n) return;
    if (n.nodeType === 3) { nodes.push(n); return; }
    if (n.shadowRoot) walk(n.shadowRoot);
    for (const c of n.childNodes || []) walk(c);
  };
  walk(root);
  for (const n of nodes) {
    const v = n.nodeValue || '';
    if (!/\*\*[^*]+\*\*|\*[^*]+\*/.test(v)) continue;
    const p = n.parentElement;
    if (!p || /^(CODE|PRE)$/.test(p.tagName)) continue;
    const sp = document.createElement('span');
    sp.innerHTML = fmt(v);
    p.replaceChild(sp, n);
  }
}