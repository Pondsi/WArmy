const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
const j = fs.readFileSync(base + 'yingYong.js', 'utf8');
const h = fs.readFileSync(base + 'index.html', 'utf8');

// 从 HTML 抽取所有 id，检查是否有对应绑定或明确不需要绑定
const ids = [...h.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
const noBindNeeded = new Set([
  'yingYong', 'yingYongTi', 'biaoTiLan', 'ceLan', 'lieBiaoLan', 'lieBiaoTi', 'zhuLan', 'kongTai',
  'liaoTianBuJu', 'liaoTianLan', 'mianBanLan', 'liaoTianBiaoTi', 'liaoTianYuanShuju', 'xiaoXiJi', 'duiLieTiao',
  'duiLieCount', 'duiLieTiaoMuJi', 'shuRu', 'attachLieBiao', 'kongZhiTaiMianBan', 'kongZhiTaiShuChu',
  'kongZhiTaiDingTiaoZhengTiao', 'shuRuDingTiaoZhengTiao', 'mianBanTiaoZhengTiao', 'lanTiaoZhengTiao', 'duiHuaKuangGen',
  'duiHuaKuangBiaoTi', 'duiHuaKuangTi', 'duiHuaKuangDongZuoJi', 'touXiangWenJian', 'selfAvatar', 'selfAvatarImg',
  'logoMing', 'logoFu', 'biaoTiLanPinPai', 'biaoTiLanlogo', 'tb-sub', 'biaoTiLanDongZuoJi', 'lieBiaoBiaoTi',
  'pageBuJu', 'pageTi', 'shiLiXiangQing', 'cpSpace', 'cpXiangQingLieBiao', 'dutyXinXi',
  'zhiBiaoJiHe', 'zhiShiKuShuChu', 'jinJiCaiDan', 'jinJiBiaoQian', 'urgencyDd',
]);
const missing = [];
for (const id of ids) {
  if (noBindNeeded.has(id)) continue;
  if (!j.includes(`$('${id}')`) && !j.includes(`'${id}'`)) missing.push(id);
}
console.log('total ids', ids.length);
console.log('ids without any reference in yingYong.js:', missing.join(', ') || '(none)');

// 关键交互绑定
const must = [
  ['ceLan click', "setNav(el.dataset.nav)"],
  ['list search', "$('lieBiaoSouSuo').addEventListener('shuRu'"],
  ['faSong', "$('anNiuFaSong').addEventListener('click'"],
  ['stop all', "$('anNiuTingZhiAll').addEventListener('click'"],
  ['attach', "$('anNiuAttach').addEventListener('click'"],
  ['voice', "$('anNiuYuYin').onclick"],
  ['screenshot', "$('anNiuShot')"],
  ['console', "$('anNiuKongZhiTai')"],
  ['urgency dropdown', "$('jinJiTrigger')"],
  ['window min/max/close', "$('anNiuwinGuanBi')"],
  ['refresh', "$('anNiuuiRefresh')"],
  ['always top', "$('anNiuZongShiDing')"],
  ['kb go', "$('anNiuZhiShiKuGo')"],
  ['smtp add', "$('anNiusmtpTianJia')"],
  ['provider add', "$('anNiuTianJiaProv')"],
  ['list action', "$('lieBiaoDongZuo')"],
  ['sec dropdown', "$('secTrigger')"],
  ['touXiang file', "$('touXiangWenJian')"],
  ['shuRu enter', "$('shuRu').addEventListener('keydown'"],
];
let fail = 0;
for (const [n, k] of must) {
  const ok = j.includes(k);
  console.log(ok ? 'OK  ' : 'FAIL', n);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
