/**
 * phase6：任务3 用户偏好独立配置 + copyFileToClipboard IPC
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function edit(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [oldS, newS, tag] of pairs) {
    const n = s.split(oldS).length - 1;
    if (n !== 1) { console.error(`FAIL ${rel} [${tag}] hits=${n}`); process.exit(1); }
    s = s.replace(oldS, newS);
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(`OK ${rel} (${pairs.length})`);
}

const EM = 'packages/app-shell/src/electron-main.ts';
const AC = 'packages/app-shell/src/archive-cleanup.ts';

// ── 任务3：偏好独立文件改成结构化、格式化、可被门禁约束 ──
edit(AC, [
  [
    `/** 使用者偏好：userData/user-preferences.json（覆盖式 + 去重 key） */
export function heBingYongHuPianHao(
  userData: string,
  prefs: Array<{ key: string; value: string; source: string }>
): { ok: boolean; count: number; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    fs.mkdirSync(userData, { recursive: true });
    let map: Record<string, { value: string; source: string; updatedAt: number }> = {};
    try {
      map = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch { map = {}; }
    let n = 0;
    for (const p of prefs) {
      const k = \`\${p.key}:\${p.value}\`.slice(0, 160);
      if (!map[k]) n += 1;`,
    `/**
 * **使用者偏好独立配置**（产品要求：归档时整理到单独文件，格式化，门禁可约束）。
 *
 * 推荐格式（JSON，UTF-8，2 空格缩进）—— 完整真实记录偏好，且每条可被门禁匹配：
 * \`\`\`json
 * {
 *   "version": 2,
 *   "updatedAt": "2026-01-01T00:00:00.000Z",
 *   "hard": [   // 硬约束：门禁必须拦截（must）
 *     { "id": "no-plaintext-password", "rule": "禁止把口令写进正文", "level": "must", "source": "user" }
 *   ],
 *   "prefer": [ // 软偏好：注入提示词，引导但不拦截
 *     { "id": "reply-style", "key": "style.concise", "value": "回复要短", "scope": "global", "confidence": 0.9, "source": "archive:s1", "updatedAt": 0 }
 *   ],
 *   "tools": { "allow": [], "deny": ["run_shell"], "confirm": ["open_path"] },
 *   "files": { "preferDir": "workspace", "naming": "kebab-case" },
 *   "models": { "prefer": [], "avoid": [] },
 *   "workflow": { "planFirst": true, "askBeforeOpen": true, "maxAutoContinue": 4 }
 * }
 * \`\`\`
 * 门禁用法：读 hard[].level==='must' 做硬拦截；prefer 注入 system；tools.* 做工具白/黑名单。
 */
export const PIAN_HAO_GE_SHI_SHUO_MING = 'user-preferences.json v2: {version,updatedAt,hard[],prefer[],tools,files,models,workflow}';

export function heBingYongHuPianHao(
  userData: string,
  prefs: Array<{ key: string; value: string; source: string }>
): { ok: boolean; count: number; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    fs.mkdirSync(userData, { recursive: true });
    let doc: {
      version: number; updatedAt: string;
      hard: Array<{ id: string; rule: string; level: string; source: string }>;
      prefer: Array<{ id: string; key: string; value: string; scope: string; confidence: number; source: string; updatedAt: number }>;
      tools: { allow: string[]; deny: string[]; confirm: string[] };
      files: { preferDir: string; naming: string };
      models: { prefer: string[]; avoid: string[] };
      workflow: { planFirst: boolean; askBeforeOpen: boolean; maxAutoContinue: number };
    } = {
      version: 2, updatedAt: new Date().toISOString(),
      hard: [], prefer: [],
      tools: { allow: [], deny: [], confirm: [] },
      files: { preferDir: 'workspace', naming: '' },
      models: { prefer: [], avoid: [] },
      workflow: { planFirst: true, askBeforeOpen: true, maxAutoContinue: 4 },
    };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.version === 2 && Array.isArray(raw.prefer)) doc = { ...doc, ...raw };
        else if (raw && !Array.isArray(raw)) {
          // v1 扁平 map → 迁移
          for (const [k, v] of Object.entries(raw as Record<string, { value?: string; source?: string; updatedAt?: number }>)) {
            doc.prefer.push({
              id: k.slice(0, 80), key: k, value: String(v?.value || ''), scope: 'global',
              confidence: 0.7, source: String(v?.source || 'legacy'), updatedAt: Number(v?.updatedAt) || 0,
            });
          }
        }
      }
    } catch { /* 空/坏文件重来 */ }
    let n = 0;
    for (const p of prefs) {
      const id = \`\${p.key}:\${p.value}\`.slice(0, 160);
      const yi = doc.prefer.find((x) => x.id === id || (x.key === p.key && x.value === p.value));
      if (!yi) {
        n += 1;
        doc.prefer.push({
          id, key: String(p.key || '').slice(0, 80), value: String(p.value || '').slice(0, 200),
          scope: 'global', confidence: 0.8, source: String(p.source || ''), updatedAt: Date.now(),
        });
      } else {
        yi.updatedAt = Date.now();
        yi.source = String(p.source || yi.source);
      }
      if (doc.prefer.length >= 200) break;
    }
    doc.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\\n', 'utf8');
    return { ok: true, count: n, file };
  } catch {
    return { ok: false, count: 0, file };
  }
}

/** 旧实现残留（不再使用） */
export function _legacyHeBingYongHuPianHao(
  userData: string,
  prefs: Array<{ key: string; value: string; source: string }>
): { ok: boolean; count: number; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    fs.mkdirSync(userData, { recursive: true });
    let map: Record<string, { value: string; source: string; updatedAt: number }> = {};
    try {
      map = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch { map = {}; }
    let n = 0;
    for (const p of prefs) {
      const k = \`\${p.key}:\${p.value}\`.slice(0, 160);
      if (!map[k]) n += 1;`,
    'prefs-v2',
  ],
]);

// ── copyFileToClipboard IPC（任务10「复制」）──
edit(EM, [
  [
    `chuliIpc('warmy:shouQuanLieBiao', (_e, sid: string) => ({ ok: true, items: shouQuanQu(sid) }));`,
    `/** 复制文件到系统剪贴板（右键菜单「复制」）；失败时由渲染层回退为复制路径 */
chuliIpc('warmy:copyFileToClipboard', async (_e, p0?: { path?: string }) => {
  try {
    const p = String(p0?.path || '');
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    // Electron clipboard.write 文件：Windows 用 FileNameClipboard / 通用路径写文本兜底
    try {
      const { clipboard, nativeImage } = require('electron') as typeof import('electron');
      const abs = path.resolve(p);
      // 尝试以文件列表方式写入（Windows Explorer 可粘贴）
      if (process.platform === 'win32') {
        // Electron 无 writeBuffer(FileName) 时，退回「复制路径」语义由渲染层处理
        clipboard.writeBuffer('FileNameW', Buffer.from(abs + '\\0', 'ucs2'));
        return { ok: true, mode: 'file' };
      }
      clipboard.write({ text: abs });
      return { ok: true, mode: 'text' };
    } catch {
      clipboard.writeText(path.resolve(p));
      return { ok: true, mode: 'text' };
    }
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:shouQuanLieBiao', (_e, sid: string) => ({ ok: true, items: shouQuanQu(sid) }));`,
    'copy-file-ipc',
  ],
]);

console.log('phase6 done');
