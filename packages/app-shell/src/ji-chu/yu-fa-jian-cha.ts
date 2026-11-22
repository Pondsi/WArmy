/**
 * R294-4 ACI：写/改后语法自动检查（中文友好，建议性，绝不阻塞写入）。
 * 进程内优先（零子进程开销）：.json→JSON.parse；.js/.cjs→vm.Script；
 * .mjs/.ts→module.stripTypeScriptTypes（Node≥23.6 内建 TS 语法解析；不可用则回落子进程）。
 * 子进程兜底：process.execPath + ELECTRON_RUN_AS_NODE=1（Electron exe 与纯 node 通吃，
 * 修复旧版直接 `electron --check` 在打包态根本不是 node 的问题）。
 * 中文友好：错误消息中文化＋行/列；全角标点出现在代码区（字符串/注释外）给提示；
 * BOM/EOL 由 edit_file 的精确替换天然保留，这里只读不改。
 */
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export interface YuFaCuoWu { line?: number; col?: number; msg: string }
export interface YuFaJieGuo {
  /** 是否真的检查了（检查器不可用＝false，如实不冒充） */
  checked: boolean;
  ok: boolean;
  errors: YuFaCuoWu[];
  /** 代码区疑似全角标点（字符串/注释外），建议性 */
  quanJiao: string[];
  /** 检查方式（进程内/子进程），供台账与自我改进统计 */
  fangShi: 'inline' | 'subprocess' | 'none';
}

const KE_JIAN = /\.(json|js|cjs|mjs|ts|tsx|mts|cts)$/i;
export function keJianYuFa(file: string): boolean { return KE_JIAN.test(String(file || '')); }

/** 粗剥字符串/注释后扫代码区全角标点（建议性，允许误报由模型自判） */
function quanJiaoSao(code: string): string[] {
  const qu = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const zhao = qu.match(/[！-～、。〈〉《》「」『』【】〔〕〖〗〝〞]/g) || [];
  return [...new Set(zhao)].slice(0, 8);
}

function cuoWuWeiZhi(e: unknown, code: string): YuFaCuoWu {
  const msg = String((e as Error)?.message || e).slice(0, 300);
  /* JSON.parse 报 "position N"；vm.Script 报 "file:line"；统一换算行/列 */
  const pos = /position (\d+)/i.exec(msg);
  if (pos && pos[1]) {
    const n = Number(pos[1]);
    const qian = code.slice(0, n);
    const line = qian.split('\n').length;
    const col = n - qian.lastIndexOf('\n');
    return { line, col, msg };
  }
  const hang = /:(\d+)(?::(\d+))?/.exec(msg);
  if (hang && hang[1]) return { line: Number(hang[1]), col: hang[2] ? Number(hang[2]) : undefined, msg };
  /* vm.Script 的行号在 stack 首行（“a.js:1”），message 里没有 */
  const zhan = String((e as Error)?.stack || '');
  const shouHang = /^([^\n]*?):(\d+)(?::(\d+))?/.exec(zhan);
  if (shouHang && shouHang[2]) return { line: Number(shouHang[2]), col: shouHang[3] ? Number(shouHang[3]) : undefined, msg };
  return { msg };
}

function ziJinChengJianCha(file: string, ext: string): YuFaJieGuo | null {
  try {
    const args = ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts'
      ? ['--experimental-strip-types', '--check', file]
      : ['--check', file];
    const jian = spawnSync(process.execPath, args, {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (jian.error) return null;
    if (jian.status === 0) return { checked: true, ok: true, errors: [], quanJiao: [], fangShi: 'subprocess' };
    const cuo = String(jian.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 300);
    const hang = /:(\d+)/.exec(cuo);
    return { checked: true, ok: false, errors: [{ line: hang && hang[1] ? Number(hang[1]) : undefined, msg: cuo }], quanJiao: [], fangShi: 'subprocess' };
  } catch { return null; }
}

/** 同步检查（工具回执用）；任何异常都吞成 checked:false，绝不阻断写入。 */
export function jianChaYuFa(file: string, code: string): YuFaJieGuo {
  const kong: YuFaJieGuo = { checked: false, ok: true, errors: [], quanJiao: [], fangShi: 'none' };
  try {
    const ext = (String(file || '').match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!KE_JIAN.test(file)) return kong;
    const quanJiao = quanJiaoSao(code);
    if (ext === '.json') {
      try { JSON.parse(code); return { checked: true, ok: true, errors: [], quanJiao, fangShi: 'inline' }; }
      catch (e) { return { checked: true, ok: false, errors: [cuoWuWeiZhi(e, code)], quanJiao, fangShi: 'inline' }; }
    }
    if (ext === '.js' || ext === '.cjs') {
      try { new vm.Script(code, { filename: file }); return { checked: true, ok: true, errors: [], quanJiao, fangShi: 'inline' }; }
      catch (e) { return { checked: true, ok: false, errors: [cuoWuWeiZhi(e, code)], quanJiao, fangShi: 'inline' }; }
    }
    /* .mjs/.ts 等：先试内建 TS 语法解析（Node≥23.6），不行再子进程 --check */
    try {
      const mod = createRequire(import.meta.url)('node:module') as { stripTypeScriptTypes?: (c: string, o?: { mode?: string }) => string };
      if (typeof mod.stripTypeScriptTypes === 'function') {
        mod.stripTypeScriptTypes(code, { mode: 'strip' });
        return { checked: true, ok: true, errors: [], quanJiao, fangShi: 'inline' };
      }
    } catch (e) {
      /* 语法错 vs 功能不可用：功能不可用（ERR_…FEATURE…/not a function）回落子进程 */
      const msg = String((e as Error)?.message || e);
      if (!/feature|unsupported|not a function|experimental/i.test(msg)) {
        return { checked: true, ok: false, errors: [cuoWuWeiZhi(e, code)], quanJiao, fangShi: 'inline' };
      }
    }
    const zi = ziJinChengJianCha(file, ext);
    if (zi) return { ...zi, quanJiao };
    return { ...kong, quanJiao };
  } catch { return kong; }
}

/** 把检查结果拼成中文建议行（工具回执尾部；ok 且无全角⇒空串） */
export function yuFaJianYiWen(jie: YuFaJieGuo): string {
  if (!jie.checked) return '';
  const tiao: string[] = [];
  if (!jie.ok) {
    for (const c of jie.errors.slice(0, 3)) {
      tiao.push('语法错误' + (c.line ? '（第' + c.line + '行' + (c.col ? '第' + c.col + '列' : '') + '）' : '') + '：' + c.msg);
    }
  }
  if (jie.quanJiao.length) tiao.push('代码区疑似全角标点 ' + jie.quanJiao.join(' ') + '（字符串/注释内可忽略；标识符/运算符处请改半角）');
  if (!tiao.length) return '';
  return '\n〔语法检查·建议（未阻止写入，请自行修正）：' + tiao.join('；') + '〕';
}
