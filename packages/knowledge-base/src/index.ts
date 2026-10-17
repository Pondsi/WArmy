/**
 * @warmy/knowledge-base — 名称驱动 + 事件驱动 + 证据锚点
 * 双向索引：实体↔事件；统一检索 knowledge_query
 */
import fs from 'node:fs';
import path from 'node:path';

export type ShitiLeixing = 'person' | 'org' | 'material' | 'place' | 'concept' | 'tool' | 'project';

export interface ZhengjuMaodian {
  file: string;
  seq: number;
  recordId: string;
}

export interface Shiti {
  id: string;
  kind: ShitiLeixing;
  ming: string;
  attrs: Record<string, string>;
  eventIds: string[];
  anchors: ZhengjuMaodian[];
  updatedAt: number;
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
}

export class KnowledgeBase {
  private entities = new Map<string, Shiti>();
  private events = new Map<string, ZhishiShijian>();

  constructor(private CangLu: string) {
    // 目录建不出来也不许把应用带崩（下次写盘会自动重试重建）
    try { fs.mkdirSync(CangLu, { recursive: true }); } catch { /* 稍后 save() 自愈 */ }
    this.load();
  }

  private get storePath() {
    return path.join(this.CangLu, 'knowledge.json');
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
    this.events.set(Shi.id, Shi);
    for (const shitiId of Shi.entityIds) {
      const tiaoMu = this.entities.get(shitiId);
      if (tiaoMu && !tiaoMu.eventIds.includes(Shi.id)) {
        tiaoMu.eventIds.push(Shi.id);
        tiaoMu.updatedAt = Date.now();
      }
    }
    this.save();
    return Shi;
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
