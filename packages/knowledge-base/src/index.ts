/**
 * @warmy/knowledge-base — 名称驱动 + 事件驱动 + 证据锚点
 * 双向索引：实体↔事件；统一检索 knowledge_query
 */
import fs from 'node:fs';
import path from 'node:path';
/** 证据锚点只有一份定义（契约 v1.1）：以前这里自己写了一份、还少了 byteOffset */
import type { ZhengjuMaodian } from '@warmy/contracts';
export type { ZhengjuMaodian };

/** 知识库三层（第 51 轮）：会话（全项目共用，可对外）/ 内部（业务与踩坑）/ 私密（仅用户本机） */
export type ZhishiCeng = 'session' | 'internal' | 'private';
export const ZHISHI_CENG: readonly ZhishiCeng[] = ['session', 'internal', 'private'];

export type ShitiLeixing = 'person' | 'org' | 'material' | 'place' | 'concept' | 'tool' | 'project';

export interface Shiti {
  id: string;
  kind: ShitiLeixing;
  ming: string;
  attrs: Record<string, string>;
  eventIds: string[];
  anchors: ZhengjuMaodian[];
  updatedAt: number;
  /** 实体第一次被记下的时刻（写一次不改；`updatedAt` 只反映最后一次改动） */
  chuangJianTs?: number;
}

export interface ZhishiShijian {
  id: string;
  biaoTi: string;
  tool?: string;
  method?: string;
  result?: string;
  expected?: string;
  entityIds: string[];
  anchors: ZhengjuMaodian[];
  ts: number;
  /**
   * **记录时间**（第 53 轮项 5）：这条信息**什么时候被说出来/写下来** —— 取原文那条消息的时刻，
   * 不是 `Date.now()`。写一次不再改（重新索引、补写、整理都不能覆盖它）。缺省时回落到 `ts`。
   */
  jiluTs?: number;
  /** **发生时间**：事情本身发生在什么时候，只有原文真写了才填（精度只到月/年时取区间起点） */
  fashengTs?: number;
  /** 原文里那句时间表述（"上个月5号"），一字不改留着，回复时可直接引用 */
  fashengBiao?: string;
  /** 发生时间的精度：日 / 月 / 年 / 无（"最近、以前"这类一律留 'wu'，不猜） */
  fashengJingDu?: 'ri' | 'yue' | 'nian' | 'wu';
  /**
   * 发生时间的来源：`stated`=原文真的说了；`none`=没说（**绝不"默认成现在"** ——
   * Graphiti 早期就犯过这毛病：回填的对话被全部标成入库时间，issue #1489）。
   */
  fashengLaiYuan?: 'stated' | 'none';
  /**
   * 原文那行的**单调序号**（同一毫秒内、或 Windows 时钟被 NTP 往回拨时，顺序以它为准；
   * 时间戳只做标签，不做定序依据 —— 这是双时态系统与流式处理的共识：Lamport/HLC/Kafka 的 event/ingestion 时间三分）。
   */
  xuHao?: number;
  /**
   * **溯源与版本**（第 53 轮项 4，对齐 W3C PROV 的 wasGeneratedBy/wasDerivedFrom）：
   * 哪次归档、哪个模型、哪一版提示词产出的 —— 升级或源被删时据此重算派生层，而不是就地瞎改。
   */
  laiYuan?: string;
  moXing?: string;
  tiShiCiBanBen?: string;
  /** 派生条目（如会话库的脱敏概要）指向它的源条目 id；源变更时这条变陈旧并重建 */
  yinZi?: string[];
  /**
   * 写入时**取代**了哪些旧说法（同一层 + 同一标题 + 有共同实体）。
   * 与 `yinZi` 区分：`yinZi` 是"我由谁派生"，`quDaiIds` 是"我把谁的说法顶掉了"——
   * 审计要回答"这条为什么现在是这个版本"，靠的是后者（第 53 轮补）。
   */
  quDaiIds?: string[];
  /** 被更新的说法取代时置时间戳（**不物理删除**，保留可审计的历史） */
  shiXiaoTs?: number;
  /**
   * **被模型实际检索命中过多少次**（第 93 轮）：只统计 `knowledge_query` 真正把这条交给模型的次数，
   * 不统计写入、UI 浏览、归档整理。短记忆用它决定“先留谁、先删谁”。
   */
  useCount?: number;
  /** 最后一次被检索命中的时刻（epoch ms） */
  lastUsedAt?: number;
  /**
   * **最近若干次检索命中的时刻**（第 96 轮，最多 64 条）：
   * 短记忆的“使用频率”要看窗口内/带时间衰减的次数，单靠 useCount + lastUsedAt 推不出来。
   * 只存时间戳，不存查询词/正文；封顶 64 条防止长跑无限膨胀。
   */
  useLog?: number[];
}

export class KnowledgeBase {
  private entities = new Map<string, Shiti>();
  private events = new Map<string, ZhishiShijian>();
  readonly ceng: ZhishiCeng;

  constructor(private CangLu: string, ceng: ZhishiCeng = 'session') {
    this.ceng = ZHISHI_CENG.includes(ceng) ? ceng : 'session';
    // 目录建不出来也不许把应用带崩（下次写盘会自动重试重建）
    try { fs.mkdirSync(CangLu, { recursive: true }); } catch { /* 稍后 save() 自愈 */ }
    this.load();
  }

  private get storePath() {
    return path.join(this.CangLu, `knowledge-${this.ceng}.json`);
  }

  private load(): void {
    try {
      const j = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      for (const e of j.entities || []) this.entities.set(e.id, e);
      for (const e of j.events || []) this.events.set(e.id, e);
    } catch {
      /* fresh */
    }
  }

  /**
   * **写盘自愈**（第 32 轮 项 11 的真因）。
   *
   * 真机事故：宿主预置/首启清理会把 userData 下的子目录整片移走（`knowledge/` 就是其中之一），
   * 而构造器里的 `mkdirSync` **只在启动时跑一次** ⇒ 目录一旦消失就再也不会重建，
   * 之后**每一轮、每一个模型**都在这里抛 `ENOENT: no such file or directory, open '…knowledge.json'`。
   * 上层把它当成"模型调用失败"⇒ 调用链一路换模型、全部同样失败 ⇒ 永远出不了最终回复
   * （用户看到的就是"计划任务都完成了，却没有最终回复，换个模型也没用"）。
   *
   * 现在与 `audit.ts` 同一套做法：目录不在就重建再写；仍失败则**降级为不落盘**（内存里的知识仍在），
   * 绝不让"存知识"这件事把整轮对话带崩。
   */
  private save(): void {
    const xie = () => fs.writeFileSync(
      this.storePath,
      JSON.stringify({ entities: [...this.entities.values()], events: [...this.events.values()] }, null, 2),
      'utf8'
    );
    try {
      xie();
      return;
    } catch {
      /* 目录可能被外力清掉：重建一次再试 */
    }
    try {
      fs.mkdirSync(this.CangLu, { recursive: true });
      xie();
    } catch {
      /* 仍写不进去 ⇒ 如实放弃落盘（内存里的内容不丢，下次成功时再写） */
    }
  }

  upsertEntity(partial: Omit<Shiti, 'updatedAt' | 'eventIds'> & { eventIds?: string[] }): Shiti {
    const prev = this.entities.get(partial.id);
    const e: Shiti = {
      ...prev,
      ...partial,
      eventIds: partial.eventIds || prev?.eventIds || [],
      anchors: partial.anchors || prev?.anchors || [],
      updatedAt: Date.now(),
      /** 首次落地才记创建时间（与事件侧的"记录时间写一次"同一口径） */
      chuangJianTs: prev?.chuangJianTs ?? partial.chuangJianTs ?? Date.now(),
    };
    this.entities.set(e.id, e);
    this.save();
    return e;
  }

  /** 删除实体（并解除事件里的引用） */
  removeEntity(id: string): boolean {
    if (!this.entities.has(id)) return false;
    this.entities.delete(id);
    for (const Shi of this.events.values()) {
      const i = Shi.entityIds.indexOf(id);
      if (i >= 0) Shi.entityIds.splice(i, 1);
    }
    this.save();
    return true;
  }

  /** 删除事件（并解除实体里的引用） */
  removeEvent(id: string): boolean {
    if (!this.events.has(id)) return false;
    this.events.delete(id);
    for (const tiaoMu of this.entities.values()) {
      const i = tiaoMu.eventIds.indexOf(id);
      if (i >= 0) tiaoMu.eventIds.splice(i, 1);
    }
    this.save();
    return true;
  }

  addEvent(Shi: ZhishiShijian): ZhishiShijian {
    /**
     * **记录时间写一次就不再改**（第 53 轮项 5）：重新归档、补写、整理都可能带着"现在的时刻"再进来一次，
     * 若让它覆盖旧值，"这条信息什么时候被说出"就退化成"最后一次被机器碰过的时间"，
     * 用户问"昨天我们聊到哪了"就会得到错的轴。
     */
    const jiu = this.events.get(Shi.id);
    const jiluTs = jiu?.jiluTs ?? Shi.jiluTs ?? Shi.ts;
    this.events.set(Shi.id, { ...jiu, ...Shi, jiluTs });
    for (const shitiId of Shi.entityIds) {
      const tiaoMu = this.entities.get(shitiId);
      if (tiaoMu && !tiaoMu.eventIds.includes(Shi.id)) {
        tiaoMu.eventIds.push(Shi.id);
        tiaoMu.updatedAt = Date.now();
      }
    }
    this.save();
    return this.events.get(Shi.id)!;
  }

  /**
   * **取代而不是删除**（第 53 轮项 4）：新说法命中旧说法时只给旧条目打 `shiXiaoTs`，
   * 历史仍可审计（Graphiti/Zep 的双时态做法；Mem0 的纯 append-only 已被反证会检索出陈旧矛盾）。
   */
  supersedeEvent(id: string, shiXiaoTs = Date.now()): boolean {
    const Shi = this.events.get(id);
    if (!Shi || Shi.shiXiaoTs) return false;
    this.events.set(id, { ...Shi, shiXiaoTs });
    this.save();
    return true;
  }

  /** 只取仍在生效的事件（被取代的默认不进上下文） */
  activeEvents(): ZhishiShijian[] {
    return [...this.events.values()].filter((e) => !e.shiXiaoTs);
  }

  /**
   * **记一次“被用”**（第 93 轮）：短记忆要按使用频率留高频、删低频，
   * 这个计数必须只在**真的把内容交给模型**时累加。批量写一次盘，避免每条都 fsync。
   */
  noteUse(ids: readonly string[], at = Date.now()): number {
    let n = 0;
    for (const id of ids) {
      const e = this.events.get(String(id || ''));
      if (!e) continue;
      const useLog = [...(Array.isArray(e.useLog) ? e.useLog : []), at].slice(-64);
      this.events.set(e.id, {
        ...e,
        useCount: (Number(e.useCount) || 0) + 1,
        lastUsedAt: at,
        useLog,
      });
      n += 1;
    }
    if (n) this.save();
    return n;
  }

  /** 实体 → 事件 */
  eventsOfEntity(entityId: string): ZhishiShijian[] {
    const e = this.entities.get(entityId);
    if (!e) return [];
    return e.eventIds.map((id) => this.events.get(id)).filter(Boolean) as ZhishiShijian[];
  }

  /** 事件 → 实体 */
  entitiesOfEvent(eventId: string): Shiti[] {
    const Shi = this.events.get(eventId);
    if (!Shi) return [];
    return Shi.entityIds.map((id) => this.entities.get(id)).filter(Boolean) as Shiti[];
  }

  /** 统一检索入口 */
  query(q: string): { entities: Shiti[]; events: ZhishiShijian[] } {
    const s = q.trim().toLowerCase();
    const entities = [...this.entities.values()].filter(
      (e) => e.ming.toLowerCase().includes(s) || JSON.stringify(e.attrs).toLowerCase().includes(s)
    );
    const events = [...this.events.values()].filter(
      (e) =>
        e.biaoTi.toLowerCase().includes(s) ||
        (e.result || '').toLowerCase().includes(s) ||
        (e.tool || '').toLowerCase().includes(s)
    );
    return { entities, events };
  }

  listEntities(kind?: ShitiLeixing): Shiti[] {
    return [...this.entities.values()].filter((e) => !kind || e.kind === kind);
  }
}

/**
 * **三层知识库**（第 51 轮）：会话 / 内部 / 私密。
 *
 * 作用域矩阵（硬门禁 verify-kb-scope 钉住）：
 *  · 群聊（external group）：**只读会话层**（禁内部/私密）
 *  · 项目（internal group）：**会话 + 内部**（禁私密）
 *  · 我的牛马（单实例、用户本人）：**三层都可读写**
 *
 * 会话层是所有会话共用互通的那一层；内部层是本项目/本机的业务与踩坑；
 * 私密层只有用户本人可见，任何非本机牛马与外部人都不得读取或输出。
 */
export class ZhishiCang {
  readonly session: KnowledgeBase;
  readonly internal: KnowledgeBase;
  readonly private: KnowledgeBase;
  constructor(dir: string) {
    this.session = new KnowledgeBase(dir, 'session');
    this.internal = new KnowledgeBase(dir, 'internal');
    this.private = new KnowledgeBase(dir, 'private');
  }
  allow(ceng: ZhishiCeng) {
    return ceng === 'session' ? this.session : ceng === 'internal' ? this.internal : this.private;
  }
  queryLayers(layers: readonly ZhishiCeng[], q: string) {
    const out = { entities: [] as Array<Shiti & { _ceng?: ZhishiCeng }>, events: [] as Array<ZhishiShijian & { _ceng?: ZhishiCeng }> };
    for (const c of layers) {
      const kb = this.allow(c);
      const r = kb.query(q);
      out.entities.push(...r.entities.map((e) => ({ ...e, _ceng: c })));
      out.events.push(...r.events.map((e) => ({ ...e, _ceng: c })));
    }
    return out;
  }
  /** 本会话有权读的层里，所有仍在生效的事件（带 _ceng，便于按层回溯） */
  activeEventsIn(layers: readonly ZhishiCeng[]): Array<ZhishiShijian & { _ceng: ZhishiCeng }> {
    const out: Array<ZhishiShijian & { _ceng: ZhishiCeng }> = [];
    for (const c of layers) out.push(...this.allow(c).activeEvents().map((e) => ({ ...e, _ceng: c })));
    return out;
  }
  /** 把“本次检索真的交给模型”的事件按层累加使用次数 */
  noteUse(items: ReadonlyArray<{ id?: string; _ceng?: ZhishiCeng }>, at = Date.now()): number {
    const by = new Map<ZhishiCeng, string[]>();
    for (const it of items) {
      const id = String(it?.id || '');
      const c = it?._ceng;
      if (!id || !c) continue;
      const arr = by.get(c) || [];
      arr.push(id);
      by.set(c, arr);
    }
    let n = 0;
    for (const [c, ids] of by) n += this.allow(c).noteUse(ids, at);
    return n;
  }
}