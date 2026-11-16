/* 诊断日志独立窗（R184）。R223 项2：搜索框（X/X 第几个/共几个 + Ctrl+F + Enter/Shift+Enter 上下翻）
 * 与「用 nm 查看器打开」（nm 未启用 ⇒ 灰）。说明文字一律走悬停气泡（R223 项12）。 */
(function () {
  'use strict';
  const el = (id) => document.getElementById(id);
  const yu = el('zdYuLan');
  const zhuang = el('zdZhuang');
  const chaInput = el('zdChaZhao');
  const jiShu = el('zdChaJiShu');
  const nmBtn = el('zdNm');
  const esc = (s) => String(s == null ? '' : s);
  const escHtml = (s) => esc(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  zhuang.title = '只记脱敏事件，绝不上传。';

  let yuanWen = '';   // 当前日志纯文本（搜索的事实来源）
  let chaCi = '';     // 当前搜索词
  let dangQian = 0;   // 当前匹配序号（0 起）
  let piPei = [];     // 全部匹配起点

  /** 按当前搜索词渲染高亮；无词 ⇒ 纯文本。当前匹配滚到视野中央。 */
  function huaGaoLiang() {
    piPei = [];
    if (!chaCi) { yu.textContent = yuanWen; jiShu.textContent = '0/0'; return; }
    const xia = yuanWen.toLowerCase(); const ci = chaCi.toLowerCase();
    let i = xia.indexOf(ci);
    while (i >= 0 && piPei.length < 5000) { piPei.push(i); i = xia.indexOf(ci, i + ci.length); }
    if (!piPei.length) { yu.textContent = yuanWen; jiShu.textContent = '0/0'; return; }
    if (dangQian >= piPei.length) dangQian = 0;
    if (dangQian < 0) dangQian = piPei.length - 1;
    let html = ''; let wei = 0;
    piPei.forEach((k, n) => {
      html += escHtml(yuanWen.slice(wei, k));
      html += '<mark' + (n === dangQian ? ' class="zdDangQian"' : '') + '>' + escHtml(yuanWen.slice(k, k + chaCi.length)) + '</mark>';
      wei = k + chaCi.length;
    });
    html += escHtml(yuanWen.slice(wei));
    yu.innerHTML = html;
    jiShu.textContent = (dangQian + 1) + '/' + piPei.length;
    const dang = yu.querySelector('mark.zdDangQian');
    if (dang) dang.scrollIntoView({ block: 'center' });
  }

  function xianShi(rows) {
    yuanWen = (!rows || !rows.length) ? '（暂无记录）' : rows.map((r) => {
      const wei = [r.ts, r.ji, r.mo, r.code].filter(Boolean).join('  ');
      const gu = r.gu ? '  [' + r.gu + ']' : '';
      const shu = r.zhi != null ? '  ' + r.zhi : '';
      const zhan = r.zhan ? '\n    ' + r.zhan : '';
      return wei + gu + shu + zhan;
    }).join('\n');
    if (chaCi) { huaGaoLiang(); return; } // 搜索中：保持词与当前匹配，不被刷新冲掉
    yu.textContent = yuanWen;
    /* 贴底跟随：只有本来就在底部附近才自动滚底（上滚阅读时不抢位置） */
    if (yu.scrollHeight - yu.scrollTop - yu.clientHeight < 48) yu.scrollTop = yu.scrollHeight;
  }

  async function shuaXin() {
    try {
      const r = await window.warmy.diagLog(200);
      xianShi(r && r.entries);
      const on = !!(r && r.enabled);
      el('zdToggle').textContent = on ? '记录：开' : '记录：关';
      zhuang.textContent = '共 ' + ((r && r.entries) || []).length + ' 条';
      /* R223 项2：nm 未启用 ⇒ 按钮灰不可用 */
      const nmOn = !!(r && r.nmQiYong);
      nmBtn.disabled = !nmOn;
      nmBtn.title = nmOn ? '在 nm 查看器中打开当前诊断日志' : 'nm 查看器未启用（设置→功能里安装/启用后可用）';
    } catch (e) { yuanWen = '读取失败：' + esc(e && e.message || e); yu.textContent = yuanWen; }
  }

  el('zdView').addEventListener('click', () => { void shuaXin(); });
  el('zdSelf').addEventListener('click', async () => {
    try {
      const r = await window.warmy.diagSelfCheck();
      xianShi(((r && r.results) || []).map((x) => ({ ts: '', ji: x.ok ? 'info' : 'warn', mo: 'selfcheck', code: x.code, zhi: x.zhi })));
      zhuang.textContent = '自检完成。';
    } catch (e) { zhuang.textContent = '自检失败：' + esc(e && e.message || e); }
  });
  el('zdExport').addEventListener('click', async () => {
    try { const r = await window.warmy.diagExport(); zhuang.textContent = r && r.ok ? '已导出（不含敏感信息）。' : '导出取消/失败。'; }
    catch (e) { zhuang.textContent = '导出失败：' + esc(e && e.message || e); }
  });
  el('zdClear').addEventListener('click', async () => {
    if (!confirm('确定清空诊断日志？')) return;
    try { await window.warmy.diagClear(); await shuaXin(); zhuang.textContent = '已清空。'; }
    catch (e) { zhuang.textContent = '清空失败：' + esc(e && e.message || e); }
  });
  el('zdToggle').addEventListener('click', async () => {
    try {
      const cur = await window.warmy.diagLog(1);
      const on = !(cur && cur.enabled);
      await window.warmy.diagToggle(on);
      el('zdToggle').textContent = on ? '记录：开' : '记录：关';
      zhuang.textContent = on ? '诊断记录已开启。' : '诊断记录已关闭。';
    } catch (e) { zhuang.textContent = '切换失败：' + esc(e && e.message || e); }
  });
  nmBtn.addEventListener('click', async () => {
    if (nmBtn.disabled) return;
    try {
      const r = await window.warmy.diagNmKai();
      zhuang.textContent = r && r.ok ? '已在 nm 查看器中打开。'
        : (r && r.error === 'nm-disabled' ? 'nm 查看器未启用。' : '打开失败。');
    } catch (e) { zhuang.textContent = '打开失败：' + esc(e && e.message || e); }
  });

  /* ── 搜索（R223 项2）── */
  chaInput.addEventListener('input', () => { chaCi = chaInput.value.trim(); dangQian = 0; huaGaoLiang(); });
  chaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!piPei.length) return;
      dangQian += e.shiftKey ? -1 : 1;
      huaGaoLiang();
    } else if (e.key === 'Escape') {
      chaInput.value = ''; chaCi = ''; dangQian = 0;
      huaGaoLiang();
      yu.scrollTop = yu.scrollHeight;
    }
  });
  el('zdChaShang').addEventListener('click', () => { if (piPei.length) { dangQian -= 1; huaGaoLiang(); } });
  el('zdChaXia').addEventListener('click', () => { if (piPei.length) { dangQian += 1; huaGaoLiang(); } });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      chaInput.focus(); chaInput.select();
    }
  });

  void shuaXin();
  setInterval(() => { void shuaXin(); }, 5000);
})();