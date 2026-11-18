/* R232 自进化 UI：开关 / 双栏分叉（输入也分栏）/ 角色 gating / 5s 撤销 / 历史回退。 */
(() => {
  'use strict';
  const Q = () => window.__ziJinHuaQiao;
  const W = () => window.warmy;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k, fb) => { try { return (Q() && Q().t(k, fb)) || fb; } catch { return fb; } };
  let cur = null; // 当前会话的活跃实验
  let adminCache = {};
  let toastTimer = 0;

  function btn() { return document.getElementById('anNiuZiJinHua'); }
  function panel() { return document.getElementById('ziJinHuaFenLan'); }

  async function isAdmin(sid) {
    if (adminCache[sid] !== undefined) return adminCache[sid];
    const v = await Q().isAdmin(sid); adminCache[sid] = v; return v;
  }

  async function refreshToggle() {
    const b = btn(); if (!b || !Q()) return;
    const sid = Q().sid(); const nav = Q().nav();
    const isProject = nav === 'internalGroup';
    const visible = nav === 'singleAi' || (isProject && await isAdmin(sid));
    b.closest('#ziJinHuaDd').style.display = visible ? '' : 'none';
    const active = cur && cur.sessionId === sid && (cur.status === 'running' || cur.status === 'split' || cur.status === 'staged');
    b.disabled = !!active;
    b.classList.toggle('qiYong', !!Q().get(sid) && !active);
    b.setAttribute('aria-pressed', String(!!Q().get(sid)));
    b.title = active ? t('evolve.lockedTip', '已有分支进行中：请先选择一条支线合并，才能再开进化。') : t('evolve.tip', '进化：开启后这条消息会同时跑两条改进支线，自动或人工选出更好的一条合并，让牛马越用越顺手。注意：token 消耗可能变为 2 倍甚至更多。');
  }

  function ensurePanel() {
    let p = panel();
    if (!p) {
      p = document.createElement('div'); p.id = 'ziJinHuaFenLan'; p.className = 'ziJinHuaFenLan yinCang';
      const footer = document.querySelector('#liaoTianLan footer');
      if (footer) footer.parentNode.insertBefore(p, footer); else document.body.appendChild(p);
    }
    return p;
  }

  function armCol(exp, arm, canChoose) {
    const zt = exp.arms[arm];
    const col = document.createElement('div'); col.className = 'zjhCol';
    col.innerHTML = '<div class="zjhColHead"><b>' + t('evolve.arm', '支线') + ' ' + arm + '</b><span class="jingYin">' + t('evolve.turns', '轮数') + ' ' + (zt.turns || 0) + '</span></div>'
      + '<div class="zjhMsgs">' + ((zt.history && zt.history.length) ? zt.history.map((h) => '<div class="zjhMsg ' + (h.role === 'user' ? 'zjhUser' : 'zjhThem') + '">' + esc(h.content) + '</div>').join('') : (zt.reply ? '<div class="zjhMsg">' + esc(zt.reply) + '</div>' : '<div class="jingYin">…</div>')) + '</div>'
      + '<div class="zjhInput"><textarea rows="2" placeholder="' + esc(t('evolve.armInput', '发送到支线 ' + arm)) + '"></textarea><button class="anNiuXiao zjhSend">' + esc(t('chat.faSong', '发送')) + '</button></div>'
      + '<button class="anNiuZhuYao zjhChoose"' + (canChoose ? '' : ' disabled title="' + esc(t('evolve.confirmTip', '只有项目创建者和管理员可以选择合并支线。')) + '"') + '>' + esc(t('evolve.choose', '选此支线')) + '</button>';
    col.querySelector('.zjhSend').onclick = async () => {
      const ta = col.querySelector('textarea'); const v = ta.value.trim(); if (!v) return;
      ta.value = ''; await W().ziJinHuaFaSong({ sessionId: exp.sessionId, arm, content: v });
    };
    col.querySelector('.zjhChoose').onclick = async () => {
      if (!canChoose) return;
      const r = await W().ziJinHuaXuanZe({ sessionId: exp.sessionId, arm });
      if (r && r.ok) showToast(exp.sessionId);
    };
    return col;
  }

  async function renderPanel() {
    const p = ensurePanel(); const sid = Q() ? Q().sid() : '';
    const active = cur && cur.sessionId === sid && (cur.status === 'split' || cur.status === 'running');
    /* R246：staged（已选支线待合并）⇒ 立即恢复一栏（面板隐藏+普通输入恢复）；5s 内撤销回 split ⇒ 马上恢复两栏。 */
    document.body.classList.toggle('zjh-split', !!active);
    p.classList.toggle('yinCang', !active);
    if (!active) { p.innerHTML = ''; return; }
    const isProject = Q().nav() === 'internalGroup';
    const canChoose = !isProject || await isAdmin(sid);
    p.innerHTML = '<div class="zjhHead"><b>' + esc(t('evolve.title', '进化 · 双支线')) + '</b><span class="jingYin">' + (cur.mode === 'objective' ? esc(t('evolve.objective', '客观验收：证据充足自动择优')) : esc(t('evolve.subjective', '主观：请人工选择'))) + '</span><button class="anNiuXiao zjhHistory">' + esc(t('evolve.history', '历史回退')) + '</button></div>';
    const row = document.createElement('div'); row.className = 'zjhRow';
    row.appendChild(armCol(cur, 'A', canChoose)); row.appendChild(armCol(cur, 'B', canChoose));
    p.appendChild(row);
    p.querySelector('.zjhHistory').onclick = openHistory;
  }

  function showToast(sid) {
    clearInterval(toastTimer);
    let el = document.getElementById('zjhToast');
    if (!el) { el = document.createElement('div'); el.id = 'zjhToast'; document.body.appendChild(el); }
    let left = 5;
    const draw = () => { el.innerHTML = '<span>' + esc(t('evolve.staged', '已选择，{n}s 后合并')).replace('{n}', String(left)) + '</span><button class="anNiuXiao">' + esc(t('evolve.undo', '撤销')) + '</button>'; el.querySelector('button').onclick = async () => { clearInterval(toastTimer); el.remove(); await W().ziJinHuaQuXiao(sid); }; };
    draw();
    toastTimer = setInterval(() => { left--; if (left <= 0) { clearInterval(toastTimer); el.remove(); } else draw(); }, 1000);
  }

  async function openHistory() {
    const r = await W().ziJinHuaZhuangTai(Q().sid());
    const items = (r && r.history) || [];
    let el = document.getElementById('zjhHistory');
    if (!el) { el = document.createElement('div'); el.id = 'zjhHistory'; el.className = 'zjhHistory'; document.body.appendChild(el); }
    el.innerHTML = '<div class="zjhHead"><b>' + esc(t('evolve.history', '历史回退')) + '</b><button class="anNiuXiao zjhClose">×</button></div>'
      + (items.length ? items.map((x) => '<div class="zjhHistRow"><span>' + esc(x.sessionId) + ' · ' + esc(t('evolve.arm', '支线')) + ' ' + esc(x.winner || '') + '</span><button class="anNiuXiao" data-snap="' + esc(x.snapshotId || '') + '" data-sid="' + esc(x.sessionId) + '">' + esc(t('evolve.rollback', '回退到合并前')) + '</button></div>').join('') : '<div class="jingYin">' + esc(t('evolve.noHistory', '暂无可回退的合并')) + '</div>');
    el.querySelector('.zjhClose').onclick = () => el.remove();
    el.querySelectorAll('[data-snap]').forEach((b) => { b.onclick = async () => { await W().ziJinHuaHuiTui({ sessionId: b.dataset.sid, snapshotId: b.dataset.snap }); el.remove(); }; });
  }

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
    W().onZiJinHua((d) => { cur = (d && d.exp) || null; refreshToggle(); renderPanel(); if (cur && cur.status === 'merged') { Q().refresh(); } });
    // 会话切换时刷新开关可见性
    setInterval(() => { refreshToggle(); }, 1500);
    refreshToggle(); renderPanel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
