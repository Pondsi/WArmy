const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';

// i18n
const zhP = base + 'i18n/zh-CN.json';
const enP = base + 'i18n/en-US.json';
const zh = JSON.parse(fs.readFileSync(zhP, 'utf8'));
const en = JSON.parse(fs.readFileSync(enP, 'utf8'));
if (!zh['panel.directory']) {
  zh['panel.directory'] = '项目目录';
  zh['export.tiShi'] = '将导出当前会话的完整聊天记录为 Markdown 文件。';
  zh['export.include'] = '包含：消息内容、角色、时间戳';
  zh['common.more'] = '更多';
  en['panel.directory'] = 'Directory';
  en['export.tiShi'] = 'Export the full chat history as a Markdown file.';
  en['export.include'] = 'Includes: xiaoXiJi, roles, timestamps';
  en['common.more'] = 'More';
  fs.writeFileSync(zhP, JSON.stringify(zh, null, 2) + '\n');
  fs.writeFileSync(enP, JSON.stringify(en, null, 2) + '\n');
  console.log('i18n added', Object.keys(zh).length);
}

// 主进程：open-chat-window 加 mode
const mp = base + 'electron-main.ts';
let m = fs.readFileSync(mp, 'utf8');
if (!m.includes("mode?: string")) {
  m = m.replace(
    "ipcMain.handle('warmy:daKaiLiaoTianChuangKou', (_e, payload: { id: string; title: string; kind?: string }) => {",
    "ipcMain.handle('warmy:daKaiLiaoTianChuangKou', (_e, payload: { id: string; title: string; kind?: string; mode?: string }) => {"
  );
  m = m.replace(
    "query: { chatId: payload.id, chatKind: payload.kind || 'single', chatTitle: payload.biaoTi || '' },",
    "query: { chatId: payload.id, chatKind: payload.kind || 'single', chatTitle: payload.biaoTi || '', mode: payload.mode || 'full' },"
  );
  fs.writeFileSync(mp, m);
  console.log('main mode added');
}

// 渲染层：子窗口模式
const jp = base + 'renderer/yingYong.js';
let j = fs.readFileSync(jp, 'utf8');
if (!j.includes("q.get('mode')")) {
  const anchor = "      const q = new URLSearchParams(window.location.search);\n      const cid = q.get('chatId');";
  if (j.includes(anchor)) {
    j = j.replace(anchor, `      const q = new URLSearchParams(window.location.search);
      const mode = q.get('mode');
      if (mode === 'fu') {
        document.getElementById('biaoTiLan')?.classList.add('yinCang');
        document.getElementById('ceLan')?.classList.add('yinCang');
        document.getElementById('lieBiaoLan')?.classList.add('yinCang');
        document.getElementById('yingYongTi')?.classList.add('yinCangLieBiao');
      }
      const cid = q.get('chatId');`);
    fs.writeFileSync(jp, j);
    console.log('sub-window mode renderer');
  } else {
    console.log('WARN: URLSearchParams anchor not found');
  }
}

console.log('done');
