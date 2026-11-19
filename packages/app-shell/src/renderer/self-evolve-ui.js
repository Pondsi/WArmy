/* R232 自进化 UI：开关 / 角色 gating。
 * R261：支线并入聊天记录并排显示；输入框原位分栏；历史回退悬浮窗删除。
 * R263：选支后立即合并（无 5s 撤销 toast）；撤销/回退走第四列回退点卡片；选支/合并后自动滚底。 */
(() => {
  'use strict';
  const Q = () => window.__ziJinHuaQiao;
  const W = () => window.warmy;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k, fb) => { try { return (Q() && Q().t(k, fb)) || fb; } catch { return fb; } };
  let cur = null; // 当前会话的活跃实验
  let adminCache = {};

  function btn() { return document.getElementById('anNiuZiJinHua'); }

  /* R261 项4：根部发散光子（底部中间→顶部整条平线，淡、缓、仅主题色明暗变化）；
   * 图标本身是 index.html 内联的 ziJinHuaIco svg，不替换只追加光子。 */
  function photons() {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const dx = -14 + i * 3.5;              // 顶部整条平线展开
      const dur = 3.6 + (i % 4) * 0.7;       // 缓缓的
      const delay = (i * 0.53) % 3.2;
      const lum = 0.72 + (i % 5) * 0.16;     // 仅明暗之分，不黑不白
      s += '<i class="gjPhoton" style="--dx:' + dx + 'px;--dur:' + dur + 's;--delay:-' + delay + 's;--lum:' + lum + '"></i>';
    }
    return s;
  }

  async function isAdmin(sid) {
    if (adminCache[sid] !== undefined) return adminCache[sid];
    const v = await Q().isAdmin(sid); adminCache[sid] = v; return v;
  }

  async function refreshToggle() {
    const b = btn(); if (!b || !Q()) return;
    if (!b.querySelector('.gjPhoton')) b.insertAdjacentHTML('beforeend', photons());
    const sid = Q().sid(); const nav = Q().nav();
    const isProject = nav === 'internalGroup';
    const visible = nav === 'singleAi' || (isProject && await isAdmin(sid));
    b.closest('#ziJinHuaDd').style.display = visible ? '' : 'none';
    const active = cur && cur.sessionId === sid && (cur.status === 'running' || cur.status === 'split' || cur.status === 'staged');
    const enabled = !!Q().get(sid);
    /* R261 项5：进化中不可点但保持开启样式（主题色图标+光子），不灰化 */
    b.disabled = !!active;
    b.classList.toggle('qiYong', enabled || !!active);
    b.setAttribute('aria-pressed', String(enabled));
    /* R261 项5：悬停比平时多一行「选择支线后才能关闭进化。」 */
    b.title = active
      ? t('evolve.tip', '进化：开启后这条消息会同时跑两条改进支线，自动或人工选出更好的一条合并，让牛马越用越顺手。注意：token 消耗可能变为 2 倍甚至更多。') + '\n' + t('evolve.lockedLine', '选择支线后才能关闭进化。')
      : t('evolve.tip', '进化：开启后这条消息会同时跑两条改进支线，自动或人工选出更好的一条合并，让牛马越用越顺手。注意：token 消耗可能变为 2 倍甚至更多。');
  }

  /* R261 项6／R263：选支按钮在聊天记录内并排块回复下方（delegation，角色 gating 不变）；
   * 选支后立即合并，不再弹 5s 撤销 toast——撤销走回退点。 */
  document.addEventListener('click', async (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.zjhChoose') : null;
    if (!b || b.disabled || !cur) return;
    const sid = cur.sessionId;
    if (Q().nav() === 'internalGroup' && !(await isAdmin(sid))) return;
    await W().ziJinHuaXuanZe({ sessionId: sid, arm: b.dataset.arm === 'B' ? 'B' : 'A' });
  });

  async function init() {
    if (!Q() || !W()) { setTimeout(init, 300); return; }
    try { const s = await W().settingsGet(); Q().load((s && s.settings && s.settings.selfEvolveSessions) || {}); } catch { /* noop */ }
    const b = btn();
    if (b) b.onclick = async () => {
      if (b.disabled) return;
      const sid = Q().sid();
      if (Q().nav() === 'internalGroup' && !(await isAdmin(sid))) return;
      Q().set(sid, !Q().get(sid)); refreshToggle();
    };
    W().onZiJinHua((d) => {
      cur = (d && d.exp) || null;
      refreshToggle();
      /* R263：选支(staged)/合并(merged)后重画并自动滚底；其余状态保持滚动位 */
      const gun = !!(cur && (cur.status === 'staged' || cur.status === 'merged'));
      try { window.__ziJinHuaChongHua && window.__ziJinHuaChongHua(gun); } catch { /* noop */ }
      if (cur && cur.status === 'merged') { Q().refresh(); }
    });
    /* 会话切换时刷新开关可见性 */
    setInterval(() => { refreshToggle(); }, 1500);
    refreshToggle();
    try { window.__ziJinHuaChongHua && window.__ziJinHuaChongHua(); } catch { /* noop */ }
  }
  /* R261：cur 暴露给 app.js（聊天记录内并排块 + 输入分栏） */
  window.__ziJinHuaCur = () => cur;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();