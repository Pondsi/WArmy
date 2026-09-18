// 启动预览壳 + CDP，供 verify-net-ui.mjs 连接
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const OUT = process.env.WARMY_NET_OUT || path.join(process.env.TEMP || '.', 'warmy-net-ui');
const PORT = Number(process.env.PORT || 9555);
const HTML = process.env.PREVIEW_HTML || path.join(OUT, 'index.html');
const electronPath = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');

const HOST_SRC = `// auto host for verify-net-ui
const { app, BrowserWindow } = require('electron');
const target = process.env.PREVIEW_HTML;
app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  w.loadFile(target);
  w.webContents.on('console-message', (_e, _lvl, message) => console.log('PAGE ' + String(message).slice(0, 200)));
});
app.on('window-all-closed', () => app.quit());
`;
fs.mkdirSync(OUT, { recursive: true });
const HOST = path.join(OUT, 'net-ui-host.cjs');
fs.writeFileSync(HOST, HOST_SRC, 'utf8');

console.log(`host=${HOST}`);
console.log(`html=${HTML}`);
console.log(`cdp=${PORT}`);
console.log(`electron=${electronPath}`);

const child = spawn(
  electronPath,
  [`--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion', `--user-data-dir=${path.join(OUT, 'profile-net')}`, HOST],
  { env: { ...process.env, PREVIEW_HTML: HTML }, cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }
);
child.stdout.on('data', (d) => process.stdout.write(String(d)));
child.stderr.on('data', (d) => process.stderr.write(String(d)));
child.on('exit', (c) => {
  console.log('host exit', c);
  process.exit(c || 0);
});
// keep alive
setInterval(() => {}, 10000);
