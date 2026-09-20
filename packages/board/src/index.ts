/**
 * @warmy/board — 看板数据模型（ADR P6）
 * 用户不能直接写看板；仅值班者解析自然语言后写入 board.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';

export type KanbanLingLei =
  | 'create_task'
  | 'update_progress'
  | 'complete_task'
  | 'add_note'
  | 'block';

export interface KanbanShi {
  seq: number;
  ts: number;
  groupId: string;
  action: KanbanLingLei;
  title: string;
  progress?: number;
  note?: string;
  /** 解析来源：值班者从自然语言解析 */
  parsedFrom: string;
  /**
   * 可选父任务 id（= 父任务 title）。用于**轻量任务树**：
   * 不是第二套任务系统，只是看板任务的父子层级（进度条仍聚合 BoardTask）。
   * 约定：`新建任务 父任务 / 子任务` 或 `新建任务 父任务 > 子任务`
   */
  parentId?: string;
}

export interface KanbanRenwu {
  id: string;
  groupId: string;
  title: string;
  progress: number;
  status: 'todo' | 'doing' | 'done' | 'blocked';
  notes: string[];
  updatedAt: number;
  /** 父任务 id（无父 = 根任务） */
  parentId?: string;
}

/** 写入者唯一：仅 duty */
export type KanbanBi = 'duty';

export class KanbanCang {
  private seq = 0;
  private tasks = new Map<string, KanbanRenwu>();
  readonly jsonlPath: string;

  constructor(CangLu: string) {
    fs.mkdirSync(CangLu, { recursive: true });
    this.jsonlPath = path.join(CangLu, 'board.jsonl');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.jsonlPath)) return;
    const HangJi = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    for (const Hang of HangJi) {
      try {
        const ev = JSON.parse(Hang) as KanbanShi;
        this.seq = Math.max(this.seq, ev.seq);
        this.apply(ev);
      } catch {
        /* skip corrupt */
      }
    }
  }

  /** 仅 duty 可写（铁律） */
  append(ev: Omit<KanbanShi, 'seq' | 'ts'>, Bi: KanbanBi): KanbanShi {
    if (Bi !== 'duty') {
      throw Object.assign(new Error('board writer must be duty'), { code: 'WRITER' });
    }
    const Quan: KanbanShi = { ...ev, seq: ++this.seq, ts: Date.now() };
    fs.appendFileSync(this.jsonlPath, JSON.stringify(Quan) + '\n', 'utf8');
    this.apply(Quan);
    return Quan;
  }

  private apply(ev: KanbanShi): void {
    if (!ev || !ev.action) return;
    if (ev.action === 'create_task') {
      const parentFromNote = ev.note && String(ev.note).startsWith('parent:') ? String(ev.note).slice(7) : undefined;
      const parentId = ev.parentId || parentFromNote;
      this.tasks.set(ev.title, {
        id: ev.title,
        groupId: ev.groupId,
        title: ev.title,
        progress: 0,
        status: 'todo',
        notes: [],
        updatedAt: ev.ts,
        ...(parentId ? { parentId } : {}),
      });
      // 父任务若不存在，占位创建，便于树形显示
      if (parentId && !this.tasks.has(parentId)) {
        this.tasks.set(parentId, {
          id: parentId,
          groupId: ev.groupId,
          title: parentId,
          progress: 0,
          status: 'doing',
          notes: [],
          updatedAt: ev.ts,
        });
      }
      return;
    }
    const task = this.tasks.get(ev.title) || this.tasks.get(String(ev.title || '').replace(/ →.*/, ''));
    if (!task) return;
    task.updatedAt = ev.ts;
    if (ev.action === 'update_progress') {
      task.status = 'doing';
      if (typeof ev.progress === 'number') task.progress = ev.progress;
    } else if (ev.action === 'complete_task') {
      task.status = 'done';
      task.progress = 100;
    } else if (ev.action === 'block') {
      task.status = 'blocked';
      if (ev.note) task.notes.push(ev.note);
    } else if (ev.action === 'add_note') {
      if (ev.note) task.notes.push(ev.note);
    }
  }

  listTasks(groupId?: string): KanbanRenwu[] {
    return JuShu([...this.tasks.values()].filter((t) => !groupId || t.groupId === groupId));
  }

  /** 外部聚合：按会话汇总进展 */
  aggregateByGroup(): Array<{ groupId: string; taskCount: number; doing: number; done: number; avgProgress: number }> {
    const map = new Map<string, KanbanRenwu[]>();
    for (const t of this.tasks.values()) {
      if (!map.has(t.groupId)) map.set(t.groupId, []);
      map.get(t.groupId)!.push(t);
    }
    return [...map.entries()].map(([groupId, LieBiao]) => ({
      groupId,
      taskCount: LieBiao.length,
      doing: LieBiao.filter((x) => x.status === 'doing' || x.status === 'blocked').length,
      done: LieBiao.filter((x) => x.status === 'done').length,
      avgProgress: LieBiao.length
        ? Math.round(LieBiao.reduce((s, x) => s + x.progress, 0) / LieBiao.length)
        : 0,
    }));
  }

  tailEvents(limit = 20): KanbanShi[] {
    if (!fs.existsSync(this.jsonlPath)) return [];
    const HangJi = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    return HangJi
      .slice(-limit)
      .map((l) => JSON.parse(l) as KanbanShi)
      .reverse();
  }
}

/** 值班者：自然语言 → BoardAction 简易解析（P6 雏形） */
export function JieLing(text: string, groupId: string): Omit<KanbanShi, 'seq' | 'ts'> | null {
  const s = text.trim();
  let m = s.match(/^(?:新建任务|创建任务|create task)[:：\s]+(.+)$/i);
  if (m) {
    const YuanWen = m[1]!.trim();
    // 轻量任务树：父 / 子 或 父 > 子
    const Pian = YuanWen.split(/\s*[/>／]\s*/).map((x) => x.trim()).filter(Boolean);
    if (Pian.length >= 2) {
      const parent = Pian[0]!;
      const Zhi = Pian.slice(1).join(' / ');
      // 先确保存在父任务（幂等：已存在则不覆盖进度）
      return { groupId, action: 'create_task', title: Zhi, parentId: parent, parsedFrom: s, note: `parent:${parent}` };
    }
    return { groupId, action: 'create_task', title: YuanWen, parsedFrom: s };
  }
  m = s.match(/^(?:完成|complete)\s*(.+)$/i);
  if (m) return { groupId, action: 'complete_task', title: m[1]!, parsedFrom: s };
  m = s.match(/^(?:阻塞|block)\s*(.+?)(?:[:：]\s*(.+))?$/i);
  if (m) return { groupId, action: 'block', title: m[1]!, note: m[2], parsedFrom: s };
  m = s.match(/^(?:备注|note)\s*(.+?)[:：]\s*(.+)$/i);
  if (m) return { groupId, action: 'add_note', title: m[1]!, note: m[2], parsedFrom: s };
  m = s.match(/^(?:进度|progress)\s*(.+?)[:：]?\s*(\d{1,3})%?$/i);
  if (m) return { groupId, action: 'update_progress', title: m[1]!, progress: Math.min(100, +m[2]!), parsedFrom: s };
  return null;
}

/** 聚合：父任务进度 = 子任务平均（无子则用自身）——进度条继续用同一数据源 */
export function JuShu(tasks: KanbanRenwu[]): KanbanRenwu[] {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const ZhiJi = new Map<string, KanbanRenwu[]>();
  for (const t of byId.values()) {
    if (!t.parentId) continue;
    const LieBiao = ZhiJi.get(t.parentId) || [];
    LieBiao.push(t);
    ZhiJi.set(t.parentId, LieBiao);
  }
  for (const [pid, kids] of ZhiJi) {
    const parent = byId.get(pid);
    if (!parent) continue;
    const junzhi = Math.round(kids.reduce((s, k) => s + k.progress, 0) / kids.length);
    if (parent.status !== 'done') {
      parent.progress = junzhi;
      if (kids.every((k) => k.status === 'done')) parent.status = 'done';
      else if (kids.some((k) => k.status === 'blocked')) parent.status = 'blocked';
      else if (kids.some((k) => k.status === 'doing')) parent.status = 'doing';
    }
  }
  return [...byId.values()];
}
