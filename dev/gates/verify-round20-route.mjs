/**
 * 第 20 轮 · 任务6：中途回复/思考的悬停路由提示
 *
 * 产品定稿：
 *   · 只是在用默认模型 ⇒ **只显示这一个模型名**；
 *   · 有任何变动 ⇒ 把「默认 / 当前 / 是否降级 / 调用链 / 依据」逐条写出来。
 *
 * 直接从 app.js 抠出 `luYouTiShi` 真函数来跑（不另写一份等价实现），
 * 再核对主进程确实把路由事实随流式分片带出去。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-route.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const kai = app.indexOf('function luYouTiShi(lu)');
const jie = app.indexOf('function xuanRanLiuShiKuai(sid, b)');
if (kai < 0 || jie < 0) { console.log('  [败] 找不到 luYouTiShi'); process.exit(1); }
const yuanMa = app.slice(kai, jie);

const sb = {
  tOr: (_k, mo) => mo,
  fmtKey: () => '',   // 模拟 i18n 未命中，走中文兜底
};
vm.createContext(sb);
vm.runInContext(yuanMa + '\nthis.luYouTiShi = luYouTiShi;', sb);
const f = sb.luYouTiShi;

console.log('\n任务6 · 悬停路由提示');

// 1. 纯默认：只显示模型名，一行
{
  const s = f({ moRen: 'mimo-v2.6-flash', dangQian: 'mimo-v2.6-flash', jiangJi: [], why: 'default', lianWei: -1, lianChang: 0, zhiNeng: false });
  shuo(s === '模型：mimo-v2.6-flash', '只用默认模型 ⇒ 只显示一行模型名', JSON.stringify(s));
}

// 2. 降级：必须写出默认、当前、跳过了谁
{
  const s = f({ moRen: 'mimo-v2.6-pro', dangQian: 'mimo-v2.6-flash', jiangJi: ['mimo-v2.6-pro'], why: 'chain', lianWei: 1, lianChang: 3, zhiNeng: false });
  shuo(s.includes('当前模型：mimo-v2.6-flash'), '降级 ⇒ 写出当前模型');
  shuo(s.includes('默认模型：mimo-v2.6-pro'), '降级 ⇒ 写出默认模型');
  shuo(s.includes('已降级') && s.includes('mimo-v2.6-pro'), '降级 ⇒ 写出跳过了谁', s);
  shuo(s.includes('第 2 / 3 个'), '降级 ⇒ 写出调用链位置', s);
  shuo(!s.includes('未降级'), '降级时不能同时写"未降级"');
}

// 3. 智能模式：默认模型写"智能"
{
  const s = f({ moRen: '', dangQian: 'qwen3.8-27b', jiangJi: [], why: 'smart', lianWei: 0, lianChang: 2, zhiNeng: true });
  shuo(s.includes('智能'), '智能模式 ⇒ 默认模型标为智能', s);
  shuo(s.includes('未降级'), '智能模式且无降级 ⇒ 写明未降级');
  shuo(s.split('\n').length > 1, '智能模式属于"有变动" ⇒ 多行');
}

// 4. 走了调用链但没降级、默认就是它 ⇒ 仍算变动（链在起作用），不能压成一行
{
  const s = f({ moRen: 'a', dangQian: 'a', jiangJi: [], why: 'chain', lianWei: 0, lianChang: 2, zhiNeng: false });
  shuo(s.split('\n').length > 1, '按调用链选中 ⇒ 写明链情况（多行）', s);
}

// 5. 没有数据 ⇒ 不显示（不编）
shuo(f(null) === '' && f({}) === '', '拿不到路由事实 ⇒ 不显示任何提示');

// 主进程：路由事实随流式分片带出去
console.log('\n主进程登记与广播');
{
  const main = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
  shuo(/luYou:\s*benLunLuYou\.get\(/.test(main), '流式分片携带 luYou');
  shuo(/benLunLuYou\.set\(/.test(main), '选型时登记路由事实');
  shuo(/jiangJi:\s*yiShiBai\.slice\(\)/.test(main), '降级清单取自真实失败记录 yiShiBai');
  shuo(/=== '__smart__'/.test(main), '智能模式判据与 MoXingJueCeShuRu 一致（__smart__ / 空串）');
}

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
