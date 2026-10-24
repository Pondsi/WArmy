import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const tree = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['yuYinDengJi', 'yuYinQingLi', 'yuYinJieShu', 'yuYinTingXie', 'yuYinKaiShi']);
const blocks = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) blocks.push(node.getText(tree));
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(blocks.length, wanted.size);
const code = `let yuYinZhuangTai = null; let yuYinQiDongZhong = false; ${blocks.join('\n')}
 globalThis.voice = { start: yuYinKaiShi, stop: yuYinJieShu, clear: yuYinQingLi, get current() { return yuYinZhuangTai; } };`;

function harness() {
  const calls = [], recorders = [], notices = [], constraints = [];
  let stopped = 0, requests = 0;
  const input = { value: '', dispatchEvent() {}, setSelectionRange() {}, focus() {} };
  const button = { disabled: false, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {} };
  const context = {
    state: { selectedChat: { id: 'A' } },
    $: (id) => id === 'shuRu' ? input : button,
    document: { activeElement: null }, Blob, Event, Uint8Array, console,
    uiAlert: (s) => notices.push(s), showToast: (s) => notices.push(s),
    t: (k) => k, tOr: (_k, text) => text,
    blobZhuanWav: async (blob) => ({ url: 'data:audio/wav;base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'), miao: 2, fengZhi: 0.6, rms: 0.1, sr: 16000, ch: 1 }),
    window: { warmy: {
      tingHuaZhuangTai: async () => ({ ready: true }),
      asrTranscribe: async ({ dataUrl }) => {
        const text = Buffer.from(dataUrl.split(',')[1], 'base64').toString();
        calls.push(text);
        return { ok: true, text, model: 'test-asr' };
      },
    } },
    navigator: { mediaDevices: { getUserMedia: async (options) => { requests++; constraints.push(options); return { getTracks: () => [{ stop() { stopped++; } }] }; } } },
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; recorders.push(this); }
      start() { this.state = 'recording'; }
      chunk(text) { this.ondataavailable({ data: new Blob([text]) }); }
      stop() {
        assert.equal(this.state, 'recording');
        this.state = 'inactive';
        queueMicrotask(() => { this.chunk('尾句'); this.onstop(); });
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, voice: context.voice, input, button, calls, recorders, notices, constraints, stats: () => ({ stopped, requests }) };
}
async function settle(done) {
  for (let i = 0; i < 80; i++) {
    if (done()) return;
    await new Promise(setImmediate);
  }
  assert.ok(done(), '异步录音未收尾');
}
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('PASS ' + label); }

await check('短录音停止后最后一块和全文都转写，资源最终释放', async () => {
  const h = harness(); await h.voice.start(); h.recorders[0].chunk('首句');
  h.voice.stop(); assert.ok(h.voice.current, 'stop 调用期间不能清空状态');
  await settle(() => !h.voice.current);
  assert.deepEqual(h.calls, ['首句尾句']); assert.equal(h.input.value, '首句尾句');
  assert.ok(h.stats().stopped > 0); assert.equal(h.button.disabled, false);
});
await check('预览尚未完成时停止必须再转写最终完整音频', async () => {
  const h = harness(); let release;
  h.context.window.warmy.asrTranscribe = async ({ dataUrl }) => {
    const text = Buffer.from(dataUrl.split(',')[1], 'base64').toString();
    h.calls.push(text);
    if (h.calls.length === 1) await new Promise((r) => { release = r; });
    return { ok: true, text };
  };
  await h.voice.start(); h.recorders[0].chunk('第一句'); h.recorders[0].chunk('第二句');
  await settle(() => !!release); h.voice.stop(); await new Promise(setImmediate); release();
  await settle(() => !h.voice.current);
  assert.deepEqual(h.calls, ['第一句第二句', '第一句第二句尾句']);
  assert.equal(h.input.value, '第一句第二句尾句');
});
await check('切换会话后迟到的转写不会改写另一个会话', async () => {
  const h = harness(); await h.voice.start(); h.recorders[0].chunk('A的音频');
  h.context.state.selectedChat.id = 'B'; h.input.value = 'B的草稿'; h.voice.stop();
  await settle(() => !h.voice.current); assert.equal(h.input.value, 'B的草稿');
});
await check('并发启动和重复停止均不重复开麦', async () => {
  const h = harness(); await Promise.all([h.voice.start(), h.voice.start()]);
  assert.equal(h.stats().requests, 1); h.voice.stop(); h.voice.stop();
  await settle(() => !h.voice.current); assert.equal(h.calls.length, 1);
});
await check('转写失败如实提示并清理状态', async () => {
  const h = harness(); h.context.window.warmy.asrTranscribe = async () => { throw new Error('test failure'); };
  await h.voice.start(); h.voice.stop(); await settle(() => !h.voice.current);
  assert.ok(h.notices.some((s) => s.includes('没转出'))); assert.ok(h.stats().stopped > 0);
});
await check('话筒自检不改草稿且完整收尾', async () => {
  const h = harness(); h.input.value = '草稿'; await h.voice.start(); h.voice.current.ceShi = true;
  h.voice.stop(); await settle(() => !h.voice.current); assert.equal(h.input.value, '草稿');
  assert.ok(h.notices.some((s) => s.includes('自检结果')));
});
await check('负向复现：恢复 stop 后立即清空会丢最终正文', async () => {
  const h = harness(); await h.voice.start(); h.recorders[0].chunk('首句'); h.voice.stop(); h.voice.clear();
  await settle(() => h.calls.length > 0);
  assert.notEqual(h.input.value, '首句尾句');
});
await check('聊天话筒读取已保存的输入设备，不误用系统默认麦克风', async () => {
  const h = harness();
  h.context.window.warmy.settingsGet = async () => ({ settings: { audioMicDevice: 'chosen-mic' } });
  await h.voice.start();
  assert.equal(h.constraints[0].audio.deviceId.exact, 'chosen-mic');
  h.voice.stop(); await settle(() => !h.voice.current);
});
await check('系统默认设备不发送空的 exact deviceId', async () => {
  const h = harness();
  h.context.window.warmy.settingsGet = async () => ({ settings: { audioMicDevice: '' } });
  await h.voice.start();
  assert.equal(h.constraints[0].audio.deviceId, undefined);
  h.voice.stop(); await settle(() => !h.voice.current);
});
await check('录音器创建失败仍关闭已打开的音轨并显示具体原因', async () => {
  const h = harness();
  h.context.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { throw new Error('recorder-init-failed'); }
  };
  await h.voice.start();
  assert.ok(h.stats().stopped > 0); assert.equal(h.voice.current, null);
  assert.ok(h.notices.some((s) => s.includes('recorder-init-failed')));
});
await check('录音中异常释放音轨，不留下无法再次点击的话筒', async () => {
  const h = harness(); await h.voice.start();
  h.recorders[0].onerror({ error: new Error('device-disconnected') });
  assert.equal(h.voice.current, null); assert.equal(h.button.disabled, false);
  assert.ok(h.stats().stopped > 0); assert.ok(h.notices.some((s) => s.includes('device-disconnected')));
});
await check('负向变异：忽略所选麦克风必被设备断言抓到', async () => {
  const h = harness();
  h.context.window.warmy.settingsGet = async () => ({ settings: { audioMicDevice: 'chosen-mic' } });
  const broken = code.replace('...(micDevice ? { deviceId: { exact: micDevice } } : {}),', '');
  assert.notEqual(broken, code);
  const c = { ...h.context }; vm.createContext(c); vm.runInContext(broken, c);
  await c.voice.start();
  assert.throws(() => assert.equal(h.constraints[0].audio.deviceId?.exact, 'chosen-mic'));
  c.voice.stop(); await settle(() => !c.voice.current);
});
console.log(`==== verify-r65-mic-lifecycle: ${passed} PASS / 0 FAIL ====`);
