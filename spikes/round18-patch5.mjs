/**
 * phase5：任务8 当前模型 / 任务10 右键菜单
 * 注意：String.raw 内不能出现反引号。
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
  console.log(`OK ${rel} (${pairs.length})`);
}

const APP = 'packages/app-shell/src/renderer/app.js';

const oldInst = [
  '          <!-- 子项 1：可用模型（只有这里的模型，才能被「默认模型」和「模型调用链」使用） -->',
  '          <div class="modelZiXiang">',
  "            <h4>${escapeHtml(tOr('model.available', '可用模型'))}</h4>",
].join('\n');

const newInst = [
  '          <!-- 当前模型（与第四列「模型管理」同一功能：降级后黏住的模型；点 × 恢复按调用链） -->',
  '          <div class="modelZiXiang" id="iCurMoXingHang" ${String(inst.currentModel || \'\').trim() ? \'\' : \'style="display:none"\'}>',
  "            <h4>${escapeHtml(tOr('model.currentModel', '当前模型'))}</h4>",
  "            <div class=\"jingYin\" style=\"margin-bottom:6px\">${escapeHtml(tOr('model.currentHint', '本轮中途换过模型，之后这段对话一直用它；点右侧 × 恢复按调用链选择'))}</div>",
  '            <div class="mgrMoXingJi" id="iCurMoXingJi"></div>',
  '          </div>',
  '          <!-- 子项 1：可用模型（只有这里的模型，才能被「默认模型」和「模型调用链」使用） -->',
  '          <div class="modelZiXiang">',
  "            <h4>${escapeHtml(tOr('model.available', '可用模型'))}</h4>",
].join('\n');

const oldBind = [
  "      const defSel = $('iDefaultMoXing');",
  "      const allChk = $('iAllMoXingJi');",
  "      const allList = $('i-all-list');",
].join('\n');

const newBind = [
  "      const defSel = $('iDefaultMoXing');",
  "      const allChk = $('iAllMoXingJi');",
  "      const allList = $('i-all-list');",
  '      /** 「当前模型」行（与第四列 modelMgrCard 同一事实 inst.currentModel） */',
  '      (function renderCurMoXing() {',
  "        const hang = $('iCurMoXingHang');",
  "        const ji = $('iCurMoXingJi');",
  '        if (!hang || !ji) return;',
  "        const dang = String(inst2.currentModel || '').trim();",
  "        if (!dang) { hang.style.display = 'none'; ji.innerHTML = ''; return; }",
  "        hang.style.display = '';",
  "        ji.innerHTML = '<span class=\"moXingChip dangQianChip\">'",
  "          + '<span class=\"moXingMing\">' + escapeHtml(dang) + '</span>'",
  "          + '<button class=\"x\" id=\"iCurMoXingClear\" title=\"' + escapeHtml(tOr('model.currentClear', '不再固定用它（恢复按调用链选择）')) + '\">×</button>'",
  "          + '</span>';",
  "        const clearBtn = $('iCurMoXingClear');",
  "        if (clearBtn) clearBtn.addEventListener('click', () => {",
  "          inst2.currentModel = '';",
  '          saveInst();',
  "          hang.style.display = 'none';",
  "          ji.innerHTML = '';",
  "          showToast(tOr('model.currentClear', '不再固定用它（恢复按调用链选择）'));",
  '        });',
  '      })();',
].join('\n');

const oldCtx = [
  '    /**',
  '     * **右键文件 → 打开所在文件夹**（产品要求：删掉了那个小图标，改用右键）。',
  '     * 作用在所有带 data-open 的文件行上（第四列的其他文件 / 文件产物 / 生成产品都适用）。',
  '     */',
  "    if (heZi.dataset.revealBound !== '1') {",
  "      heZi.dataset.revealBound = '1';",
  "      heZi.addEventListener('contextmenu', async (e) => {",
  "        const hang = e.target && e.target.closest && e.target.closest('[data-open]');",
  '        if (!hang) return;',
  "        const p = hang.getAttribute('data-open') || '';",
  '        if (!p) return;',
  '        e.preventDefault();',
  '        e.stopPropagation();',
  '        // 右键语义 = **打开所在文件夹**（不是打开文件本身）；文件已经不在就报清楚',
  '        const r = await window.warmy.xianShiWenJianJia?.({ path: p });',
  '        if (r && r.ok === true) return;',
  "        const dir = String(p).replace(/[\\\\/][^\\\\/]*$/, '');",
  '        if (dir && dir !== p) {',
  '          const r2 = await window.warmy.daKaiLuJing?.({ path: dir });',
  '          if (r2 && r2.ok === true) return;',
  '        }',
  "        uiAlert(String((r && r.error) || t('common.error')));",
  '      });',
  '    }',
].join('\n');

// Verify exact content first
{
  const s = fs.readFileSync(path.join(ROOT, APP), 'utf8');
  console.log('oldInst hits', s.split(oldInst).length - 1);
  console.log('oldBind hits', s.split(oldBind).length - 1);
  console.log('oldCtx hits', s.split(oldCtx).length - 1);
}

const newCtx = [
  '    /**',
  '     * **右键文件 → 菜单**（产品要求）：复制 / 复制路径 / 打开目录。',
  '     */',
  "    if (heZi.dataset.revealBound !== '1') {",
  "      heZi.dataset.revealBound = '1';",
  "      heZi.addEventListener('contextmenu', async (e) => {",
  "        const hang = e.target && e.target.closest && e.target.closest('[data-open]');",
  '        if (!hang) return;',
  "        const p = hang.getAttribute('data-open') || '';",
  '        if (!p) return;',
  '        e.preventDefault();',
  '        e.stopPropagation();',
  '        shouWenJianYouJianCaiDan(p, e.clientX, e.clientY);',
  '      });',
  '    }',
].join('\n');

const oldFu = '  function fuJianHangHtml(lie) {';
const newFu = [
  '  /**',
  '   * 文件右键菜单：复制 / 复制路径 / 打开目录（替代「右键直接打开文件夹」）。',
  '   */',
  '  function shouWenJianYouJianCaiDan(p, x, y) {',
  "    document.querySelectorAll('.wenJianYouJianCaiDan').forEach((n) => n.remove());",
  "    const mk = document.createElement('div');",
  "    mk.className = 'wenJianYouJianCaiDan';",
  "    mk.style.cssText = 'position:fixed;z-index:12000;min-width:160px;background:var(--card);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;';",
  '    const mkItem = (label, fn) => {',
  "      const b = document.createElement('button');",
  "      b.type = 'button';",
  '      b.textContent = label;',
  "      b.style.cssText = 'display:block;width:100%;text-align:left;border:none;background:transparent;padding:8px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:13px;color:var(--ink);';",
  "      b.onmouseenter = () => { b.style.background = 'var(--hover)'; };",
  "      b.onmouseleave = () => { b.style.background = 'transparent'; };",
  '      b.onclick = async (ev) => {',
  '        ev.preventDefault(); ev.stopPropagation();',
  '        mk.remove();',
  '        try { await fn(); } catch (err) { uiAlert(String((err && err.message) || err)); }',
  '      };',
  '      mk.appendChild(b);',
  '    };',
  "    mkItem(tOr('common.copy', '复制'), async () => {",
  '      try {',
  '        const r = await window.warmy.copyFileToClipboard?.({ path: p });',
  "        if (r && r.ok) { showToast(tOr('chat.copied', '已复制')); return; }",
  '      } catch { /* noop */ }',
  "      try { await navigator.clipboard.writeText(p); showToast(tOr('chat.copied', '已复制')); } catch { /* noop */ }",
  '    });',
  "    mkItem(tOr('common.copyPath', '复制路径'), async () => {",
  "      try { await navigator.clipboard.writeText(p); showToast(tOr('chat.copied', '已复制')); }",
  "      catch { uiAlert(t('common.error')); }",
  '    });',
  "    mkItem(tOr('common.openDir', '打开目录'), async () => {",
  '      const r = await window.warmy.xianShiWenJianJia?.({ path: p });',
  '      if (r && r.ok === true) return;',
  "      const dir = String(p).replace(/[\\\\/][^\\\\/]*$/, '');",
  '      if (dir && dir !== p) {',
  '        const r2 = await window.warmy.daKaiLuJing?.({ path: dir });',
  '        if (r2 && r2.ok === true) return;',
  '      }',
  "      uiAlert(String((r && r.error) || t('common.error')));",
  '    });',
  '    document.body.appendChild(mk);',
  '    const mw = mk.offsetWidth || 160, mh = mk.offsetHeight || 120;',
  '    mk.style.left = Math.min(x, window.innerWidth - mw - 8) + \'px\';',
  '    mk.style.top = Math.min(y, window.innerHeight - mh - 8) + \'px\';',
  '    const close = (ev) => {',
  '      if (ev && mk.contains(ev.target)) return;',
  '      mk.remove();',
  "      document.removeEventListener('mousedown', close, true);",
  "      document.removeEventListener('contextmenu', close, true);",
  '    };',
  '    setTimeout(() => {',
  "      document.addEventListener('mousedown', close, true);",
  "      document.addEventListener('contextmenu', close, true);",
  '    }, 0);',
  '  }',
  '',
  '  function fuJianHangHtml(lie) {',
].join('\n');

const oldRev = [
  "  document.addEventListener('contextmenu', (e) => {",
  "    const ka = e.target && e.target.closest && e.target.closest('[data-art-reveal]');",
  '    if (!ka) return;',
  '    e.preventDefault();',
  '    e.stopPropagation();',
  "    const p = ka.getAttribute('data-art-reveal') || '';",
  '    if (p) void window.warmy.xianShiWenJianJia?.({ path: p });',
  '  });',
].join('\n');

const newRev = [
  "  document.addEventListener('contextmenu', (e) => {",
  "    const ka = e.target && e.target.closest && e.target.closest('[data-art-reveal]');",
  '    if (!ka) return;',
  '    e.preventDefault();',
  '    e.stopPropagation();',
  "    const p = ka.getAttribute('data-art-reveal') || '';",
  '    if (p) shouWenJianYouJianCaiDan(p, e.clientX, e.clientY);',
  '  });',
].join('\n');

edit(APP, [
  [oldInst, newInst, 'inst-current-model'],
  [oldBind, newBind, 'inst-current-bind'],
  [oldCtx, newCtx, 'ctx-menu-bind'],
  [oldFu, newFu, 'ctx-menu-impl'],
  [oldRev, newRev, 'art-reveal-menu'],
]);

console.log('phase5 done');
