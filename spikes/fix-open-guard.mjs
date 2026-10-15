import fs from 'node:fs';
function edit(rel, pairs) {
  let s = fs.readFileSync(rel, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(rel, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

const EM = 'packages/app-shell/src/electron-main.ts';

edit(EM, [
  // open_path：先解析回落 + 不存在不调 shell.openPath（防 Windows 模态框卡死）
  [
    `            } else {
              abs = path.resolve(baseH, p0);
              const rel = path.relative(baseH, abs);
              if (rel.startsWith('..') || path.isAbsolute(rel)) yueQuan = true;
            }
            if (yueQuan) {`,
    `            } else {
              abs = path.resolve(baseH, p0);
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
              }
              const rel = path.relative(baseH, abs);
              if (rel.startsWith('..') || path.isAbsolute(rel)) yueQuan = true;
            }
            if (yueQuan) {`,
    'open-fallback',
  ],
  [
    `            if (okH && abs) {
              /** 本会话已打开过 ⇒ 不再重复弹窗（真机：同一文件被连开十几次） */
              try {
                let kaiGuo = huiHuaYiDaKai.get(sessionId);
                if (!kaiGuo) { kaiGuo = new Set(); huiHuaYiDaKai.set(sessionId, kaiGuo); }
                if (kaiGuo.has(abs)) {
                  huiBaoH = \`[open_path] \${abs} 本会话已经打开过了，不再重复打开。如需再看请让用户自己点开。\`;
                } else {
                  const r0 = await shell.openPath(abs);
                  if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
                  else {
                    kaiGuo.add(abs);
                    huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;
                    try { jiLuBenLunWenJian(String(argsH.path || ''), abs, Number((fs.existsSync(abs) && fs.statSync(abs).size) || 0)); } catch { /* noop */ }
                  }
                }
              } catch { /* 去重失败不挡打开 */ }
            }`,
    `            if (okH && abs) {
              /**
               * **文件不存在就绝不调 shell.openPath**（真机事故：Windows 弹「找不到文件」
               * 模态框，整应用卡死、测试挂死）。如实回给模型，让它先 write_file / 用对路径。
               */
              if (!fs.existsSync(abs)) {
                okH = false;
                huiBaoH = \`[open_path] 文件不存在：\${abs}（工作区相对路径请写对，或先用 write_file 生成）。**不要**用猜测的绝对路径。\`;
              } else {
                try {
                  let kaiGuo = huiHuaYiDaKai.get(sessionId);
                  if (!kaiGuo) { kaiGuo = new Set(); huiHuaYiDaKai.set(sessionId, kaiGuo); }
                  if (kaiGuo.has(abs)) {
                    huiBaoH = \`[open_path] \${abs} 本会话已经打开过了，不再重复打开。如需再看请让用户自己点开。\`;
                  } else {
                    const r0 = await shell.openPath(abs);
                    if (r0) { okH = false; huiBaoH = \`[open_path] 打开失败：\${r0}\`; }
                    else {
                      kaiGuo.add(abs);
                      huiBaoH = \`[open_path] 已用系统默认程序打开 \${abs}\`;
                      try { jiLuBenLunWenJian(String(argsH.path || ''), abs, Number((fs.existsSync(abs) && fs.statSync(abs).size) || 0)); } catch { /* noop */ }
                    }
                  }
                } catch { /* 去重失败不挡打开 */ }
              }
            }`,
    'open-exists-guard',
  ],
]);

console.log('open_path guard done');
