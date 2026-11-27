/* R300：固定本地 A2UI runtime；只消费宿主校验过的协议数据，不执行模型 HTML/JS。 */
import '@a2ui/lit';
import { MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core';
import { basicCatalog, injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1';

const CATALOG_ID = 'https://warmy.local/catalogs/a2ui-safe/1.json';
const COMPONENTS = ['Text', 'Icon', 'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'Image'];
const FUNCTIONS = ['required', 'regex', 'length', 'numeric', 'email', 'formatString', 'formatNumber', 'formatCurrency', 'formatDate', 'pluralize', 'and', 'or', 'not'];

try {
  const catalog = basicCatalog.derive({ catalogId: CATALOG_ID, components: COMPONENTS, functions: FUNCTIONS });
  const raw = String(document.getElementById('a2ui-data')?.textContent || '').trim();
  const messages = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!messages.length) throw new Error('a2ui-empty');
  /* R315：剔除 Icon 裸文本节点（无图标字体时会与卡片标题重叠）。 */
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
  injectBasicCatalogStyles();
  /* R308⑨：按钮动作不再被 noop 丢弃——回传宿主（存档等），并就地给反馈。 */
  const note = (wen) => {
    const box = document.createElement('div');
    box.className = 'a2ui-action-note';
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80vw;padding:8px 14px;border-radius:10px;background:rgba(30,28,26,.82);color:#fff;font:13px/1.5 system-ui;pointer-events:none;z-index:99';
    box.textContent = String(wen || '');
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 6000);
  };
  const processor = new MessageProcessor([catalog], (action, surfaceId2, componentId) => {
    try {
      const raw = (() => { try { return JSON.stringify(action || {}); } catch { return ''; } })();
      const label = String((action && (action.label || action.name)) || (raw.match(/"label"\s*:\s*"([^"]+)"/) || [])[1] || '');
      const payload = { action, label, surfaceId: surfaceId2, componentId, text: document.body.innerText || '', sessionId: document.getElementById('a2ui-data')?.getAttribute('data-session') || '', messageId: document.getElementById('a2ui-data')?.getAttribute('data-message') || '' };
      if (window.warmyA2ui && window.warmyA2ui.action) {
        Promise.resolve(window.warmyA2ui.action(payload)).then((r) => {
          if (r && r.ok) {
            if (r.dispatched) { note('已派活：交互内容已发给牛马'); return; }
            if (r.copied) { note('已复制到剪贴板'); return; }
            if (r.opened) { note('已打开：' + r.opened); return; }
            note(r.generic ? '按钮交互已执行' : ('已生成存档：' + ((r.files || []).join('、') || '完成')));
            return;
          }
          note('按钮动作未执行：' + String((r && r.error) || label || 'unknown'));
        }).catch((e) => note('按钮动作回传失败：' + String(e && e.message || e)));
      } else {
        note('宿主桥不可用，按钮动作无法执行。');
      }
    } catch (e) {
      note('按钮动作处理失败：' + String(e && e.message || e));
    }
  }, {
    version: '1.0', validationConfig: STRICT_VALIDATION, reportErrorsOnly: false,
  });
  processor.processMessages(clean);
  const surface = processor.getSurface(surfaceId);
  if (!surface || !surface.componentsModel.has(surface.rootId)) throw new Error('a2ui-root-missing');
  const view = document.createElement('a2ui-surface');
  view.surface = surface;
  document.body.appendChild(view);
  try { mdEmphSurface(view); } catch { /* noop */ }
} catch (error) {
  const box = document.createElement('div');
  box.className = 'a2ui-error';
  box.textContent = '互动内容无法显示：' + String(error?.message || error);
  document.body.appendChild(box);
}
/* R316：A2UI Text 纯文本中的星号强调转成 strong/em。 */
function mdEmphSurface(root) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmt = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
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
