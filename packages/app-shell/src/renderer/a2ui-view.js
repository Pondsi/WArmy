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
  const processor = new MessageProcessor([catalog], () => {}, {
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
