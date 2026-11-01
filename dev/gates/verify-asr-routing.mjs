/** 2026-10-24 语音路由行为回放：运行源码函数/IPC，不启动 Electron、不读用户配置/密钥、不联网。
 * AST 仅用于提取可执行单元，不以源码字符串是否存在作为产品断言。
 * 本地文件系统、原生推理、供应商和 fetch 全部使用隔离夹具；不生成 dist/tsbuildinfo。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readSource = (p) => ts.createSourceFile(p, fs.readFileSync(path.join(ROOT, p), 'utf8'), ts.ScriptTarget.Latest, true);
const main = readSource('packages/app-shell/src/electron-main.ts');
const local = readSource('packages/app-shell/src/bendi-yuyin.ts');
const audio = readSource('packages/providers/src/audio.ts');
for (const s of [main, local, audio]) assert.equal(s.parseDiagnostics.length, 0, s.fileName + ' syntax');
const transpile = (code) => {
  const r = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(r.diagnostics?.length || 0, 0, 'fixture compilation');
  return r.outputText;
};
const funcs = ['nengLiLianMoXing', 'asrWuYuYin', 'asrPcm16JingYin', 'asrChatShi', 'zhuanXieYinPinBuf',
  'shiYinPinFuJian', 'yuYinZhuanXie', 'renWuXuYaoNengLi', 'ttsChatShi'];
const channels = ['warmy:asrZhuanXie', 'warmy:tingHuaZhuangTai', 'warmy:shuoHuaZhuangTai', 'warmy:ttsLangDu',
  'warmy:benDiYuYinQiYong', 'warmy:benDiYuYinZiJian'];
const selected = main.statements.filter((n) => {
  if (ts.isFunctionDeclaration(n)) return funcs.includes(n.name?.text);
  if (!ts.isExpressionStatement(n) || !ts.isCallExpression(n.expression)) return false;
  const c = n.expression;
  return ts.isIdentifier(c.expression) && c.expression.text === 'chuliIpc' && channels.includes(c.arguments[0]?.text);
});
assert.equal(selected.length, funcs.length + channels.length, 'all executable functions and IPCs found');
// 每个附件调用点连同它的真实 try/catch 回放，验证失败会返回给宿主而非继续聊天。
const delegateTries = [];
function visit(n) {
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'yuYinZhuanXie') {
    let p = n.parent;
    while (p && !ts.isTryStatement(p)) p = p.parent;
    assert.ok(p?.catchClause, 'attachment call has a replayable boundary');
    delegateTries.push(p);
  }
  ts.forEachChild(n, visit);
}
visit(main);
assert.ok(delegateTries.length, 'attachment callers found');
const mainCode = transpile(selected.map((n) => n.getText(main)).join('\n') + '\n' + delegateTries.map((n, i) =>
  `async function replayDelegate${i}() { ${n.getText(main)} chatCalls++; return { ok: true }; }`).join('\n'));
const localCode = transpile(local.statements.filter((n) => !ts.isImportDeclaration(n)
  && !(ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(local) === 'thisDir')))
  .map((n) => n.getText(local)).join('\n'));
const audioScope = vm.createContext({ exports: {} });
vm.runInContext(transpile(audio.text), audioScope);

function wave({ silent = false, channels = 1, bits = 16, codec = 1, junk = false, seconds = 2 } = {}) {
  const align = channels * bits / 8;
  const data = Buffer.alloc(16000 * seconds * align);
  if (!silent) for (let i = 0; i + 1 < data.length; i += 2) data.writeInt16LE(i % 4 ? 4000 : -4000, i);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt '); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(codec, 8); fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(16000, 12); fmt.writeUInt32LE(16000 * align, 16); fmt.writeUInt16LE(align, 20); fmt.writeUInt16LE(bits, 22);
  const dh = Buffer.alloc(8); dh.write('data'); dh.writeUInt32LE(data.length, 4);
  const parts = [fmt];
  if (junk) { const j = Buffer.alloc(10); j.write('JUNK'); j.writeUInt32LE(1, 4); parts.push(j); }
  parts.push(dh, data);
  const riff = Buffer.alloc(12); riff.write('RIFF'); riff.writeUInt32LE(4 + parts.reduce((n, b) => n + b.length, 0), 4); riff.write('WAVE', 8);
  return Buffer.concat([riff, ...parts]);
}
const wav = wave();
const dataUrl = (buf = wav, mime = 'audio/wav') => `data:${mime};base64,${buf.toString('base64')}`;
const payload = (extra = {}) => ({ dataUrl: dataUrl(), ext: 'wav', ...extra });

function localFixture({ installed = true, enabled = false } = {}) {
  const files = new Map();
  const root = path.resolve(ROOT, '__memory_only_speech_fixture__');
  const statePath = path.join(root, 'ben-di-yu-yin.json');
  const controls = { runtime: true, asrText: '你好', asrError: '', ttsError: '', ttsEmpty: false, writes: 0, decoded: 0, configs: [], readExternal: [] };
  const memFs = {
    existsSync: (p) => files.has(p),
    statSync(p) { if (!files.has(p)) throw new Error('ENOENT'); return { isFile: () => true, size: files.get(p).length }; },
    readFileSync(p, encoding) { if (!files.has(p)) throw new Error('ENOENT'); return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p)); },
    writeFileSync(p, v) { files.set(p, Buffer.from(v)); if (p === statePath) controls.writes++; },
    mkdirSync() {},
    rmSync(p) { files.delete(p); },
  };
  const runtime = {
    OfflineRecognizer: class {
      constructor(config) { controls.configs.push(config); }
      createStream() { return { acceptWaveform() {} }; }
      decode() { controls.decoded++; if (controls.asrError) throw new Error(controls.asrError); }
      getResult() { return { text: controls.asrText }; }
    },
    OfflineTts: class {
      numSpeakers = 5;
      generate() { if (controls.ttsError) throw new Error(controls.ttsError); return { samples: controls.ttsEmpty ? [] : [0.2, -0.2], sampleRate: 16000 }; }
    },
    readWave(_p, external) { controls.readExternal.push(external); return { samples: [0.2, -0.2], sampleRate: 16000 }; },
    writeWave(p) { memFs.writeFileSync(p, wav); },
  };
  const scope = vm.createContext({ exports: {}, fs: memFs, path, Buffer, thisDir: root,
    createRequire: () => () => { if (!controls.runtime) throw new Error('runtime-broken'); return runtime; },
    fetch: () => { throw new Error('unexpected install network'); }, spawn: () => { throw new Error('unexpected native process'); } });
  vm.runInContext(localCode, scope);
  const api = scope.exports;
  api.chuShiHuaBenDiYuYin({ userDataDir: root });
  files.set(statePath, Buffer.from(JSON.stringify({ qiYong: enabled })));
  const manifest = api.BEN_DI_QING_DAN;
  files.set(path.join(root, 'local-speech', 'node_modules', manifest.yunXing.name, 'package.json'), Buffer.from('{}'));
  const modelPath = (kind, file) => path.join(root, 'local-speech', 'models', manifest.moXing[kind].ming, file);
  if (installed) for (const kind of ['shiBie', 'heCheng']) for (const file of manifest.moXing[kind].wenJian) files.set(modelPath(kind, file), Buffer.from('fixture'));
  return { api, files, controls, memFs, modelPath, statePath, state: () => JSON.parse(files.get(statePath).toString()) };
}

function fixture({ chain = ['whisper-1'], disabled = [], settings = {}, installed = true, enabled = false, responses = [], providers = {} } = {}) {
  const local = localFixture({ installed, enabled });
  const calls = [], resolved = [], timers = [], ipc = new Map();
  let unlocks = 0, forbiddenKeys = 0;
  const cfg = { specialModels: { asrChain: chain, asrDisabled: disabled, ttsChain: ['tts-fixture'] }, ...settings };
  const scope = vm.createContext({ ...audioScope.exports, ...local.api, Buffer, Uint8Array, Blob, FormData,
    fs: local.memFs, settingsStore: { load: () => cfg }, audit: { log() {} },
    yinPinZhuanWav: async () => { throw new Error('fixture-decode-failed'); },
    xiJingCuoWu: (e) => String(e?.message || e), pinJieUrl: (base, endpoint) => base + '/' + endpoint,
    baozhangGongyingshangMiyao: async () => { unlocks++; },
    jiexiGongyingshangMiyao: async () => { forbiddenKeys++; throw new Error('legacy key access forbidden'); },
    secureKeys: { load() { forbiddenKeys++; throw new Error('legacy key access forbidden'); } },
    jieMoXingGongYingShang: async (mo) => {
      resolved.push(mo);
      return Object.hasOwn(providers, mo) ? providers[mo] : { apiKey: 'fixture-not-a-real-key', protocol: 'openai-compatible', baseURL: 'https://fixture.invalid/' + mo, biaoQian: mo };
    },
    AbortSignal: { timeout(ms) { assert.ok(ms > 0 && ms <= 120000 && Number.isFinite(ms), 'finite ASR deadline'); const c = new AbortController(); timers.push({ ms, c }); return c.signal; } },
    fetch: async (url, options) => {
      const standard = options.body instanceof FormData;
      const body = standard ? options.body : JSON.parse(options.body);
      const model = standard ? body.get('model') : body.model;
      const bytes = standard ? Buffer.from(await body.get('file').arrayBuffer()) : Buffer.from(body.messages[0].content[0].input_audio.data, 'base64');
      calls.push({ url, options, body, model, standard, bytes });
      assert.ok(options.signal, 'every ASR request carries timeout signal');
      assert.deepEqual(bytes, wav, 'audio survives fallback intact');
      const r = responses[calls.length - 1];
      if (!r) throw new Error('unexpected-fetch-' + calls.length);
      if (r.timeout) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('fixture-timeout')), { once: true });
          timers.find((t) => t.c.signal === options.signal).c.abort();
        });
      }
      if (r.throw) throw new Error(r.throw);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.invalidJson) throw new Error('invalid-json'); return r.body; } };
    },
    chuliIpc: (channel, fn) => ipc.set(channel, fn),
    lei: 'asr', xiaoXi: { attachments: [] }, sessionId: 'fixture-session', modelId: 'chat-must-not-infer-audio', why: 'audio',
    yiShiBai: [], jieGuoWenBen: [], chatCalls: 0,
  });
  vm.runInContext(mainCode, scope);
  return { local, scope, calls, resolved, timers, cfg,
    invoke: (channel, p) => ipc.get('warmy:' + channel)(null, p),
    run: (...args) => scope.zhuanXieYinPinBuf(...args),
    unlocks: () => unlocks, forbiddenKeys: () => forbiddenKeys };
}
const standard = (text = 'yes') => ({ status: 200, body: { text } });
const chat = (text = '你好') => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
}

await test('未装全/运行时损坏不能启用；拒绝保留原选择且不写配置', async () => {
  for (const enabled of [false, true]) {
    for (const missing of ['shiBie', 'heCheng', 'runtime']) {
      const f = fixture({ enabled });
      if (missing === 'runtime') f.local.controls.runtime = false;
      else f.local.files.delete(f.local.modelPath(missing, 'tokens.txt'));
      const r = await f.invoke('benDiYuYinQiYong', { kai: true });
      assert.equal(r.ok, false); assert.ok(r.error); assert.equal(r.qiYong, enabled);
      assert.equal(r.zhuangTai.qiYong, enabled); assert.notEqual(r.zhuangTai.zhuangTai, 'yi_an_zhuang');
      assert.equal(f.local.controls.writes, 0); assert.equal(f.local.state().qiYong, enabled);
    }
  }
  const f = fixture();
  f.local.files.set(f.local.modelPath('shiBie', 'model.int8.onnx'), Buffer.alloc(0));
  assert.equal((await f.invoke('benDiYuYinQiYong', { kai: true })).ok, false);
});
await test('安装完成才可开启；安装完成返回 ready 而非 installing', async () => {
  const f = fixture();
  const installed = await f.local.api.anZhuangBenDiYuYin();
  assert.equal(installed.ok, true); assert.equal(installed.zhuangTai.zhuangTai, 'yi_an_zhuang');
  assert.equal(installed.zhuangTai.qiYong, false);
  assert.equal((await f.invoke('benDiYuYinQiYong', { kai: true })).qiYong, true);
  assert.equal((await f.invoke('benDiYuYinQiYong', { kai: false })).qiYong, false);
});
await test('本地 ASR 连续四次失败（含第三次）无 fetch/解锁、无自动取消勾选', async () => {
  const f = fixture({ enabled: true, settings: { asrLocalOnly: false, asrCloudProvider: 'deepgram' } });
  f.local.controls.asrError = 'native-fixture-failed';
  for (let i = 0; i < 4; i++) {
    const r = await f.invoke('asrZhuanXie', payload());
    assert.equal(r.ok, false); assert.equal(r.source, 'bendi-yuyin'); assert.match(r.error, /native-fixture-failed/);
    assert.equal(f.local.api.zhuangTaiBenDiYuYin().qiYong, true);
  }
  assert.equal(f.local.controls.decoded, 4); assert.equal(f.local.controls.writes, 0);
  assert.equal(f.calls.length, 0); assert.equal(f.unlocks(), 0); assert.equal(f.resolved.length, 0);
});
await test('本地缺模型/空结果/格式错误均 strict；ASR/TTS 状态不先解锁', async () => {
  for (const kind of ['missing', 'empty', 'format']) {
    const f = fixture({ enabled: true });
    if (kind === 'missing') f.local.files.delete(f.local.modelPath('heCheng', 'tokens.txt'));
    if (kind === 'empty') f.local.controls.asrText = '';
    const r = await f.invoke('asrZhuanXie', payload(kind === 'format' ? { ext: 'mp3' } : {}));
    assert.equal(r.ok, false); assert.equal(r.source, 'bendi-yuyin'); assert.ok(r.error);
    for (const c of ['tingHuaZhuangTai', 'shuoHuaZhuangTai']) {
      const s = await f.invoke(c); assert.equal(s.local, true); assert.equal(s.ready, kind !== 'missing');
    }
    assert.equal(f.calls.length, 0); assert.equal(f.unlocks(), 0); assert.equal(f.local.state().qiYong, true);
  }
});
await test('快照守住 strict：本地调用抛错或中途改变状态不能转云端', async () => {
  for (const throwing of [false, true]) {
    const f = fixture({ enabled: true });
    f.scope.benDiShiBie = async () => {
      f.local.api.qiYongBenDiYuYin(false);
      if (throwing) throw new Error('local-throw');
      return { ok: false, error: 'local-failure' };
    };
    const r = await f.invoke('asrZhuanXie', payload());
    assert.equal(r.ok, false); assert.equal(r.source, 'bendi-yuyin'); assert.match(r.error, /local-/);
    assert.equal(f.calls.length, 0); assert.equal(f.unlocks(), 0);
  }
});
await test('本地成功来源正确；中英无伪造 language，非中英明确报限制', async () => {
  const f = fixture({ enabled: true, settings: { asrLang: 'en' } });
  const yes = await f.invoke('asrZhuanXie', payload());
  assert.equal(yes.ok, true); assert.equal(yes.text, '你好'); assert.equal(yes.source, 'bendi-yuyin');
  assert.equal(f.local.controls.configs.length, 1);
  assert.equal(Object.hasOwn(f.local.controls.configs[0], 'language'), false);
  assert.deepEqual(f.local.controls.readExternal, [false]);
  f.cfg.asrLang = 'ja';
  const no = await f.invoke('asrZhuanXie', payload());
  assert.equal(no.ok, false); assert.match(no.error, /language-unsupported/);
  const attachment = await f.invoke('asrZhuanXie', payload({ source: 'attachment' }));
  assert.equal(attachment.ok, true); assert.equal(f.calls.length, 0);
});
await test('话筒关闭只挡话筒；统一函数默认附件，附件永远不传语言', async () => {
  const f = fixture({ settings: { asrEnabled: false, asrLang: 'ja', asrLocalOnly: true }, responses: [standard('yes'), standard('好')] });
  assert.equal((await f.invoke('asrZhuanXie', payload())).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.run(wav, 'wav')).text, 'yes');
  assert.equal((await f.invoke('asrZhuanXie', payload({ source: 'attachment' }))).text, '好');
  for (const c of f.calls) assert.equal(c.body.has('language'), false);
});
await test('云端严格顺序去重/disabled：同一候选标准→chat，然后下一候选，成功立即停', async () => {
  const f = fixture({ chain: ['plain-model', 'off', 'plain-model', 'whisper-1', 'unused-asr'], disabled: ['off'],
    responses: [{ status: 404 }, { status: 503, body: chat('假的成功').body }, standard('yes')] });
  const r = await f.invoke('asrZhuanXie', payload());
  assert.equal(r.ok, true); assert.equal(r.model, 'whisper-1');
  assert.deepEqual(f.calls.map((c) => [c.model, c.standard]), [['plain-model', true], ['plain-model', false], ['whisper-1', true]]);
  assert.deepEqual(f.resolved, ['plain-model', 'whisper-1']);
});
for (const viaChat of [false, true]) for (const text of ['yes', '好', '42', '谢谢观看', 'thank you for watching', 'one two three four five six seven eight nine ten eleven twelve thirteen']) {
  await test(`合法 Whisper API ${viaChat ? 'chat兼容' : '标准'} 短语保真：${text}`, async () => {
    const f = fixture({ responses: viaChat ? [{ status: 404 }, chat(text)] : [standard(text)] });
    const r = await f.invoke('asrZhuanXie', payload());
    assert.equal(r.ok, true); assert.equal(r.text, text); assert.equal(r.model, 'whisper-1');
  });
}
await test('auto 不传 language；明确语言仅话筒传，标准与 chat 一致', async () => {
  for (const lang of ['auto', 'en', 'zh']) for (const source of ['microphone', 'attachment']) {
    const f = fixture({ settings: { asrLang: lang }, responses: [{ status: 404 }, chat('yes')] });
    assert.equal((await f.invoke('asrZhuanXie', payload({ source }))).ok, true);
    const expected = source === 'microphone' && lang !== 'auto' ? lang : undefined;
    assert.equal(f.calls[0].body.get('language') ?? undefined, expected);
    assert.equal(f.calls[1].body.language, expected);
    assert.equal(f.calls[1].body.messages[0].content[0].input_audio.language, expected);
  }
});
await test('旧独立云配置不能抢跑；空链不能退到当前聊天供应商', async () => {
  for (const provider of ['deepgram', 'assemblyai']) {
    const f = fixture({ chain: [], settings: { asrCloudProvider: provider, asrCloudModel: 'legacy' } });
    const r = await f.invoke('asrZhuanXie', payload());
    assert.equal(r.ok, false); assert.match(r.error, /no-asr-model/);
    assert.equal(f.calls.length, 0); assert.equal(f.forbiddenKeys(), 0);
  }
});
await test('Ollama 不调用音频或 chat；不按 Whisper 名字筛掉正常 API', async () => {
  const f = fixture({ chain: ['dimavz/whisper-tiny', 'whisper-1'], providers: { 'dimavz/whisper-tiny': { protocol: 'ollama' } }, responses: [standard('yes')] });
  assert.equal((await f.invoke('asrZhuanXie', payload())).model, 'whisper-1');
  assert.deepEqual(f.calls.map((c) => c.model), ['whisper-1']);
  const only = fixture({ providers: { 'whisper-1': { protocol: 'ollama' } } });
  assert.match((await only.invoke('asrZhuanXie', payload())).error, /ollama-audio-unsupported/);
  assert.equal((await only.invoke('tingHuaZhuangTai')).ready, false); assert.equal(only.calls.length, 0);
});
await test('全部失败逐个列原因：缺供应商/密钥/不支持/HTTP/空结果，不重复 IPC 兜底', async () => {
  const chain = ['missing', 'nokey', 'ollama', 'http', 'empty', 'chat-empty', 'invalid-json', 'business-error'];
  const f = fixture({ chain, providers: { missing: null, nokey: { protocol: 'openai-compatible' }, ollama: { protocol: 'ollama' } },
    responses: [{ status: 401, body: { error: { message: 'denied' } } }, standard(' '), { status: 404 }, chat(' '),
      { status: 200, invalidJson: true }, { status: 200, body: { text: 'false success', error: { message: 'business-error' } } }] });
  const r = await f.invoke('asrZhuanXie', payload());
  assert.equal(r.ok, false);
  let pos = -1;
  for (const model of chain) { const next = r.error.indexOf(model + ':', pos + 1); assert.ok(next > pos, model + ' reason in configured order'); pos = next; }
  assert.match(r.error, /HTTP 401/); assert.match(r.error, /chat\/completions/); assert.equal(f.calls.length, 6);
});
await test('首个请求与 chat 超时后推进下一候选，不无限卡住', async () => {
  for (const viaChat of [false, true]) {
    const f = fixture({ chain: ['slow', 'whisper-1'], responses: viaChat ? [{ status: 404 }, { timeout: true }, standard()] : [{ timeout: true }, standard()] });
    assert.equal((await f.invoke('asrZhuanXie', payload())).model, 'whisper-1');
    assert.equal(f.timers.length, f.calls.length);
  }
});
await test('真实 no_speech 拒绝且不再次 chat；混合语音/静音片段不能全盘否定', async () => {
  const quiet = { no_speech_prob: 0.99, avg_logprob: -1.5 };
  const speech = { no_speech_prob: 0.02, avg_logprob: -0.1 };
  for (const viaChat of [false, true]) {
    const body = viaChat ? { ...chat().body, no_speech: true } : { text: 'no speech', segments: [quiet] };
    const f = fixture({ responses: viaChat ? [{ status: 404 }, { status: 200, body }] : [{ status: 200, body }] });
    const r = await f.invoke('asrZhuanXie', payload());
    assert.equal(r.ok, false); assert.match(r.error, /no-speech/); assert.equal(f.calls.length, viaChat ? 2 : 1);
  }
  const f = fixture({ responses: [{ status: 200, body: { text: 'yes', segments: [quiet, speech] } }] });
  assert.equal((await f.invoke('asrZhuanXie', payload())).text, 'yes');
});
await test('PCM16 静音检查识别 fmt/RIFF/chunk/声道，不把浮点/8bit/压缩误当静音', async () => {
  const f = fixture();
  for (const opts of [{ silent: true }, { silent: true, channels: 2, junk: true }]) {
    const b = wave(opts); assert.equal(f.scope.asrPcm16JingYin(b, 'wav'), true);
    assert.match((await f.run(b, 'wav')).error, /audio-silent/);
  }
  for (const opts of [{ silent: true, bits: 8 }, { silent: true, bits: 32, codec: 3 }, { silent: true, codec: 7 }, { silent: false }]) {
    assert.equal(f.scope.asrPcm16JingYin(wave(opts), 'wav'), false);
  }
  const malformed = wave({ silent: true }); malformed.writeUInt32LE(0xffffffff, 16);
  assert.equal(f.scope.asrPcm16JingYin(malformed, 'wav'), false);
  assert.equal(f.scope.asrPcm16JingYin(wave({ silent: true }).subarray(0, 60), 'wav'), false);
  assert.equal(f.calls.length, 0);
});
await test('附件用已转码 dataUrl 优先于原路径；忽略话筒语言和关闭开关', async () => {
  const f = fixture({ enabled: true, settings: { asrEnabled: false, asrLang: 'ja' } });
  const original = path.join(ROOT, 'fixture-original.mp3'); f.local.files.set(original, Buffer.from('compressed-original'));
  assert.equal(await f.scope.yuYinZhuanXie([{ path: original, name: 'original.mp3', dataUrl: dataUrl() }]), '你好');
  assert.equal(f.scope.renWuXuYaoNengLi({ attachments: [{ dataUrl: dataUrl() }], wen: '', neiBuLun: false, tuShu: 0 })[0].lei, 'asr');
  assert.equal(f.calls.length, 0);
});
await test('所有附件调用点把真实失败返回用户，不能进入后续聊天；成功才允许继续', async () => {
  for (let i = 0; i < delegateTries.length; i++) for (const success of [false, true]) {
    const f = fixture({ enabled: true });
    if (!success) f.local.controls.asrError = 'actual-native-failure';
    f.scope.xiaoXi.attachments = [{ name: 'user-audio.wav', dataUrl: dataUrl() }];
    const r = await f.scope['replayDelegate' + i]();
    assert.equal(r.ok, success); assert.equal(f.scope.chatCalls, success ? 1 : 0);
    if (!success) { assert.match(r.error, /actual-native-failure/); assert.match(r.error, /user-audio.wav/); }
    assert.equal(f.calls.length, 0);
  }
});
await test('多附件中任何失败不可默默跳过；损坏压缩音频不能上传或伪造转写', async () => {
  const f = fixture({ enabled: true });
  await assert.rejects(f.scope.yuYinZhuanXie([{ name: 'one.wav', dataUrl: dataUrl() }, { name: 'two.wav' }]), /two.wav.*read-failed/);
  await assert.rejects(f.scope.yuYinZhuanXie([{ name: 'a.mp3', dataUrl: dataUrl(wav, 'audio/mpeg') }]), /audio-decode-failed/);
  assert.equal(f.calls.length, 0);
});
await test('压缩音频在统一入口解码，本地不上传、云端附件不带话筒语言', async () => {
  for (const enabled of [true, false]) {
    const f = fixture({ enabled, settings: { asrLang: 'fr' }, responses: [standard('你好')] });
    let decoded = 0;
    f.scope.yinPinZhuanWav = async () => { decoded++; return wav; };
    const text = await f.scope.yuYinZhuanXie([{ name: 'voice.webm', dataUrl: dataUrl(Buffer.from('fixture-webm'), 'audio/webm') }]);
    assert.equal(text, '你好'); assert.equal(decoded, 1);
    assert.equal(f.calls.length, enabled ? 0 : 1);
    if (!enabled) assert.equal(f.calls[0].body.has('language'), false);
  }
});
await test('解码等待期间改变状态也不能把本地音频转发云端', async () => {
  const f = fixture({ enabled: true });
  f.scope.yinPinZhuanWav = async () => { f.local.api.qiYongBenDiYuYin(false); return wav; };
  const r = await f.run(Buffer.from('fixture-webm'), 'webm');
  assert.equal(r.ok, false); assert.equal(r.source, 'bendi-yuyin'); assert.equal(f.calls.length, 0);
});
await test('负向变异：删掉 strict 分支必被不准上传断言抓到', async () => {
  const f = fixture({ enabled: true, responses: [standard()] });
  const original = f.scope.zhuanXieYinPinBuf.toString();
  const broken = original.replace('if (localEnabled)', 'if (false)');
  assert.notEqual(broken, original);
  vm.runInContext(broken, f.scope);
  await f.run(wav, 'wav');
  assert.throws(() => assert.equal(f.calls.length, 0));
});
await test('TTS 启用即 strict：缺模型/空音频/异常无云调用，成功保持来源', async () => {
  for (const mode of ['missing', 'empty', 'error', 'throw', 'ok']) {
    const f = fixture({ enabled: true });
    if (mode === 'missing') f.local.files.delete(f.local.modelPath('shiBie', 'tokens.txt'));
    if (mode === 'empty') f.local.controls.ttsEmpty = true;
    if (mode === 'error') f.local.controls.ttsError = 'native-tts-error';
    if (mode === 'throw') f.scope.benDiHeCheng = async () => { throw new Error('native-tts-throw'); };
    const r = await f.invoke('ttsLangDu', { text: '你好' });
    assert.equal(r.ok, mode === 'ok'); assert.equal(r.source, 'bendi-yuyin');
    if (!r.ok) assert.ok(r.error);
    assert.equal(f.calls.length, 0); assert.equal(f.resolved.length, 0); assert.equal(f.local.state().qiYong, true);
  }
});
await test('本地自检无论成功/ASR失败/TTS失败都不临时改用户勾选', async () => {
  for (const mode of ['ok', 'asr', 'tts']) {
    const f = fixture({ enabled: false });
    if (mode === 'asr') f.local.controls.asrError = 'selftest-asr';
    if (mode === 'tts') f.local.controls.ttsError = 'selftest-tts';
    const r = await f.invoke('benDiYuYinZiJian');
    assert.equal(r.ok, mode === 'ok'); assert.equal(f.local.state().qiYong, false); assert.equal(f.local.controls.writes, 0);
  }
});
console.log(`\nverify-asr-routing: ${passed} passed / ${failed} failed; attachment callers replayed: ${delegateTries.length}`);
process.exitCode = failed ? 1 : 0;
