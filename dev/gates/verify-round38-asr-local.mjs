/**
 * 本地真实链门禁：三次损坏音频失败仍启用且零云请求，合法音频恢复，显式关闭才走云。
 * R38_LOCAL_CACHE/local-speech 须预备完整模型；只复制到临时 profile，不安装、不写回缓存。
 * 保留重新启用及 Electron native externalbuffer 自检；node --check 不代表真实链通过。
 * 显式运行会调用真实 MiMo TTS/ASR：
 * MIMO_KEY_FILE="<密钥文件>" R38_LOCAL_CACHE="<预备缓存>" node dev/gates/verify-round38-asr-local.mjs [--keep]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages/app-shell');
const MAIN = path.join(PKG, 'dist/electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const KEY_FILE = String(process.env.MIMO_KEY_FILE || '');
if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.log('缺 MIMO_KEY_FILE'); process.exit(2); }
const KEY = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
const JIDI = 'https://token-plan-cn.xiaomimimo.com/v1';
const PORT = Number(process.env.R38_ASR_L_PORT || 9983);
const YU = '今天下午三点十分，请把第三列的看板改成暗色主题，另外帮我确认王师傅的发票已经寄到海淀区知春路二十七号。';
const cache = String(process.env.R38_LOCAL_CACHE || '');
const cacheLu = cache ? path.resolve(cache, 'local-speech') : '';
if (!cacheLu || !fs.existsSync(path.join(cacheLu, 'models'))) {
  console.error('缺 R38_LOCAL_CACHE/local-speech/models；未运行真实链，不会自动安装'); process.exit(2);
}

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 240) : '')); };
const xiao = (s) => Array.from(String(s || '').replace(/[\s\p{P}]/gu, ''));
const jiaJu = (a, b) => {
  const x = xiao(a), y = xiao(b);
  if (!y.length) return 0;
  const d = [];
  for (let i = 0; i <= x.length; i++) { d[i] = []; d[i][0] = i; }
  for (let k = 0; k <= y.length; k++) d[0][k] = k;
  for (let i = 1; i <= x.length; i++) for (let k = 1; k <= y.length; k++) {
    d[i][k] = Math.min(d[i - 1][k] + 1, d[i][k - 1] + 1, d[i - 1][k - 1] + (x[i - 1] === y[k - 1] ? 0 : 1));
  }
  return Math.max(0, 1 - d[x.length][y.length] / Math.max(x.length, y.length));
};
const faSong = async (body) => {
  const r = await fetch(JIDI + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, raw: t.slice(0, 200) }; }
};
const dengCdp = async () => {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(1000);
  }
  return false;
};

const tts = await faSong({
  model: 'mimo-v2.5-tts',
  messages: [{ role: 'user', content: '请把下一条消息原样读出来。' }, { role: 'assistant', content: YU }],
  modalities: ['text', 'audio'], audio: { voice: 'mimo_default', format: 'wav' },
});
const WAV64 = String(((tts.json || {}).choices || [{}])[0]?.message?.audio?.data || '');
const wavBytes = Buffer.from(WAV64, 'base64');
const wavOK = tts.status >= 200 && tts.status < 300 && wavBytes.length > 1000
  && wavBytes.toString('ascii', 0, 4) === 'RIFF' && wavBytes.toString('ascii', 8, 12) === 'WAVE';
jian('素材合成成功且为 WAV', wavOK, 'status=' + tts.status + ' bytes=' + wavBytes.length);
if (!wavOK) process.exit(1);
const WAV_URL = 'data:audio/wav;base64,' + WAV64;
// 真正不可解码的字节，不是给合法 WAV 换扩展名。
const HUAI = Buffer.from('r38-corrupt-audio:not-a-container\n'.repeat(64));
const HUAI_URL = 'data:audio/webm;base64,' + HUAI.toString('base64');
const profile = path.join(os.tmpdir(), 'warmy-r38-asr-local-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
let yunXuYun = false;
const yunQingQiu = [];
// 透明转发仅在明确关闭本地后开放；零请求由计数证明，不猜审计事件。
const daiLi = createServer(async (req, res) => {
  const endpoint = req.url === '/v1/audio/transcriptions' ? '/audio/transcriptions'
    : req.url === '/v1/chat/completions' ? '/chat/completions' : '';
  if (req.method !== 'POST' || !endpoint) { res.writeHead(404); res.end('{}'); return; }
  yunQingQiu.push({ endpoint, allowed: yunXuYun });
  try {
    if (!yunXuYun) { req.resume(); res.writeHead(503); res.end('{"error":{"message":"gate-local-must-not-call-cloud"}}'); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const r = await fetch(JIDI + endpoint, {
      method: 'POST', headers: { Authorization: req.headers.authorization || '', 'Content-Type': req.headers['content-type'] || '' },
      body: Buffer.concat(chunks), signal: AbortSignal.timeout(120000),
    });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }); res.end(body);
  } catch {
    res.writeHead(502); res.end('{"error":{"message":"gate-cloud-forward-failed"}}');
  }
});
const env = { ...process.env, WARMY_OPEN_PATH_DRYRUN: '1', WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let child = null, c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
const zhuangTai = async () => await js('window.warmy.benDiYuYinZhuangTai()');
const shenJi = () => {
  const f = path.join(profile, 'audit', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const zhuan = async (label, payload, expected) => {
  const offset = shenJi().length;
  const r = await js('window.warmy.asrTranscribe(' + JSON.stringify(payload) + ')');
  jian(label, r?.ok === expected.ok && r.source === expected.source && (r.model || '') === expected.model
    && (expected.ok ? String(r.text || '').trim().length > 0 && !r.error
      : expected.error.test(String(r.error || '')) && !r.text), JSON.stringify(r));
  const rows = shenJi().slice(offset).filter((x) => x.op === 'asr.request' || x.op === 'asr.result');
  const q = rows[0]?.detail, a = rows[1]?.detail;
  jian(label + '：request/result 与素材、实际返回一致', rows.length === 2 && rows[0].op === 'asr.request' && rows[1].op === 'asr.result'
    && q?.geShi === payload.ext && q.bytes === Buffer.from(payload.dataUrl.split(',')[1], 'base64').length
    && a?.ok === expected.ok && a.source === expected.source && a.model === expected.model
    && a.chars === String(r?.text || '').length && a.error === String(r?.error || '').slice(0, 160)
    && a.miao === q.miao && q.miao > 0, JSON.stringify(rows));
  return r;
};
const wuYun = (label, count = 0) => jian(label + '：无云端 ASR 请求', yunQingQiu.length === count, JSON.stringify(yunQingQiu));
const jiWen = () => fs.readFileSync(path.join(profile, 'ben-di-yu-yin.json'), 'utf8');

try {
  fs.cpSync(cacheLu, path.join(profile, 'local-speech'), { recursive: true, dereference: true });
  console.log('  · 模型副本仅位于：' + path.join(profile, 'local-speech'));
  await new Promise((resolve, reject) => { daiLi.once('error', reject); daiLi.listen(0, '127.0.0.1', resolve); });
  const baseURL = 'http://127.0.0.1:' + daiLi.address().port + '/v1';
  child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
    { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
  if (!(await dengCdp())) throw new Error('CDP 启动超时');
  await sleep(7000);
  c = await attach(PORT, { biaoQian: 'r38local', callTimeout: 300000 });
  await c.send('Runtime.enable');
  await sleep(1500);
  const peiZhi = {
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    globalSecurity: 'normal', trustedFolders: [], asrEnabled: true, asrLang: 'auto',
    providers: [{ id: 'mimo-r38', biaoQian: 'MiMo token plan（cn）', protocol: 'openai-compatible', baseURL, defaultModel: '', models: ['mimo-v2.6-flash', 'mimo-v2.5-asr', 'mimo-v2.5-tts'], staleModels: [], hasKey: false }],
    specialModels: { chatChain: ['mimo-v2.6-flash'], asrChain: ['mimo-v2.5-asr'], asrDisabled: [] },
    instances: [{ id: 'inst-r38local', ming: '牛马-1', name: '牛马-1', status: 'running', defaultModel: 'MiMo token plan（cn） · mimo-v2.6-flash', currentModel: 'mimo-v2.6-flash', chain: ['MiMo token plan（cn） · mimo-v2.6-flash'], chainDisabled: [] }],
  };
  const saved = await js('window.warmy.settingsSave(' + JSON.stringify(peiZhi) + ')');
  const keyed = await js('window.warmy.providerKeySet(' + JSON.stringify({ providerId: 'mimo-r38', apiKey: KEY }) + ')');
  if (saved?.ok !== true || keyed?.ok !== true) throw new Error('配置或密钥保存失败');
  await sleep(2500);

  const z0 = await zhuangTai();
  const ready = z0?.ok === true && z0.zhuangTai === 'yi_an_zhuang' && z0.qiYong === false
    && z0.yunXing?.keYiBao === true && z0.moXing?.shiBie === true && z0.moXing?.heCheng === true
    && path.resolve(z0.muLu || '') === path.join(profile, 'local-speech');
  jian('临时 profile 自有模型路径完整可用，初始未启用', ready, JSON.stringify(z0));
  if (!ready) throw new Error('预备缓存不完整或 profile 隔离失败，不进行安装');
  const localModel = 'local/' + z0.moXingMing.shiBie;
  const localOK = { ok: true, source: 'bendi-yuyin', model: localModel };
  const wav = { dataUrl: WAV_URL, ext: 'wav' };
  const kai = await js('window.warmy.benDiYuYinQiYong({ kai: true })');
  jian('安装齐全才可启用', kai?.ok === true && kai.qiYong === true && kai.zhuangTai?.qiYong === true, JSON.stringify(kai));
  if (kai?.ok !== true || kai.qiYong !== true) throw new Error('无法开启本地语音');
  const r1 = await zhuan('启用后默认话筒 IPC 由本地成功识别', wav, localOK);
  jian('本机识别已知句（相似度 ≥0.5）', jiaJu(YU, r1?.text) >= 0.5, r1?.text);
  wuYun('启用后的合法音频');

  const qiYongJi = jiWen();
  for (let i = 1; i <= 3; i++) {
    await zhuan('连续第 ' + i + ' 次损坏音频如实失败', { dataUrl: HUAI_URL, ext: 'webm', source: 'microphone' },
      { ok: false, source: 'bendi-yuyin', model: '', error: /^audio-decode-failed（/ });
    const z = await zhuangTai();
    jian('第 ' + i + ' 次失败仍启用，未改写勾选', z?.ok === true && z.qiYong === true && z.ziDongGuan === '' && jiWen() === qiYongJi, JSON.stringify(z));
    wuYun('第 ' + i + ' 次失败');
  }
  const r4 = await zhuan('三次失败后不重新勾选，合法音频恢复本地', wav, localOK);
  jian('恢复后的本地正文正确且启用状态未变', jiaJu(YU, r4?.text) >= 0.5 && (await zhuangTai())?.qiYong === true && jiWen() === qiYongJi, r4?.text);
  wuYun('恢复后的合法音频');

  const lang = await js('window.warmy.settingsSave({ asrLang: "ja" })');
  if (lang?.ok !== true) throw new Error('语言测试设置失败');
  await zhuan('省略 source 默认话筒，明确报告本地日语限制', wav,
    { ok: false, source: 'bendi-yuyin', model: '', error: /^bendi-yuyin-language-unsupported（/ });
  const fu = await zhuan('附件忽略话筒指定语言，自动识别', { ...wav, source: 'attachment' }, localOK);
  jian('附件仍识别中文全句', jiaJu(YU, fu?.text) >= 0.5, fu?.text);
  wuYun('话筒语言与附件自动语言');
  if ((await js('window.warmy.settingsSave({ asrLang: "auto" })'))?.ok !== true) throw new Error('恢复自动语言失败');

  const ziJian = async (enabled) => {
    const before = jiWen(), count = yunQingQiu.length;
    const r = await js('window.warmy.benDiYuYinZiJian()');
    jian('native externalbuffer 回归：本地 TTS→ASR 自检成功（启用=' + enabled + '）', r?.ok === true
      && r.shiBieMoXing === localModel && r.heChengMoXing === 'local/' + z0.moXingMing.heCheng
      && r.yangBenMB > 0 && r.sampleRate > 0 && jiaJu(r.yuan, r.huiZhuan) >= 0.5, JSON.stringify(r));
    const after = await zhuangTai();
    jian('自检不临时改写勾选（启用=' + enabled + '）', after?.ok === true && after.qiYong === enabled && jiWen() === before, JSON.stringify(after));
    wuYun('本地自检', count);
  };
  const guan = await js('window.warmy.benDiYuYinQiYong({ kai: false })');
  const off = await zhuangTai();
  jian('只有显式关闭才取消启用', guan?.ok === true && guan.qiYong === false && off?.ok === true && off.qiYong === false, JSON.stringify(guan));
  if (guan?.ok !== true || off?.qiYong !== false) throw new Error('无法确认本地关闭，不开放云转发');
  await ziJian(false);

  const cloudBefore = yunQingQiu.length;
  yunXuYun = true;
  const cloud = await zhuan('显式关闭后合法音频走真实听话链', wav, { ok: true, source: 'asr-chain', model: 'mimo-v2.5-asr' });
  yunXuYun = false;
  jian('关闭后确实请求云端并识别已知句', yunQingQiu.length > cloudBefore
    && yunQingQiu.slice(cloudBefore).every((r) => r.allowed) && jiaJu(YU, cloud?.text) >= 0.7, JSON.stringify(yunQingQiu));

  const again = await js('window.warmy.benDiYuYinQiYong({ kai: true })');
  const z4 = await zhuangTai();
  jian('显式重新启用后仍由用户选择决定', again?.ok === true && again.qiYong === true && z4?.qiYong === true && z4.ziDongGuan === '', JSON.stringify(again));
  const cloudCount = yunQingQiu.length;
  const r5 = await zhuan('重新启用后恢复实际本地模型', wav, localOK);
  jian('重新启用后的本地正文正确', jiaJu(YU, r5?.text) >= 0.5, r5?.text);
  wuYun('重新启用后', cloudCount);
  await ziJian(true);
  jian('所有非显式关闭阶段均未请求云端', yunQingQiu.every((r) => r.allowed), JSON.stringify(yunQingQiu));
} catch (e) {
  jian('门禁执行无异常', false, e?.message || e);
} finally {
  yunXuYun = false;
  daiLi.close(); daiLi.closeAllConnections();
  try { if (c) c.close(); } catch { /* noop */ }
  try { if (child && !child.killed) child.kill(); } catch { /* noop */ }
  await sleep(3000);
  if (!process.argv.includes('--keep')) {
    try { fs.rmSync(profile, { recursive: true, force: true }); console.log('  · 临时 profile（含模型副本）已删除：' + profile); } catch { /* noop */ }
  } else console.log('  · 保留 profile：' + profile);
}
console.log(`\n==== verify-round38-asr-local：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
