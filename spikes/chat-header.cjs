const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let h = fs.readFileSync(base + 'index.html', 'utf8');
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// ── 1) 聊天头部：只留控制台+安全模式+停止，其余进「…」菜单 ──
const oldActions = h.match(/            <div class="liaoTianDongZuoJi">[\s\S]*?<\/div>\n          <\/header>/);
if (oldActions) {
  h = h.replace(oldActions[0], `            <div class="liaoTianDongZuoJi">
              <button id="anNiuKongZhiTai" class="anNiuTuBiao" data-i18n-title="tip.console" aria-label="console">
                <svg class="ico" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="16" width="80" height="68" rx="6"/><polyline points="28,40 42,52 28,64"/><line x1="50" y1="64" x2="72" y2="64"/></g></svg>
              </button>
              <div class="jinJiDd" id="secDd">
                <button class="jinJiTrigger" id="secTrigger" type="button" data-i18n-title="chat.security">
                  <svg class="ico secWarn yinCang" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v11h-2V3zm0 13h2v2h-2v-2z"/></svg>
                  <span id="secBiaoQian" data-i18n="chat.securityNormal"></span>
                  <svg class="ico jinJiJianTou" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6z"/></svg>
                </button>
                <div class="jinJiCaiDan yinCang" id="secCaiDan" role="menu">
                  <button type="button" data-s="normal" data-i18n="chat.securityNormal"></button>
                  <button type="button" data-s="strict" data-i18n="chat.securityStrict"></button>
                  <button type="button" data-s="full" data-i18n="chat.securityFull"></button>
                </div>
              </div>
              <div class="jinJiDd" id="gengDuoDd">
                <button class="jinJiTrigger" id="gengDuoTrigger" type="button" data-i18n-title="common.more">
                  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
                </button>
                <div class="jinJiCaiDan yinCang" id="gengDuoCaiDan" role="menu">
                  <button type="button" id="caiDanTuBiaoSouSuo" data-i18n="list.search"></button>
                  <button type="button" id="caiDanTuBiaoDingXiang" data-i18n="group.directed"></button>
                  <button type="button" id="caiDanTuBiaoDaKai" data-i18n="chat.openWindow"></button>
                  <button type="button" id="caiDanTuBiaoDaoChu" data-i18n="chat.export"></button>
                </div>
              </div>
              <button id="anNiuTingZhiAll" class="anNiuTingZhi" data-i18n="chat.stopAll" data-i18n-title="chat.stopAllTip"></button>
            </div>
          </header>`);
  console.log('chat header simplified');
}

// ── 2) 扫码加入 → 移到列表列（创建按钮旁） ──
if (!h.includes('anNiuJiaRuqr')) {
  h = h.replace(
    '        <button id="lieBiaoDongZuo" class="anNiuXiao yinCang"></button>',
    '        <div style="display:flex;gap:6px;align-items:center">\n          <button id="anNiuJiaRuqr" class="anNiuXiao yinCang" data-i18n="join.scanQr" data-i18n-title="join.qrHint"></button>\n          <button id="lieBiaoDongZuo" class="anNiuXiao yinCang"></button>\n        </div>'
  );
  console.log('jiaRuqr moved to list header');
}

// ── 3) CSS：更多菜单样式 ──
if (!c.includes('.gengDuoDd')) {
  c += `
.gengDuoDd { position: relative; display: inline-flex; }
.jinJiTrigger .ico { width: 18px; height: 18px; fill: currentColor; }
`;
}

fs.writeFileSync(base + 'index.html', h);
fs.writeFileSync(base + 'renderer.css', c);
// 注意：css 文件名
fs.writeFileSync(base + 'yingYong.css', c);
console.log('html/css updated');
