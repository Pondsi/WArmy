/**
 * 第 18 轮补丁 phase2：UI 各项（精确匹配）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function edit(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) {
      console.error(`FAIL ${rel} [${tag}] hits=${n}`);
      process.exit(1);
    }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length} edits)`);
}

const APP = 'packages/app-shell/src/renderer/app.js';
const CSS = 'packages/app-shell/src/renderer/app.css';
const RCSS = 'packages/app-shell/src/renderer/renderer.css';

// ── 任务1：删语音识别勾选；识别语言加问号 ──
edit(APP, [
  [
    `          <label style="display:flex;align-items:center;gap:6px;margin-top:8px">
            <input type="checkbox" id="asrKaiQi" \${state.asrEnabled !== false ? 'checked' : ''}/> \${escapeHtml(tOr('settings.asrEnable', '语音识别'))}
          </label>
          <div class="shiLiHang" style="align-items:center;gap:10px;margin-top:6px">
            <span class="jingYin" style="min-width:160px">\${escapeHtml(tOr('settings.asrLang', '识别语言'))}</span>
            <select id="asrYuYan" style="min-width:260px">
              <option value="auto">\${escapeHtml(tOr('settings.asrLangAuto', '自动（由模型判断）'))}</option>
              \${ASR_YU_YAN.map((l) => \`<option value="\${l.c}">\${escapeHtml(l.n)}（\${l.c}）</option>\`).join('')}
            </select>
          </div>
          <div class="jingYin" style="font-size:11px;margin-top:4px">\${escapeHtml(tOr('settings.asrLangHint', '「自动」不传语言参数，由模型自行判断；选了具体语言则把语言参数带给模型，可显著降低中英文互串。语言列表覆盖 Whisper 系（含 faster-whisper / whisper.cpp）与 MiMo ASR 等主流模型支持的语种。'))}</div>`,
    `          <div class="shiLiHang" style="align-items:center;gap:10px;margin-top:8px">
            <span class="jingYin" style="min-width:160px;display:inline-flex;align-items:center;gap:4px">\${escapeHtml(tOr('settings.asrLang', '识别语言'))}<button type="button" class="ddWen" title="\${escapeHtml(tOr('settings.asrLangHint', '「自动」不传语言参数，由模型自行判断；选了具体语言则把语言参数带给模型，可显著降低中英文互串。语言列表覆盖 Whisper 系（含 faster-whisper / whisper.cpp）与 MiMo ASR 等主流模型支持的语种。'))}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.8"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/></svg></button></span>
            <select id="asrYuYan" style="min-width:260px">
              <option value="auto">\${escapeHtml(tOr('settings.asrLangAuto', '自动（由模型判断）'))}</option>
              \${ASR_YU_YAN.map((l) => \`<option value="\${l.c}">\${escapeHtml(l.n)}（\${l.c}）</option>\`).join('')}
            </select>
          </div>`,
    'asr-ui',
  ],
  [
    `      (function bindAsrLang() {
        const kai = $('asrKaiQi');
        const yuYan = $('asrYuYan');
        if (yuYan) {
          try { yuYan.value = String(state.asrLang || 'auto'); } catch { /* noop */ }
          // 兜底：存过的语言不在列表里（旧值/拼写不同）就退回「自动」，不让选中态空着
          if (yuYan.value !== String(state.asrLang || 'auto')) { try { yuYan.value = 'auto'; } catch { /* noop */ } }
          yuYan.onchange = () => {
            state.asrLang = String(yuYan.value || 'auto');
            try { window.warmy.settingsSave({ asrLang: state.asrLang }); } catch { /* noop */ }
          };
        }
        if (kai) {
          kai.onchange = () => {
            state.asrEnabled = !!kai.checked;
            try { window.warmy.settingsSave({ asrEnabled: state.asrEnabled }); } catch { /* noop */ }
            // 关掉时把语言下拉一起灰掉（保持"设置项之间的逻辑关系"清楚）
            if (yuYan) { try { yuYan.disabled = !state.asrEnabled; } catch { /* noop */ } }
          };
          if (yuYan) { try { yuYan.disabled = !state.asrEnabled; } catch { /* noop */ } }
        }
      })();`,
    `      (function bindAsrLang() {
        // 语音识别始终开启（产品要求：删除「语音识别」勾选框）
        try { state.asrEnabled = true; window.warmy.settingsSave?.({ asrEnabled: true }); } catch { /* noop */ }
        const yuYan = $('asrYuYan');
        if (yuYan) {
          try { yuYan.value = String(state.asrLang || 'auto'); } catch { /* noop */ }
          if (yuYan.value !== String(state.asrLang || 'auto')) { try { yuYan.value = 'auto'; } catch { /* noop */ } }
          yuYan.onchange = () => {
            state.asrLang = String(yuYan.value || 'auto');
            try { window.warmy.settingsSave({ asrLang: state.asrLang }); } catch { /* noop */ }
          };
        }
      })();`,
    'asr-bind',
  ],
  // ── 任务2：赞/踩只出现在牛马回复 ──
  [
    `          /**
           * **赞 / 踩**（产品要求）：**空心 SVG** 图标，默认空心；点了**填充强调色**，再点取消。
           * 与左边图标之间留大一点的空隙；整行右侧不溢出（\`margin-left:auto\` + 不换行）。
           * 记录进智能配置文件；**取消时把那条记录删掉**（不是再记一条"取消"）。
           */
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
          '</span>' +`,
    `          /**
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
          '</span>') +`,
    'zancai-assistant-only',
  ],
]);

console.log('phase2a done');
