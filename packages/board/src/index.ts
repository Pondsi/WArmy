/**
 * @warmy/board — 看板数据模型（ADR P6）
 * 用户不能直接写看板；仅值班者解析自然语言后写入 board.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';

export type BoardActionType =
  | 'create_task'
  | 'update_progress'
  | 'complete_task'
  | 'add_note'
  | 'block';

export interface BoardEvent {
  seq: number;
  ts: number;
  groupId: string;
  action: BoardActionType;
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

export interface BoardTask {
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
export type BoardWriter = 'duty';

export class BoardStore {
  private seq = 0;
  private tasks = new Map<string, BoardTask>();
  readonly jsonlPath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.jsonlPath = path.join(dataDir, 'board.jsonl');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.jsonlPath)) return;
    const lines = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as BoardEvent;
        this.seq = Math.max(this.seq, ev.seq);
        this.apply(ev);
      } catch {
        /* skip corrupt */
      }
    }
  }

  /** 仅 duty 可写（铁律） */
  append(ev: Omit<BoardEvent, 'seq' | 'ts'>, writer: BoardWriter): BoardEvent {
    if (writer !== 'duty') {
      throw Object.assign(new Error('board writer must be duty'), { code: 'WRITER' });
    }
    const full: BoardEvent = { ...ev, seq: ++this.seq, ts: Date.now() };
    fs.appendFileSync(this.jsonlPath, JSON.stringify(full) + '\n', 'utf8');
    this.apply(full);
    return full;
  }

  private apply(ev: BoardEvent): void {
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

  listTasks(groupId?: string): BoardTask[] {
    return withTreeAggregation([...this.tasks.values()].filter((t) => !groupId || t.groupId === groupId));
  }

  /** 外部聚合：按会话汇总进展 */
  aggregateByGroup(): Array<{ groupId: string; taskCount: number; doing: number; done: number; avgProgress: number }> {
    const map = new Map<string, BoardTask[]>();
    for (const t of this.tasks.values()) {
      if (!map.has(t.groupId)) map.set(t.groupId, []);
      map.get(t.groupId)!.push(t);
    }
    return [...map.entries()].map(([groupId, list]) => ({
      groupId,
      taskCount: list.length,
      doing: list.filter((x) => x.status === 'doing' || x.status === 'blocked').length,
      done: list.filter((x) => x.status === 'done').length,
      avgProgress: list.length
        ? Math.round(list.reduce((s, x) => s + x.progress, 0) / list.length)
        : 0,
    }));
  }

  tailEvents(limit = 20): BoardEvent[] {
    if (!fs.existsSync(this.jsonlPath)) return [];
    const lines = fs.readFileSync(this.jsonlPath, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as BoardEvent)
      .reverse();
  }
}

/** 值班者：自然语言 → BoardAction 简易解析（P6 雏形） */
export function parseBoardCommand(text: string, groupId: string): Omit<BoardEvent, 'seq' | 'ts'> | null {
  const s = text.trim();
  let m = s.match(/^(?:新建任务|创建任务|create task)[:：\s]+(.+)$/i);
  if (m) {
    const raw = m[1]!.trim();
    // 轻量任务树：父 / 子 或 父 > 子
    const parts = raw.split(/\s*[/>／]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const parent = parts[0]!;
      const child = parts.slice(1).join(' / ');
      // 先确保存在父任务（幂等：已存在则不覆盖进度）
      return { groupId, action: 'create_task', title: child, parentId: parent, parsedFrom: s, note: `parent:${parent}` };
    }
    return { groupId, action: 'create_task', title: raw, parsedFrom: s };
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
export function withTreeAggregation(tasks: BoardTask[]): BoardTask[] {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const children = new Map<string, BoardTask[]>();
  for (const t of byId.values()) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId) || [];
    list.push(t);
    children.set(t.parentId, list);
  }
  for (const [pid, kids] of children) {
    const parent = byId.get(pid);
    if (!parent) continue;
    const avg = Math.round(kids.reduce((s, k) => s + k.progress, 0) / kids.length);
    if (parent.status !== 'done') {
      parent.progress = avg;
      if (kids.every((k) => k.status === 'done')) parent.status = 'done';
      else if (kids.some((k) => k.status === 'blocked')) parent.status = 'blocked';
      else if (kids.some((k) => k.status === 'doing')) parent.status = 'doing';
    }
  }
  return [...byId.values()];
}
