// R260 项「Tree-sitter 增量 AST」：代码结构解析子进程（web-tree-sitter WASM，零原生）。
// 用法: node tree-sitter-run.mjs <file> [grammar.wasm]
// 约定: 成功打印 {"ok":true,"outline":[{type,text,row}...]}；未装/缺语法如实 {"ok":false,"error":...}。
// Tree-sitter 按 AST 精确提取函数/类/方法（而非正则），供代码理解/结构化 diff。
import fs from 'node:fs';

const file = process.argv[2];
const grammar = process.argv[3];
const fail = (m) => { console.log(JSON.stringify({ ok: false, error: String(m).slice(0, 400) })); process.exit(0); };

if (!file || !fs.existsSync(file)) fail('file-not-found');
let Parser;
try { Parser = (await import('web-tree-sitter')).default; }
catch (e) { fail('tree-sitter-not-installed: ' + String(e?.message || e) + '（需 npm i web-tree-sitter + 语言 grammar.wasm）'); }
try {
  await Parser.init();
  const parser = new Parser();
  if (grammar) {
    if (!fs.existsSync(grammar)) fail('grammar-not-found: ' + grammar);
    const Lang = await Parser.Language.load(grammar);
    parser.setLanguage(Lang);
  } else {
    fail('needs-grammar（请提供对应语言的 grammar.wasm 路径）');
  }
  const src = fs.readFileSync(file, 'utf8');
  const tree = parser.parse(src);
  const outline = [];
  const walk = (node) => {
    if (/function|class|method|declaration|interface|struct|impl_item/.test(node.type)) {
      outline.push({ type: node.type, text: node.text.slice(0, 80).replace(/\s+/g, ' '), row: node.startPosition.row });
    }
    for (const c of node.children) walk(c);
  };
  walk(tree.rootNode);
  console.log(JSON.stringify({ ok: true, outline: outline.slice(0, 500) }));
} catch (e) { fail('parse-failed: ' + String(e?.message || e)); }