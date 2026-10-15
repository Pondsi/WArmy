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

edit('packages/app-shell/src/electron-main.ts', [
  [
    `async function yanXuJiHuaRenWu(sessionId: string, xiaoXi: Parameters<typeof zhenZhengFaSong>[1], shangLun?: { diaoYongJi?: number; huiFu?: string }): Promise<void> {`,
    `async function yanXuJiHuaRenWu(sessionId: string, xiaoXi: Parameters<typeof zhenZhengFaSong>[1], shangLun?: { diaoYongJi?: number; huiFu?: string; cuoWu?: string }): Promise<void> {`,
    'sig',
  ],
  [
    `          void yanXuJiHuaRenWu(sessionId, xiaoXi as never, { diaoYongJi: loop.gongJuDiaoYongJi, huiFu: reply });`,
    `          void yanXuJiHuaRenWu(sessionId, xiaoXi as never, {
            diaoYongJi: loop.gongJuDiaoYongJi,
            huiFu: reply,
            cuoWu: String((loop as { degradedReason?: string }).degradedReason || loop.tingZhiYuanYin || ''),
          });`,
    'call1',
  ],
  [
    `    await yanXuJiHuaRenWu(sessionId, xiaoXi, { diaoYongJi: xiaLun.diaoYongJi, huiFu: String((r as { reply?: string }).reply || '') });`,
    `    await yanXuJiHuaRenWu(sessionId, xiaoXi, {
      diaoYongJi: xiaLun.diaoYongJi,
      huiFu: String((r as { reply?: string }).reply || ''),
      cuoWu: String((r as { error?: string; tools?: { tingZhiYuanYin?: string; degradedReason?: string } }).error
        || (r as { tools?: { degradedReason?: string } }).tools?.degradedReason
        || ''),
    });`,
    'call2',
  ],
]);
console.log('continue-sig done');
