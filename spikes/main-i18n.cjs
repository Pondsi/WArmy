const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/';
const p = base + 'src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

const loadStrings = `function loadMainStrings(locale) {
  const f = locale && locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', \`\${f}.json\`), 'utf8'));
  } catch {
    return {};
  }
}
const MAIN_I18N = loadMainStrings(app.getLocale());
function tMain(k, fallback = '') {
  return MAIN_I18N[k] || fallback || k;
}
`;

if (!s.includes('function tMain')) {
  s = s.replace('let win: BrowserWindow | null = null;', loadStrings + '\nlet win: BrowserWindow | null = null;');
}

// 未配置 Key 回复
s = s.replace(
  /const reply = `\[未配置 API Key\] 已收到：\$\{msg\.content\.slice\(0, 80\)\}`;/,
  "const reply = tMain('llm.noKey') + msg.content.slice(0, 80);"
);

// 值班者系统提示
s = s.replace(
  /'你是 WArmy 内部群的值班者。请用简短中文回复用户，并在需要时使用看板指令格式：新建任务:\/完成\/进度 标题:百分比。',/,
  "tMain('llm.dutySystem'),"
);

fs.writeFileSync(p, s);
console.log('main i18n patched:', s.includes('tMain('));
