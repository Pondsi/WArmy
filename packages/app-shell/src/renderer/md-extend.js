/* R310⑤：Markdown 显示能力扩展（chat mdHtml 与 nm markdownToHtml 共用）。
 * 补齐 CommonMark/GFM 与常见扩展的显示：表格/任务列表/删除线/高亮/图片/上下标/剧透/
 * 自动链接/脚注/定义列表/提示框/Front Matter/数学(文本式)/Setext/缩进代码/转义。
 * 不引入 KaTeX/Mermaid 等重依赖；界面画不出的（mermaid 图/wiki 链接/嵌入）不进候选。
 * 约定：块级助手接收已 HTML 转义的行数组；inlineFn 由调用方传入。 */
(function () {
  const ZW = String.fromCharCode(2);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** 反斜杠转义保护：先换占位符，行内格式跑完再还原（显示字符本身）。 */
  function baoHu(x) {
    const cun = [];
    const out = String(x).replace(/\\([\\`*_{}\[\]()#+\-.!>~=|^$])/g, (_m, ch) => {
      cun.push(ch);
      return ZW + (cun.length - 1) + ZW;
    });
    const huan = (v) => String(v).replace(new RegExp(ZW + '(\\d+)' + ZW, 'g'), (_m, i) => esc(cun[Number(i)] || ''));
    return { x: out, huan };
  }

  /** 行内扩展（在既有 code/bold/italic/link 之后跑；转义占位符最后还原）。 */
  function inlineKuoZhan(x, zhu) {
    let s = String(x);
    s = s.replace(/!\[([^\]\n]*)\]\((https?:[^)\s]+|data:image\/(?:png|jpeg|webp|gif);base64,[^)\s]+)\)/g,
      (_m, alt, url) => '<img class="mdImg" src="' + url + '" alt="' + alt + '"/>');
    s = s.replace(/\$([^$\n]+)\$/g, '<code class="mdMath">$1</code>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=\n]+)==/g, '<mark class="mdGaoLiang">$1</mark>');
    s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="mdSpoiler" role="button" tabindex="0" title="点击显示剧透">$1</span>');
    s = s.replace(/~([^~\n]+)~/g, '<sub>$1</sub>');
    s = s.replace(/\^([^\^\n]+)\^/g, '<sup>$1</sup>');
    if (zhu && zhu.size) {
      s = s.replace(/\[\^([^\]\n]+)\]/g, (m, id) => zhu.has(id)
        ? '<sup class="mdZhu"><a href="#md-zhu-' + esc(id) + '">[' + esc(id) + ']</a></sup>' : m);
    }
    s = s.replace(/(^|[^"=>\w(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g,
      (m, pre, url) => pre + '<a class="mdAutoLian" href="' + url + '" target="_blank" rel="noreferrer">' + url + '</a>');
    s = s.replace(/(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=[\s).,;]|$)/g,
      (m, pre, mail) => pre + '<a class="mdAutoLian" href="mailto:' + mail + '">' + mail + '</a>');
    return s;
  }

  /** Setext 标题归并成 ATX（单行段落＋下一行 ===/---）。 */
  function setextGuiBing(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const cur = String(lines[i] || '');
      const nxt = String(lines[i + 1] || '').trim();
      const prev = out.length ? String(out[out.length - 1] || '').trim() : '';
      if (/^(=+|-+)$/.test(nxt) && cur.trim() && !prev
        && !/^(#{1,6}\s|&gt;|\s*[-*+]\s|\s*\d+[.)]\s|```|\s{4})/.test(cur) && !cur.includes(ZW + 'K')) {
        out.push((/^=+$/.test(nxt) ? '# ' : '## ') + cur.trim());
        i++;
        continue;
      }
      out.push(cur);
    }
    return out;
  }

  /** GFM 表格：head 含 | 且下一行是分隔行。返回 {html,next}。 */
  function tableAt(lines, i, inlineFn) {
    const fn = inlineFn || ((v) => v);
    const head = String(lines[i] || '');
    const sep = String(lines[i + 1] || '');
    if (!head.includes('|') || !sep.includes('-') || !/^\s*\|?[\s:|-]+$/.test(sep)) return null;
    const cells = (l) => String(l).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const hs = cells(head);
    if (!hs.length) return null;
    const al = cells(sep).map((c) => /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '');
    let j = i + 2;
    const rows = [];
    while (j < lines.length && String(lines[j] || '').trim() && String(lines[j] || '').includes('|')) { rows.push(cells(lines[j])); j++; }
    const sty = (k) => al[k] ? ' style="text-align:' + al[k] + '"' : '';
    let html = '<table class="mdBiao"><thead><tr>' + hs.map((c, k) => '<th' + sty(k) + '>' + fn(c) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of rows) html += '<tr>' + hs.map((_h, k) => '<td' + sty(k) + '>' + fn(r[k] || '') + '</td>').join('') + '</tr>';
    return { html: html + '</tbody></table>', next: j };
  }

  /** 缩进代码块（4 空格/制表符）。 */
  function indentAt(lines, i) {
    if (!/^( {4}|\t)/.test(String(lines[i] || ''))) return null;
    let j = i;
    const buf = [];
    while (j < lines.length) {
      const l = String(lines[j] || '');
      if (/^( {4}|\t)/.test(l)) { buf.push(l.replace(/^( {4}|\t)/, '')); j++; continue; }
      if (!l.trim() && j + 1 < lines.length && /^( {4}|\t)/.test(String(lines[j + 1] || ''))) { buf.push(''); j++; continue; }
      break;
    }
    return { html: '<pre class="mdCode mdSuoJin">' + buf.join('\n') + '</pre>', next: j };
  }

  /** 块级数学 $$ … $$（文本式显示）。 */
  function mathAt(lines, i) {
    if (String(lines[i] || '').trim() !== '$$') return null;
    let j = i + 1;
    const buf = [];
    while (j < lines.length && String(lines[j] || '').trim() !== '$$') { buf.push(String(lines[j] || '')); j++; }
    if (j >= lines.length) return null;
    return { html: '<pre class="mdMath mdMathKuai">' + buf.join('\n') + '</pre>', next: j + 1 };
  }

  window.warmyMdExtendPart1 = { esc, baoHu, inlineKuoZhan, setextGuiBing, tableAt, indentAt, mathAt, ZW };
})();
/* R310⑤ 续：任务列表/提示框/定义列表/Front Matter/脚注。 */
(function () {
  const P1 = window.warmyMdExtendPart1 || {};
  const esc = P1.esc || ((s) => String(s));

  /** 任务列表项：marker 后紧跟 [ ]/[x]。 */
  function taskMatch(rest) {
    const m = /^\[([ xX])\]\s+(.*)$/.exec(String(rest || ''));
    return m ? { checked: m[1] !== ' ', content: m[2] } : null;
  }
  function taskHtml(content, checked) {
    return '<li class="mdTask"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '/><span>' + content + '</span></li>';
  }

  /** 提示框（GitHub/Obsidian 风格）：&gt; [!NOTE] 等（行已转义）。 */
  const CALL_OUT = {
    note: ['注意', 'mdCallout-note'], info: ['注意', 'mdCallout-note'],
    tip: ['提示', 'mdCallout-tip'], success: ['提示', 'mdCallout-tip'],
    important: ['重要', 'mdCallout-important'],
    warning: ['警告', 'mdCallout-warning'], danger: ['警告', 'mdCallout-warning'],
    caution: ['小心', 'mdCallout-caution'],
  };
  function calloutAt(lineEsc) {
    const m = /^&gt;\s*\[!(\w+)\]\s*(.*)$/.exec(String(lineEsc || ''));
    if (!m) return null;
    const c = CALL_OUT[m[1].toLowerCase()];
    if (!c) return null;
    return { cls: c[1], title: c[0], rest: m[2] };
  }
  function calloutHtml(co, restHtml) {
    return '<blockquote class="mdCallout ' + co.cls + '"><span class="mdCalloutBiao">' + esc(co.title) + '</span>' + (restHtml || '') + '</blockquote>';
  }

  /** 定义列表：术语行＋紧随的 : 定义行。 */
  function defAt(lines, i, inlineFn) {
    const fn = inlineFn || ((v) => v);
    const term = String(lines[i] || '').trim();
    if (!term || !/^:\s+/.test(String(lines[i + 1] || ''))) return null;
    let j = i + 1;
    let html = '<dl class="mdDingYi"><dt>' + fn(term) + '</dt>';
    while (j < lines.length && /^:\s+/.test(String(lines[j] || ''))) {
      html += '<dd>' + fn(String(lines[j]).replace(/^:\s+/, '')) + '</dd>';
      j++;
    }
    return { html: html + '</dl>', next: j };
  }

  /** Front Matter：首行 --- 到下一个 ---（限 60 行内），显示为 yaml 块。 */
  function frontMatterAt(lines) {
    if (String(lines[0] || '').trim() !== '---') return null;
    for (let j = 1; j < Math.min(lines.length, 60); j++) {
      if (String(lines[j] || '').trim() === '---') {
        return { html: '<pre class="mdFront">' + lines.slice(1, j).join('\n') + '</pre>', next: j + 1 };
      }
    }
    return null;
  }

  /** 脚注：抽定义行；行内引用由 inlineKuoZhan 处理；文末生成脚注区。 */
  function chouZhu(lines) {
    const defs = new Map();
    const rest = [];
    for (const l of lines) {
      const m = /^\[\^([^\]\n]+)\]:\s*(.*)$/.exec(String(l || ''));
      if (m) defs.set(m[1], m[2]); else rest.push(l);
    }
    return { defs, rest };
  }
  function zhuHtml(defs, inlineFn) {
    if (!defs || !defs.size) return '';
    const fn = inlineFn || ((v) => v);
    let html = '<section class="mdZhuQu"><hr/><ol>';
    for (const [id, wen] of defs) html += '<li id="md-zhu-' + esc(id) + '">' + fn(wen) + '</li>';
    return html + '</ol></section>';
  }

  window.warmyMdExtend = Object.assign({}, P1, {
    taskMatch, taskHtml, calloutAt, calloutHtml, defAt, frontMatterAt, chouZhu, zhuHtml,
  });
  delete window.warmyMdExtendPart1;
})();