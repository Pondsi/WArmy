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
    /* R260 项28：静音（切换扬声器权限，与设置→拟态扬声器勾选联动）；已静音时显示“取消静音” */
    xiang(r.speakerOn === false ? (w.quXiaoJingYin || '取消静音') : (w.jingYin || '静音'), () => dong('jingYin'));
    xiang(w.sheZhi, () => dong('sheZhi'));
    gen.querySelector('button')?.focus();
  } catch { await guan(); }
})();
