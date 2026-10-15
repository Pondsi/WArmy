import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel}`);
}

edit('packages/app-shell/src/work-tools.ts', [
  [
    `    const file = resolveInside(baseDir, args && args.path, kuaiQuan);`,
    `    let file = resolveInside(baseDir, args && args.path, kuaiQuan);
    /**
     * **会话 id 叠两遍回落**（真机：workspace/inst-x/inst-x/hello.txt 找不到时
     * Windows 会弹「找不到文件」模态框）。append 时优先复用已存在的那份。
     */
    file = huiLuoHuiHuaGen(baseDir, String((args && args.path) || ''), file);`,
    'write-use-fallback',
  ],
]);

// list_dir / open 也用同一回落
edit('packages/app-shell/src/electron-main.ts', [
  [
    `              abs = path.resolve(baseH, p0);
              /**
               * **会话 id 叠两遍回落**（真机：workspace/inst-x/inst-x/hello.txt 找不到，
               * Windows 弹「找不到文件」模态框把整个应用卡死）。
               * 与 read_file 同一套：原路径不在就再试「相对工作区根」一次。
               */
              if (!fs.existsSync(abs)) {
                const root = path.resolve(baseH, '..');
                const shang = path.resolve(root, p0);
                if (shang !== root && shang.startsWith(root + path.sep) && fs.existsSync(shang)) {
                  abs = shang;
                }
              }`,
    `              abs = path.resolve(baseH, p0);
              /**
               * **会话 id 叠两遍回落**（真机：workspace/inst-x/inst-x/hello.txt 找不到，
               * Windows 弹「找不到文件」模态框把整个应用卡死）。
               */
              if (!fs.existsSync(abs)) {
                const root = path.resolve(baseH, '..');
                const shang = path.resolve(root, p0);
                if (shang !== root && shang.startsWith(root + path.sep) && fs.existsSync(shang)) abs = shang;
                else {
                  const pei = String(p0).match(/^[^/\\\\]+[\\\\/](.+)$/);
                  if (pei && pei[1]) {
                    const qu = path.resolve(baseH, pei[1]);
                    if (fs.existsSync(qu)) abs = qu;
                  }
                }
              }`,
    'open-fallback2',
  ],
]);

console.log('fallbacks wired');
