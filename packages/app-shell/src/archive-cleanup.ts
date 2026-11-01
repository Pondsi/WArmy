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
/** 第 38 轮 项 5：`user-preferences.json` 已废弃并删除（只写不读的死路径；用户偏好统一进「印象」yinxiang.md）。 */


/**
 * 供应商官方协议软门禁：来自各家官方 API 约定。
 * 只做 advise/warn，不替代运行时真实错误；目的是让模型在配置供应商时少走弯路。
 */
export const GONG_YING_SHANG_RUAN_MEN_JIN: RuanMenJinGuiZe[] = [
  { id: 'provider-openai-auth', i18n: 'softGate.openaiAuth', category: 'model', match: { type: 'keyword', pattern: 'openai' }, action: 'warn', severity: 'medium', message: 'OpenAI 兼容接口通常使用 Authorization: Bearer <key>；聊天端点为 /v1/chat/completions。401/403 优先检查 key 与站点是否匹配，404 优先检查 baseURL 是否重复或缺少 /v1。', status: 'active', source: 'official-docs' },
  { id: 'provider-anthropic-auth', i18n: 'softGate.anthropicAuth', category: 'model', match: { type: 'keyword', pattern: 'anthropic' }, action: 'warn', severity: 'medium', message: 'Anthropic Messages API 使用 x-api-key 与 anthropic-version 请求头，端点为 /v1/messages；不要套用 OpenAI Bearer/chat-completions 形状。', status: 'active', source: 'official-docs' },
  { id: 'provider-ollama-local', i18n: 'softGate.ollamaLocal', category: 'model', match: { type: 'keyword', pattern: 'ollama' }, action: 'advise', severity: 'low', message: 'Ollama 原生根地址通常是 http://127.0.0.1:11434，不加 /v1；无需 API Key。连接拒绝时先确认 Ollama 服务与模型已启动。', status: 'active', source: 'official-docs' },
  { id: 'provider-mimo-site-key', i18n: 'softGate.mimoSiteKey', category: 'model', match: { type: 'keyword', pattern: 'mimo' }, action: 'warn', severity: 'medium', message: 'MiMo token-plan 的 CN/SGP 站点 key 不通用；401 时先核对 key 所属站点。工具调用优先走流式，reasoning_content 与 content 要分别解析。', status: 'active', source: 'official-docs' },
  { id: 'provider-deepgram-asr', i18n: 'softGate.deepgramAsr', category: 'model', match: { type: 'keyword', pattern: 'deepgram' }, action: 'advise', severity: 'low', message: 'Deepgram 预录音转写：POST /v1/listen，Authorization: Token <key>，请求体为音频二进制；默认推荐 nova-3 + smart_format=true。', status: 'active', source: 'official-docs' },
  { id: 'provider-assemblyai-asr', i18n: 'softGate.assemblyaiAsr', category: 'model', match: { type: 'keyword', pattern: 'assemblyai' }, action: 'advise', severity: 'low', message: 'AssemblyAI 预录音需先 /v2/upload，再 POST /v2/transcript，最后轮询 /v2/transcript/<id>；Authorization 头直接放 key，不加 Bearer。', status: 'active', source: 'official-docs' },
];

/** 软门禁规则（v3） */
export interface RuanMenJinGuiZe {
  id: string;
  /** 语言包里的键（界面展示用；缺了就用 message 原文） */
  i18n?: string;
  category: 'style' | 'tool' | 'file' | 'model' | 'workflow' | 'safety';
  match: { type: 'always' | 'regex' | 'keyword'; pattern: string };
  action: 'advise' | 'warn' | 'block';
  severity: 'low' | 'medium' | 'high';
  message: string;
  status: 'active' | 'skipped' | 'retired';
  source: string;
  skipHistory?: Array<{ at: number; by: string; reason: string }>;
}

/**
 * 模型自愈：把某条门禁标成「暂时跳过」（**不改原对象**，返回新的一条）。
 * v3 的关键就在这里：软门禁是可以被"这次先别管"的，但**必须留下痕迹**（谁跳的、为什么、什么时候），
 * 归档复盘时据此决定改规则还是删规则 —— 否则"软"就变成"没人再管"。
 */
export function biaoJiZanShiTiaoGuo(
  guiZe: RuanMenJinGuiZe,
  yuanYin: string,
  by: 'model' | 'user' | 'archive' = 'model',
): RuanMenJinGuiZe {
  const li = String(yuanYin || '').slice(0, 200);
  return {
    ...guiZe,
    status: 'skipped',
    skipHistory: [...(guiZe.skipHistory || []), { at: Date.now(), by, reason: li }],
  };
}

/** 归档复盘：把 skipped 的规则列出来供模型决定改/删（配 `skipHistory` 一起看） */
export function guiDangFuPanRuanMenJin(guiZeJi: readonly RuanMenJinGuiZe[] | null | undefined): RuanMenJinGuiZe[] {
  return (guiZeJi || []).filter((g) => g && g.status === 'skipped');
}

/**
 * 命中判定：`match.type` = always（永远命中）/ keyword（大小写不敏感包含）/ regex。
 * 只返回 **active** 的规则（skipped/retired 的不许再说话），并且**正则编译失败按不命中**处理
 * （一条坏规则不许把整张表废掉）。
 */
export function piPeiRuanMenJin(
  guiZeJi: readonly RuanMenJinGuiZe[] | null | undefined,
  wen: string,
): RuanMenJinGuiZe[] {
  const ben = String(wen || '');
  const chu: RuanMenJinGuiZe[] = [];
  for (const g of guiZeJi || []) {
    if (!g || g.status !== 'active') continue;
    const m = g.match || { type: 'always', pattern: '' };
    let ming = false;
    try {
      if (m.type === 'always') ming = true;
      else if (m.type === 'keyword') ming = !!m.pattern && ben.toLowerCase().includes(String(m.pattern).toLowerCase());
      else if (m.type === 'regex') ming = !!m.pattern && new RegExp(m.pattern, 'i').test(ben);
    } catch { ming = false; }
    if (ming) chu.push(g);
  }
  return chu;
}

/** 旧实现残留（不再使用） */


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
