/**
 * @warmy/knowledge-base — 名称驱动 + 事件驱动 + 证据锚点
 * 双向索引：实体↔事件；统一检索 knowledge_query
 */
import fs from 'node:fs';
import path from 'node:path';

export type EntityKind = 'person' | 'org' | 'material' | 'place' | 'concept' | 'tool' | 'project';

export interface EvidenceAnchor {
  file: string;
  seq: number;
  recordId: string;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  attrs: Record<string, string>;
  eventIds: string[];
  anchors: EvidenceAnchor[];
  updatedAt: number;
}

export interface KnowledgeEvent {
  id: string;
  title: string;
  tool?: string;
  method?: string;
  result?: string;
  expected?: string;
  entityIds: string[];
  anchors: EvidenceAnchor[];
  ts: number;
}

export class KnowledgeBase {
  private entities = new Map<string, Entity>();
  private events = new Map<string, KnowledgeEvent>();

  constructor(private dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private get storePath() {
    return path.join(this.dataDir, 'knowledge.json');
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

  upsertEntity(partial: Omit<Entity, 'updatedAt' | 'eventIds'> & { eventIds?: string[] }): Entity {
    const prev = this.entities.get(partial.id);
    const e: Entity = {
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
    for (const ev of this.events.values()) {
      const i = ev.entityIds.indexOf(id);
      if (i >= 0) ev.entityIds.splice(i, 1);
    }
    this.save();
    return true;
  }

  /** 删除事件（并解除实体里的引用） */
  removeEvent(id: string): boolean {
    if (!this.events.has(id)) return false;
    this.events.delete(id);
    for (const ent of this.entities.values()) {
      const i = ent.eventIds.indexOf(id);
      if (i >= 0) ent.eventIds.splice(i, 1);
    }
    this.save();
    return true;
  }

  addEvent(ev: KnowledgeEvent): KnowledgeEvent {
    this.events.set(ev.id, ev);
    for (const eid of ev.entityIds) {
      const ent = this.entities.get(eid);
      if (ent && !ent.eventIds.includes(ev.id)) {
        ent.eventIds.push(ev.id);
        ent.updatedAt = Date.now();
      }
    }
    this.save();
    return ev;
  }

  /** 实体 → 事件 */
  eventsOfEntity(entityId: string): KnowledgeEvent[] {
    const e = this.entities.get(entityId);
    if (!e) return [];
    return e.eventIds.map((id) => this.events.get(id)).filter(Boolean) as KnowledgeEvent[];
  }

  /** 事件 → 实体 */
  entitiesOfEvent(eventId: string): Entity[] {
    const ev = this.events.get(eventId);
    if (!ev) return [];
    return ev.entityIds.map((id) => this.entities.get(id)).filter(Boolean) as Entity[];
  }

  /** 统一检索入口 */
  query(q: string): { entities: Entity[]; events: KnowledgeEvent[] } {
    const s = q.trim().toLowerCase();
    const entities = [...this.entities.values()].filter(
      (e) => e.name.toLowerCase().includes(s) || JSON.stringify(e.attrs).toLowerCase().includes(s)
    );
    const events = [...this.events.values()].filter(
      (e) =>
        e.title.toLowerCase().includes(s) ||
        (e.result || '').toLowerCase().includes(s) ||
        (e.tool || '').toLowerCase().includes(s)
    );
    return { entities, events };
  }

  listEntities(kind?: EntityKind): Entity[] {
    return [...this.entities.values()].filter((e) => !kind || e.kind === kind);
  }
}
