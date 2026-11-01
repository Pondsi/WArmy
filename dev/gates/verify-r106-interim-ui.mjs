import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const port = Number(process.env.R106_PORT || 10306);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r106-interim-'));
const sid = 'r106-interim';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [{ id: sid, ming: '界面验收', name: '界面验收', status: 'running', chain: [], chainDisabled: [] }],
}));
const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(pkg, 'node_modules/electron/dist/electron.exe'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, path.join(pkg, 'dist/electron-main.js'),
], { cwd: pkg, env, stdio: 'ignore' });
let c;
let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('PASS ' + name); };
const evaluate = async (expression) => {
  const result = await c.evaluate(expression);
  assert.ok(!result?.__exc, 'Renderer evaluation failed: ' + result?.__exc);
  return result;
};
try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) {
    try { c = await attach(port, { matchUrlIncludes: 'index.html', callTimeout: 15000 }); }
    catch { await sleep(150); }
  }
  assert.ok(c, 'Electron dev app did not start');
  await c.send('Runtime.enable');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evaluate(`window.warmy.chatLogAppend({sessionId:${JSON.stringify(sid)},role:'user',content:'界面验收会话'})`);
  await c.send('Page.reload');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evaluate(`document.querySelector('[data-nav="singleAi"]').click()`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')`);
  await evaluate(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu').click()`);
  await c.waitFor(`window.__r35?.huiHua() === ${JSON.stringify(sid)}`);
  check('真实应用选中临时会话，无模型调用', true);
  const micGap = await evaluate(`(() => {
    const a = document.querySelector('#anNiuYuYin svg')?.getBoundingClientRect();
    const b = document.querySelector('#anNiuYuYinXiaLa svg')?.getBoundingClientRect();
    return a && b ? { gap: Math.round(b.left - a.right), mic: Math.round(a.width), arrow: Math.round(b.width) } : null;
  })()`);
  check('话筒图标与右侧下拉箭头挨着（视觉间距 ≤4px）', !!micGap && micGap.gap >= -2 && micGap.gap <= 4, JSON.stringify(micGap));
  const t = Date.now() + 1000;
  await evaluate(`(() => {
    window.__r35.tian({role:'wo', text:'检查12条中间回复', ts:${t}});
    const reasoningDuan = Array.from({length:13}, (_,i)=>({ts:${t}+i*100+10,text:'思考段 '+(i+1)}));
    const zhongJian = Array.from({length:12}, (_,i)=>({ts:${t}+i*100+50,text:'**进度 '+(i+1)+'**：已完成本步骤。'}));
    window.__r35.tian({role:'them',text:'最终回复保留。',ts:${t}+1400,reasoningDuan,zhongJian});
    window.__r35.hangDong({hao:'r106-op',ts:${t}+80,tsEnd:${t}+90,op:'读取验收文件',raw:'read_file',detail:'fixture.txt',status:'ok',ms:10});
    return true;
  })()`);
  const snapshot = () => evaluate(`(() => {
    const row=[...document.querySelectorAll('#xiaoXiJi .xiaoXi.them')].at(-1);
    return { mids:[...row.querySelectorAll('.zhongJianKa')].map(n=>({
      tag:n.tagName,summary:!!n.querySelector('summary'),open:n.open,
      text:n.textContent,visible:getComputedStyle(n).display!=='none' && n.getBoundingClientRect().height>0,
      bodyVisible:(() => { const b=n.querySelector('.zhongJianHuiFu'); return !!b && (b.checkVisibility ? b.checkVisibility({checkVisibilityCSS:true}) : b.getBoundingClientRect().height>0); })(),
      shadow:getComputedStyle(n).boxShadow,key:n.dataset.key||''
    })),segs:[...row.querySelectorAll('.guoChengDuan')].map(n=>({open:n.open,fen:Number(n.dataset.fen),acts:n.querySelectorAll('.xingDongZu').length})),
    text:row.querySelector('.bubble')?.textContent, nested:row.querySelectorAll('.guoChengLie .guoChengLie').length };
  })()`);
  const initial = await snapshot();
  check('12条中间回复完整存在', initial.mids.length === 12);
  check('中间回复是独立可折叠框：details+summary+默认展开', initial.mids.every(n => n.tag === 'DETAILS' && n.summary && n.open && n.key.startsWith('mid:')));
  check('所有浮雕内容可见且保留Markdown', initial.mids.every((n,i) => n.visible && n.bodyVisible && n.shadow !== 'none' && n.text.includes('进度 '+(i+1))));
  check('13段执行过程仍默认折叠', initial.segs.length === 13 && initial.segs.every(n=>n.open === false));
  check('操作按时间落在第一条中间回复之后的执行段（不是全塞在第 0 段）',
    initial.segs.find(n=>n.fen===1)?.acts === 1 && initial.segs.reduce((n,s)=>n+s.acts,0) === 1);
  check('最终回复不变，且执行过程没有嵌套容器（流式嵌套已修）', initial.text === '最终回复保留。' && initial.nested === 0);
  // 中间回复：用户手动折叠后，重绘必须保持折叠；再点一次恢复展开
  await evaluate(`document.querySelector('.xiaoXi.them:last-child .zhongJianKa > summary').click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them:last-child .zhongJianKa').open === false`, { timeout: 3000 });
  const afterClick = await snapshot();
  check('中间回复可以被用户手动折叠（默认展开、手动折叠生效）', afterClick.mids[0].open === false && afterClick.mids[0].bodyVisible === false);
  await evaluate('window.__r35.chongHua()');
  check('重绘后用户折叠的中间回复保持折叠（不会被程序强行展开）', (await snapshot()).mids[0].open === false);
  await evaluate(`document.querySelector('.xiaoXi.them:last-child .zhongJianKa > summary').click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them:last-child .zhongJianKa').open === true`, { timeout: 3000 });
  check('中间回复可再次展开', (await snapshot()).mids[0].open === true && (await snapshot()).mids[0].bodyVisible === true);
  const summarySelector = '.xiaoXi.them:last-child .guoChengDuan > summary';
  await evaluate(`document.querySelector(${JSON.stringify(summarySelector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const hit = await c.clickSelector(summarySelector);
  console.log('SUMMARY-HIT ' + JSON.stringify(hit));
  /**
   * 坐标点击只用来验证"summary 没被遮挡"（上面的 hit 命中 SUMMARY）。
   * 它可能已经把段展开了（命中即默认动作生效），所以后面按**当前真实状态**决定是否再点，
   * 避免"坐标点一次开 + 元素点一次关"这种仪器自己造成的假红。
   */
  const wasOpen = await evaluate(`document.querySelector(${JSON.stringify(summarySelector)}).parentElement.open`);
  if (!wasOpen) await evaluate(`document.querySelector(${JSON.stringify(summarySelector)}).click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them:last-child .guoChengDuan').open === true`, { timeout: 3000 });
  check('执行过程仍能单独展开', (await snapshot()).segs[0].open === true);
  const nowOpen = await evaluate(`document.querySelector(${JSON.stringify(summarySelector)}).parentElement.open`);
  if (nowOpen) await evaluate(`document.querySelector(${JSON.stringify(summarySelector)}).click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them:last-child .guoChengDuan').open === false`, { timeout: 3000 });
  check('执行过程仍能单独折叠', (await snapshot()).segs[0].open === false);
  await evaluate('window.__r35.chongHua()');
  check('重绘后12张浮雕仍可见', (await snapshot()).mids.filter(n=>n.visible).length === 12);
  const planBtn = await evaluate(`(() => {
    window.__r35.planZhongDuan('要求 6000 字，实际只写到约 5686 字');
    const b = document.querySelector('.huiFuRenWuBtn');
    const r = document.querySelector('.huiFuRenWuYuanYin');
    return { btn: !!b, reason: r?.textContent || '', disabled: !!b?.disabled };
  })()`);
  check('中断后出现继续按钮，并把真实原因写在旁边（不是无来由的按钮）',
    planBtn.btn && !planBtn.disabled && planBtn.reason.includes('6000'));
  const ackResume = await evaluate(`window.__r35.jueCeAck('resume')`);
  check('决策卡选「接着干」后继续按钮整条收掉（不会让用户再派一轮）',
    !ackResume.btn && !ackResume.interrupted && !ackResume.disabled);
  await evaluate(`window.__r35.planZhongDuan('模型调用失败')`);
  const ackSwitch = await evaluate(`window.__r35.jueCeAck('switch-model')`);
  check('换模型分支保留继续按钮且复位为可点（改完设置还要能继续）',
    ackSwitch.btn && !ackSwitch.disabled && ackSwitch.interrupted);
  await evaluate('window.__r35.planQing()');
  /* 第 107 轮：引导卡默认位置 + 创建牛马只指路 */
  await evaluate('window.__startGuide.open(false)');
  await c.waitFor('!!document.querySelector("#startGuide")', { timeout: 3000 });
  const guideGeo = await evaluate(`(() => {
    const g = document.querySelector('#startGuide').getBoundingClientRect();
    const i = document.querySelector('.shuRuQu').getBoundingClientRect();
    return { bottom: Math.round(g.bottom), mid: Math.round(i.top + i.height / 2), rightGap: Math.round(innerWidth - g.right) };
  })()`);
  check('引导卡默认在右下角、底边对齐聊天输入区中线', Math.abs(guideGeo.bottom - guideGeo.mid) <= 3 && Math.abs(guideGeo.rightGap - 18) <= 2, JSON.stringify(guideGeo));
  await evaluate('window.__r35.guideNiuma()');
  await sleep(350);
  const guideClick = await evaluate(`({
    dialogOpen: !document.querySelector('#duiHuaKuangGen')?.classList.contains('yinCang'),
    pulsed: !!document.querySelector('#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao.startGuidePulse'),
  })`);
  check('创建牛马只高亮第二列按钮、不替用户打开创建窗', guideClick.pulsed && !guideClick.dialogOpen, JSON.stringify(guideClick));
  /* 第 107 轮：定时导出弹窗字段齐全 */
  await evaluate('window.__showDingShiDaoChuDialog()');
  await c.waitFor('!!document.querySelector("#dscLocations")', { timeout: 3000 });
  const dsc = await evaluate(`({
    next: !!document.querySelector('#dscNext'),
    cycles: document.querySelector('#dscCycles')?.type === 'number' && document.querySelector('#dscCycles')?.min === '0' && document.querySelector('#dscCycles')?.value === '0',
    interval: document.querySelector('#dscInterval')?.type === 'number' && document.querySelector('#dscInterval')?.min === '1',
    intervalHuman: String(document.querySelector('#dscIntervalHuman')?.textContent || ''),
    skip: !!document.querySelector('#dscSkip'), encrypt: !!document.querySelector('#dscEncrypt'),
    requireGone: !document.querySelector('#dscRequire'),
    cats: document.querySelectorAll('[data-scope-cat]').length,
    chatAll: !!document.querySelector('[data-scope-chat-all]'),
    kbs: document.querySelectorAll('[data-scope-kb]').length,
    from: !!document.querySelector('[data-scope-from]'), to: !!document.querySelector('[data-scope-to]'),
    locs: document.querySelectorAll('#dscLocations > .shiLiHang').length,
    locUser: !!document.querySelector('[data-dsc-loc-user]'), locPass: !!document.querySelector('[data-dsc-loc-pass]'),
    add: !!document.querySelector('#dscAddLoc'),
  })`);
  check('定时导出弹窗：数字次数/秒级间隔+换算/无旧凭证/对话+知识库+时间范围/位置凭证齐全',
    dsc.next && dsc.cycles && dsc.interval && dsc.intervalHuman && dsc.skip && dsc.encrypt && dsc.requireGone
    && dsc.cats >= 6 && dsc.chatAll && dsc.kbs === 3 && dsc.from && dsc.to
    && dsc.locs >= 1 && dsc.locUser && dsc.locPass && dsc.add, JSON.stringify(dsc));
  /* 导入也要有同一套分类选项 */
  await evaluate(`void window.__showVaultImportScopeDialog()`);
  await c.waitFor('!!document.querySelector("#duiHuaKuangTi [data-scope-cat]")', { timeout: 3000 });
  const vis = await evaluate(`({ cats: document.querySelectorAll('#duiHuaKuangTi [data-scope-cat]').length, checked: [...document.querySelectorAll('#duiHuaKuangTi [data-scope-cat]')].every(x=>x.checked), buttons: document.querySelectorAll('#duiHuaKuangDongZuoJi button').length })`);
  check('导入弹窗提供同一套类别（默认全选、可取消）', vis.cats === 6 && vis.checked && vis.buttons === 2, JSON.stringify(vis));
  await evaluate(`document.querySelector('#duiHuaKuangDongZuoJi button')?.click()`);
  await evaluate(`document.querySelector('#duiHuaKuangGen').classList.add('yinCang')`);
  await evaluate('window.__startGuide.close()');
  await c.send('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});
  check('窄窗口无整页横向溢出', await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector('.xiaoXi.them:last-child .zhongJianKa').scrollIntoView({block:'center'})`);
  if (process.env.R106_KEEP === '1') await c.snap(path.join(profile,'interim.png'));
  check('渲染进程无未处理异常', c.errors().length === 0);
  console.log(`verify-r106-interim-ui: ${passed} PASS / 0 FAIL`);
} catch (error) {
  console.error('FAIL ' + error.message);
  if (c && process.env.R106_KEEP === '1') await c.snap(path.join(profile, 'failure.png')).catch(()=>{});
  process.exitCode = 1;
} finally {
  if (c) {
    await c.evaluate(`window.warmy.appQuit('r106-ui-test')`).catch(()=>{});
    c.close();
  }
  if (child.exitCode === null) {
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);
    if (child.exitCode === null) {
      try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}); } catch {}
    }
  }
  if (process.env.R106_KEEP === '1') console.log('FIXTURE ' + profile);
  else fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
