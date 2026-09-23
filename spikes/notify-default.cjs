const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');

// 1) 默认 notify=true：创建实例/群/联系人/演示数据
j = j.replace(
  "const inst = state.instances.find((x) => x.id === c.id) || { id: c.id, ming: c.name, status: 'stopped', notify: false };",
  "const inst = state.instances.find((x) => x.id === c.id) || { id: c.id, ming: c.name, status: 'stopped', notify: true };"
);
// 创建牛马
j = j.replace(
  "        id: 'inst-' + Date.now(),\n        ming,\n        status: 'stopped',\n        dutyEligible: true,",
  "        id: 'inst-' + Date.now(),\n        ming,\n        status: 'stopped',\n        dutyEligible: true,\n        notify: true,"
);
// 创建群
j = j.replace(
  "      state.groups.push({ id, ming, type, members: [] });",
  "      state.groups.push({ id, ming, type, members: [], notify: true });"
);
// 添加联系人
j = j.replace(
  "      state.chats.push({ id: 'c-' + Date.now(), ming, kind: 'extdm', lastPreview: t('list.noReply') });",
  "      state.chats.push({ id: 'c-' + Date.now(), ming, kind: 'extdm', lastPreview: t('list.noReply'), notify: true });"
);
// 演示实例
j = j.replace(
  "          id: 'demo-1',\n          ming: 'demo.agent',",
  "          id: 'demo-1',\n          ming: 'demo.agent',\n          notify: true,"
);
// 演示会话（board.sessions）
j = j.replace(
  "sessions: [",
  "sessions: ["
);
// 给 demo sessions 加 notify
j = j.replace(
  "{ id: 's-internal-1', kind: 'internal', ming: 'demo.project1', jinDu: 65, status: 'doing', blocked: false },",
  "{ id: 's-internal-1', kind: 'internal', ming: 'demo.project1', jinDu: 65, status: 'doing', blocked: false, notify: true },"
);

// 2) shouldNotify 辅助函数
if (!j.includes('function shouldNotify')) {
  j = j.replace(
    '  function sessionHasBlockingTasks(id) {',
    `  function shouldNotify(sessionId) {
    if (!sessionId) return true;
    const inst = state.instances.find((x) => x.id === sessionId);
    if (inst) return inst.notify !== false;
    const g = state.groups.find((x) => x.id === sessionId);
    if (g) return g.notify !== false;
    const c = state.chats.find((x) => x.id === sessionId);
    if (c) return c.notify !== false;
    // 未知会话：默认提醒
    return true;
  }

  function sessionHasBlockingTasks(id) {`
  );
  console.log('shouldNotify added');
}

// 3) 播放提示音（仅在 notify 且 sound 开关打开时）
if (!j.includes('function playNotifySound')) {
  j = j.replace(
    '  function shouldNotify(sessionId) {',
    `  function playNotifySound(kind) {
    const sid = state.selectedChat?.id;
    if (!shouldNotify(sid)) return; // 未勾选提醒：无提示音
    if (!state.sound || !state.sound[kind]) return; // 全局开关
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = kind === 'error' ? 220 : kind === 'request' ? 880 : 660;
      gain.gain.value = 0.04;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* noop */ }
  }

  function shouldNotify(sessionId) {`
  );
  console.log('playNotifySound added');
}

// 4) 发送后播放提示音
j = j.replace(
  "    renderChat();\n    flushQueue(id);\n    if (CHAT_NAVS.has(state.nav)) renderList();\n  }",
  "    renderChat();\n    flushQueue(id);\n    playNotifySound('complete');\n    if (CHAT_NAVS.has(state.nav)) renderList();\n  }"
);

// 5) 主进程邮件队列：根据 notify 决定是否入队
m = m.replace(
  "    // 请求时邮件提醒（队列占位）\n    if (settingsStore?.load().emailOnRequest) {\n      const profile = accountStore?.loadProfile();\n      if (profile?.email) {\n        emailQueue.push({",
  "    // 请求时邮件提醒：仅在该会话勾选了「提醒」时才入队\n    const notifyOk = (p1?.instances.list().find((x) => x.id === xiaoXi.groupId)?.dutyEligible !== false);\n    if (settingsStore?.load().emailOnRequest && notifyOk) {\n      const profile = accountStore?.loadProfile();\n      if (profile?.email) {\n        emailQueue.push({"
);

// 更精确：用 emailNotify.request 控制
m = m.replace(
  "    if (settingsStore?.load().emailOnRequest && notifyOk) {\n      const profile = accountStore?.loadProfile();\n      if (profile?.email) {",
  "    const sset = settingsStore?.load();\n    const emailOn = sset?.emailNotify?.request !== false || sset?.emailOnRequest;\n    if (emailOn && notifyOk) {\n      const profile = accountStore?.loadProfile();\n      if (profile?.email) {"
);

fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'electron-main.ts', m);
console.log('done');
