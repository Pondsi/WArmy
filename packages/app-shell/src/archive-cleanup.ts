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

/** 使用者偏好：userData/user-preferences.json（覆盖式 + 去重 key） */
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
