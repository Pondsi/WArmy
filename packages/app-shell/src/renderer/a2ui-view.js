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
          note(r && r.ok ? ('已生成存档：' + ((r.files || []).join('、') || '完成')) : ('按钮动作未执行：' + String((r && r.error) || label || 'unknown')));
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
  processor.processMessages(messages);
  const surface = processor.getSurface(surfaceId);
  if (!surface || !surface.componentsModel.has(surface.rootId)) throw new Error('a2ui-root-missing');
  const view = document.createElement('a2ui-surface');
  view.surface = surface;
  document.body.appendChild(view);
} catch (error) {
  const box = document.createElement('div');
  box.className = 'a2ui-error';
  box.textContent = '互动内容无法显示：' + String(error?.message || error);
  document.body.appendChild(box);
}
