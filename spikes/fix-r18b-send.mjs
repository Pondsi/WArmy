import fs from 'node:fs';
const p = 'verify-round18b.mjs';
let s = fs.readFileSync(p, 'utf8');
const oldS = `  // 直接用 IPC 发带附件的消息更可靠
  const sent2 = await ev(\`(()=>{
    const abs = \${JSON.stringify(imgPath)};
    if (window.warmy && window.warmy.chatSend) {
      return window.warmy.chatSend({
        sessionId: 'inst-r18b',
        content: '请先描述我发的这张图（一句话），然后立刻用 write_file 在工作区生成 hello-\${MARK}.txt，content 写：\${MARK}。必须调用工具。',
        attachments: [{ path: abs, name: 'seed-tiny.png', bytes: 70 }],
      }).then(r => !!r);
    }
    return false;
  })()\`, 20000);
  ok('已发送（含图片附件）', !!sent2);`;

const newS = `  // 按 UI 同款 payload 发送（含图片附件 + 工具任务）
  const sent2 = await ev(\`(async ()=>{
    try {
      const abs = \${JSON.stringify(imgPath)};
      const inst = (window.__state && window.__state.instances && window.__state.instances[0]) || null;
      const chatId = (inst && inst.id) || 'inst-r18b';
      const r = await window.warmy.chatSend({
        sessionId: chatId,
        content: '请先描述我发的这张图（一句话），然后立刻用 write_file 在工作区生成 hello-\${MARK}.txt，content 写：\${MARK}。必须调用工具。',
        attachments: [{ name: 'seed-tiny.png', path: abs, dataUrl: '' }],
        ming: (inst && (inst.ming || inst.name)) || '牛马-1',
        thinkLevel: 'auto',
        xiaoDiShuLiang: 0,
        moXingJueCe: {
          urgency: 'P2',
          defaultModel: (inst && inst.defaultModel) || '',
          chain: (inst && inst.chain) || [],
          chainDisabled: (inst && inst.chainDisabled) || [],
        },
      });
      return !!(r && (r.ok || r.reply));
    } catch (e) { return 'err:' + (e && e.message); }
  })()\`, 240000);
  ok('已发送（含图片附件）', sent2 === true, String(sent2).slice(0, 80));`;

if (!s.includes(oldS)) {
  console.log('block not found, trying loose replace');
  // fallback: replace chatSend section by regex
  const re = /  \/\/ 直接用 IPC 发带附件的消息更可靠[\s\S]*?ok\('已发送（含图片附件）', !!sent2\);/;
  if (!re.test(s)) { console.log('regex fail'); process.exit(1); }
  s = s.replace(re, newS);
} else {
  s = s.replace(oldS, newS);
}
fs.writeFileSync(p, s, 'utf8');
console.log('sent2 updated');
