const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'renderer/yingYong.css', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── 1) 标题栏：去掉文字，只留 Logo ──
h = h.replace(
  '<span class="biaoTiLanPinPai" id="biaoTiLanPinPai">WArmy</span>\n        <span class="jingYin" id="tb-sub"></span>',
  '<div class="tb-logo-cow" id="tb-logo-cow"></div>'
);
console.log('biaoTiLan logo');

// ── 2) 我的第一行：Logo + 品牌文字 ──
// 在 ceLan wo 按钮里，已有 touXiang；改为在 list biaoTi 区域显示品牌
// 我的牛马列表头：标题 + 牛马管理局图标（已有）
// 我 的页面：加品牌条
if (!j.includes('pinPaiStrip')) {
  j = j.replace(
    "      box.innerHTML = `\n        <h1>${t('nav.touXiang')}</h1>\n        <div class=\"woStrip\">",
    "      box.innerHTML = `\n        <div class=\"pinPaiStrip\">\n          <div class=\"pinPaiCow\"><svg viewBox=\"0 0 140 100\" style=\"width:48px;height:34px\"><g><rect x=\"120\" y=\"0\" width=\"10\" height=\"10\" fill=\"#D2B48C\"/><rect x=\"130\" y=\"10\" width=\"10\" height=\"10\" fill=\"#D2B48C\"/><rect x=\"90\" y=\"0\" width=\"10\" height=\"10\" fill=\"#3E2723\"/><rect x=\"100\" y=\"0\" width=\"10\" height=\"10\" fill=\"#3E2723\"/><rect x=\"100\" y=\"10\" width=\"10\" height=\"10\" fill=\"#3E2723\"/><rect x=\"110\" y=\"10\" width=\"10\" height=\"10\" fill=\"#8B5A2B\"/><rect x=\"110\" y=\"20\" width=\"10\" height=\"10\" fill=\"#A0522D\"/><rect x=\"120\" y=\"20\" width=\"10\" height=\"10\" fill=\"#A0522D\"/><rect x=\"110\" y=\"30\" width=\"10\" height=\"10\" fill=\"#A0522D\"/><rect x=\"120\" y=\"30\" width=\"10\" height=\"10\" fill=\"#A0522D\"/><rect x=\"120\" y=\"40\" width=\"10\" height=\"10\" fill=\"#C19A6B\"/><rect x=\"130\" y=\"40\" width=\"10\" height=\"10\" fill=\"#C19A6B\"/><rect x=\"100\" y=\"20\" width=\"10\" height=\"10\" fill=\"#8B5A2B\"/><rect x=\"100\" y=\"30\" width=\"10\" height=\"10\" fill=\"#8B5A2B\"/><rect x=\"20\" y=\"20\" width=\"80\" height=\"30\" fill=\"#A0522D\"/><rect x=\"90\" y=\"50\" width=\"10\" height=\"15\" fill=\"#8B5A2B\"/><rect x=\"100\" y=\"65\" width=\"10\" height=\"15\" fill=\"#8B5A2B\"/><rect x=\"70\" y=\"50\" width=\"10\" height=\"30\" fill=\"#8B5A2B\"/><rect x=\"40\" y=\"50\" width=\"10\" height=\"30\" fill=\"#8B5A2B\"/><rect x=\"20\" y=\"50\" width=\"10\" height=\"15\" fill=\"#8B5A2B\"/><rect x=\"10\" y=\"65\" width=\"10\" height=\"15\" fill=\"#8B5A2B\"/><rect x=\"10\" y=\"30\" width=\"10\" height=\"10\" fill=\"#3E2723\"/><rect x=\"0\" y=\"40\" width=\"10\" height=\"10\" fill=\"#3E2723\"/><rect x=\"0\" y=\"50\" width=\"10\" height=\"10\" fill=\"#3E2723\"/></g></svg></div>\n          <div>\n            <div class=\"pinPaiMing\">无限牛马 WArmy</div>\n            <div class=\"pinPaiFu\">Workhorse Army</div>\n          </div>\n        </div>\n        <div class=\"woStrip\">"
  );
  console.log('brand strip added');
}

// ── 3) 我的牛马：默认选中第一个聊天 ──
j = j.replace(
  "    setNav('singleAi');\n    refreshMetrics();",
  `    setNav('singleAi');
    // 默认选中第一个聊天
    setTimeout(() => {
      const first = state.instances[0] || state.chats.find((x) => x.kind === 'single');
      if (first) openChat('single', first.id, first.name);
    }, 100);
    refreshMetrics();`
);
console.log('auto-select first chat');

// ── 4) 系统托盘：双击打开，右键仅退出 ──
m = m.replace(
  `    t.setToolTip('WArmy');
    t.setContextMenu(
      Menu.buildFromTemplate([
        { biaoQian: '显示主窗口', click: () => { win?.show(); win?.focus(); } },
        { type: 'separator' },
        { biaoQian: '退出', click: () => { app.quit(); } },
      ])
    );
    t.on('click', () => {
      if (win?.isVisible()) win.hide();
      else { win?.show(); win?.focus(); }
    });`,
  `    t.setToolTip('WArmy');
    // 右键仅「退出」
    t.setContextMenu(
      Menu.buildFromTemplate([
        { biaoQian: '退出', click: () => { app.quit(); } },
      ])
    );
    // 双击打开主窗口
    t.on('double-click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });`
);
console.log('tray updated');

// ── 5) 设置两栏布局 ──
c += `
/* 设置两栏 */
.peiZhiBuJu {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 0;
  height: 100%;
  min-height: 0;
}
.peiZhiDaoHang {
  border-right: 1px solid var(--line);
  padding: 16px 0;
  background: var(--card);
}
.peiZhiDaoHang button {
  display: block; width: 100%;
  border: none; background: transparent;
  padding: 10px 16px; text-align: left;
  font: inherit; font-size: var(--fs-base);
  color: var(--ink); cursor: pointer;
}
.peiZhiDaoHang button:hover { background: var(--hover); }
.peiZhiDaoHang button.qiYong { background: var(--accent); color: #fff; }
.peiZhiNeiRong {
  overflow: auto; padding: 16px 20px;
}
/* 品牌条 */
.pinPaiStrip {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0 16px;
}
.pinPaiCow { flex-shrink: 0; }
.pinPaiMing { font-size: 18px; font-weight: 700; }
.pinPaiFu { font-size: 12px; color: var(--muted); letter-spacing: 0.06em; }
.tb-logo-cow {
  width: 28px; height: 20px;
  background: url("data:image/svg+xml,...") no-repeat center;
}
`;

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'renderer/yingYong.css', c);
fs.writeFileSync(base + 'preload.cjs', p);
console.log('done');
