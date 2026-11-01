/**
 * verify-r48-zhongjian-ui.mjs —— 中间回复（模型发起工具调用时写给用户的话）真的画进「执行过程」、重启也不丢（第 48 轮）
 *
 * 真机来由（`verify-round34-live` 本地腿）：27B 在中间回复里把截图内容逐条描述了，最终回复只写"截图：两张都看得到"。
 * 中间回复以前只活在流式气泡里，会话一重绘/重启就没了 ⇒ 用户再也看不到那段答案。
 * 这支用**确定性的假模型**（OpenAI 兼容 + SSE）走真主进程、真渲染层：
 *   ① 回复落地后界面里有 `.zhongJianKa > .zhongJianHuiFu`，文字就是模型那段话、观感是正文（不是思考的灰字）、
 *      按时间排在 get_time 那条操作行之前；最终气泡里**没有**把它并进去（不重复、不改写）；
 *   ② 同一个 profile 重启 ⇒ 还在，位置不变。
 *
 * 跑法：node dev/gates/verify-r48-zhongjian-ui.mjs（不联网、不要密钥）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages', 'app-shell');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.R48Z_PORT || 9962);
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d !== undefined ? ' ← ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 320) : '')); };

const BIAO = 'ZJUI-' + Date.now().toString(36).toUpperCase();
const ZHONG_JIAN = '先回答你：截图里写着 ' + BIAO + '。我再看一下现在几点。';
const ZHONG_DA = '都做完了（中间回复界面测试）。';
/** 假模型：带工具清单且还没有工具结果 ⇒ 正文 + get_time；有工具结果 ⇒ 终答；旁路请求（没有 tools）⇒ 普通文本 */
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (ch) => (raw += ch));
  req.on('end', () => {
    let ti = {};
    try { ti = JSON.parse(raw || '{}'); } catch { /* noop */ }
    if (/\/models$/.test(String(req.url || ''))) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'mock-zj' }] })); return; }
    const msgs = ti.messages || [];
    const youGongJu = Array.isArray(ti.tools) && ti.tools.length > 0;
    const yiYouJieGuo = msgs.some((m) => m.role === 'tool');
    const zhengWen = !youGongJu ? '好' : (yiYouJieGuo ? ZHONG_DA : ZHONG_JIAN);
    const gongJu = youGongJu && !yiYouJieGuo ? [{ index: 0, id: 'call-zjui', type: 'function', function: { name: 'get_time', arguments: '{}' } }] : null;
    if (ti.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const pian = (delta, fr) => 'data: ' + JSON.stringify({ id: 'c-zj', model: 'mock-zj', choices: [{ index: 0, delta, ...(fr ? { finish_reason: fr } : {}) }] }) + '\n\n';
      res.write(pian({ role: 'assistant', content: zhengWen }));
      if (gongJu) res.write(pian({ tool_calls: gongJu }));
      res.write(pian({}, gongJu ? 'tool_calls' : 'stop'));
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'c-zj', model: 'mock-zj', choices: [{ index: 0, message: { role: 'assistant', content: zhengWen, ...(gongJu ? { tool_calls: gongJu.map(({ index: _i, ...g }) => g) } : {}) }, finish_reason: gongJu ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 10 } }));
  });
});
const mockPort = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));
const JIDI = 'http://127.0.0.1:' + mockPort + '/v1';

const profile = path.join(os.tmpdir(), 'warmy-r48-zhongjian-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
  globalSecurity: 'normal', trustedFolders: [], asrEnabled: false,
  providers: [{ id: 'mock-zj', biaoQian: 'Mock（中间回复）', protocol: 'openai-compatible', baseURL: JIDI, defaultModel: '', models: ['mock-zj'], staleModels: [], hasKey: false }],
  modelCaps: { 'mock-zj': { contextLen: 65536, kind: 'chat', tools: true, vision: false } },
  specialModels: { chatChain: ['mock-zj'], asrChain: [], asrDisabled: [] },
  instances: [{ id: 'inst-r48zj-1', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: 'Mock（中间回复） · mock-zj', currentModel: 'mock-zj', chain: ['Mock（中间回复） · mock-zj'], chainDisabled: [] }],
}, null, 2), 'utf8');

let child = null;
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack||err.message)) || err).slice(0,240) }; } })()');
async function qiDong() {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.MIMO_KEY_FILE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
  let lian = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { lian = true; break; } } catch { /* 还没起 */ } await sleep(1000); }
  if (!lian) throw new Error('CDP 起不来');
  await sleep(5000);
  c = await attach(PORT, { biaoQian: 'r48zj', callTimeout: 120000 });
  await c.send('Runtime.enable');
  await sleep(1500);
}
async function guanBi() {
  try { c && c.close && c.close(); } catch { /* noop */ }
  c = null;
  if (child && child.pid) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* 已退出 */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(250);
  }
  child = null;
  await sleep(1500);
}
/** 量界面：中间回复块、它与 get_time 操作行的先后、观感、最终气泡里有没有被并进去 */
const liangJieMian = () => js(`(() => {
  const kuai = [...document.querySelectorAll('.guoChengLie > .zhongJianKa > .zhongJianHuiFu')];
  const zj = kuai.find((n) => n.textContent.includes(${JSON.stringify(BIAO)}));
  if (!zj) return { you: false, n: kuai.length };
  const card = zj.parentElement;
  const lie = card.parentElement;
  const hang = [...lie.querySelectorAll('.guoChengDuan .xingDongHang')];
  const shiJian = hang.find((h) => /get_time|时间/.test(h.textContent));
  const zhe = shiJian?.closest('.guoChengDuan');
  const xianHou = shiJian ? (zj.compareDocumentPosition(shiJian) & Node.DOCUMENT_POSITION_FOLLOWING ? 'zj-qian' : 'zj-hou') : 'wu-hang';
  const qiPao = zj.closest('.xiaoXi');
  const zuiZhong = qiPao ? [...qiPao.querySelectorAll(':scope .bubble.md')].filter((b) => !b.closest('.guoChengLie')).map((b) => b.textContent).join('|') : '';
  return {
    you: true, n: kuai.length, xianHou, hangShu: hang.length,
    yuanWen: zj.textContent === ${JSON.stringify(ZHONG_JIAN)},
    cardOk: card.tagName === 'DETAILS' && card.open && !!card.querySelector('summary')
      && !/中间回复/.test(card.querySelector('summary').textContent || ''),
    visible: zj.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && zj.getBoundingClientRect().height > 0,
    collapsed: !!zhe && [...lie.querySelectorAll('.guoChengDuan')].every((n) => n.tagName === 'DETAILS' && !n.open),
    fenOk: !!zhe && Number(zhe.dataset.fen) === Number(card.dataset.fen) + 1,
    seZJ: getComputedStyle(zj).color, seZhe: zhe ? getComputedStyle(zhe).color : '',
    zuiZhong: zuiZhong.slice(0, 80), bingJin: zuiZhong.includes(${JSON.stringify(BIAO)}),
  };
})()`);

try {
  await qiDong();
  await js('window.warmy.providerKeySet(' + JSON.stringify({ providerId: 'mock-zj', apiKey: 'sk-mock' }) + ')');
  await js('(() => { const b = document.querySelector(\'[data-nav="singleAi"]\'); if (b) b.click(); return !!b; })()');
  await sleep(1500);
  await js('(() => { const b = document.querySelector("#lieBiaoTi .lieBiaoTiaoMu"); if (b) b.click(); return !!b; })()');
  await sleep(2000);
  const sid = String((await js('window.__r35 && window.__r35.huiHua()')) || '');
  jian('界面里有当前单聊会话', sid.length > 1, sid);
  const r = await js('window.warmy.chatSend(' + JSON.stringify({ sessionId: sid, content: '中间回复界面测试：看一下时间再回答', insertMode: 'outer', ming: '牛马-1', thinkLevel: 'auto', xiaoDiShuLiang: 'auto', moXingJueCe: { urgency: 'P2', defaultModel: 'mock-zj', chain: [], chainDisabled: [] }, jiaQiangHuiFu: false }) + ')');
  jian('chatSend 走通，回包带中间回复', !!r && r.ok === true && Array.isArray(r.zhongJian) && r.zhongJian.some((x) => String(x.text || '').includes(BIAO)), r && { ok: r.ok, reply: r.reply, zj: r.zhongJian, err: r.error });
  let m1 = null;
  for (let i = 0; i < 20 && !(m1 && m1.you); i++) { await sleep(1000); m1 = await liangJieMian(); }
  jian('① 回复落地后过程时间线画出了中间回复原文', !!m1 && m1.you === true && m1.yuanWen === true, m1);
  jian('① 中间回复无标题且不可折叠，执行过程折叠时正文可见', !!m1 && m1.cardOk && m1.visible && m1.collapsed, m1);
  jian('① 中间回复按时间排在 get_time 那条操作行之前，操作属于下一段', !!m1 && m1.xianHou === 'zj-qian' && m1.fenOk, m1 && { xianHou: m1.xianHou, hangShu: m1.hangShu });
  jian('① 观感是正文，不是思考的灰字（颜色与折叠容器不同）', !!m1 && !!m1.seZJ && !!m1.seZhe && m1.seZJ !== m1.seZhe, m1 && { zj: m1.seZJ, zhe: m1.seZhe });
  jian('① 最终气泡没有把中间回复并进去（不重复、不改写）', !!m1 && m1.bingJin === false && /都做完了/.test(String(m1.zuiZhong || '')), m1 && m1.zuiZhong);
  await sleep(1500);
  await guanBi();

  await qiDong();
  await js('(() => { const b = document.querySelector(\'[data-nav="singleAi"]\'); if (b) b.click(); return !!b; })()');
  let m2 = null;
  for (let i = 0; i < 25 && !(m2 && m2.you); i++) { await sleep(1000); m2 = await liangJieMian(); }
  jian('② 同一个 profile 重启后中间回复原文仍在时间线中可见', !!m2 && m2.you === true && m2.yuanWen && m2.cardOk && m2.visible && m2.collapsed, m2);
  jian('② 重启后先后顺序与操作归属不变（仍在 get_time 操作行之前）', !!m2 && m2.xianHou === 'zj-qian' && m2.fenOk, m2 && { xianHou: m2.xianHou, hangShu: m2.hangShu });
  /** 截图实锤过的假象：这一轮明明写完了，重启后却多出"上次这一轮被中断（应用退出）"块 + 「继续 / 重试」 */
  const jia = await js(`(() => ({
    zhongDuan: /上次这一轮被中断/.test(document.body.innerText),
    anNiu: [...document.querySelectorAll('.huiFuRenWuBtn')].filter((b) => !b.disabled && b.getBoundingClientRect().width > 0).length,
  }))()`);
  jian('② 写完的那一轮重启后**不会**被当成"上次被中断"（没有中断保留块、没有可点的「继续/重试」）',
    !!jia && jia.zhongDuan === false && jia.anNiu === 0, jia);
} catch (e) {
  jian('整条路跑完没抛错', false, String((e && e.message) || e).slice(0, 240));
} finally {
  await guanBi();
  try { mock.close(); } catch { /* noop */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 句柄可能还没放 */ }
  if (fs.existsSync(profile)) { await sleep(2500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 留给收尾 */ } }
}
console.log(`\n[verify-r48-zhongjian-ui] ${ok} ok / ${shi.length} FAIL`);
process.exit(shi.length ? 1 : 0);
