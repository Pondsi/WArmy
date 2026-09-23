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
    fs.mkdirSync(CangLu, { recursive: true });
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

  private save(): void {
    fs.writeFileSync(
      this.storePath,
      JSON.stringify({ entities: [...this.entities.values()], events: [...this.events.values()] }, null, 2),
      'utf8'
    );
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
