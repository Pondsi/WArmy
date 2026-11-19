/* R232：独立可聚焦菜单，子选项留在可滚动容器内，失焦关闭由宿主兜底。 */
(async () => {
  'use strict';
  const api = window.warmyMimicMenu;
  const gen = document.getElementById('caiDan');
  const guan = () => api.guan().catch(() => window.close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') void guan(); });
  document.addEventListener('mousedown', (e) => { if (!gen.contains(e.target)) void guan(); });
  try {
    const r = await api.zhuangTai();
    if (!r?.ok || !r.wen) { await guan(); return; }
    const w = r.wen;
    document.documentElement.lang = r.locale || 'en';
    document.documentElement.dir = /^(ar|fa)(-|$)/.test(r.locale || '') ? 'rtl' : 'ltr';
    let mang = false;
    const dong = async (item, value) => {
      if (mang) return;
      mang = true;
      gen.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try { await api.dongZuo({ item, value }); } finally { await guan(); }
    };
    const xiang = (label, fn, parent = gen) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'xiang'; b.textContent = label; b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { Promise.resolve(fn()).catch(() => guan()); });
      parent.appendChild(b); return b;
    };
    xiang(w.duiHua + ': ' + (r.zmKai ? w.kai : w.guan), () => dong('duiHua'));
    xiang(w.yinShen, () => dong('yinShen'));
    xiang(w.chuangKou, () => dong('chuangKou'));
    const yy = xiang(w.yuYin + ' ▸', () => {
      zi.hidden = !zi.hidden; yy.setAttribute('aria-expanded', String(!zi.hidden));
      if (!zi.hidden) zi.scrollIntoView({ block: 'nearest' });
    });
    yy.setAttribute('aria-expanded', 'false');
    const zi = document.createElement('div'); zi.className = 'zi'; zi.hidden = true;
    for (const mode of ['off', 'wake', 'always', 'smart']) {
      const b = xiang((r.moShi === mode ? '✓ ' : '') + w.modes[mode], () => dong('yuYin', mode), zi);
      b.dataset.mode = mode; b.classList.toggle('on', r.moShi === mode);
    }
    gen.appendChild(zi);
    /* R264 项6：固定: 是/否（是=不走动只原地动；否=可走到图标边/闲逛） */
    const gd = xiang((w.guDing || '固定') + ' ▸', () => {
      gdZi.hidden = !gdZi.hidden; gd.setAttribute('aria-expanded', String(!gdZi.hidden));
      if (!gdZi.hidden) gdZi.scrollIntoView({ block: 'nearest' });
    });
    gd.setAttribute('aria-expanded', 'false');
    const gdZi = document.createElement('div'); gdZi.className = 'zi'; gdZi.hidden = true;
    for (const v of ['shi', 'fou']) {
      const on = !!r.guDing === (v === 'shi');
      const b = xiang((on ? '✓ ' : '') + (v === 'shi' ? (w.guDingShi || '是') : (w.guDingFou || '否')), () => dong('guDing', v), gdZi);
      b.classList.toggle('on', on);
    }
    gen.appendChild(gdZi);
    /* R260：静音＝关「阅读回复」（与拟态聊天窗三点菜单同功能同开关，默认开）；已静音时显示“取消静音” */
    xiang(r.autoReadOn === false ? (w.quXiaoJingYin || '取消静音') : (w.jingYin || '静音'), () => dong('jingYin'));
    xiang(w.sheZhi, () => dong('sheZhi'));
    gen.querySelector('button')?.focus();
  } catch { await guan(); }
})();
