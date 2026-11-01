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
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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

/** 旁路认证：这里量的是「装好技能市场之后」的界面，首启/登录由 r35–r38、r68 专项门禁覆盖。
 *  不旁路时干净 profile 会停在首启语言页（z-index 2147483000），弹窗遮罩断言量到的是首启卡而不是市场遮罩。 */
const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
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

  // ① 首屏（正常进入后的主界面；认证已旁路，首启/登录由专门门禁覆盖）
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
  /**
   * 类别这一项第 44 轮修过判据：第 32 轮把"横排胶囊 dshMkLeiP"改成了**下拉框**（样式照上游），
   * 老选择器 .dshMkLeiP 永远数到 0 ⇒ 这条门禁红了 12 轮，红的从来不是产品。
   * 现在量真正的事实：**下拉里有 ≥3 个真实类别 + 一个"全部"**，并且筛选真的生效（见下面的选择断言）。
   * ⚠️ 这段说明**不许写进下面那个反引号模板里** —— 模板字符串里出现反引号会当场截断字符串。
   */
  const kaiChuang = await js(`(async function(){
    const b=document.querySelector('#anNiuJinengShiChangShua'); if(!b) return { __err: 'no-button' };
    b.click();
    const gen=document.querySelector('#dshMkGen');
    const yinCang=gen?gen.classList.contains('yinCang'):true;
    /**
     * **等到"有结果"为止，不是干等 6 秒**（第 49 轮的真机假红）：产品侧这条请求自己带 15 秒上限
     * （duShiChangMuLu 里 AbortSignal.timeout(15000)），拿不到就落一句实话。以前这里固定等 6 秒，
     * 上游慢的时候恰好抓在"正在读取上游目录…"那一秒 ⇒ 判成"目录不可达时不实话"，而类别下拉框还没建出来 ⇒
     * 又连红两条。现在等到出卡片 / 出实话为止（最多 26 秒）；**过完产品自己的上限还在转圈**，那才是真红。
     */
    const JIAZAI = /正在读取|读取中|loading/i;
    let kaPian = 0, xiaoXi = '', leiXuan = null, xuanXiang = 0, dengMs = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 26000) {
      await new Promise((r)=>setTimeout(r,1000));
      const wang=document.querySelector('#dshMkWang');
      kaPian = wang ? wang.querySelectorAll('.dshMkKaP').length : 0;
      xiaoXi = String((document.querySelector('#dshMkXiaoXi')||{}).textContent||'');
      leiXuan = document.querySelector('#dshMkLeiJi select.dshMkLeiXuan') || document.querySelector('#dshMkFenLeiXuan');
      xuanXiang = leiXuan ? (leiXuan.querySelectorAll('option') || []).length : 0;
      if (kaPian > 0 || xuanXiang > 0 || (xiaoXi && !JIAZAI.test(xiaoXi))) break;
      dengMs = Date.now() - t0;
    }
    if (dengMs === 0) dengMs = Date.now() - t0;
    const wang=document.querySelector('#dshMkWang');
    const mask=document.elementFromPoint(Math.round(innerWidth/2), Math.round(innerHeight-24));
    const dianDaoZhu=(document.elementFromPoint(24, 24)||{}).className||'';
    const fenLei = Math.max((document.querySelectorAll('#dshMkLeiJi .dshMkLeiP') || []).length, xuanXiang - 1);
    return { zhanShi: !yinCang, ariaModal: gen?gen.getAttribute('aria-modal'):null, kaPian,
      xiaoXi: xiaoXi.slice(0,120), fenLei, maskLei: String((mask||{}).className||'').slice(0,40),
      zhuLei: String(dianDaoZhu).slice(0,40), dengMs, rengZaiJiaZai: JIAZAI.test(xiaoXi) && kaPian === 0 };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 弹窗：' + JSON.stringify(kaiChuang));
  check('弹窗真的打开了（不是新窗口、不是外链）', kaiChuang.zhanShi === true && kaiChuang.ariaModal === 'true', kaiChuang);
  check('遮罩盖住主界面（左上角命中的是遮罩，不是主界面元素）', /dshMkMask/.test(String(kaiChuang.maskLei || '')), kaiChuang);
  const luLu = Array.isArray(kaiChuang) ? null : kaiChuang;
  if (luLu && luLu.kaPian > 0) {
    check('目录出卡片了（真实上游 plugins.json）', luLu.kaPian >= 5 && luLu.fenLei >= 3, { kaPian: luLu.kaPian, fenLei: luLu.fenLei, dengMs: luLu.dengMs });
  } else {
    check('目录不可达时如实说明（不白屏、不假装有内容）', luLu && luLu.rengZaiJiaZai !== true && /不可用|失败|limit|http|unreachable|no-skill/i.test(String(luLu.xiaoXi || '')), luLu);
  }
  await png('02-dsh-market');

  /**
   * ③′ **类别筛选真的能用**（第 44 轮补）：老门禁只数"类别有几个"，不验"选了它到底生不生效" ⇒
   * 控件即使是个死下拉框也能绿。现在真的改值、派 `change`，看列表跟着变、不报错、切回"全部"还能恢复。
   * （筛选是**带类别重新拉上游**，所以判"不多于全量 + 恢复后仍有卡片"，不去猜具体条数 —— 那是上游数据，不是我们的产品。）
   */
  const shai = await js(`(async function(){
    const sel=document.querySelector('#dshMkLeiJi select.dshMkLeiXuan'); if(!sel) return { __err: 'no-select' };
    const ops=[...(sel.options||[])];
    const fei=ops.find((o)=>String(o.value||'')); if(!fei) return { __err: 'no-category-option' };
    const shu=()=>(document.querySelectorAll('#dshMkWang .dshMkKaP')||[]).length;
    const qian=shu();
    sel.value=fei.value; sel.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise((r)=>setTimeout(r,8000));
    const hou=shu();
    const xiaoXi=((document.querySelector('#dshMkXiaoXi')||{}).textContent||'').slice(0,140);
    sel.value=''; sel.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise((r)=>setTimeout(r,6000));
    return { lei: String(fei.value), qian, hou, huiFu: shu(), xiaoXi };
  })()`.replace(/\n\s*/g, ' '));
  console.log('  · 类别筛选：' + JSON.stringify(shai));
  if (luLu && luLu.kaPian > 0) {
    check('选一个类别后列表按类别重新出（不多于全量），切回"全部"能恢复', !shai.__err && shai.hou <= shai.qian && shai.huiFu >= 5, shai);
    check('筛选过程中没有把错误当成功（不白屏、不假装加载完）', !shai.__err && !/不可用|失败|unreachable|no-skill|限流|http [45]/i.test(String(shai.xiaoXi || '')), shai.xiaoXi || shai.__err);
  } else {
    /**
     * 上游拿不到时**不能把这两条判红**（那是这台机器的网络事实，不是我们的产品），但也**不许静默跳过**：
     * 改判一条真不变量 —— 没有目录数据就不许凭空造出筛选控件，小字必须是实话（不是"加载完成"）。
     */
    check('上游不可达时：不造假控件、不把加载说成完成（小字是实话）', shai.__err === 'no-select'
      && luLu.rengZaiJiaZai !== true && /不可用|失败|limit|http|unreachable|no-skill/i.test(String(luLu.xiaoXi || '')), { shai, xiaoXi: luLu.xiaoXi, dengMs: luLu.dengMs });
  }

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
