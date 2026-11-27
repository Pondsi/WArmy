/* R310⑤：Ctrl+空格 Markdown 格式候选（聊天输入框 / 聊天文本编辑器 / nm markdown 编辑共用）。
 * 格式栈：选中格式后后续输入都在该格式内；再按触发键出现「取消 XXX」选项（嵌套清晰）。
 * 导航：上下键 / PageUp / PageDown 固定；另两组单键（默认 -/= 与 ,/.）可在设置→快捷更改。
 * 候选按使用频率排序（核心强调/标题/列表/链接/代码优先，其后 GFM，再后扩展；仅列界面能显示的）。 */
(function () {
  const F = (id, label, hint, kind, a, b, extra) => Object.assign({ id, label, hint, kind, open: a || '', close: b || '' }, extra || {});
  const FORMATS = [
    F('bold', '粗体', '**文字**', 'wrap', '**', '**'),
    F('italic', '斜体', '*文字*', 'wrap', '*', '*'),
    F('h2', '标题 2', '## 标题', 'prefix', '## ', '', { family: 'h' }),
    F('h3', '标题 3', '### 标题', 'prefix', '### ', '', { family: 'h' }),
    F('h1', '标题 1', '# 标题', 'prefix', '# ', '', { family: 'h' }),
    F('ul', '无序列表', '- 项目', 'prefix', '- ', '', { family: 'ul' }),
    F('ol', '有序列表', '1. 项目', 'prefix', '1. ', '', { family: 'ol' }),
    F('link', '链接', '[文字](网址)', 'wrap', '[', '](https://)'),
    F('code', '行内代码', '`代码`', 'wrap', '`', '`'),
    F('fence', '代码块', '``` 围栏', 'block', '```\n\n```', '', { cursor: 4 }),
    F('quote', '引用', '> 引用', 'prefix', '> ', '', { family: 'q' }),
    F('task', '任务列表', '- [ ] 任务', 'prefix', '- [ ] ', '', { family: 'ul' }),
    F('table', '表格', '| 列 | 列 |', 'block', '| 列1 | 列2 |\n| --- | --- |\n|  |  |\n', '', { cursor: 28 }),
    F('strike', '删除线', '~~文字~~', 'wrap', '~~', '~~'),
    F('highlight', '高亮', '==文字==', 'wrap', '==', '=='),
    F('image', '图片', '![描述](网址)', 'wrap', '![', '](https://)'),
    F('hr', '分隔线', '---', 'block', '---\n', ''),
    F('h4', '标题 4', '#### 标题', 'prefix', '#### ', '', { family: 'h' }),
    F('h5', '标题 5', '##### 标题', 'prefix', '##### ', '', { family: 'h' }),
    F('h6', '标题 6', '###### 标题', 'prefix', '###### ', '', { family: 'h' }),
    F('sub', '下标', 'H~2~O', 'wrap', '~', '~'),
    F('sup', '上标', 'E=mc^2^', 'wrap', '^', '^'),
    F('spoiler', '剧透', '||隐藏||', 'wrap', '||', '||'),
    F('autolink', '自动链接', '<https://…>', 'wrap', '<', '>'),
    F('footnote', '脚注引用', '[^1]', 'wrap', '[^', ']'),
    F('callout', '提示框', '> [!NOTE]', 'prefix', '> [!NOTE] ', '', { family: 'q' }),
    F('deflist', '定义列表', '术语 + : 定义', 'block', '术语\n: 定义\n', '', { cursor: 0 }),
    F('math', '行内数学', '$E=mc^2$', 'wrap', '$', '$'),
    F('mathblock', '块级数学', '$$ … $$', 'block', '$$\n\n$$\n', '', { cursor: 3 }),
    F('frontmatter', 'Front Matter', '--- yaml ---', 'block', '---\ntitle: \n---\n', '', { cursor: 10 }),
    F('indentcode', '缩进代码块', '4 空格缩进', 'prefix', '    ', '', { family: 'indent' }),
    F('setext', 'Setext 标题', '文本 + ===', 'block', '标题\n===\n', '', { cursor: 0 }),
    F('escape', '转义', '\\* 显示符号', 'wrap', '\\', ''),
  ];

  const ZHUANG = new WeakMap();
  const stOf = (el) => { let s = ZHUANG.get(el); if (!s) { s = { stack: [] }; ZHUANG.set(el, s); } return s; };
  let navKeys = { up1: '-', down1: '=', up2: ',', down2: '.' };
  let caiDan = null, caiDanEl = null, xiangLie = [], xuanIdx = 0;

  const lineStartOf = (v, p) => v.lastIndexOf('\n', Math.max(0, p - 1)) + 1;
  const lineEndOf = (v, p) => { const i = v.indexOf('\n', p); return i < 0 ? v.length : i; };
  function chaRu(el, text, from, to, caret) {
    el.focus();
    el.setRangeText(text, from, to, 'end');
    if (typeof caret === 'number') { el.selectionStart = el.selectionEnd = caret; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function yingYong(el, f) {
    const st = stOf(el);
    const v = el.value, a = el.selectionStart, b = el.selectionEnd;
    if (f.kind === 'wrap') {
      if (b > a) { chaRu(el, f.open + v.slice(a, b) + f.close, a, b); return; }
      chaRu(el, f.open, a, b);
      st.stack.push({ f, kind: 'wrap' });
      return;
    }
    if (f.kind === 'prefix') {
      const ls = lineStartOf(v, a), le = lineEndOf(v, a);
      let line = v.slice(ls, le);
      const strip = { h: /^#{1,6}\s+/, ul: /^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ol: /^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, q: /^>\s?(\[!\w+\]\s+)?/, indent: /^ {4}/ }[f.family] || null;
      if (strip) line = line.replace(strip, '');
      chaRu(el, f.open + line, ls, le, ls + f.open.length);
      st.stack.push({ f, kind: 'prefix' });
      return;
    }
    const pre = a > 0 && v[a - 1] !== '\n' ? '\n' : '';
    const text = pre + f.open;
    chaRu(el, text, a, b, a + pre.length + (typeof f.cursor === 'number' ? f.cursor : f.open.length));
    st.stack.push({ f, kind: 'text', text });
  }
  function quXiao(el, entry) {
    const v = el.value, p = el.selectionStart;
    if (entry.kind === 'wrap') { chaRu(el, entry.f.close, p, p); return; }
    if (entry.kind === 'prefix') {
      const ls = lineStartOf(v, p), le = lineEndOf(v, p);
      const line = v.slice(ls, le);
      if (line.startsWith(entry.f.open)) chaRu(el, line.slice(entry.f.open.length), ls, le, ls);
      return;
    }
    const i = v.lastIndexOf(entry.text);
    if (i >= 0) chaRu(el, '', i, i + entry.text.length, i);
  }

  function guan() {
    if (caiDan) { caiDan.remove(); caiDan = null; }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', waiDian, true);
    caiDanEl = null; xiangLie = []; lieRong = null; souInput = null; souSuo = '';
  }
  function waiDian(e) { if (caiDan && !caiDan.contains(e.target)) guan(); }
  let souSuo = '';
  let lieRong = null;
  let souInput = null;
  function huaXuan() {
    if (!lieRong) return;
    [...lieRong.children].forEach((n, i) => n.classList.toggle('xuan', i === xuanIdx));
    const n = lieRong.children[xuanIdx];
    if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
  }
  /* R317：取消项须校验该格式标记仍在文中（用户可能已编辑/删除），不在则不显示。 */
  function haiZai(el, entry) {
    const v = String(el.value || '');
    const f = entry.f;
    if (entry.kind === 'wrap') return v.includes(f.open) && (!f.close || v.includes(f.close));
    if (entry.kind === 'prefix') return v.split('\n').some((ln) => ln.startsWith(f.open));
    return v.includes(entry.text || f.open);
  }
  function jiSuanXiangLie(el) {
    const st = stOf(el);
    const lie = [];
    const youXiao = st.stack.filter((e) => haiZai(el, e));
    st.stack = youXiao;
    if (youXiao.length) lie.push({ cancel: youXiao[youXiao.length - 1], label: '取消 ' + youXiao[youXiao.length - 1].f.label, hint: '最内层' });
    for (const f of FORMATS) lie.push({ f, label: f.label, hint: f.hint });
    if (youXiao.length) {
      for (let i = 0; i < youXiao.length - 1; i++) lie.push({ cancel: youXiao[i], label: '取消 ' + youXiao[i].f.label, hint: i === youXiao.length - 2 ? '次内层' : '外层' });
      lie.push({ all: true, label: '取消所有格式', hint: '清空格式栈' });
    }
    const q = souSuo.trim().toLowerCase();
    if (!q) return lie;
    return lie.filter((x) => String(x.label).toLowerCase().includes(q) || String(x.hint || '').toLowerCase().includes(q) || String((x.f && x.f.id) || '').toLowerCase().includes(q));
  }
  function huaLie() {
    if (!lieRong || !caiDanEl) return;
    xiangLie = jiSuanXiangLie(caiDanEl);
    if (xuanIdx >= xiangLie.length) xuanIdx = 0;
    lieRong.textContent = '';
    xiangLie.forEach((x, i) => {
      const n = document.createElement('div');
      n.setAttribute('role', 'option');
      n.dataset.i = String(i);
      n.className = 'mdGsx' + (x.cancel || x.all ? ' mdGsxQu' : '');
      const lab = document.createElement('span'); lab.className = 'mdGsxLabel'; lab.textContent = String(x.label);
      const hin = document.createElement('span'); hin.className = 'mdGsxHint'; hin.textContent = String(x.hint || '');
      n.append(lab, hin);
      n.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      n.onclick = (e) => { e.preventDefault(); e.stopPropagation(); xuanIdx = Number(n.dataset.i); xuanZe(); };
      lieRong.appendChild(n);
    });
    huaXuan();
  }
  function kai(el) {
    guan();
    caiDanEl = el;
    souSuo = '';
    xuanIdx = 0;
    caiDan = document.createElement('div');
    caiDan.id = 'mdGeShiCaiDan';
    caiDan.setAttribute('role', 'listbox');
    /* R317：顶部搜索框（英文 id / 中文 / 输入法）。 */
    souInput = document.createElement('input');
    souInput.type = 'text';
    souInput.placeholder = '搜索格式（英文/中文）…';
    souInput.style.cssText = 'width:100%;box-sizing:border-box;margin:0 0 4px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:5px;background:var(--bg,#fff);color:var(--ink,#222);font:inherit';
    souInput.addEventListener('input', () => { souSuo = souInput.value; xuanIdx = 0; huaLie(); });
    souInput.addEventListener('keydown', (e) => { e.stopPropagation(); }, false);
    caiDan.appendChild(souInput);
    lieRong = document.createElement('div');
    caiDan.appendChild(lieRong);
    document.body.appendChild(caiDan);
    const r = el.getBoundingClientRect();
    caiDan.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + 'px';
    caiDan.style.top = Math.min(r.bottom + 4, window.innerHeight - 340) + 'px';
    huaLie();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', waiDian, true);
  }
  function xuanZe() {
    const x = xiangLie[xuanIdx];
    const el = caiDanEl;
    guan();
    if (!x || !el) return;
    const st = stOf(el);
    if (x.all) { while (st.stack.length) quXiao(el, st.stack.pop()); return; }
    if (x.cancel) {
      const i = st.stack.indexOf(x.cancel);
      if (i >= 0) { st.stack.splice(i, 1); quXiao(el, x.cancel); }
      return;
    }
    yingYong(el, x.f);
  }
  function onKey(e) {
    if (!caiDan) return;
    /* 搜索框聚焦时：只拦导航/确认/关闭，其余交给输入。 */
    if (e.target === souInput) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') { /* 下方统一处理 */ }
      else return;
    }
    let k = e.key;
    /* R317：中文全角 ，。 映射为半角 ,. 作翻页键。 */
    if (k === '，') k = ',';
    if (k === '。') k = '.';
    const yi = (d) => { e.preventDefault(); e.stopPropagation(); if (!xiangLie.length) return; xuanIdx = (xuanIdx + d + xiangLie.length) % xiangLie.length; huaXuan(); };
    if (k === 'ArrowDown' || k === 'PageDown' || k === navKeys.down1 || k === navKeys.down2) { yi(1); return; }
    if (k === 'ArrowUp' || k === 'PageUp' || k === navKeys.up1 || k === navKeys.up2) { yi(-1); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); xuanZe(); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); guan(); return; }
    if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === souInput) return;
    guan();
  }
  window.warmyMdFormat = {
    FORMATS,
    isOpen: () => !!caiDan,
    open: kai,
    close: guan,
    toggle: (el) => { if (caiDan) guan(); else kai(el); },
    setNavKeys: (p) => { navKeys = Object.assign({}, navKeys, p || {}); },
    getNavKeys: () => Object.assign({}, navKeys),
    stackOf: (el) => stOf(el).stack.slice(),
    refresh: () => { if (caiDan && caiDanEl) kai(caiDanEl); },
  };
})();