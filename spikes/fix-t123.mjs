/**
 * 任务1-3：自动/手动添加模型 + 右键真复制文件
 */
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

const APP = 'packages/app-shell/src/renderer/app.js';
const CSS = 'packages/app-shell/src/renderer/app.css';

// 1) 拉取模型 → 自动添加模型；右侧加手动添加模型
edit(APP, [
  [
    `          '<div class="provDongZuoJi"><button class="anNiuXiao" data-fetch' + ' title="' + escapeHtml(laQuBiaoTi) + '">' + escapeHtml(t('settings.fetchModels')) + '</button></div>' +`,
    `          '<div class="provDongZuoJi">' +
            '<button class="anNiuXiao" data-fetch title="' + escapeHtml(laQuBiaoTi) + '">' + escapeHtml(tOr('settings.autoAddModel', '自动添加模型')) + '</button>' +
            '<button class="anNiuXiao" data-manual-add="' + escapeHtml(pr.id) + '" title="' + escapeHtml(tOr('settings.manualAddModelTip', '手动填写模型名称与能力并验证')) + '">' + escapeHtml(tOr('settings.manualAddModel', '手动添加模型')) + '</button>' +
          '</div>' +`,
    'add-buttons',
  ],
]);

// 3) 右键「复制」= 复制文件本体（Explorer 可粘贴），不是复制路径
edit(APP, [
  [
    `    mkItem(tOr('common.copy', '复制'), async () => {
      try {
        const r = await window.warmy.copyFileToClipboard?.({ path: p });
        if (r && r.ok) { showToast(tOr('chat.copied', '已复制')); return; }
      } catch { /* noop */ }
      try { await navigator.clipboard.writeText(p); showToast(tOr('chat.copied', '已复制')); } catch { /* noop */ }
    });`,
    `    mkItem(tOr('common.copy', '复制'), async () => {
      /**
       * **复制文件本体**（产品要求：和「复制路径」区分开）。
       * 优先走系统文件剪贴板（Explorer 里可粘贴出文件）；失败才退回复制路径并如实提示。
       */
      try {
        const r = await window.warmy.copyFileToClipboard?.({ path: p });
        if (r && r.ok && r.mode === 'file') { showToast(tOr('chat.copiedFile', '已复制文件')); return; }
        if (r && r.ok) { showToast(tOr('chat.copied', '已复制')); return; }
      } catch { /* noop */ }
      try { await navigator.clipboard.writeText(p); showToast(tOr('chat.copiedPathFallback', '文件复制不可用，已改为复制路径')); } catch { /* noop */ }
    });`,
    'copy-file-true',
  ],
]);

// 2) 手动添加模型弹窗（挂在 prov 卡片事件之后）
edit(APP, [
  [
    `      const provKaEl = (pr) => {`,
    `      /** 手动添加模型弹窗：固定在主界面、不可拖动、随主界面移动 */
      function kaiShouDongMoXing(provId) {
        document.querySelectorAll('.shouDongMoXingTan').forEach((n) => n.remove());
        const pr = (state.providers || []).find((x) => x && x.id === provId);
        if (!pr) return;
        const mk = document.createElement('div');
        mk.className = 'shouDongMoXingTan';
        mk.style.cssText = 'position:fixed;z-index:12000;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,92vw);max-height:86vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px 18px;';
        const danXuan = (name, opts, def) => opts.map((o) =>
          '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;cursor:pointer">' +
          '<input type="radio" name="' + name + '" value="' + o + '"' + (o === def ? ' checked' : '') + '/>' +
          '<span data-unit="' + o + '">' + o + '</span></label>').join('');
        const duoXuan = (name, opts, sel) => opts.map((o) =>
          '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;cursor:pointer">' +
          '<input type="checkbox" name="' + name + '" value="' + o + '"' + (sel.includes(o) ? ' checked' : '') + '/>' + o + '</label>').join('');
        mk.innerHTML =
          '<div style="font-weight:600;margin-bottom:10px">' + escapeHtml(tOr('settings.manualAddModel', '手动添加模型')) + ' · ' + escapeHtml(pr.biaoQian || pr.id) + '</div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.nameId', '模型名称 / id')) + '</label>' +
          '<input id="sdModelId" style="width:100%" placeholder="e.g. gpt-4o / qwen2.5:7b"/></div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.ctxLen', '上下文长度')) + '</label>' +
          '<input id="sdCtx" type="number" min="0" step="1" style="width:120px"/> ' + danXuan('sdCtxU', ['kb', 'm'], 'm') + '</div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.outLen', '输出长度')) + '</label>' +
          '<input id="sdOut" type="number" min="0" step="1" style="width:120px"/> ' + danXuan('sdOutU', ['kb', 'm'], 'm') + '</div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.inTypes', '输入类型')) + '</div></label>' +
          '<div>' + duoXuan('sdIn', ['text', 'image', 'audio', 'video'], ['text']) + '</div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.outTypes', '输出类型')) + '</label>' +
          '<div>' + duoXuan('sdOutT', ['text', 'image', 'audio', 'code'], ['text']) + '</div></div>' +
          '<div class="field" style="margin:8px 0"><label>' + escapeHtml(tOr('model.caps', '能力')) + '</label>' +
          '<div>' + duoXuan('sdCap', ['chat', 'tools', 'vision', 'embedding', 'asr', 'tts', 'reasoning'], ['chat']) + '</div></div>' +
          '<div id="sdMsg" style="min-height:20px;margin:8px 0;color:var(--accent);font-size:12px"></div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">' +
          '<button class="anNiuXiao" id="sdCancel">' + escapeHtml(t('common.cancel') || '取消') + '</button>' +
          '<button class="anNiuZhuYao" id="sdOk">' + escapeHtml(t('common.ok') || '确定') + '</button></div>';
        document.body.appendChild(mk);
        // 单位选中态：强调色
        const syncUnit = () => {
          mk.querySelectorAll('input[type=radio]').forEach((r) => {
            const sp = r.parentElement && r.parentElement.querySelector('span');
            if (sp) sp.style.color = r.checked ? 'var(--accent)' : '';
            if (sp) sp.style.fontWeight = r.checked ? '600' : '';
          });
        };
        mk.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', syncUnit));
        syncUnit();
        const msg = mk.querySelector('#sdMsg');
        const close = () => mk.remove();
        mk.querySelector('#sdCancel').onclick = close;
        mk.querySelector('#sdOk').onclick = async () => {
          const id = String(mk.querySelector('#sdModelId').value || '').trim();
          if (!id) { msg.textContent = tOr('model.nameIdRequired', '请填写模型名称/id'); return; }
          const ctxN = Number(mk.querySelector('#sdCtx').value || 0);
          const ctxU = (mk.querySelector('input[name=sdCtxU]:checked') || {}).value || 'm';
          const outN = Number(mk.querySelector('#sdOut').value || 0);
          const outU = (mk.querySelector('input[name=sdOutU]:checked') || {}).value || 'm';
          const toTok = (n, u) => Math.round(Number(n || 0) * (u === 'm' ? 1000000 : 1024));
          const contextLen = toTok(ctxN, ctxU);
          const maxOut = toTok(outN, outU);
          const ins = [...mk.querySelectorAll('input[name=sdIn]:checked')].map((x) => x.value);
          const outs = [...mk.querySelectorAll('input[name=sdOutT]:checked')].map((x) => x.value);
          const caps = [...mk.querySelectorAll('input[name=sdCap]:checked')].map((x) => x.value);
          // 确定后：用该供应商设置请求 /models 或最小 chat 验证
          msg.innerHTML = '<span class="sdRun">' + escapeHtml(tOr('model.testing', '正在验证…')) + '</span>';
          mk.querySelector('#sdOk').disabled = true;
          try {
            const r = await window.warmy.shouDongMoXingYanZheng?.({
              providerId: provId, model: id, contextLen, maxOut,
              inputTypes: ins, outputTypes: outs, caps,
            });
            if (r && r.ok) {
              // 写入模型列表 + modelCaps
              try {
                pr.models = [...new Set([...(pr.models || []), id])];
                state.modelCaps = state.modelCaps || {};
                state.modelCaps[id] = {
                  ...(state.modelCaps[id] || {}),
                  contextLen, kind: caps.includes('embedding') ? 'embedding' : caps.includes('asr') ? 'asr' : caps.includes('tts') ? 'tts' : 'chat',
                  tools: caps.includes('tools'), vision: caps.includes('vision') ? true : (ins.includes('image') ? 'unknown' : false),
                  mediaFormats: ins.filter((x) => x !== 'text'),
                };
                window.__saveState?.();
              } catch { /* noop */ }
              showToast(tOr('model.added', '已添加模型'));
              close();
              try { renderProvList(); } catch { /* noop */ }
            } else {
              msg.innerHTML = escapeHtml(String((r && r.error) || tOr('model.verifyFailed', '验证失败')));
              mk.querySelector('#sdOk').disabled = false;
            }
          } catch (e) {
            msg.innerHTML = escapeHtml(String((e && e.message) || e));
            mk.querySelector('#sdOk').disabled = false;
          }
        };
      }
      const provKaEl = (pr) => {`,
    'manual-dialog',
  ],
  // 绑定按钮事件（在 data-fetch 绑定附近）
  [
    `          '<div class="provDongZuoJi">' +
            '<button class="anNiuXiao" data-fetch title="' + escapeHtml(laQuBiaoTi) + '">' + escapeHtml(tOr('settings.autoAddModel', '自动添加模型')) + '</button>' +
            '<button class="anNiuXiao" data-manual-add="' + escapeHtml(pr.id) + '" title="' + escapeHtml(tOr('settings.manualAddModelTip', '手动填写模型名称与能力并验证')) + '">' + escapeHtml(tOr('settings.manualAddModel', '手动添加模型')) + '</button>' +
          '</div>' +`,
    `          '<div class="provDongZuoJi">' +
            '<button class="anNiuXiao" data-fetch title="' + escapeHtml(laQuBiaoTi) + '">' + escapeHtml(tOr('settings.autoAddModel', '自动添加模型')) + '</button>' +
            '<button class="anNiuXiao" data-manual-add="' + escapeHtml(pr.id) + '" title="' + escapeHtml(tOr('settings.manualAddModelTip', '手动填写模型名称与能力并验证')) + '">' + escapeHtml(tOr('settings.manualAddModel', '手动添加模型')) + '</button>' +
          '</div>' +`,
    'keep-buttons',
  ],
]);

console.log('t1-3 ui done');
