const fs = require('node:fs');
const path = require('node:path');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';

// ── 1) 创建图标目录 ──
const iconsDir = path.join(base, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const icons = {
  'my-agents': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="34" r="12"/><path d="M14,78 C14,60 24,54 34,54 C40,54 45,56 49,60"/><rect x="58" y="26" width="24" height="24" rx="4"/><circle cx="70" cy="38" r="3" fill="currentColor"/><line x1="70" y1="26" x2="70" y2="18"/><circle cx="70" cy="16" r="3" fill="currentColor"/></g></svg>`,
  'project': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50,14 A36,36 0 1,1 21,71" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M34,50 C30,38 42,38 50,50 C58,62 70,62 66,50 C62,38 50,38 50,50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`,
  'contact': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><circle cx="42" cy="34" r="14"/><path d="M18,82 C18,62 30,56 42,56 C48,56 53,58 57,62"/><path d="M68,32 C74,38 74,50 68,56"/><path d="M78,24 C88,36 88,52 78,64"/></g></svg>`,
  'group': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="34" cy="34" r="12"/><path d="M16,78 C16,62 24,54 34,54 C44,54 52,62 52,78"/><circle cx="66" cy="34" r="12"/><path d="M48,78 C48,62 56,54 66,54 C76,54 84,62 84,78"/></g></svg>`,
  'agents-hq': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>`,
  'settings': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><mask id="h2"><rect width="100" height="100" fill="white"/><polygon points="50,32 66,42 66,58 50,68 34,58 34,42" fill="black"/></mask></defs><g fill="currentColor" mask="url(#h2)"><circle cx="50" cy="50" r="30"/><g stroke="currentColor" stroke-width="14"><line x1="50" y1="20" x2="50" y2="6"/><line x1="50" y1="80" x2="50" y2="94"/><line x1="20" y1="50" x2="6" y2="50"/><line x1="80" y1="50" x2="94" y2="50"/><line x1="29" y1="29" x2="19" y2="19"/><line x1="71" y1="71" x2="81" y2="81"/><line x1="71" y1="29" x2="81" y2="19"/><line x1="29" y1="71" x2="19" y2="81"/></g></g></svg>`,
  'pin': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="18" y="14" width="64" height="12" rx="6" fill="currentColor"/><polygon points="32,26 68,26 58,58 42,58" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/><rect x="45" y="58" width="10" height="28" rx="5" fill="currentColor"/></svg>`,
  'console': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="16" width="80" height="68" rx="6"/><polyline points="28,40 42,52 28,64"/><line x1="50" y1="64" x2="72" y2="64"/></g></svg>`,
  'screenshot': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M334 111.6c0-24.6-20-44.4-44.4-44.4s-44.4 20-44.4 44.4v89H111.6c-24.6 0-44.4 20-44.4 44.4s20 44.4 44.4 44.4h623V690h89V245c0-24.6-20-44.4-44.4-44.4H334V111.6zM245 334v445c0 24.6 20 44.4 44.4 44.4h445v89c0 24.6 20 44.4 44.4 44.4s44.4-20 44.4-44.4v-89h89c24.6 0 44.4-20 44.4-44.4s-20-44.4-44.4-44.4H334V334h-89z" fill="currentColor"/></svg>`,
  'attach': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"><path d="M22,24 L56,24 L70,38 L70,86 L22,86 Z"/><polyline points="56,24 56,38 70,38"/></g><g stroke="currentColor" stroke-width="8" stroke-linecap="square"><line x1="76" y1="14" x2="76" y2="30"/><line x1="68" y1="22" x2="84" y2="22"/></g></svg>`,
  'logo-color': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100"><g><rect x="120" y="0" width="10" height="10" fill="#D2B48C"/><rect x="130" y="10" width="10" height="10" fill="#D2B48C"/><rect x="90" y="0" width="10" height="10" fill="#3E2723"/><rect x="100" y="0" width="10" height="10" fill="#3E2723"/><rect x="100" y="10" width="10" height="10" fill="#3E2723"/><rect x="110" y="10" width="10" height="10" fill="#8B5A2B"/><rect x="110" y="20" width="10" height="10" fill="#A0522D"/><rect x="120" y="20" width="10" height="10" fill="#A0522D"/><rect x="110" y="30" width="10" height="10" fill="#A0522D"/><rect x="120" y="30" width="10" height="10" fill="#A0522D"/><rect x="120" y="40" width="10" height="10" fill="#C19A6B"/><rect x="130" y="40" width="10" height="10" fill="#C19A6B"/><rect x="100" y="20" width="10" height="10" fill="#8B5A2B"/><rect x="100" y="30" width="10" height="10" fill="#8B5A2B"/><rect x="20" y="20" width="80" height="30" fill="#A0522D"/><rect x="90" y="50" width="10" height="15" fill="#8B5A2B"/><rect x="100" y="65" width="10" height="15" fill="#8B5A2B"/><rect x="70" y="50" width="10" height="30" fill="#8B5A2B"/><rect x="40" y="50" width="10" height="30" fill="#8B5A2B"/><rect x="20" y="50" width="10" height="15" fill="#8B5A2B"/><rect x="10" y="65" width="10" height="15" fill="#8B5A2B"/><rect x="10" y="30" width="10" height="10" fill="#3E2723"/><rect x="0" y="40" width="10" height="10" fill="#3E2723"/><rect x="0" y="50" width="10" height="10" fill="#3E2723"/><rect x="100" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="70" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="40" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="10" y="75" width="10" height="5" fill="#1A1A1A"/></g></svg>`,
};

for (const [name, svg] of Object.entries(icons)) {
  fs.writeFileSync(path.join(iconsDir, name + '.svg'), svg);
}
console.log('icons written:', Object.keys(icons).length);

// ── 2) index.html：Logo 上色 + 移除 rail 底部牛马管理局 + 列表头按钮改文案 ──
let h = fs.readFileSync(base + 'index.html', 'utf8');

// Logo：替换 logo-glyph 为彩色像素牛
h = h.replace(
  '<div class="logo-glyph">牛</div>',
  '<div class="logo-glyph"><svg viewBox="0 0 140 100" style="width:96px;height:68px"><g><rect x="120" y="0" width="10" height="10" fill="#D2B48C"/><rect x="130" y="10" width="10" height="10" fill="#D2B48C"/><rect x="90" y="0" width="10" height="10" fill="#3E2723"/><rect x="100" y="0" width="10" height="10" fill="#3E2723"/><rect x="100" y="10" width="10" height="10" fill="#3E2723"/><rect x="110" y="10" width="10" height="10" fill="#8B5A2B"/><rect x="110" y="20" width="10" height="10" fill="#A0522D"/><rect x="120" y="20" width="10" height="10" fill="#A0522D"/><rect x="110" y="30" width="10" height="10" fill="#A0522D"/><rect x="120" y="30" width="10" height="10" fill="#A0522D"/><rect x="120" y="40" width="10" height="10" fill="#C19A6B"/><rect x="130" y="40" width="10" height="10" fill="#C19A6B"/><rect x="100" y="20" width="10" height="10" fill="#8B5A2B"/><rect x="100" y="30" width="10" height="10" fill="#8B5A2B"/><rect x="20" y="20" width="80" height="30" fill="#A0522D"/><rect x="90" y="50" width="10" height="15" fill="#8B5A2B"/><rect x="100" y="65" width="10" height="15" fill="#8B5A2B"/><rect x="70" y="50" width="10" height="30" fill="#8B5A2B"/><rect x="40" y="50" width="10" height="30" fill="#8B5A2B"/><rect x="20" y="50" width="10" height="15" fill="#8B5A2B"/><rect x="10" y="65" width="10" height="15" fill="#8B5A2B"/><rect x="10" y="30" width="10" height="10" fill="#3E2723"/><rect x="0" y="40" width="10" height="10" fill="#3E2723"/><rect x="0" y="50" width="10" height="10" fill="#3E2723"/><rect x="100" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="70" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="40" y="75" width="10" height="5" fill="#1A1A1A"/><rect x="10" y="75" width="10" height="5" fill="#1A1A1A"/></g></svg></div>'
);
console.log('logo updated');

// 移除 rail-bottom 的牛马管理局（只保留设置）
h = h.replace(
  /        <div style="position:relative;display:inline-block">\s*<button class="rail-item" data-nav="instances"[\s\S]*?<\/div>\s*<button class="rail-item" data-nav="settings"/,
  '        <button class="rail-item" data-nav="settings"'
);
console.log('agents-hq removed from rail');

// 列表头：加入按钮文案由 JS 控制，HTML 只留 id
// 已有 btn-join-qr

fs.writeFileSync(base + 'index.html', h);

// ── 3) app.js：列表头按钮文案 + 我的牛马标题旁加牛马管理局图标 ──
let j = fs.readFileSync(base + 'app.js', 'utf8');

// setupListAction：按钮文案按 nav 类型
j = j.replace(
  `    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('hidden', !showJoin);
    }`,
  `    if (joinBtn) {
      const showJoin = state.nav === 'internalGroup' || state.nav === 'externalGroup' || state.nav === 'externalChat';
      joinBtn.classList.toggle('hidden', !showJoin);
      if (state.nav === 'internalGroup') joinBtn.textContent = t('nav.addProject');
      else if (state.nav === 'externalGroup') joinBtn.textContent = t('nav.addGroup');
      else if (state.nav === 'externalChat') joinBtn.textContent = t('contact.add');
    }`
);
console.log('join btn labels');

// 我的牛马：标题右侧加牛马管理局图标
j = j.replace(
  "    $('list-title').textContent = t(NAV_TITLES[nav] || nav);",
  `    const lt = $('list-title');
    lt.textContent = t(NAV_TITLES[nav] || nav);
    // 我的牛马：标题右侧加牛马管理局图标
    const oldIcon = lt.querySelector('.list-hq-icon');
    if (oldIcon) oldIcon.remove();
    if (nav === 'singleAi') {
      const icon = document.createElement('button');
      icon.className = 'list-hq-icon';
      icon.title = t('nav.instances');
      icon.innerHTML = '<svg viewBox="0 0 100 100" style="width:18px;height:18px"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30,38 C18,32 12,20 16,10"/><path d="M70,38 C82,32 88,20 84,10"/><path d="M28,38 L72,38 L62,68 L50,80 L38,68 Z"/><line x1="40" y1="52" x2="48" y2="52"/><line x1="52" y1="52" x2="60" y2="52"/></g><rect x="36" y="46" width="8" height="8" fill="currentColor"/><rect x="56" y="46" width="8" height="8" fill="currentColor"/></svg>';
      icon.onclick = () => setNav('instances');
      lt.appendChild(icon);
    }`
);
console.log('hq icon in list title');

fs.writeFileSync(base + 'app.js', j);

// ── 4) CSS：list-hq-icon + logo-glyph 适配 ──
let c = fs.readFileSync(base + 'app.css', 'utf8');
c += `
.list-hq-icon {
  border: none; background: transparent; color: var(--muted);
  cursor: pointer; padding: 4px; margin-left: 8px;
  display: inline-flex; align-items: center; border-radius: 6px;
}
.list-hq-icon:hover { background: var(--hover); color: var(--ink); }
.logo-glyph {
  width: 120px; height: 86px;
  background: transparent;
  display: grid; place-items: center;
  box-shadow: none;
}
`;
fs.writeFileSync(base + 'app.css', c);

// ── 5) i18n ──
const zh = JSON.parse(fs.readFileSync(base + 'i18n/zh-CN.json', 'utf8'));
const en = JSON.parse(fs.readFileSync(base + 'i18n/en-US.json', 'utf8'));
zh['nav.addProject'] = '加入项目';
zh['nav.addGroup'] = '加入群聊';
en['nav.addProject'] = 'Join project';
en['nav.addGroup'] = 'Join group';
fs.writeFileSync(base + 'i18n/zh-CN.json', JSON.stringify(zh, null, 2) + '\n');
fs.writeFileSync(base + 'i18n/en-US.json', JSON.stringify(en, null, 2) + '\n');
console.log('i18n', Object.keys(zh).length);

console.log('done');
