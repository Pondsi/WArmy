/**
 * trash-store —— **最近删除的会话（48 小时可恢复）**。
 *
 * 产品口径（第 41 轮）：
 *   · 右击第二列图标删除会话**不再二次确认** —— 误删的成本由这张回收站兜住；
 *   · 设置页底部有「最近删除」区（默认折叠）：我的牛马 / 联系人 / 项目 / 群聊，
 *     带一段**截断的最近对话摘要**、删除时间、恢复与永久删除（永久删除才二次确认）；
 *   · 进回收站 **48 小时**后自动永久清理。
 *
 * 为什么放在主进程而不是渲染层：删除会同时清工作区、知识库、聊天日志，
 * 渲染层拿不到"删之前那份内容"的快照；只有主进程在动手之前才看得到全部。
 *
 * 纯 Node、无 Electron 依赖 —— 便于门禁直接 import 编译产物做断言。
 */
import fs from 'node:fs';
import path from 'node:path';

export type TrashKind = 'agent' | 'contact' | 'project' | 'group';

export interface TrashEntry {
  /** 原会话 id（恢复时按它写回） */
  id: string;
  kind: TrashKind;
  /** 界面显示名（删除那一刻的名字，之后原对象已经没了） */
  name: string;
  /** 最近对话摘要（**已截断**，不超过 `PREVIEW_MAX` 个字符） */
  preview: string;
  deletedAt: number;
  /** 恢复时需要的轻量数据（渲染层自己维护的会话壳） */
  payload: Record<string, unknown>;
}

export interface TrashFile {
  v: 1;
  items: TrashEntry[];
}

/** 回收站保留时长：48 小时 */
export const TRASH_TTL_MS = 48 * 60 * 60 * 1000;
/** 摘要硬上限：超出直接截断（产品要求"不能超出长度"） */
export const PREVIEW_MAX = 140;
/** 总条数上限，防止无限增长 */
const MAX_ITEMS = 200;

const KINDS: TrashKind[] = ['agent', 'contact', 'project', 'group'];

export function shiTrashKind(v: unknown): v is TrashKind {
  return KINDS.includes(String(v) as TrashKind);
}

/** 摘要截断（按字符，不按字节；末尾加省略号） */
export function jieZhiZhaiYao(text: unknown, max = PREVIEW_MAX): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const arr = Array.from(s);
  return arr.length <= max ? s : arr.slice(0, max - 1).join('') + '…';
}

export class TrashStore {
  constructor(private readonly file: string) {}

  private read(): TrashFile {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8')) as TrashFile;
      if (!j || !Array.isArray(j.items)) return { v: 1, items: [] };
      return { v: 1, items: j.items.filter((x) => x && shiTrashKind(x.kind) && x.id) };
    } catch {
      return { v: 1, items: [] };
    }
  }

  private write(items: TrashEntry[]): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const lin = this.file + '.tmp';
      fs.writeFileSync(lin, JSON.stringify({ v: 1, items } satisfies TrashFile, null, 1), 'utf8');
      fs.renameSync(lin, this.file);
    } catch {
      /* 写不进去不该把删除流程带崩；下次再试 */
    }
  }

  /** 丢掉超期的（48h）——读取与写入前都调，保证"自动清理"不依赖定时器 */
  purgeExpired(now = Date.now()): number {
    const { items } = this.read();
    const sheng = items.filter((x) => now - Number(x.deletedAt || 0) < TRASH_TTL_MS);
    const diao = items.length - sheng.length;
    if (diao) this.write(sheng);
    return diao;
  }

  add(e: Omit<TrashEntry, 'deletedAt' | 'preview'> & { preview?: unknown; deletedAt?: number }): TrashEntry {
    const now = Date.now();
    const items = this.read().items.filter((x) => !(x.id === e.id && x.kind === e.kind));
    const entry: TrashEntry = {
      id: String(e.id),
      kind: e.kind,
      name: String(e.name || e.id),
      preview: jieZhiZhaiYao(e.preview),
      deletedAt: Number(e.deletedAt) || now,
      payload: (e.payload && typeof e.payload === 'object') ? { ...e.payload } : {},
    };
    items.push(entry);
    // 先按时间淘汰超期的，再按条数截断（保最新的）
    const youXiao = items.filter((x) => now - Number(x.deletedAt || 0) < TRASH_TTL_MS);
    const jian = youXiao.length > MAX_ITEMS ? youXiao.slice(youXiao.length - MAX_ITEMS) : youXiao;
    this.write(jian);
    return entry;
  }

  /** 列表（新的在前）；读之前先把超期的清掉 */
  list(now = Date.now()): TrashEntry[] {
    this.purgeExpired(now);
    return this.read().items.slice().sort((a, b) => Number(b.deletedAt) - Number(a.deletedAt));
  }

  get(id: string, kind?: TrashKind): TrashEntry | null {
    const it = this.read().items.find((x) => x.id === String(id) && (!kind || x.kind === kind));
    return it ? { ...it, payload: { ...it.payload } } : null;
  }

  /** 从回收站移除（恢复成功后调用；永久删除也走它） */
  remove(id: string, kind?: TrashKind): boolean {
    const items = this.read().items;
    const sheng = items.filter((x) => !(x.id === String(id) && (!kind || x.kind === kind)));
    if (sheng.length === items.length) return false;
    this.write(sheng);
    return true;
  }

  clear(): void {
    this.write([]);
  }
}
