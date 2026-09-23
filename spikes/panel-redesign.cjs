const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let h = fs.readFileSync(base + 'index.html', 'utf8');
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// ── 1) 新文件图标 ──
h = h.replace(
  /<svg viewBox="0 0 24 24" class="ico"><path d="M8 3h7l5 5v13H8V3zm7 1\.5V9h4\.5L15 4\.5z"\/><\/svg>/,
  '<svg viewBox="0 0 100 100" class="ico"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"><path d="M22,24 L56,24 L70,38 L70,86 L22,86 Z"/><polyline points="56,24 56,38 70,38"/></g><g stroke="currentColor" stroke-width="8" stroke-linecap="square"><line x1="76" y1="14" x2="76" y2="30"/><line x1="68" y1="22" x2="84" y2="22"/></g></svg>'
);
console.log('file icon updated');

// ── 2) 右侧面板重设计 ──
const oldPanel = h.match(/        <aside id="mianBanLan">[\s\S]*?<\/aside>/);
if (oldPanel) {
  h = h.replace(oldPanel[0], `        <aside id="mianBanLan">
          <div id="mianBanTiaoZhengTiao" biaoTi="拖动调整宽度"></div>

          <!-- 进度（折叠：百分比条；展开：任务列表） -->
          <div class="mianBanKuai">
            <div class="mianBanKaiGuan" id="jinDuKaiGuan">
              <span data-i18n="panel.jinDu"></span>
              <div class="jinDu" style="flex:1;margin:0 8px"><div id="jinDuTiao" class="jinDuTiao" style="width:0%"></div></div>
              <span id="jinDuWenBen" class="jingYin">0%</span>
              <span class="jianTou">›</span>
            </div>
            <ul id="renwuLieBiao" class="renwuLieBiao yinCang">
              <li class="renwuDone">整理周报 <span class="dian done"></span></li>
              <li class="renwuFail">接口对接 <span class="dian fail"></span></li>
              <li class="renwuJiHuo">值班编排 <span class="dian jiHuo"></span></li>
              <li>知识库归档 <span class="dian"></span></li>
              <li class="renwuAbandoned">旧方案验证 <span class="dian fail"></span></li>
            </ul>
          </div>

          <!-- 项目目录（仅项目/群聊） -->
          <div class="mianBanKuai onlyQun">
            <h3 data-i18n="panel.directory"></h3>
            <div id="muLuHe" class="jingYin">—</div>
          </div>

          <!-- 成员（仅项目/群聊） -->
          <div class="mianBanKuai onlyQun">
            <h3 data-i18n="group.members"></h3>
            <div id="chengYuanJiHe" class="jingYin">—</div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <shuRu id="chengYuanMing" style="flex:1" placeholder=""/>
              <button class="anNiuXiao" id="anNiuChengYuanTianJia">+</button>
            </div>
          </div>

          <!-- 值班者（仅项目/群聊） -->
          <div class="mianBanKuai onlyQun">
            <h3 data-i18n="panel.duty"></h3>
            <div id="dutyXinXi" class="jingYin">—</div>
          </div>

          <!-- 知识库 -->
          <div class="mianBanKuai">
            <h3 data-i18n="knowledge.biaoTi"></h3>
            <shuRu id="zhiShiKuQ" data-i18n-placeholder="knowledge.search" style="width:100%;margin-bottom:6px"/>
            <div style="display:flex;gap:6px">
              <button class="anNiuXiao" id="anNiuZhiShiKuGo" data-i18n="knowledge.search"></button>
              <button class="anNiuXiao" id="anNiuZhiShiKuBaoCun" data-i18n="knowledge.save"></button>
            </div>
            <div id="zhiShiKuShuChu" class="jingYin" style="margin-top:8px;max-height:100px;overflow:auto"></div>
          </div>
        </aside>`);
  console.log('panel redesigned');
}

// ── 3) 更多菜单：搜索浮窗 + 定向勾选 + 导出弹窗 ──
const oldMore = h.match(/              <div class="jinJiDd" id="gengDuoDd">[\s\S]*?<\/div>\n              <button id="anNiuTingZhiAll"/);
if (oldMore) {
  h = h.replace(oldMore[0], `              <div class="jinJiDd" id="gengDuoDd">
                <button class="jinJiTrigger" id="gengDuoTrigger" type="button" data-i18n-title="common.more">
                  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
                </button>
                <div class="jinJiCaiDan gengDuoCaiDanMianBan yinCang" id="gengDuoCaiDan" role="menu">
                  <button type="button" id="caiDanTuBiaoSouSuo" data-i18n="list.search"></button>
                  <biaoQian class="gengDuoJianCha"><shuRu type="checkbox" id="caiDanTuBiaoDingXiang"/> <span data-i18n="group.directed"></span></biaoQian>
                  <button type="button" id="caiDanTuBiaoDaKai" data-i18n="chat.openWindow"></button>
                  <button type="button" id="caiDanTuBiaoDaoChu" data-i18n="chat.export"></button>
                </div>
              </div>
              <button id="anNiuTingZhiAll"`);
  console.log('more menu updated');
}

// ── 4) CSS：任务状态点、面板切换、更多菜单边框 ──
c += `
/* 任务列表状态点 */
.renwuLieBiao li { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.renwuLieBiao li .dian { width: 8px; height: 8px; border-radius: 50%; background: var(--line); flex-shrink: 0; }
.renwuLieBiao li .dian.done { background: var(--accent); }
.renwuLieBiao li .dian.fail { background: var(--danger); }
.renwuLieBiao li .dian.jiHuo { background: #f5a623; }
.renwuLieBiao li.renwuDone { color: var(--muted); }
.renwuLieBiao li.renwuDone .dian { background: var(--accent); }
.renwuLieBiao li.renwuFail { color: var(--muted); }
.renwuLieBiao li.renwuFail .dian { background: var(--danger); }
.renwuLieBiao li.renwuAbandoned { color: var(--muted); text-decoration: line-through; }
.renwuLieBiao li.renwuJiHuo .dian { background: #f5a623; }

/* 面板折叠 */
.mianBanKaiGuan {
  display: flex; align-items: center; cursor: pointer;
  padding: 4px 0; user-select: none;
}
.mianBanKaiGuan .jianTou { transition: transform 0.15s; color: var(--muted); }
.mianBanKaiGuan.daKai .jianTou { transform: rotate(90deg); }

/* 更多菜单边框 */
.gengDuoCaiDanMianBan {
  min-width: 140px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,.16));
  padding: 4px;
  z-index: 500;
}
.gengDuoCaiDanMianBan button,
.gengDuoCaiDanMianBan biaoQian {
  display: flex; align-items: center; gap: 6px;
  width: 100%; border: none; background: transparent;
  padding: 8px 12px; border-radius: 6px;
  font: inherit; font-size: var(--fs-base); color: var(--ink);
  cursor: pointer; text-align: left;
}
.gengDuoCaiDanMianBan button:hover,
.gengDuoCaiDanMianBan biaoQian:hover { background: var(--hover); }
.gengDuoJianCha { margin: 0; }

/* onlyQun: 仅项目/群聊显示 */
.onlyQun.yinCang { display: none !important; }
`;

fs.writeFileSync(base + 'index.html', h);
fs.writeFileSync(base + 'yingYong.css', c);
console.log('html/css done');
