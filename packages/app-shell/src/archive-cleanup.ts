/**
 * KnowledgeArchiver：外部群归档流水线
 * 将外部群会话归档到知识库，保留证据锚点
 */
import fs from 'node:fs';
import path from 'node:path';

export interface GuiDangJieGou {
  bullets: string[];
  decisions: string[];
  todos: string[];
  risks: string[];
}

export interface GuiDangTiaoMu {
  id: string;
  groupId: string;
  biaoTi: string;
  summary: string;
  ts: number;
  anchors: Array<{ file: string; seq: number }>;
  structured?: GuiDangJieGou;
}

export class ZhiShiGuiDangQi {
  private file: string;

  constructor(userData: string) {
    const dir = path.join(userData, 'archive');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'archives.jsonl');
  }

  archive(entry: Omit<GuiDangTiaoMu, 'ts'>): GuiDangTiaoMu {
    const Quan: GuiDangTiaoMu = { ...entry, ts: Date.now() };
    if (!Quan.structured) delete Quan.structured;
    fs.appendFileSync(this.file, JSON.stringify(Quan) + '\n', 'utf8');
    return Quan;
  }

  LieBiao(groupId?: string): GuiDangTiaoMu[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((e) => !groupId || e.groupId === groupId);
    } catch {
      return [];
    }
  }
}

/**
 * CleanupManager：手动清理机制
 */
export class QingLiGuanLiQi {
  constructor(private userData: string) {}

  /** 清理旧检查点（保留最近 N 个） */
  cleanCheckpoints(keep = 20): number {
    const dir = path.join(this.userData, 'checkpoints');
    const meta = path.join(dir, 'checkpoints.json');
    try {
      const items = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (items.length <= keep) return 0;
      const removed = items.splice(0, items.length - keep);
      for (const r of removed) {
        fs.rmSync(path.join(dir, r.dir), { recursive: true, force: true });
      }
      fs.writeFileSync(meta, JSON.stringify(items, null, 2));
      return removed.length;
    } catch {
      return 0;
    }
  }

  /** 清理审计日志 */
  cleanAudit(): void {
    const f = path.join(this.userData, 'audit', 'audit.jsonl');
    try {
      fs.writeFileSync(f, '', 'utf8');
    } catch {
      /* noop */
    }
  }

  /** 清理语音文件 */
  cleanVoice(olderThanMs = 7 * 24 * 3600_000): number {
    const dir = path.join(this.userData, 'voice');
    let n = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const st = fs.statSync(fp);
        if (Date.now() - st.mtimeMs > olderThanMs) {
          fs.rmSync(fp, { force: true });
          n++;
        }
      }
    } catch {
      /* noop */
    }
    return n;
  }
}


/**
 * 归档时提炼：知识库实体/事件 + 使用者行为偏好（持久、跨会话）。
 * 产品原则：归档不只是 summary+anchors 存档，还要**进知识**与**进偏好**。
 */
export interface GuiDangTiQu {
  entities: Array<{ id: string; ming: string; kind: string; attrs?: Record<string, string> }>;
  events: Array<{ id: string; biaoTi: string; result?: string }>;
  preferences: Array<{ key: string; value: string; source: string }>;
}

export function congGuiDangTiQuZhiShi(shuRu: {
  groupId: string;
  biaoTi: string;
  summary: string;
}): GuiDangTiQu {
  const text = `${shuRu.biaoTi}\n${shuRu.summary}`.slice(0, 4000);
  const entities: GuiDangTiQu['entities'] = [];
  const events: GuiDangTiQu['events'] = [];
  const preferences: GuiDangTiQu['preferences'] = [];

  // 实体：标题本身作为会话/主题实体
  entities.push({
    id: `arc-topic-${shuRu.groupId}-${Date.now()}`,
    ming: shuRu.biaoTi.slice(0, 80),
    kind: 'concept',
    attrs: { groupId: shuRu.groupId },
  });

  // 从摘要里抓简单要点（中英文关键词）
  const prefPatterns: Array<[RegExp, string]> = [
    [/(?:用户|我)(?:偏好|希望|想要|倾向)[：: ]*(.{2,60})/g, 'preference.stated'],
    [/(?:always|prefer|user likes)\s+(.{3,60})/gi, 'preference.stated'],
    [/(?:端口|port)\s*[=:：]?\s*(\d{2,5})/gi, 'preference.port'],
    [/(?:语言|yuYan|language)\s*[=:：]?\s*([a-zA-Z-]{2,8})/gi, 'preference.language'],
  ];
  for (const [re, key] of prefPatterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const zhi = String(m[1] || '').trim();
      if (!zhi) continue;
      preferences.push({ key, value: zhi.slice(0, 120), source: `archive:${shuRu.groupId}` });
      if (preferences.length >= 8) break;
    }
  }

  // 结构化提炼：决策/待办/风险/要点（不编造，只从文本模式匹配）
  const structured = tiQuJieGouHuaZhaiYao({
    groupId: shuRu.groupId,
    biaoTi: shuRu.biaoTi,
    ti: shuRu.summary,
  });
  const shouHang = shuRu.summary.split(/\n|\r/).map((s) => s.trim()).filter(Boolean)[0] || shuRu.biaoTi;
  const zhuJieguo = (structured.decisions[0] || structured.bullets[0] || shouHang).slice(0, 160);
  events.push({
    id: `ev-arc-${Date.now()}`,
    biaoTi: shuRu.biaoTi.slice(0, 100),
    result: zhuJieguo,
  });
  // 决策/待办进知识库事件（有界，避免爆炸）
  let extra = 0;
  for (const d of [...structured.decisions, ...structured.todos].slice(0, 4)) {
    if (d === zhuJieguo) continue;
    events.push({
      id: `ev-arc-${Date.now()}-${extra}`,
      biaoTi: d.slice(0, 80),
      result: d.slice(0, 160),
    });
    extra += 1;
  }

  return { entities, events, preferences };
}

/**
 * **使用者偏好独立配置**（产品要求：归档时整理到单独文件，格式化，门禁可约束）。
 *
 * **v3 软门禁格式**（行业通行：Constitutional AI / guardrails 都是「引导 + 可修正」而非一票否决）：
 * - 所有规则都是 **soft**：注入提示词引导，默认不拦截；
 * - 模型判断「异常由此门禁导致」时可 **skip**（带原因），归档时复盘改/删；
 * - 每条规则有 id / match / action / severity / status / skipHistory。
 *
 * ```json
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
 * ```
 * - action: advise（只提示） | warn（提示并记审计） | block（仍可被 skip 自愈）
 * - status: active | skipped（暂时跳过） | retired（归档复盘后删除）
 * - 归档时检查 skipped：分析 skipHistory，改 message/match 或 retired。
 */
export const PIAN_HAO_GE_SHI_SHUO_MING = 'user-preferences.json v3 soft-gate: {version,rules[{id,category,match,action,severity,message,status,skipHistory}],tools,workflow}';

/**
 * 供应商官方协议软门禁：来自各家官方 API 约定。
 * 只做 advise/warn，不替代运行时真实错误；目的是让模型在配置供应商时少走弯路。
 */
export const GONG_YING_SHANG_RUAN_MEN_JIN: RuanMenJinGuiZe[] = [
  { id: 'provider-openai-auth', category: 'model', match: { type: 'keyword', pattern: 'openai' }, action: 'warn', severity: 'medium', message: 'OpenAI 兼容接口通常使用 Authorization: Bearer <key>；聊天端点为 /v1/chat/completions。401/403 优先检查 key 与站点是否匹配，404 优先检查 baseURL 是否重复或缺少 /v1。', status: 'active', source: 'official-docs' },
  { id: 'provider-anthropic-auth', category: 'model', match: { type: 'keyword', pattern: 'anthropic' }, action: 'warn', severity: 'medium', message: 'Anthropic Messages API 使用 x-api-key 与 anthropic-version 请求头，端点为 /v1/messages；不要套用 OpenAI Bearer/chat-completions 形状。', status: 'active', source: 'official-docs' },
  { id: 'provider-ollama-local', category: 'model', match: { type: 'keyword', pattern: 'ollama' }, action: 'advise', severity: 'low', message: 'Ollama 原生根地址通常是 http://127.0.0.1:11434，不加 /v1；无需 API Key。连接拒绝时先确认 Ollama 服务与模型已启动。', status: 'active', source: 'official-docs' },
  { id: 'provider-mimo-site-key', category: 'model', match: { type: 'keyword', pattern: 'mimo' }, action: 'warn', severity: 'medium', message: 'MiMo token-plan 的 CN/SGP 站点 key 不通用；401 时先核对 key 所属站点。工具调用优先走流式，reasoning_content 与 content 要分别解析。', status: 'active', source: 'official-docs' },
  { id: 'provider-deepgram-asr', category: 'model', match: { type: 'keyword', pattern: 'deepgram' }, action: 'advise', severity: 'low', message: 'Deepgram 预录音转写：POST /v1/listen，Authorization: Token <key>，请求体为音频二进制；默认推荐 nova-3 + smart_format=true。', status: 'active', source: 'official-docs' },
  { id: 'provider-assemblyai-asr', category: 'model', match: { type: 'keyword', pattern: 'assemblyai' }, action: 'advise', severity: 'low', message: 'AssemblyAI 预录音需先 /v2/upload，再 POST /v2/transcript，最后轮询 /v2/transcript/{id}；Authorization 头直接放 key，不加 Bearer。', status: 'active', source: 'official-docs' },
];

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
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
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
}

export function heBingYongHuPianHao(
  userData: string,
  prefs: Array<{ key: string; value: string; source: string }>
): { ok: boolean; count: number; file: string } {
  const file = path.join(userData, 'user-preferences.json');
  try {
    fs.mkdirSync(userData, { recursive: true });
    let doc: {
      version: number; updatedAt: string;
      rules?: RuanMenJinGuiZe[];
      hard: Array<{ id: string; rule: string; level: string; source: string }>;
      prefer: Array<{ id: string; key: string; value: string; scope: string; confidence: number; source: string; updatedAt: number }>;
      tools: { allow: string[]; deny: string[]; confirm: string[] };
      files: { preferDir: string; naming: string };
      models: { prefer: string[]; avoid: string[] };
      workflow: { planFirst: boolean; askBeforeOpen: boolean; maxAutoContinue: number };
    } = {
      version: 3, updatedAt: new Date().toISOString(), rules: GONG_YING_SHANG_RUAN_MEN_JIN.map((r) => ({ ...r, match: { ...r.match } })),
      hard: [], prefer: [],
      tools: { allow: [], deny: [], confirm: [] },
      files: { preferDir: 'workspace', naming: '' },
      models: { prefer: [], avoid: [] },
      workflow: { planFirst: true, askBeforeOpen: true, maxAutoContinue: 4 },
    };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.version >= 3 && Array.isArray(raw.rules)) {
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
        }
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
      const id = `${p.key}:${p.value}`.slice(0, 160);
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
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
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
      const k = `${p.key}:${p.value}`.slice(0, 160);
      if (!map[k]) n += 1;
      map[k] = { value: p.value, source: p.source, updatedAt: Date.now() };
    }
    // 有界：最多 200 条偏好
    const keys = Object.keys(map).sort((a, b) => ((map[b] && map[b]!.updatedAt) || 0) - ((map[a] && map[a]!.updatedAt) || 0));
    const keep: typeof map = {};
    for (const k of keys.slice(0, 200)) {
      const v = map[k];
      if (v) keep[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify(keep, null, 2), 'utf8');
    return { ok: true, count: n, file };
  } catch {
    return { ok: false, count: 0, file };
  }
}


/** 结构化会话摘要：要点/决策/待办/风险（从近期日志文本提炼，不编造） */
export interface JieGouHuaZhaiYao {
  biaoTi: string;
  bullets: string[];
  decisions: string[];
  todos: string[];
  risks: string[];
  anchors: Array<{ file: string; seq: number }>;
}

export function tiQuJieGouHuaZhaiYao(shuRu: {
  groupId: string;
  biaoTi: string;
  ti: string;
  anchors?: Array<{ file: string; seq: number }>;
}): JieGouHuaZhaiYao {
  const HangJi = String(shuRu.ti || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bullets: string[] = [];
  const decisions: string[] = [];
  const todos: string[] = [];
  const risks: string[] = [];
  const DECID = /^(决定|定稿|结论|decision|decided|conclu|заключ|결정|決定)/i;
  const TODO = /^(待办|todo|next|下一步|задача|할 일|やること|待ち)/i;
  const RISK = /^(风险|注意|警告|risk|warning|注意|risk|рис|위험|注意)/i;
  for (const ln of HangJi.slice(-80)) {
    const ti = ln.replace(/^(user|assistant|system|wo|ai)\s*[:：]\s*/i, '').trim();
    if (!ti) continue;
    if (DECID.test(ti)) decisions.push(ti.slice(0, 200));
    else if (TODO.test(ti)) todos.push(ti.slice(0, 200));
    else if (RISK.test(ti)) risks.push(ti.slice(0, 200));
    else if (bullets.length < 8) bullets.push(ti.slice(0, 180));
  }
  return {
    biaoTi: String(shuRu.biaoTi || '').slice(0, 100),
    bullets,
    decisions: decisions.slice(0, 6),
    todos: todos.slice(0, 6),
    risks: risks.slice(0, 4),
    anchors: shuRu.anchors || [],
  };
}
