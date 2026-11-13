// R184：诊断日志独立窗口逻辑。只读查看/自检；导出/清空/开关走主进程。纯文本渲染，绝不 HTML 解析。
(function () {
  'use strict';
  const el = (id) => document.getElementById(id);
  const yu = el('zdYuLan');
  const zhuang = el('zdZhuang');
  const esc = (s) => String(s == null ? '' : s);

  function xianShi(rows) {
    if (!rows || !rows.length) { yu.textContent = '（暂无记录）'; return; }
    yu.textContent = rows.map((r) => {
      const wei = [r.ts, r.ji, r.mo, r.code].filter(Boolean).join('  ');
      const gu = r.gu ? '  [' + r.gu + ']' : '';
      const shu = r.zhi != null ? '  ' + r.zhi : '';
      const zhan = r.zhan ? '\n    ' + r.zhan : '';
      return wei + gu + shu + zhan;
    }).join('\n');
    yu.scrollTop = yu.scrollHeight;
  }
  async function shuaXin() {
    try {
      const r = await window.warmy.diagLog(200);
      xianShi(r && r.entries);
      const on = !!(r && r.enabled);
      el('zdToggle').textContent = on ? '记录：开' : '记录：关';
      zhuang.textContent = '共 ' + ((r && r.entries) || []).length + ' 条 · 只记脱敏事件，绝不上传。';
    } catch (e) { yu.textContent = '读取失败：' + esc(e && e.message || e); }
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
  void shuaXin();
  setInterval(() => { void shuaXin(); }, 5000);
})();