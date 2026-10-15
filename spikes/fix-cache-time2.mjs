import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = `        xiaoXiJiZui = guiZhengXiaoXiJiZhuang(xiaoXiJiZui);`;
const newS = `        xiaoXiJiZui = guiZhengXiaoXiJiZhuang(xiaoXiJiZui);
        /**
         * **当前时刻挂在最后一条用户消息末尾**（缓存命中优化）：
         * system 保持静态可缓存；动态时间戳放后缀，与 OpenAI/Anthropic prompt caching 一致。
         */
        try {
          const xz = new Date();
          const shiJianHang = '\\n\\n（当前时间：' + xz.toLocaleString() + '，时区 ' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'local')
            + '，时间戳 ' + xz.getTime() + '）';
          for (let i = xiaoXiJiZui.length - 1; i >= 0; i--) {
            const m = xiaoXiJiZui[i]!;
            if (m && m.role === 'user') {
              xiaoXiJiZui[i] = { ...m, content: String(m.content || '') + shiJianHang };
              break;
            }
          }
        } catch { /* noop */ }`;
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('time appended to last user msg');
}
