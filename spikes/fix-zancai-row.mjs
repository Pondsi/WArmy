import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.js';
let s = fs.readFileSync(p, 'utf8');

// 1) 模型行右侧放赞踩
const oldModel = `          '<div class="xiaoXiMoXing"' + (m.moXingJiangJi ? ' title="' + escapeHtml(jiangJiWenBen(m.moXingJiangJi)) + '"' : '') + '>' +
            escapeHtml(String(m.moXing || '').replace(/^本轮模型[：:]\\s*/, '')) +
            (m.moXingJiangJi ? ' <span class="moXingJiangJiKuo">(' + escapeHtml(jiangJiDuan(m.moXingJiangJi)) + ')</span>' : '') + '</div>')`;

const zanHtml = `          /**
           * **赞 / 踩**（产品要求）：**只出现在牛马（assistant）回复**，用户消息下面不要。
           * 空心 SVG；点了填充强调色，再点取消。记录进智能配置文件。
           */
          (m.role === 'wo' ? '' :
          '<span class="zanCaiJi">' +
          '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'up') ? ' qiYong' : '') + '" data-zan="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteUp', '赞')) + '">' +
          '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
          '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
          '</svg></button>' +
          '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'down') ? ' qiYong' : '') + '" data-cai="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteDown', '踩')) + '">' +
          '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)">' +
          '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
          '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
          '</svg></button>' +
          '</span>')`;

const newModel = `          '<div class="xiaoXiMoXing"' + (m.moXingJiangJi ? ' title="' + escapeHtml(jiangJiWenBen(m.moXingJiangJi)) + '"' : '') + '>' +
            escapeHtml(String(m.moXing || '').replace(/^本轮模型[：:]\\s*/, '')) +
            (m.moXingJiangJi ? ' <span class="moXingJiangJiKuo">(' + escapeHtml(jiangJiDuan(m.moXingJiangJi)) + ')</span>' : '') +
            '<span class="zanCaiJi" style="margin-left:24px">' +
            (m.role === 'wo' ? '' :
              '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'up') ? ' qiYong' : '') + '" data-zan="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteUp', '赞')) + '">' +
              '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
              '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
              '</svg></button>' +
              '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'down') ? ' qiYong' : '') + '" data-cai="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteDown', '踩')) + '">' +
              '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)">' +
              '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
              '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
              '</svg></button>') +
            '</span></div>')`;

const n1 = s.split(oldModel).length - 1;
console.log('model row hits', n1);
if (n1 !== 1) process.exit(1);
s = s.replace(oldModel, newModel);

// 2) 从页脚移除赞踩
const oldFoot = `          (m.role === 'wo' ? '' :
          '<span class="zanCaiJi">' +
          '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'up') ? ' qiYong' : '') + '" data-zan="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteUp', '赞')) + '">' +
          '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
          '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
          '</svg></button>' +
          '<button type="button" class="zanCaiBtn' + ((state.votes && state.votes[maoYao(m)] === 'down') ? ' qiYong' : '') + '" data-cai="1" data-mkey="' + escapeHtml(maoYao(m)) + '" title="' + escapeHtml(tOr('chat.voteDown', '踩')) + '">' +
          '<svg viewBox="0 0 24 24" class="zanCaiIco" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)">' +
          '<path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/>' +
          '<path d="M7 10l4.1-6.6A1.8 1.8 0 0 1 12.6 2.5h.7a1.7 1.7 0 0 1 1.7 2L14 9h4.6a2 2 0 0 1 2 2.4l-1.1 6.7A2 2 0 0 1 17.5 20H7"/>' +
          '</svg></button>' +
          '</span>') +`;
const n2 = s.split(oldFoot).length - 1;
console.log('footer zan hits', n2);
if (n2 === 1) {
  s = s.replace(oldFoot, '');
}
fs.writeFileSync(p, s, 'utf8');
console.log('zanCai moved to model row');
