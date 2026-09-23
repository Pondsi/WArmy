const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'renderer/yingYong.css', 'utf8');

// ═══════════════════════════════════════════════════
// 1. 卡顿根因：去掉 content-visibility（会触发 scroll-driven layout）
//    改用 contain: strict（更可预测）
// ═══════════════════════════════════════════════════
c = c.replace(
  `.xiaoXiJi {
  flex: 1; overflow: auto; padding: var(--sp-4);
  content-visibility: auto;
  contain-intrinsic-size: auto 500px;
}`,
  `.xiaoXiJi {
  flex: 1; overflow: auto; padding: var(--sp-4);
  contain: strict;
  height: 0; /* flex 内必须给 0 才能正确撑开 */
}`
);
console.log('xiaoXiJi contain:strict');

c = c.replace(
  `#shuRu {
  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);
  padding: 10px; font: inherit; outline: none; background: var(--input-bg);
  contain: layout style;
  will-change: contents;
}`,
  `#shuRu {
  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);
  padding: 10px; font: inherit; outline: none; background: var(--input-bg);
}`
);
console.log('shuRu cleaned');

// ═══════════════════════════════════════════════════
// 2. 主进程：backgroundThrottling: false（防止渲染进程被节流）
// ═══════════════════════════════════════════════════
m = m.replace(
  `    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    win?.show();
    boot('window ready-to-show');
  });`,
  `    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
    icon: path.join(__dirname, 'renderer', 'icons', 'logo-color.svg'),
  });
  // 任务栏/标题栏图标
  try {
    const iconPath = path.join(__dirname, 'renderer', 'icons', 'logo-color.png');
    if (fs.existsSync(iconPath)) win.setIcon(iconPath);
  } catch { /* noop */ }
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    win?.show();
    boot('window ready-to-show');
  });`
);
console.log('backgroundThrottling disabled + icon');

// ═══════════════════════════════════════════════════
// 3. 系统托盘：用原生 Image 创建图标
// ═══════════════════════════════════════════════════
m = m.replace(
  `    const img = nativeImage.createEmpty();
    const t = new Tray(img);`,
  `    // 用16x16棕色方块作为托盘图标（后续可换真图标文件）
    const img = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAAgQAAF/lPurAAAAAElFTkSuQmCC', 'base64')
    );
    const t = new Tray(img);`
);
console.log('tray icon added');

// ═══════════════════════════════════════════════════
// 4. 我的页：点击名字直接编辑，去掉用户名输入框
// ═══════════════════════════════════════════════════
j = j.replace(
  `          <div class="field" style="margin-bottom:10px">
            <biaoQian for="pMing">${t('wo.username')}</biaoQian>
            <shuRu id="pMing" ming="username" autocomplete="username" spellcheck="false" value="${escapeHtml(p.username)}" biaoTi="${escapeHtml(t('wo.username'))}"/>
          </div>`,
  `          <div class="jingYin" style="margin-bottom:10px">${t('wo.avatarHint')}</div>`
);
// 名字显示改为可编辑
j = j.replace(
  `<div id="pMingDisplay" class="usernameDisplay" biaoTi="${escapeHtml(t('wo.username'))}">${escapeHtml(p.username)}</div>`,
  `<shuRu id="pMing" class="usernameShuRu" value="${escapeHtml(p.username)}" biaoTi="${escapeHtml(t('wo.username'))}"/>`
);
console.log('wo page inline edit');

// ═══════════════════════════════════════════════════
// 5. 设置两栏：真正实现
// ═══════════════════════════════════════════════════
// 设置页 HTML 改为两栏
j = j.replace(
  "        <h1>${t('nav.settings')}</h1>\n        <div class=\"sheZhiSection\"><h2 style=\"color:var(--accent)\">${t('settings.section.ui')}</h2></div>",
  `        <div class="peiZhiBuJu">
        <div class="peiZhiDaoHang" id="peiZhiDaoHang">
          <button data-sec="ui" class="qiYong">${t('settings.section.ui')}</button>
          <button data-sec="notify">${t('settings.section.notify')}</button>
          <button data-sec="model">${t('settings.section.model')}</button>
          <button data-sec="func">${t('settings.section.func')}</button>
        </div>
        <div class="peiZhiNeiRong" id="peiZhiNeiRong">
        <div class="sheZhiSection"><h2 style="color:var(--accent)">${t('settings.section.ui')}</h2></div>`
);
// 结尾闭合
j = j.replace(
  `        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.about')}</h2>
          <div class="jingYin">${t('about.version')} 0.1.0 · WArmy · ${t('yingYong.subtitle')}</div>
          <div style="margin-top:10px">
            <button class="anNiuXiao" id="anNiuAboutGengXin">${t('about.checkUpdate')}</button>
            <span class="jingYin" id="aboutUpd"></span>
          </div>
        </div>\`;`,
  `        <div class="sheZhiSection sheZhiKa">
          <h2>${t('settings.about')}</h2>
          <div class="jingYin">${t('about.version')} 0.1.0 · WArmy · ${t('yingYong.subtitle')}</div>
          <div style="margin-top:10px">
            <button class="anNiuXiao" id="anNiuAboutGengXin">${t('about.checkUpdate')}</button>
            <span class="jingYin" id="aboutUpd"></span>
          </div>
        </div>
        </div></div>\`;`
);
console.log('settings two-column');

// 设置导航绑定
if (!j.includes('peiZhiDaoHang')) {
  j = j.replace(
    "      $('xuanZeYuYan').onchange = async (e) => {",
    `      // 设置两栏导航
      $('peiZhiDaoHang')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sec]');
        if (!btn) return;
        $('peiZhiDaoHang').querySelectorAll('button').forEach((b) => b.classList.toggle('qiYong', b === btn));
        // 滚动到对应区块
        const sec = btn.dataset.sec;
        const headers = { ui: 'settings.section.ui', notify: 'settings.section.notify', model: 'settings.section.model', func: 'settings.section.func' };
        const h2s = document.querySelectorAll('#peiZhiNeiRong h2');
        for (const h2 of h2s) {
          if (h2.textContent === t(headers[sec])) {
            h2.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      });

      $('xuanZeYuYan').onchange = async (e) => {`
  );
  console.log('settings nav bound');
}

// ═══════════════════════════════════════════════════
// 6. CSS：usernameShuRu
// ═══════════════════════════════════════════════════
c += `
.usernameShuRu {
  font-size: 18px; font-weight: 600;
  border: none; border-bottom: 1px dashed transparent;
  background: transparent; color: var(--ink);
  padding: 2px 0; outline: none; width: 200px;
}
.usernameShuRu:hover, .usernameShuRu:focus {
  border-bottom-color: var(--muted);
}
`;

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'renderer/yingYong.css', c);
console.log('done');
