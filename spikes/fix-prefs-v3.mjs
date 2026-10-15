import fs from 'node:fs';
const p = 'packages/app-shell/src/archive-cleanup.ts';
let s = fs.readFileSync(p, 'utf8');

const oldDoc = ` * 推荐格式（JSON，UTF-8，2 空格缩进）—— 完整真实记录偏好，且每条可被门禁匹配：
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
export const PIAN_HAO_GE_SHI_SHUO_MING = 'user-preferences.json v2: {version,updatedAt,hard[],prefer[],tools,files,models,workflow}';`;

const newDoc = ` * **v3 软门禁格式**（行业通行：Constitutional AI / guardrails 都是「引导 + 可修正」而非一票否决）：
 * - 所有规则都是 **soft**：注入提示词引导，默认不拦截；
 * - 模型判断「异常由此门禁导致」时可 **skip**（带原因），归档时复盘改/删；
 * - 每条规则有 id / match / action / severity / status / skipHistory。
 *
 * \`\`\`json
 * {
 *   "version": 3,
 *   "updatedAt": "ISO-8601",
 *   "rules": [
 *     {
 *       "id": "reply-style-concise",
 *       "category": "style",
 *       "match": { "type": "always", "pattern": "" },
 *       "action": "advise",
 *       "severity": "low",
 *       "message": "回复尽量短",
 *       "status": "active",
 *       "source": "user|archive|model",
 *       "skipHistory": [{ "at": 0, "by": "model", "reason": "..." }]
 *     }
 *   ],
 *   "tools": { "confirm": ["run_shell"], "deny": [] },
 *   "workflow": { "planFirst": true, "maxAutoContinue": 8 }
 * }
 * \`\`\`
 * - action: advise（只提示） | warn（提示并记审计） | block（仍可被 skip 自愈）
 * - status: active | skipped（暂时跳过） | retired（归档复盘后删除）
 * - 归档时检查 skipped：分析 skipHistory，改 message/match 或 retired。
 */
export const PIAN_HAO_GE_SHI_SHUO_MING = 'user-preferences.json v3 soft-gate: {version,rules[{id,category,match,action,severity,message,status,skipHistory}],tools,workflow}';

/** 软门禁规则（v3） */
export interface RuanMenJinGuiZe {
  id: string;
  category: 'style' | 'tool' | 'file' | 'model' | 'workflow' | 'safety';
  match: { type: 'always' | 'regex' | 'keyword'; pattern: string };
  action: 'advise' | 'warn' | 'block';
  severity: 'low' | 'medium' | 'high';
  message: string;
  status: 'active' | 'skipped' | 'retired';
  source: string;
  skipHistory?: Array<{ at: number; by: string; reason: string }>;
}

/** 模型自愈：标记某条门禁「暂时跳过」 */
export function biaoJiZanShiTiaoGuo(userData: string, ruleId: string, reason: string, by = 'model'): { ok: boolean; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = (doc.rules || []).find((x: RuanMenJinGuiZe) => x && x.id === ruleId);
    if (!r) return { ok: false, file };
    r.status = 'skipped';
    r.skipHistory = Array.isArray(r.skipHistory) ? r.skipHistory : [];
    r.skipHistory.push({ at: Date.now(), by, reason: String(reason || '').slice(0, 300) });
    doc.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\\n', 'utf8');
    return { ok: true, file };
  } catch { return { ok: false, file }; }
}

/** 归档复盘：把 skipped 规则列出来供模型决定改/删 */
export function fuPanTiaoGuoGuiZe(userData: string): Array<RuanMenJinGuiZe> {
  const file = path.join(userData, 'user-preferences.json');
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (doc.rules || []).filter((x: RuanMenJinGuiZe) => x && x.status === 'skipped');
  } catch { return []; }
}`;

if (!s.includes(oldDoc)) {
  console.log('old doc not found, trying partial');
  const i = s.indexOf('推荐格式');
  console.log(i, s.slice(i, i + 100));
  process.exit(1);
}
s = s.replace(oldDoc, newDoc);

// v2 → v3 迁移
s = s.replace(
  `        if (raw.version === 2 && Array.isArray(raw.prefer)) doc = { ...doc, ...raw };`,
  `        if (raw.version >= 3 && Array.isArray(raw.rules)) {
          // v3 直接读
          return { ok: true, count: 0, file };
        }
        if (raw.version === 2 && Array.isArray(raw.prefer)) {
          // v2 → v3：hard 变 block 规则，prefer 变 advise 规则
          for (const h of (raw.hard || [])) {
            (doc as unknown as { rules: RuanMenJinGuiZe[] }).rules.push({
              id: String(h.id || 'r' + Date.now()), category: 'safety',
              match: { type: 'always', pattern: '' },
              action: 'block', severity: 'high',
              message: String(h.rule || h.message || ''), status: 'active', source: String(h.source || 'user'),
            });
          }
          for (const pr of (raw.prefer || [])) {
            (doc as unknown as { rules: RuanMenJinGuiZe[] }).rules.push({
              id: String(pr.id || 'p' + Date.now()), category: 'style',
              match: { type: 'keyword', pattern: String(pr.key || '') },
              action: 'advise', severity: 'low',
              message: String(pr.value || ''), status: 'active', source: String(pr.source || 'user'),
            });
          }
        }`
);

fs.writeFileSync(p, s, 'utf8');
console.log('prefs v3 soft-gate written');
