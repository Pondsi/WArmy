import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DATA = path.join(process.env.APPDATA || '', '@warmy', 'app-shell');
const PKG = path.join(process.cwd().replace(/\\/g, '/'), 'packages', 'app-shell');

function rmSafe(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) { try { fs.unlinkSync(p); } catch { /* noop */ } return; }
  if (st.isDirectory()) {
    try {
      for (const name of fs.readdirSync(p)) rmSafe(path.join(p, name));
      fs.rmdirSync(p);
    } catch { /* noop */ }
    return;
  }
  try { fs.unlinkSync(p); } catch { /* noop */ }
}

if (fs.existsSync(DATA)) {
  for (const name of fs.readdirSync(DATA)) {
    if (name === 'node_modules' || name === 'memory-runtime') continue;
    rmSafe(path.join(DATA, name));
  }
  console.log('wiped userData');
} else {
  fs.mkdirSync(DATA, { recursive: true });
  console.log('created empty userData');
}

const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: 'ignore', detached: true });
child.unref();
console.log('first-run launched');
