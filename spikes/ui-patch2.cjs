const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
// 1) HTML: urgency labels + 去掉慎用 + 标题 tooltip i18n
let h = fs.readFileSync(base + 'index.html', 'utf8');
h = h.replace('data-i18n="chat.p1"', 'data-i18n="urgency.urgentLabel"');
h = h.replace('data-i18n="chat.p2"', 'data-i18n="urgency.insertLabel"');
h = h.replace('data-i18n="chat.p3"', 'data-i18n="urgency.queueLabel"');
h = h.replace('biaoTi="拖动调整宽度"', 'data-i18n-title="tip.dragWidth"');
fs.writeFileSync(base + 'index.html', h);

// 2) JS: 替换 urgency-sel 绑定 → 分段控件 + P1 倒计时确认；控制台双 resizer
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');

const oldUrg = j.match(/\s*\$\('urgency-sel'\)\?\.addEventListener\([\s\S]*?\n  \}\);/);
if (oldUrg) {
  j = j.replace(oldUrg[0], `
  $('urgency-bar')?.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-u]');
    if (!b) return;
    const u = b.dataset.u;
    if (u === 'P1') {
      const ok = await uiConfirmCountdown(t('urgency.confirmBody'), t('urgency.confirmTitle'), 5);
      if (!ok) return;
    }
    state.urgency = u;
    $('urgency-bar').querySelectorAll('button').forEach((x) => x.classList.toggle('qiYong', x === b));
  });`);
}

// 控制台/输入框 双 resizer
if (!j.includes('bindVerticalResizer')) {
  j = j.replace('  bindResizer($(\'lanTiaoZhengTiao\'), \'--list-w\', 200, 420);', `  function bindVerticalResizer(handleId, targetId, dir) {
    const el = $(handleId);
    const target = $(targetId);
    if (!el || !target) return;
    let y0 = 0, h0 = 0, drag = false;
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = target.getBoundingClientRect().height; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const delta = dir === 'up' ? (y0 - e.clientY) : (e.clientY - y0);
      const h = Math.min(400, Math.max(80, h0 + delta));
      target.style.height = h + 'px';
      target.style.maxHeight = h + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; });
  }
  // 控制台上方：拉伸控制台自身
  bindVerticalResizer('kongZhiTaiDingTiaoZhengTiao', 'kongZhiTaiMianBan', 'up');
  // 控制台下方（输入框上方）：拉伸输入区
  bindVerticalResizer('shuRuDingTiaoZhengTiao', 'shuRu', 'up');

  bindResizer($('lanTiaoZhengTiao'), '--list-w', 200, 420);`);
}

// 倒计时确认弹窗
if (!j.includes('function uiConfirmCountdown')) {
  j = j.replace('  function uiPrompt(message, defaultValue, biaoTi) {', `  /** 强制倒计时确认（危险操作） */
  function uiConfirmCountdown(message, biaoTi, seconds = 5) {
    return new Promise((resolve) => {
      const root = $('duiHuaKuangGen');
      $('duiHuaKuangBiaoTi').textContent = biaoTi || displayName();
      $('duiHuaKuangTi').textContent = String(message ?? '');
      const acts = $('duiHuaKuangDongZuoJi');
      acts.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'anNiuXiao';
      cancel.textContent = t('common.cancel');
      cancel.onclick = () => { root.classList.add('yinCang'); clearInterval(timer); resolve(false); };
      const ok = document.createElement('button');
      ok.className = 'anNiuDanger';
      ok.disabled = true;
      let left = seconds;
      const biaoQian = () => (t('urgency.confirmWait') || 'wait {s}s').replace('{s}', String(left));
      ok.textContent = biaoQian();
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          ok.disabled = false;
          ok.textContent = t('common.ok');
        } else {
          ok.textContent = biaoQian();
        }
      }, 1000);
      ok.onclick = () => { if (ok.disabled) return; root.classList.add('yinCang'); clearInterval(timer); resolve(true); };
      acts.append(cancel, ok);
      root.classList.remove('yinCang');
    });
  }

  function uiPrompt(message, defaultValue, biaoTi) {`);
}

// 去掉 anNiuAboutGengXin 绑定（关于区按钮已并到提示音区之外）
const oldAbout = j.match(/\s*\$\('anNiuAboutGengXin'\)[\s\S]*?\n  \};\n/);
if (oldAbout) j = j.replace(oldAbout[0], '\n');

fs.writeFileSync(base + 'yingYong.js', j);
console.log('patched html+js');
