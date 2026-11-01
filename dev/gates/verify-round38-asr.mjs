/**
 * 麦克风真实链门禁：未装不能启用 → 明确关闭本地 → MiMo TTS 素材灌入采集口。
 * 真走 MediaRecorder → 16k WAV → 默认话筒 IPC → 听话链 → 回填，以 request/result 核对音频和来源。
 * 仅用临时 profile，不安装；显式运行会调用真实 TTS/ASR，node --check 不代表真实链通过。
 * MIMO_KEY_FILE="<密钥文件>" node dev/gates/verify-round38-asr.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(G, 'packages/app-shell');
const MAIN = path.join(PKG, 'dist/electron-main.js');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const KEY_FILE = String(process.env.MIMO_KEY_FILE || '');
if (!KEY_FILE || !fs.existsSync(KEY_FILE)) { console.log('缺 MIMO_KEY_FILE（指向密钥文件，只读第一行）'); process.exit(2); }
const KEY = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)[0].trim();
const JIDI = 'https://token-plan-cn.xiaomimimo.com/v1';
const PORT = Number(process.env.R38_ASR_PORT || 9981);
const SID = 'inst-r38asr-' + Date.now().toString(36);
const YU = '今天下午三点十分，请把第三列的看板改成暗色主题，另外帮我确认王师傅的发票已经寄到海淀区知春路二十七号。';
const MING = ['mimo-v2.5-asr'];

let ok = 0; const shi = [];
const jian = (l, p, d) => { if (p) { ok += 1; console.log('  ok   ' + l); return; } shi.push(l); console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 220) : '')); };
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
  const r = await fetch(JIDI + '/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, raw: t.slice(0, 200) }; }
};
const dengCdp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(1000);
  }
  return false;
};
const shaJinCheng = (p) => { try { if (p && !p.killed) p.kill(); } catch { /* noop */ } };

/** ① 闭环素材：MiMo TTS 合成已知句 */
const tts = await faSong({
  model: 'mimo-v2.5-tts',
  messages: [{ role: 'user', content: '请把下一条消息原样读出来。' }, { role: 'assistant', content: YU }],
  modalities: ['text', 'audio'], audio: { voice: 'mimo_default', format: 'wav' },
});
const WAV64 = String((tts.json && tts.json.choices && tts.json.choices[0] && tts.json.choices[0].message && tts.json.choices[0].message.audio && tts.json.choices[0].message.audio.data) || '');
const wavBytes = Buffer.from(WAV64, 'base64');
const wavOK = tts.status >= 200 && tts.status < 300 && wavBytes.length > 1000
  && wavBytes.toString('ascii', 0, 4) === 'RIFF' && wavBytes.toString('ascii', 8, 12) === 'WAVE';
jian('素材合成成功且为 WAV', wavOK, 'status=' + tts.status + ' bytes=' + wavBytes.length);
if (!wavOK) process.exit(1);

/** ② 起真应用（临时 profile，配好 MiMo 与「听话模型 = mimo-v2.5-asr」） */
const profile = path.join(os.tmpdir(), 'warmy-r38-asr-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env, WARMY_OPEN_PATH_DRYRUN: '1', WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN],
  { cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env });
let c = null;
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 300) }; } })()');
try {
  if (!(await dengCdp())) throw new Error('CDP 启动超时');
  await sleep(7000);
  c = await attach(PORT, { biaoQian: 'r38asr', callTimeout: 240000 });
  await c.send('Runtime.enable');
  await sleep(1500);
  const peiZhi = {
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, providersSeeded: true,
    globalSecurity: 'normal', trustedFolders: [], asrEnabled: true, asrLang: 'auto',
    modelContextTokens: 32768, contextBudgetChars: 4000, contextToolResultChars: 4000, contextToolTotalChars: 12000,
    providers: [{
      id: 'mimo-r38', biaoQian: 'MiMo token plan（cn）', protocol: 'openai-compatible', baseURL: JIDI,
      defaultModel: '', models: ['mimo-v2.6-flash', 'mimo-v2.5-asr', 'mimo-v2.5-tts'], staleModels: [], hasKey: false,
    }],
    specialModels: {
      chatChain: ['mimo-v2.6-flash'], organizerChain: ['mimo-v2.6-flash'],
      asrChain: [MING[0]], asrDisabled: [], ttsChain: ['mimo-v2.5-tts'],
    },
    instances: [{
      id: SID, ming: '牛马-1', name: '牛马-1', status: 'running', dutyEligible: true, notify: true,
      persona: '', smartMode: false, defaultModel: 'MiMo token plan（cn） · mimo-v2.6-flash',
      currentModel: 'mimo-v2.6-flash', chain: ['MiMo token plan（cn） · mimo-v2.6-flash'], chainDisabled: [],
    }],
  };
  const bao = await js(`window.warmy.settingsSave(${JSON.stringify(peiZhi)})`);
  const miYaoQingQiu = JSON.stringify({ providerId: 'mimo-r38', apiKey: KEY });
  const kmi = await js('window.warmy.providerKeySet(' + miYaoQingQiu + ')');
  jian('配置与密钥落盘（听话模型链里只有 mimo-v2.5-asr）', bao?.ok === true && kmi?.ok === true);
  if (bao?.ok !== true || kmi?.ok !== true) throw new Error('配置或密钥保存失败');
  const z0 = await js('window.warmy.benDiYuYinZhuangTai()');
  jian('临时 profile 未安装模型，初始未启用', z0?.ok === true && z0.qiYong === false
    && z0.moXing?.shiBie === false && z0.moXing?.heCheng === false
    && path.resolve(z0.muLu || '') === path.join(profile, 'local-speech'), JSON.stringify(z0));
  if (z0?.ok !== true || z0.qiYong !== false || z0.moXing?.shiBie !== false || z0.moXing?.heCheng !== false
    || path.resolve(z0.muLu || '') !== path.join(profile, 'local-speech')) throw new Error('未安装夹具或 profile 隔离不成立');
  const qiYong = await js('window.warmy.benDiYuYinQiYong({ kai: true })');
  const z1 = await js('window.warmy.benDiYuYinZhuangTai()');
  jian('未装不能开启，返回 not-ready 且仍未启用', qiYong?.ok === false && qiYong.qiYong === false
    && /^bendi-yuyin-not-ready（/.test(qiYong.error || '') && z1?.ok === true && z1.qiYong === false, JSON.stringify(qiYong));
  const guan = await js('window.warmy.benDiYuYinQiYong({ kai: false })');
  jian('明确关闭本地后才开始云端麦克风测试', guan?.ok === true && guan.qiYong === false && guan.zhuangTai?.qiYong === false, JSON.stringify(guan));
  if (guan?.ok !== true || guan.qiYong !== false || guan.zhuangTai?.qiYong !== false) throw new Error('无法确认本地已关闭');
  await c.send('Page.reload');
  await c.waitFor(`window.__warmyDebugState?.().selected === ${JSON.stringify(SID)} && document.querySelector('#shuRu')`, { timeout: 30000, biaoQian: '测试会话选中' });

  /** 原生采样率、双声道供流；不改应用录音代码。 */
  const zhuang = await js(`(async () => {
    const b64 = ${JSON.stringify(WAV64)};
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(bin.buffer.slice(0));
    const dst = ac.createMediaStreamDestination();
    dst.channelCount = 2;
    const yi = ac.createBufferSource();
    yi.buffer = buf; yi.loop = false; yi.connect(dst);
    const liu = dst.stream;
    const jia = {
      getUserMedia: async () => { await ac.resume(); yi.start(ac.currentTime + 0.2); return liu; },
      getDisplayMedia: async () => { throw new Error('gate-no-display'); },
      enumerateDevices: async () => liu.getTracks().map((t, i) => ({ deviceId: 'gate-mic-' + i, kind: 'audioinput', label: '门禁麦克风', groupId: 'gate' })),
      addEventListener: () => {}, removeEventListener: () => {}, ondevicechange: null,
    };
    try { Object.defineProperty(navigator, 'mediaDevices', { value: jia, configurable: true }); } catch (e) { return { __err: 'defineProperty ' + e }; }
    window.__r38asr = { sr: ac.sampleRate, channels: dst.channelCount, miao: buf.duration, bytes: bin.length };
    const anNiu = document.querySelector('#anNiuYuYin');
    if (!anNiu || anNiu.disabled) return { __err: '话筒按钮不可用' };
    document.querySelector('#shuRu').value = '';
    window.__asrZhenDuan = {};
    anNiu.click();
    return { ok: true, ...window.__r38asr, lu: liu.getAudioTracks().length };
  })()`);
  jian('假麦克风接上了（原生采样率、双声道、完整素材）', zhuang?.ok === true
    && Number(zhuang.sr) >= 44100 && zhuang.channels === 2 && zhuang.lu === 1
    && zhuang.miao > 0 && zhuang.bytes === Buffer.from(WAV64, 'base64').length, JSON.stringify(zhuang));
  if (zhuang?.ok !== true || !(zhuang.miao > 0)) throw new Error('麦克风素材注入失败');
  await c.waitFor(`document.querySelector('#anNiuYuYin')?.getAttribute('aria-pressed') === 'true'`, { timeout: 15000, biaoQian: '真实录音启动' });
  await sleep(Math.ceil((zhuang.miao + 0.6) * 1000));
  await js(`(() => { document.querySelector('#anNiuYuYin').click(); return true; })()`);
  await c.waitFor(`(() => { const a = document.querySelector('#anNiuYuYin'); return a && !a.disabled && !a.classList.contains('jieLianZhong') && a.getAttribute('aria-pressed') === 'false' && typeof window.__asrZhenDuan?.shangCi?.ok === 'boolean'; })()`, { timeout: 240000, poll: 300, biaoQian: '最终转写与回填收尾' });

  const jie = await js(`(() => {
    const ru = document.querySelector('#shuRu');
    const z = (window.__asrZhenDuan && window.__asrZhenDuan.shangCi) || {};
    return { wen: String((ru && ru.value) || ''), moXing: String(z.moXing || ''), ok: z.ok, cuo: String(z.cuo || ''), zhenDuan: z, tongJi: window.__r38asr || null };
  })()`);
  const wen = String((jie && jie.wen) || '');
  const quan = jiaJu(YU, wen);
  console.log('  · 听到：' + JSON.stringify(wen.slice(0, 90)));
  console.log('  · 诊断：' + JSON.stringify(jie && jie.zhenDuan).slice(0, 220));
  jian('输入框回填完整已知句（全句相似度 ≥0.7）', wen.length > 6 && quan >= 0.7, '相似度=' + (quan * 100).toFixed(1) + '%');
  jian('话筒成功结果来自指定的云模型', jie?.ok === true && jie.moXing === MING[0]
    && jie.zhenDuan?.laiYuan === 'asr-chain' && !jie.cuo, JSON.stringify(jie?.zhenDuan));

  const shenJi = path.join(profile, 'audit', 'audit.jsonl');
  const duShenJi = () => fs.readFileSync(shenJi, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tiao = duShenJi().filter((r) => r.op === 'asr.request' || r.op === 'asr.result');
  const qing = tiao.filter((r) => r.op === 'asr.request').map((r) => r.detail);
  const jieGuo = tiao.filter((r) => r.op === 'asr.result').map((r) => r.detail);
  jian('每次话筒请求都有实际云模型成功结果，无本地抢答', qing.length > 0 && qing.length === jieGuo.length
    && tiao.every((r, i) => r.op === (i % 2 ? 'asr.result' : 'asr.request'))
    && jieGuo.every((r) => r.ok === true && r.source === 'asr-chain' && r.model === MING[0] && r.chars > 0 && !r.error), JSON.stringify(jieGuo));
  const d = jie?.zhenDuan || {}, last = qing.at(-1), result = jieGuo.at(-1);
  jian('录音完整：最终时长覆盖素材，16k WAV 字节数与 request/result 一致', d.wav === true && d.sr === 16000
    && d.blobZiJie > 1000 && d.fengZhi >= 0.02 && d.rms > 0 && d.miao >= zhuang.miao - 0.2 && d.miao <= zhuang.miao + 2.5
    && last?.geShi === 'wav' && Math.abs(last.bytes - (44 + Math.floor(d.miao * 16000) * 2)) <= 2
    && Math.abs(last.miao - d.miao) <= 0.001 && result?.miao === last.miao && result.chars === wen.trim().length,
    JSON.stringify({ material: zhuang.miao, recorded: d.miao, last, result }));

  // 附件复用完整素材，不受话筒开关和指定语言影响。
  const she = await js('window.warmy.settingsSave({ asrEnabled: false, asrLang: "ja" })');
  if (she?.ok !== true) throw new Error('附件测试设置失败');
  const offset = duShenJi().length;
  const j2 = await js(`window.warmy.asrTranscribe({ dataUrl: 'data:audio/wav;base64,' + ${JSON.stringify(WAV64)}, ext: 'wav', source: 'attachment' })`);
  jian('关闭本地时附件走听话链，仍识别中文全句', j2?.ok === true && j2.source === 'asr-chain'
    && j2.model === MING[0] && jiaJu(YU, j2.text) >= 0.7, JSON.stringify(j2));
  const a2 = duShenJi().slice(offset).filter((r) => r.op === 'asr.request' || r.op === 'asr.result');
  jian('附件音频未截断，审计与返回结果一致', a2.length === 2 && a2[0].op === 'asr.request' && a2[1].op === 'asr.result'
    && a2[0].detail.geShi === 'wav' && a2[0].detail.bytes === Buffer.from(WAV64, 'base64').length
    && a2[1].detail.ok === true && a2[1].detail.source === 'asr-chain' && a2[1].detail.model === j2?.model
    && a2[1].detail.chars === String(j2?.text || '').length && !a2[1].detail.error, JSON.stringify(a2));
} catch (e) {
  jian('门禁执行无异常', false, e?.message || e);
} finally {
  try { if (c) c.close(); } catch { /* noop */ }
  shaJinCheng(child);
  await sleep(2500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 留着的只是缓存 */ }
}
console.log(`\n==== verify-round38-asr：${ok} ok / ${shi.length} FAIL ====`);
for (const s of shi) console.log('  FAIL ' + s);
process.exit(shi.length ? 1 : 0);
