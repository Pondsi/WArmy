import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.js';
let s = fs.readFileSync(p, 'utf8');

const oldS = `      return '<div class="' + cls + '" data-fs-id="' + escapeHtml(x.id) + '" data-fs-status="' + escapeHtml(zt) + '">' +
        '<div class="fenShenHang1">' +
          '<span class="fenShenShiJian" data-fs-kai="' + escapeHtml(x.id) + ':t">' +
            escapeHtml(kai('t') ? new Date(Number(x.createdAt) || 0).toLocaleString() : fsShiFen(x.createdAt)) +
          '</span>' +
          '<span class="fenShenMing">' + escapeHtml(x.ming || '') + '</span>' +
        '</div>' +
        '<div class="fenShenWen' + (kai('w') ? '' : ' yiHang') + '" data-fs-kai="' + escapeHtml(x.id) + ':w">' + escapeHtml(kai('w') ? renWu : fsYiHang(renWu)) + '</div>' +
        '<div class="jingYin fenShenWen' + (kai('m') ? '' : ' yiHang') + '" data-fs-kai="' + escapeHtml(x.id) + ':m">' + escapeHtml(kai('m') ? moXing : fsYiHang(moXing)) + '</div>' +
        '</div>';`;

const newS = `      /**
       * **分身卡片布局**（产品要求）：开始时间(时分) | 昵称 | 任务(截断) | 已进行秒
       * 悬停：完整时间(年月日时分秒) + 昵称(模型) + 完整任务 + 秒数
       */
      const chuang = Number(x.createdAt) || 0;
      const yong = chuang ? Math.max(0, Math.floor((Date.now() - chuang) / 1000)) : 0;
      const shiFen2 = chuang ? (function () {
        const d = new Date(chuang);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      })() : '—';
      const wanZheng = chuang ? new Date(chuang).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
      const tip = wanZheng + '\\n' + String(x.ming || '') + (moXing && moXing !== '—' ? '（' + moXing + '）' : '') + '\\n' + renWu + '\\n' + yong + 's';
      return '<div class="' + cls + '" data-fs-id="' + escapeHtml(x.id) + '" data-fs-status="' + escapeHtml(zt) + '" title="' + escapeHtml(tip) + '">' +
        '<div class="fenShenHang1" style="display:flex;align-items:center;gap:8px;min-width:0">' +
          '<span class="fenShenShiJian" style="flex:0 0 auto;width:42px">' + escapeHtml(shiFen2) + '</span>' +
          '<span class="fenShenMing" style="flex:0 0 auto;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(x.ming || '') + '</span>' +
          '<span class="fenShenWen yiHang" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(renWu) + '</span>' +
          '<span class="jingYin" style="flex:0 0 auto;width:48px;text-align:right">' + yong + 's</span>' +
        '</div>' +
        '</div>';`;

const n = s.split(oldS).length - 1;
console.log('fenShen hits', n);
if (n !== 1) process.exit(1);
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('fenShen card redesigned');
