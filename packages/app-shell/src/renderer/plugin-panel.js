/**
 * plugin-panel —— R238 插件管理 + 市场发现面板（对齐 dsh 官方插件系统）。
 *
 * 自包含模态，两大标签：
 *  · 已安装：启用/禁用开关、设置表单（插件自行决定是否有设置——无 Config 不显示设置）、更新检测/执行、卸载、
 *    **确定性（非模型裁量）扩展点**展示（订阅事件 / 提供服务 / 中间件 / 效果 / 工具）。
 *  · 发现：索引源管理（添加/删除/切换，每源显示最近错误）、搜索（容忍拼写）、分类/标签/排序、
 *    插件卡片（推荐版本）、安装确认框（展示 npm/git 来源）、版本详情（逐版本兼容性与安装）。
 *
 * 接 window.warmy.chaJian* IPC（R238）。视觉用 WArmy 主题 CSS 变量，滚动条按调色板自绘。
 */
(function () {
  'use strict';
  const warmy = window.warmy;
  if (!warmy) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, d) => { try { return window.__warmyT ? window.__warmyT(k, d) : d; } catch { return d; } };

  const STYLE = `
  .cjmb-overlay{position:fixed;inset:0;z-index:100000;background:rgba(8,10,14,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px}
  .cjmb-dialog{width:min(920px,96vw);max-height:88vh;display:flex;flex-direction:column;background:var(--card,#fff);color:var(--ink,#1a1d24);border:1px solid var(--line,#e3e6ec);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.34);overflow:hidden}
  .cjmb-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line,#e3e6ec);background:linear-gradient(120deg,color-mix(in srgb,var(--accent,#3b6ef5) 12%,transparent),transparent 60%)}
  .cjmb-head h2{margin:0;font-size:17px;font-weight:700;letter-spacing:.2px}
  .cjmb-head .cjmb-sub{font-size:12px;opacity:.62;margin-top:2px}
  .cjmb-x{margin-left:auto;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer;width:32px;height:32px;border-radius:8px;line-height:1}
  .cjmb-x:hover{background:var(--hover,#f0f2f6)}
  .cjmb-tabs{display:flex;gap:6px;padding:10px 20px 0;border-bottom:1px solid var(--line,#e3e6ec)}
  .cjmb-tab{border:0;background:transparent;color:inherit;opacity:.6;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
  .cjmb-tab.on{opacity:1;color:var(--accent,#3b6ef5);border-bottom-color:var(--accent,#3b6ef5)}
  .cjmb-body{padding:16px 20px;overflow-y:auto;flex:1}
  .cjmb-body::-webkit-scrollbar{width:10px}
  .cjmb-body::-webkit-scrollbar-track{background:color-mix(in srgb,var(--line,#e3e6ec) 40%,transparent);border-radius:8px}
  .cjmb-body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--accent,#3b6ef5) 55%,var(--line,#c9ced8));border-radius:8px;border:2px solid transparent;background-clip:padding-box}
  .cjmb-body::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--accent,#3b6ef5) 80%,var(--line,#c9ced8));background-clip:padding-box}
  .cjmb-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
  .cjmb-bar input,.cjmb-bar select{padding:7px 10px;border:1px solid var(--line,#d7dbe3);border-radius:9px;background:var(--card,#fff);color:inherit;font-size:13px}
  .cjmb-bar input[type=search]{flex:1;min-width:160px}
  .cjmb-btn{border:1px solid var(--line,#d7dbe3);background:var(--card,#fff);color:inherit;padding:7px 13px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s}
  .cjmb-btn:hover{border-color:var(--accent,#3b6ef5);color:var(--accent,#3b6ef5)}
  .cjmb-btn.pri{background:var(--accent,#3b6ef5);border-color:var(--accent,#3b6ef5);color:#fff}
  .cjmb-btn.pri:hover{filter:brightness(1.08);color:#fff}
  .cjmb-btn.danger:hover{border-color:#e5484d;color:#e5484d}
  .cjmb-btn:disabled{opacity:.45;cursor:not-allowed}
  .cjmb-card{border:1px solid var(--line,#e3e6ec);border-radius:13px;padding:14px;margin-bottom:12px;background:color-mix(in srgb,var(--card,#fff) 92%,var(--accent,#3b6ef5) 3%)}
  .cjmb-card-top{display:flex;align-items:flex-start;gap:12px}
  .cjmb-ico{width:42px;height:42px;border-radius:11px;flex:0 0 auto;object-fit:cover;background:color-mix(in srgb,var(--accent,#3b6ef5) 16%,transparent);display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;color:var(--accent,#3b6ef5)}
  .cjmb-name{font-weight:700;font-size:14px}
  .cjmb-meta{font-size:12px;opacity:.66;margin-top:2px}
  .cjmb-desc{font-size:12.5px;opacity:.8;margin-top:6px;line-height:1.5}
  .cjmb-ver{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:color-mix(in srgb,var(--accent,#3b6ef5) 15%,transparent);color:var(--accent,#3b6ef5)}
  .cjmb-badge-up{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#fff4e0;color:#b76e00;border:1px solid #ffd591}
  .cjmb-badge-ok{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#e7f7ee;color:#1a7f4b;border:1px solid #b7e4c9}
  .cjmb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
  .cjmb-chip{font-size:11px;padding:3px 9px;border-radius:8px;border:1px solid var(--line,#dfe3ea);background:var(--card,#fff);opacity:.85}
  .cjmb-chip b{color:var(--accent,#3b6ef5);font-weight:700}
  .cjmb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;align-items:center}
  .cjmb-switch{position:relative;width:40px;height:22px;flex:0 0 auto;border-radius:20px;background:var(--line,#cfd4dd);cursor:pointer;transition:.18s;border:0}
  .cjmb-switch.on{background:var(--accent,#3b6ef5)}
  .cjmb-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.18s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .cjmb-switch.on::after{left:20px}
  .cjmb-form{margin-top:12px;padding:12px;border:1px dashed var(--line,#d7dbe3);border-radius:11px;background:color-mix(in srgb,var(--card,#fff) 80%,var(--accent,#3b6ef5) 4%)}
  .cjmb-field{margin-bottom:10px}
  .cjmb-field label{display:block;font-size:12px;font-weight:600;margin-bottom:4px}
  .cjmb-field .hint{font-weight:400;opacity:.6;margin-left:6px}
  .cjmb-field input[type=text],.cjmb-field input[type=number],.cjmb-field select{width:100%;padding:7px 10px;border:1px solid var(--line,#d7dbe3);border-radius:8px;background:var(--card,#fff);color:inherit;font-size:13px;box-sizing:border-box}
  .cjmb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:12px}
  .cjmb-empty{text-align:center;padding:40px 20px;opacity:.6;font-size:13px}
  .cjmb-err{font-size:12px;color:#e5484d;background:#fdecec;border:1px solid #f5c2c2;border-radius:8px;padding:8px 10px;margin-top:8px;word-break:break-all}
  .cjmb-src{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line,#e3e6ec);border-radius:9px;margin-bottom:7px;font-size:12.5px}
  .cjmb-src .u{flex:1;word-break:break-all;opacity:.8}
  .cjmb-confirm{position:fixed;inset:0;z-index:100001;background:rgba(8,10,14,.6);display:flex;align-items:center;justify-content:center;padding:24px}
  .cjmb-confirm-box{width:min(460px,94vw);background:var(--card,#fff);color:var(--ink,#1a1d24);border:1px solid var(--line,#e3e6ec);border-radius:15px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  .cjmb-confirm-box h3{margin:0 0 10px;font-size:15px}
  .cjmb-src-detail{font-size:12px;background:color-mix(in srgb,var(--accent,#3b6ef5) 7%,transparent);border:1px solid var(--line,#e3e6ec);border-radius:9px;padding:10px;margin:10px 0;word-break:break-all;line-height:1.6}
  .cjmb-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:100002;padding:11px 20px;border-radius:11px;font-size:13px;font-weight:600;color:#fff;background:#1a7f4b;box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:.25s;pointer-events:none}
  .cjmb-toast.show{opacity:1;bottom:44px}
  .cjmb-toast.err{background:#c92a2a}
  .cjmb-spin{display:inline-block;width:14px;height:14px;border:2px solid color-mix(in srgb,var(--accent,#3b6ef5) 30%,transparent);border-top-color:var(--accent,#3b6ef5);border-radius:50%;animation:cjmb-rot .7s linear infinite;vertical-align:-2px;margin-right:6px}
  @keyframes cjmb-rot{to{transform:rotate(360deg)}}
  `;

  let overlay = null, bodyEl = null, tab = 'installed';
  let sources = [], activeUrl = '', market = null, installed = [], points = [], schemas = {};
  let browsing = false;

  function injectStyle() {
    if (document.getElementById('cjmb-style')) return;
    const s = document.createElement('style'); s.id = 'cjmb-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  function toast(msg, kind) {
    let t = document.getElementById('cjmb-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cjmb-toast'; t.className = 'cjmb-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cjmb-toast show' + (kind === 'err' ? ' err' : '');
    clearTimeout(t.__timer); t.__timer = setTimeout(() => { t.className = 'cjmb-toast' + (kind === 'err' ? ' err' : ''); }, 2600);
  }
  function srcDetail(v) {
    if (!v || !v.source) return '';
    const s = v.source;
    if (s.type === 'npm') return `npm 包：${esc(v.version)}<br>注册表：${esc(s.registry || '默认 npm registry')}`;
    return `Git 仓库：${esc(s.url)}<br>提交：${esc(s.commit)}${s.path ? '<br>目录：' + esc(s.path) : ''}`;
  }
  function confirmBox(title, html, onOk, okLabel) {
    const w = document.createElement('div'); w.className = 'cjmb-confirm';
    w.innerHTML = `<div class="cjmb-confirm-box"><h3>${esc(title)}</h3><div>${html}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="cjmb-btn" data-no>${esc(T('common.cancel', '取消'))}</button>
      <button class="cjmb-btn pri" data-ok>${esc(okLabel || T('common.confirm', '确认'))}</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.querySelector('[data-no]').onclick = close;
    w.addEventListener('click', (e) => { if (e.target === w) close(); });
    w.querySelector('[data-ok]').onclick = async () => { const b = w.querySelector('[data-ok]'); b.disabled = true; b.innerHTML = '<span class="cjmb-spin"></span>' + esc(T('common.working', '处理中…')); try { await onOk(); } finally { close(); } };
  }

  // ── 已安装 ──
  async function loadInstalled() {
    const r = await warmy.chaJianXinXi();
    installed = (r && r.plugins) || []; points = (r && r.points) || [];
    const sr = await warmy.chaJianSheZhiSchema();
    schemas = {}; for (const s of (sr && sr.schemas) || []) schemas[s.plugin] = s.Config;
  }
  function fieldHtml(key, rule, val) {
    const t = rule.type || 'string';
    const label = esc(rule.title || key) + (rule.required ? ' *' : '') + (rule.description ? `<span class="hint">${esc(rule.description)}</span>` : '');
    const cur = val === undefined ? rule.default : val;
    if (t === 'boolean') return `<div class="cjmb-field"><label>${label}</label><button type="button" class="cjmb-switch${cur ? ' on' : ''}" data-cfg="${esc(key)}" data-type="boolean" role="switch" aria-checked="${!!cur}"></button></div>`;
    if (t === 'select') {
      const opts = (rule.options || []).map((o) => (o && typeof o === 'object' && 'value' in o ? o : { value: o, label: String(o) }));
      return `<div class="cjmb-field"><label>${label}</label><select data-cfg="${esc(key)}" data-type="select">${opts.map((o) => `<option value="${esc(o.value)}"${String(cur) === String(o.value) ? ' selected' : ''}>${esc(o.label || o.value)}</option>`).join('')}</select></div>`;
    }
    if (t === 'number' || t === 'integer') return `<div class="cjmb-field"><label>${label}</label><input type="number" data-cfg="${esc(key)}" data-type="${t}" value="${esc(cur === undefined ? '' : cur)}"${rule.min !== undefined ? ` min="${rule.min}"` : ''}${rule.max !== undefined ? ` max="${rule.max}"` : ''}${t === 'integer' ? ' step="1"' : ' step="any"'}></div>`;
    return `<div class="cjmb-field"><label>${label}</label><input type="text" data-cfg="${esc(key)}" data-type="string" value="${esc(cur === undefined ? '' : cur)}"></div>`;
  }
  function renderInstalled() {
    if (!installed.length) { bodyEl.innerHTML = `<div class="cjmb-empty">${esc(T('plugin.noneInstalled', '还没有已加载的插件。到「发现」标签浏览索引并安装，或在设置里用 pnpm/目录扫描加载。'))}</div>`; return; }
    bodyEl.innerHTML = `<div class="cjmb-bar"><button class="cjmb-btn" data-act="refresh">${esc(T('common.refresh', '刷新'))}</button><span class="cjmb-meta">${esc(T('plugin.hostVer', '宿主版本'))} ${esc((installed[0] && window.__cjHostVer) || '')}</span></div>` +
      installed.map((p, i) => {
        const pt = points.find((x) => x.plugin === p.name) || {};
        const chips = [];
        if (pt.events && pt.events.length) chips.push(`<span class="cjmb-chip"><b>${esc(T('plugin.evEvents', '事件'))}</b> ${pt.events.map(esc).join(', ')}</span>`);
        if (pt.services && pt.services.length) chips.push(`<span class="cjmb-chip"><b>${esc(T('plugin.evServices', '服务'))}</b> ${pt.services.map(esc).join(', ')}</span>`);
        if (pt.middleware) chips.push(`<span class="cjmb-chip"><b>${esc(T('plugin.evMiddleware', '中间件'))}</b> ×${pt.middleware}</span>`);
        if (pt.effects) chips.push(`<span class="cjmb-chip"><b>${esc(T('plugin.evEffects', '生命周期'))}</b> ×${pt.effects}</span>`);
        if (p.tools && p.tools.length) chips.push(`<span class="cjmb-chip"><b>${esc(T('plugin.evTools', '工具'))}</b> ${p.tools.map(esc).join(', ')}</span>`);
        return `<div class="cjmb-card" data-i="${i}">
          <div class="cjmb-card-top">
            <div class="cjmb-ico">${esc((p.title || p.name || '?')[0].toUpperCase())}</div>
            <div style="flex:1">
              <div class="cjmb-name">${esc(p.title || p.name)} <span class="cjmb-ver">v${esc(p.version || '?')}</span> ${p.hasUpdate ? `<span class="cjmb-badge-up">${esc(T('plugin.hasUpdate', '有新版本'))}</span>` : ''}</div>
              <div class="cjmb-meta">${esc(p.name)}${p.author ? ' · ' + esc(p.author) : ''}</div>
              ${p.description ? `<div class="cjmb-desc">${esc(p.description)}</div>` : ''}
            </div>
            <button class="cjmb-switch${p.enabled ? ' on' : ''}" data-act="toggle" data-i="${i}" role="switch" aria-checked="${!!p.enabled}" title="${esc(T('plugin.enableToggle', '启用/禁用'))}"></button>
          </div>
          ${chips.length ? `<div class="cjmb-chips">${chips.join('')}</div>` : `<div class="cjmb-chips"><span class="cjmb-chip">${esc(T('plugin.noExtPoints', '无确定性扩展点（仅工具或空插件）'))}</span></div>`}
          <div class="cjmb-actions">
            ${p.hasConfig ? `<button class="cjmb-btn" data-act="settings" data-i="${i}">${esc(T('plugin.settings', '设置'))}</button>` : `<span class="cjmb-meta">${esc(T('plugin.noSettings', '该插件未声明设置项'))}</span>`}
            <button class="cjmb-btn" data-act="checkupdate" data-i="${i}">${esc(T('plugin.checkUpdate', '检查更新'))}</button>
            <button class="cjmb-btn" data-act="update" data-i="${i}"${p.hasUpdate ? '' : ' disabled'}>${esc(T('plugin.update', '更新'))}</button>
            <button class="cjmb-btn danger" data-act="uninstall" data-i="${i}">${esc(T('plugin.uninstall', '卸载'))}</button>
          </div>
          <div data-form="${i}"></div>
        </div>`;
      }).join('');
  }
  function openSettings(i) {
    const p = installed[i]; const box = bodyEl.querySelector(`[data-form="${i}"]`);
    if (!p || !box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const Config = schemas[p.name] || {};
    const keys = Object.keys(Config);
    if (!keys.length) { box.innerHTML = `<div class="cjmb-err">${esc(T('plugin.noSettings', '该插件未声明设置项'))}</div>`; return; }
    box.innerHTML = `<div class="cjmb-form">${keys.map((k) => fieldHtml(k, Config[k] || {}, (p.config || {})[k])).join('')}
      <div style="display:flex;gap:8px"><button class="cjmb-btn pri" data-act="savecfg" data-i="${i}">${esc(T('common.save', '保存'))}</button><button class="cjmb-btn" data-act="closecfg" data-i="${i}">${esc(T('common.cancel', '取消'))}</button></div></div>`;
    box.querySelectorAll('.cjmb-switch[data-cfg]').forEach((sw) => { sw.onclick = () => { const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); }; });
  }
  async function saveCfg(i) {
    const p = installed[i]; const box = bodyEl.querySelector(`[data-form="${i}"]`);
    const cfg = {};
    box.querySelectorAll('[data-cfg]').forEach((el) => {
      const k = el.getAttribute('data-cfg'); const t = el.getAttribute('data-type');
      if (t === 'boolean') cfg[k] = el.classList.contains('on');
      else if (t === 'number' || t === 'integer') { if (el.value !== '') cfg[k] = Number(el.value); }
      else cfg[k] = el.value;
    });
    const r = await warmy.chaJianSheZhiBaoCun({ plugin: p.name, config: cfg });
    if (r && r.ok) { toast(T('plugin.cfgSaved', '设置已保存并生效')); await loadInstalled(); renderInstalled(); }
    else toast((r && (r.error || (r.errors || []).join('; '))) || 'save-failed', 'err');
  }

  // ── 发现 / 市场 ──
  async function loadSources() { const r = await warmy.chaJianSuoYinYuan({ action: 'list' }); sources = (r && r.sources) || []; if (!activeUrl && sources.length) activeUrl = sources[0].url; }
  function renderMarketShell() {
    bodyEl.innerHTML = `
      <div class="cjmb-bar">
        <select data-mk="src">${sources.length ? sources.map((s) => `<option value="${esc(s.url)}"${s.url === activeUrl ? ' selected' : ''}>${esc(s.url)}</option>`).join('') : `<option value="">${esc(T('plugin.noSource', '无索引源——先添加'))}</option>`}</select>
        <button class="cjmb-btn" data-act="addsrc">${esc(T('plugin.addSource', '添加索引源'))}</button>
        <button class="cjmb-btn" data-act="mgrsrc">${esc(T('plugin.manageSources', '管理源'))}</button>
      </div>
      <div data-mk="srcerr"></div>
      <div class="cjmb-bar">
        <input type="search" data-mk="q" placeholder="${esc(T('plugin.searchPh', '搜索名称/作者/关键词/标题…'))}">
        <select data-mk="cat"><option value="">${esc(T('plugin.allCats', '全部分类'))}</option></select>
        <select data-mk="label"><option value="">${esc(T('plugin.allLabels', '全部标签'))}</option></select>
        <select data-mk="sort"><option value="">${esc(T('plugin.bestMatch', '最佳匹配'))}</option><option value="publishTimestamp">${esc(T('plugin.newest', '最新发布'))}</option></select>
        <button class="cjmb-btn pri" data-act="browse">${esc(T('plugin.browse', '浏览'))}</button>
      </div>
      <div data-mk="cards"><div class="cjmb-empty">${esc(T('plugin.browseHint', '添加索引源后点「浏览」。索引是第三方内容，安装前请核对来源。'))}</div></div>`;
    const q = bodyEl.querySelector('[data-mk="q"]');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') browse(); });
    bodyEl.querySelector('[data-mk="src"]').addEventListener('change', (e) => { activeUrl = e.target.value; browse(); });
  }
  async function browse() {
    if (browsing) return;
    if (!activeUrl) { toast(T('plugin.needSource', '请先添加并选择一个索引源'), 'err'); return; }
    browsing = true;
    const cards = bodyEl.querySelector('[data-mk="cards"]');
    cards.innerHTML = `<div class="cjmb-empty"><span class="cjmb-spin"></span>${esc(T('plugin.loading', '加载索引中…'))}</div>`;
    const q = bodyEl.querySelector('[data-mk="q"]').value;
    const cat = bodyEl.querySelector('[data-mk="cat"]').value;
    const label = bodyEl.querySelector('[data-mk="label"]').value;
    const sort = bodyEl.querySelector('[data-mk="sort"]').value;
    const r = await warmy.chaJianShiChang({ url: activeUrl, query: q, category: cat || undefined, label: label || undefined, sortKey: sort || undefined, order: 'desc' });
    browsing = false;
    const errBox = bodyEl.querySelector('[data-mk="srcerr"]');
    if (!r || !r.ok) {
      const detail = r && r.errors ? r.errors.map((e) => `${e.path}: ${e.reason}`).join('\n') : (r && r.error) || 'fetch-failed';
      errBox.innerHTML = `<div class="cjmb-err">${esc(detail)}</div>`;
      cards.innerHTML = `<div class="cjmb-empty">${esc(T('plugin.indexFailed', '索引不可用'))}</div>`;
      return;
    }
    errBox.innerHTML = '';
    market = r;
    // 填充分类/标签/排序选项（保留当前选择）
    const fill = (sel, map, cur) => { const el = bodyEl.querySelector(`[data-mk="${sel}"]`); const first = el.options[0].outerHTML; el.innerHTML = first + Object.entries(map || {}).map(([id, v]) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc((v && v.title && (v.title.zh || v.title.en)) || id)}</option>`).join(''); };
    fill('cat', r.categories, cat); fill('label', r.labels, label);
    const sortEl = bodyEl.querySelector('[data-mk="sort"]');
    for (const [id, v] of Object.entries(r.sortKeys || {})) { if (![...sortEl.options].some((o) => o.value === id)) sortEl.add(new Option((v.title && (v.title.zh || v.title.en)) || id, id)); }
    if (!r.cards.length) { cards.innerHTML = `<div class="cjmb-empty">${esc(T('plugin.noResults', '没有匹配的插件'))}</div>`; return; }
    cards.innerHTML = `<div class="cjmb-grid">${r.cards.map((c, i) => marketCard(c, i)).join('')}</div>`;
  }
  function marketCard(c, i) {
    const ico = c.icon ? `<img class="cjmb-ico" src="${esc(c.icon)}" alt="" onerror="this.outerHTML='<div class=cjmb-ico>${esc((c.title || c.name || '?')[0].toUpperCase())}</div>'">` : `<div class="cjmb-ico">${esc((c.title || c.name || '?')[0].toUpperCase())}</div>`;
    const status = c.installed ? (c.hasUpdate ? `<span class="cjmb-badge-up">${esc(T('plugin.hasUpdate', '有新版本'))}</span>` : `<span class="cjmb-badge-ok">${esc(T('plugin.installed', '已安装'))}</span>`) : '';
    const rec = c.recommended ? `<span class="cjmb-ver">v${esc(c.recommended.version)}</span>` : `<span class="cjmb-meta">${esc(T('plugin.incompatible', '无兼容版本'))}</span>`;
    return `<div class="cjmb-card" data-mi="${i}" style="cursor:pointer">
      <div class="cjmb-card-top">${ico}<div style="flex:1"><div class="cjmb-name">${esc(c.title || c.name)} ${status}</div><div class="cjmb-meta">${esc(c.name)}${c.author ? ' · ' + esc(c.author) : ''}</div></div></div>
      ${c.description ? `<div class="cjmb-desc">${esc(c.description)}</div>` : ''}
      <div class="cjmb-actions" style="justify-content:space-between">
        ${rec}
        <button class="cjmb-btn pri" data-act="install" data-mi="${i}"${c.recommended ? '' : ' disabled'}>${esc(c.installed && !c.hasUpdate ? T('plugin.reinstall', '重装') : T('plugin.install', '安装'))}</button>
      </div></div>`;
  }
  function openDetail(i) {
    const c = market && market.cards[i]; if (!c) return;
    const rows = (c.versions || []).slice().sort((a, b) => b.publishTimestamp - a.publishTimestamp).map((v) => `<div class="cjmb-src" style="align-items:center">
      <span class="cjmb-ver">v${esc(v.version)}</span>
      <span class="u">${esc(new Date(v.publishTimestamp * 1000).toLocaleDateString())} · ${v.compatible ? esc(T('plugin.compat', '兼容')) : esc(T('plugin.incompat', '不兼容'))}</span>
      <button class="cjmb-btn" data-act="installver" data-name="${esc(c.name)}" data-ver="${esc(v.version)}"${v.compatible ? '' : ' disabled'}>${esc(T('plugin.install', '安装'))}</button></div>`).join('');
    confirmBox(c.title || c.name, `${c.description ? `<div class="cjmb-desc">${esc(c.description)}</div>` : ''}
      ${c.homepage ? `<div class="cjmb-meta"><a href="${esc(c.homepage)}" target="_blank" rel="noreferrer">${esc(T('plugin.homepage', '主页'))}</a></div>` : ''}
      <div style="margin-top:10px;font-weight:600;font-size:13px">${esc(T('plugin.versions', '版本'))}</div>${rows}`, async () => {}, T('common.close', '关闭'));
    // 详情框里的逐版本安装
    const w = document.querySelector('.cjmb-confirm:last-of-type');
    if (w) w.querySelectorAll('[data-act="installver"]').forEach((b) => { b.onclick = () => { w.remove(); doInstall(c.name, b.getAttribute('data-ver')); }; });
  }
  function doInstall(name, version) {
    const c = market && market.cards.find((x) => x.name === name);
    const v = c && (c.versions || []).find((x) => x.version === version);
    confirmBox(T('plugin.confirmInstall', '确认安装插件'), `<div style="font-weight:700">${esc(name)}@${esc(version)}</div>
      <div class="cjmb-src-detail">${srcDetail(v)}</div>
      <div class="cjmb-meta">${esc(T('plugin.installWarn', '索引是第三方内容；确认来源可信后再安装。安装含兼容性与注册表检查。'))}</div>`,
      async () => {
        const r = await warmy.chaJianShiChangAnZhuang({ name, version, url: activeUrl });
        if (r && r.ok) { toast(T('plugin.installedOk', '已安装') + ' ' + name + '@' + version); await loadInstalled(); if (tab === 'installed') renderInstalled(); else browse(); }
        else toast((r && r.error) || 'install-failed', 'err');
      }, T('plugin.install', '安装'));
  }
  function addSource() {
    confirmBox(T('plugin.addSource', '添加索引源'), `<div class="cjmb-field"><label>${esc(T('plugin.indexUrl', '索引文件 URL（http/https）'))}</label><input type="text" data-srcurl placeholder="https://example.com/dsh/index.json" style="width:100%;padding:8px 10px;border:1px solid var(--line,#d7dbe3);border-radius:8px;box-sizing:border-box"></div>
      <div class="cjmb-meta">${esc(T('plugin.srcWarn', 'URL 须 http/https，不含用户名密码或 # 片段。经不受控网络的索引建议用 https。'))}</div>`,
      async () => {
        const w = document.querySelector('.cjmb-confirm:last-of-type');
        const url = w.querySelector('[data-srcurl]').value.trim();
        const r = await warmy.chaJianSuoYinYuan({ action: 'add', url });
        if (r && r.ok) { await loadSources(); activeUrl = url; toast(T('plugin.srcAdded', '索引源已添加')); if (tab === 'market') { renderMarketShell(); browse(); } }
        else toast((r && r.error) || 'add-failed', 'err');
      }, T('common.add', '添加'));
  }
  function manageSources() {
    const rows = sources.length ? sources.map((s) => `<div class="cjmb-src"><span class="u">${esc(s.url)}</span><button class="cjmb-btn danger" data-del="${esc(s.url)}">${esc(T('common.remove', '删除'))}</button></div>`).join('') : `<div class="cjmb-empty">${esc(T('plugin.noSource', '无索引源'))}</div>`;
    confirmBox(T('plugin.manageSources', '管理索引源'), rows, async () => {}, T('common.close', '关闭'));
    const w = document.querySelector('.cjmb-confirm:last-of-type');
    if (w) w.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await warmy.chaJianSuoYinYuan({ action: 'remove', url: b.getAttribute('data-del') }); await loadSources(); if (activeUrl === b.getAttribute('data-del')) activeUrl = sources[0] ? sources[0].url : ''; w.remove(); manageSources(); }; });
  }

  // ── 模态骨架 ──
  function build() {
    injectStyle();
    overlay = document.createElement('div'); overlay.className = 'cjmb-overlay';
    overlay.innerHTML = `<div class="cjmb-dialog" role="dialog" aria-modal="true">
      <div class="cjmb-head"><div><h2>${esc(T('plugin.panelTitle', '插件'))}</h2><div class="cjmb-sub">${esc(T('plugin.panelSub', '一切皆插件 · 确定性扩展点 · 市场发现与更新'))}</div></div><button class="cjmb-x" data-act="close" aria-label="close">×</button></div>
      <div class="cjmb-tabs"><button class="cjmb-tab on" data-tab="installed">${esc(T('plugin.tabInstalled', '已安装'))}</button><button class="cjmb-tab" data-tab="market">${esc(T('plugin.tabMarket', '发现'))}</button></div>
      <div class="cjmb-body"></div></div>`;
    document.body.appendChild(overlay);
    bodyEl = overlay.querySelector('.cjmb-body');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-act="close"]').onclick = close;
    overlay.querySelectorAll('.cjmb-tab').forEach((t) => { t.onclick = () => switchTab(t.getAttribute('data-tab')); });
    bodyEl.addEventListener('click', onBodyClick);
  }
  function switchTab(name) {
    tab = name;
    overlay.querySelectorAll('.cjmb-tab').forEach((t) => t.classList.toggle('on', t.getAttribute('data-tab') === name));
    if (name === 'installed') { loadInstalled().then(renderInstalled); }
    else { loadSources().then(() => { renderMarketShell(); if (activeUrl) browse(); }); }
  }
  async function onBodyClick(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.getAttribute('data-act'); const i = Number(el.getAttribute('data-i'));
    if (act === 'refresh') { await loadInstalled(); renderInstalled(); }
    else if (act === 'toggle') { const p = installed[i]; const r = await warmy.chaJianQiYong({ plugin: p.name, enabled: !p.enabled }); if (r && r.ok) { await loadInstalled(); renderInstalled(); } else toast((r && r.error) || 'toggle-failed', 'err'); }
    else if (act === 'settings') openSettings(i);
    else if (act === 'closecfg') { const box = bodyEl.querySelector(`[data-form="${i}"]`); if (box) box.innerHTML = ''; }
    else if (act === 'savecfg') await saveCfg(i);
    else if (act === 'checkupdate') { const p = installed[i]; el.disabled = true; const r = await warmy.chaJianGengXinJianCe({ plugin: p.name }); el.disabled = false; if (r && r.ok) { p.hasUpdate = r.hasUpdate; p.recommended = r.recommended; renderInstalled(); toast(r.hasUpdate ? (T('plugin.updateFound', '发现新版本') + ' ' + r.recommended) : T('plugin.upToDate', '已是最新')); } else toast((r && r.error) || 'check-failed', 'err'); }
    else if (act === 'update') { const p = installed[i]; confirmBox(T('plugin.update', '更新') + ' ' + p.name, `<div class="cjmb-meta">${esc(T('plugin.updateTo', '更新到'))} ${esc(p.recommended || '')}</div>`, async () => { const r = await warmy.chaJianGengXin({ plugin: p.name }); if (r && r.ok) { toast(T('plugin.updated', '已更新') + ' ' + r.version); await loadInstalled(); renderInstalled(); } else toast((r && r.error) || 'update-failed', 'err'); }, T('plugin.update', '更新')); }
    else if (act === 'uninstall') { const p = installed[i]; confirmBox(T('plugin.uninstall', '卸载') + ' ' + p.name, `<div class="cjmb-meta">${esc(T('plugin.uninstallWarn', '卸载会停用并移除该插件的运行时注册（工具/事件/服务）。'))}</div>`, async () => { const r = await warmy.chaJianQiYong({ plugin: p.name, enabled: false }); if (r && r.ok) { toast(T('plugin.uninstalled', '已卸载')); await loadInstalled(); renderInstalled(); } else toast((r && r.error) || 'uninstall-failed', 'err'); }, T('plugin.uninstall', '卸载')); }
    else if (act === 'addsrc') addSource();
    else if (act === 'mgrsrc') manageSources();
    else if (act === 'browse') browse();
    else if (act === 'install') { e.stopPropagation(); const c = market.cards[Number(el.getAttribute('data-mi'))]; if (c && c.recommended) doInstall(c.name, c.recommended.version); }
    else if (act === 'installver') { /* handled in detail */ }
    const card = e.target.closest('[data-mi]');
    if (card && !el) openDetail(Number(card.getAttribute('data-mi')));
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; bodyEl = null; } }
  async function open() {
    if (overlay) { close(); }
    build();
    const r = await warmy.chaJianXinXi(); window.__cjHostVer = (r && r.hostVersion) || '';
    switchTab('installed');
  }
  window.warmyPluginPanel = { open, close };
  // Escape 关闭：只注册一次（不随每次 open 累积监听器）
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay) close(); });
  // 委托监听设置页的「插件市场与管理」按钮（设置页会重渲染，委托最稳）
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('#anNiuChaJianShiChang') : null;
    if (b) { e.preventDefault(); open(); }
  });
})();