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
    caiDanEl = null; xiangLie = [];
  }
  function waiDian(e) { if (caiDan && !caiDan.contains(e.target)) guan(); }
  function huaXuan() {
    if (!caiDan) return;
    [...caiDan.children].forEach((n, i) => n.classList.toggle('xuan', i === xuanIdx));
    const n = caiDan.children[xuanIdx];
    if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
  }
  function kai(el) {
    guan();
    caiDanEl = el;
    const st = stOf(el);
    xiangLie = [];
    if (st.stack.length) {
      xiangLie.push({ cancel: st.stack[st.stack.length - 1], label: '取消 ' + st.stack[st.stack.length - 1].f.label, hint: '最内层' });
    }
    for (const f of FORMATS) xiangLie.push({ f, label: f.label, hint: f.hint });
    if (st.stack.length) {
      for (let i = 0; i < st.stack.length - 1; i++) xiangLie.push({ cancel: st.stack[i], label: '取消 ' + st.stack[i].f.label, hint: i === st.stack.length - 2 ? '次内层' : '外层' });
      xiangLie.push({ all: true, label: '取消所有格式', hint: '清空格式栈' });
    }
    xuanIdx = 0;
    caiDan = document.createElement('div');
    caiDan.id = 'mdGeShiCaiDan';
    caiDan.setAttribute('role', 'listbox');
    /* 安全构造：候选文案全为内部常量，仍一律 textContent，不走 innerHTML */
    xiangLie.forEach((x, i) => {
      const n = document.createElement('div');
      n.setAttribute('role', 'option');
      n.dataset.i = String(i);
      n.className = 'mdGsx' + (x.cancel || x.all ? ' mdGsxQu' : '');
      const lab = document.createElement('span');
      lab.className = 'mdGsxLabel';
      lab.textContent = String(x.label);
      const hin = document.createElement('span');
      hin.className = 'mdGsxHint';
      hin.textContent = String(x.hint || '');
      n.append(lab, hin);
      caiDan.appendChild(n);
    });
    document.body.appendChild(caiDan);
    const r = el.getBoundingClientRect();
    caiDan.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + 'px';
    caiDan.style.top = Math.min(r.bottom + 4, window.innerHeight - 340) + 'px';
    [...caiDan.children].forEach((n) => {
      n.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      n.onclick = (e) => { e.preventDefault(); e.stopPropagation(); xuanIdx = Number(n.dataset.i); xuanZe(); };
    });
    huaXuan();
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
    const k = e.key;
    const yi = (d) => { e.preventDefault(); e.stopPropagation(); xuanIdx = (xuanIdx + d + xiangLie.length) % xiangLie.length; huaXuan(); };
    if (k === 'ArrowDown' || k === 'PageDown' || k === navKeys.down1 || k === navKeys.down2) { yi(1); return; }
    if (k === 'ArrowUp' || k === 'PageUp' || k === navKeys.up1 || k === navKeys.up2) { yi(-1); return; }
    if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); xuanZe(); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); guan(); return; }
    if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return;
    /* 带修饰键的组合（如触发键再按）交给外层刷新，不在这里收菜单 */
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    /* 其余键：收起候选，让输入继续（触发键由外层重开刷新） */
    guan();
  }
  window.warmyMdFormat = {
    FORMATS,
    isOpen: () => !!caiDan,
    open: kai,
    close: guan,
    toggle: (el) => { if (caiDan && caiDanEl === el) kai(el); else if (caiDan) guan(); else kai(el); },
    setNavKeys: (p) => { navKeys = Object.assign({}, navKeys, p || {}); },
    getNavKeys: () => Object.assign({}, navKeys),
    stackOf: (el) => stOf(el).stack.slice(),
    refresh: () => { if (caiDan && caiDanEl) kai(caiDanEl); },
  };
})();