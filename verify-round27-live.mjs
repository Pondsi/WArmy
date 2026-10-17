/**
 * 第 27 轮 真机 UI 门禁：本轮新增的两个界面必须在**真实 Electron**里成立
 *   项 2  dsh-market 应用内弹窗（遮罩挡住主界面 / 卡片来自真实目录 / Esc 能关）
 *   项 5 「本地语音识别」卡片（在新机器上如实显示未安装、启用勾不上、按钮是「安装」）
 * 另附首屏截图给你验收（不改动你的实例：独立 user-data-dir + 独立调试端口）。
 *
 * 跑法：node verify-round27-live.mjs        # 会启动一个临时牛马窗口
 *      KEEP_SHOTS=1 node verify-round27-live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './packages/app-shell/scripts/cdp-lib.mjs';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(GEN, 'packages', 'app-shell');
const PORT = Number(process.env.R27_PORT || 9931);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const shots = path.join(os.tmpdir(), 'warmy-r27-shots');

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d === undefined ? '' : ' => ' + JSON.stringify(d).slice(0, 300))); }
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
const profile = path.join(os.tmpdir(), 'warmy-r27-live-' + Date.now());

const child = spawn(electron, [
  '--remote-debugging-port=' + PORT,
  '--disable-features=CalculateNativeWinOcclusion',
  '--user-data-dir=' + profile,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

let c = null;
const jieShu = () => { try { if (c) c.close(); } catch { /* noop */ } try { child.kill('SIGKILL'); } catch { /* noop */ } };

async function png(ming) {
  try {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    await fs.promises.writeFile(path.join(shots, ming + '.png'), Buffer.from(r.data, 'base64'));
    return true;
  } catch { return false; }
}
async function js(biaoDaShi) {
  const r = await c.evaluate('(async function(){ try { return await (' + biaoDaShi + '); } catch (e) { return { __err: String((e && (e.stack || e.message)) || e).slice(0, 300) }; } })()');
  return r;
}

try {
  let shang = false;
  for (let i = 0; i < 100; i++) {
    try { const rr = await fetch('http://127.0.0.1:' + PORT + '/json', { signal: AbortSignal.timeout(1200) }); if (rr.ok) { shang = true; break; } } catch { /* 等 */ }
    await sleep(500);
  }
  if (!shang) { console.log('CDP 起不来'); jieShu(); process.exit(2); }
  await sleep(6000);
  c = await attach(PORT, { biaoQian: 'r27live', callTimeout: 25000 });
  await c.send('Runtime.enable');
  await sleep(2500);

  // ① 首屏（干净 profile 的首次启动样子）
  const shouPing = await js('(function(){ return { title: document.title, yinSiKa: !!document.querySelector("#yinSiTongYiKa, [id*=yinSi]"), huiHuaShu: (document.querySelectorAll(".huiHuaHang, .huiHuaXiang, [id*=huiHua]").length), shuRu: !!document.querySelector("#shuRu"), ceLan: !!document.querySelector("#ceLan, .ceLan"), kuaiZhao: !!document.querySelector("#kuaiZhaoXiaoXi, [id*=kuaiZhao]") }; })()');
  console.log('  · 首屏：' + JSON.stringify(shouPing));
  check('应用起来了（标题 + 输入框在）', !shouPing.__err && shouPing.shuRu === true, shouPing);
  await png('01-shouping');

  // ② 打开设置 → 技能（走应用自己的导航：左栏 [data-nav=settings] + 设置内 #peiZhiDaoHang）
  const daoHang = await js(`(async function(){
    const ceLan=document.querySelector('[data-nav="settings"]'); if (ceLan) ceLan.click();
    await new Promise((r)=>setTimeout(r,1400));
    const nav=(sec)=>document.querySelector('#peiZhiDaoHang button[data-sec="'+sec+'"]');
    const jin=nav('skill'); if (jin) jin.click();
    for (let i=0;i<20;i++){ if (document.querySelector('#anNiuJinengShiChangShua')) break; await new Promise((r)=>setTimeout(r,300)); }
    const he=document.querySelector('#jinengSaoMiaoMuLuJi');
    return { nianLeSheZhi: !!ceLan, nianLeJineng: !!jin, changZai: !!document.querySelector('#anNiuJinengShiChangShua'), saoMiaoMuLu: he?[...he.children].length:0, xuRiKai: !!document.querySelector('#xuRiKaiGuan') };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 设置→技能：' + JSON.stringify(daoHang));
  check('能找到「打开 dsh-market」入口', daoHang.changZai === true, daoHang);

  // ③ 点开弹窗（真实网络：目录应能出卡片；不通就应如实报错而不是白屏）
  const kaiChuang = await js(`(async function(){
    const b=document.querySelector('#anNiuJinengShiChangShua'); if(!b) return { __err: 'no-button' };
    b.click();
    const gen=document.querySelector('#dshMkGen');
    const yinCang=gen?gen.classList.contains('yinCang'):true;
    await new Promise((r)=>setTimeout(r,6000));
    const wang=document.querySelector('#dshMkWang');
    const kaPian=(wang?wang.querySelectorAll('.dshMkKaP').length:0);
    const xiaoXi=(document.querySelector('#dshMkXiaoXi')||{}).textContent||'';
    const mask=document.elementFromPoint(Math.round(innerWidth/2), Math.round(innerHeight-24));
    const dianDaoZhu=(document.elementFromPoint(24, 24)||{}).className||'';
    return { zhanShi: !yinCang, ariaModal: gen?gen.getAttribute('aria-modal'):null, kaPian, xiaoXi: xiaoXi.slice(0,120), fenLei: (document.querySelectorAll('#dshMkLeiJi .dshMkLeiP')||[]).length, maskLei: String(mask.className||'').slice(0,40), zhuLei: String(dianDaoZhu).slice(0,40) };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 弹窗：' + JSON.stringify(kaiChuang));
  check('弹窗真的打开了（不是新窗口、不是外链）', kaiChuang.zhanShi === true && kaiChuang.ariaModal === 'true', kaiChuang);
  check('遮罩盖住主界面（左上角命中的是遮罩，不是主界面元素）', /dshMkMask/.test(String(kaiChuang.maskLei || '')), kaiChuang);
  const luLu = Array.isArray(kaiChuang) ? null : kaiChuang;
  if (luLu && luLu.kaPian > 0) {
    check('目录出卡片了（真实上游 plugins.json）', luLu.kaPian >= 5 && luLu.fenLei >= 3, { kaPian: luLu.kaPian, fenLei: luLu.fenLei });
  } else {
    check('目录不可达时如实说明（不白屏、不假装有内容）', /不可用|失败|limit|http|unreachable|no-skill/i.test(String(luLu.xiaoXi || '')), luLu.xiaoXi);
  }
  await png('02-dsh-market');

  // ④ Esc 关闭
  const guan = await js(`(async function(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await new Promise((r)=>setTimeout(r,400));
    const gen=document.querySelector('#dshMkGen');
    return { yiGuan: gen?gen.classList.contains('yinCang'):true };
  })()`.replace(/\n\s*/g, ' '));
  check('Esc 能关弹窗', guan.yiGuan === true, guan);

  // ⑤ 设置 → 功能 → 本地语音识别（干净 profile：应如实「未安装」，启用勾不上）
  const yuYin = await js(`(async function(){
    const gong=document.querySelector('#peiZhiDaoHang button[data-sec="func"]');
    if (gong) gong.click();
    for (let i=0;i<20;i++){ if (document.querySelector('#benDiYuYinKa')) break; await new Promise((r)=>setTimeout(r,300)); }
    const ka=document.querySelector('#benDiYuYinKa');
    if (!ka) return { __err: 'no-card' };
    const ck=document.querySelector('#benDiYuYinKaiGuan');
    const an=document.querySelector('#anNiuBenDiYuYinCaoZuo');
    const zt=document.querySelector('#benDiYuYinZhuangTai');
    return { jian: true, keJian: !!ka.offsetParent, biaoTi: (ka.querySelector('h2')||{}).textContent||'', zhuangTai: (zt?zt.textContent:'').slice(0,200), anNiu: (an?an.textContent:'').slice(0,40), gouKeYong: ck?ck.disabled:null, gouGou: ck?ck.checked:null };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 本地语音卡片：' + JSON.stringify(yuYin));
  check('「本地语音识别」卡片在设置→功能里', yuYin.jian === true && !yuYin.__err, yuYin);
  check('干净机器上如实显示未安装/状态（不假装已安装）', /未安装|不可用|安装/.test(String(yuYin.zhuangTai || '')), yuYin.zhuangTai);
  check('没装好时启用勾是禁用状态（勾不上）', yuYin.gouKeYong === true, yuYin);
  check('按钮是「安装」（删除只在实际装好后出现）', /安装/.test(String(yuYin.anNiu || '')) && !/删除/.test(String(yuYin.anNiu || '')), yuYin.anNiu);
  await png('03-bendi-yuyin');

  // ⑥ 技能扫描目录：干净 profile 应该只有 1 条默认（第 27 轮 项 3 的验收点）
  const muLu = await js(`(async function(){
    const jin=document.querySelector('#peiZhiDaoHang button[data-sec="skill"]');
    if (jin) jin.click();
    await new Promise((r)=>setTimeout(r,1200));
    const he=document.querySelector('#jinengSaoMiaoMuLuJi');
    const hang=he?[...he.children].length:-1;
    const shanChuAnNiu=he?[...he.querySelectorAll('button')].filter((b)=>/移除|删/.test(b.textContent||'')):[];
    return { hang, shan: shanChuAnNiu.length, quanBuJinYong: shanChuAnNiu.length>0 && shanChuAnNiu.every((b)=>b.disabled), wen: he?(he.textContent||'').slice(0,160):'' };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 扫描目录：' + JSON.stringify(muLu));
  check('扫描目录只有一条默认（不再一屏重复）', muLu.hang === 1, muLu);
  check('默认目录的删除按钮全禁用（不可删除的默认目录）', muLu.quanBuJinYong === true, muLu);

  console.log('\n  · 截图目录：' + shots);
  console.log('  · 临时 profile：' + profile);
  if (!process.env.KEEP_SHOTS) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ } }
  console.log('\n真机 UI：过 ' + pass + ' · 败 ' + fail);
  jieShu();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.log('  [异常] ' + String((e && (e.stack || e.message)) || e).slice(0, 400));
  jieShu();
  process.exit(2);
}
