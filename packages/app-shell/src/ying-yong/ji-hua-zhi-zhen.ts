/** R292-5：计划题目/验收标准只读，证据指针必须可核实。纯校验，不持有文件系统或会话状态。 */
export interface JiHuaZhiZhenYiLai {
  hasTool: (name: string) => boolean;
  resolvePath: (rel: string) => string;
  isFile: (abs: string) => boolean;
  relativePath: (abs: string) => string;
}

export type JiHuaZhiZhenJieGuo =
  | { ok: true; zhi: string }
  | { ok: false; why: string };

export function jiHuaBiaoTiGuiYi(s: unknown): string {
  return String(s || '').replace(/[\s，。,.;；:：、!！?？"'“”‘’（）()【】[\]《》<>]/g, '').toLowerCase();
}

/** tool: 本次任务真实成功工具；path: 当前工作区内真实文件。 */
export function yanZhengJiHuaZhengJu(raw: unknown, yiLai: JiHuaZhiZhenYiLai): JiHuaZhiZhenJieGuo {
  const zhi = String(raw || '').trim();
  if (!zhi) return { ok: true, zhi: '' };
  if (zhi.length > 500) return { ok: false, why: '证据指针超过 500 字' };
  if (/^tool:/i.test(zhi)) {
    const body = zhi.slice(5);
    const m = /^([A-Za-z0-9_.:-]+)$/.exec(body);
    if (!m || !yiLai.hasTool(m[1]!)) return { ok: false, why: 'tool: 指针没有对应的本次任务成功工具记录' };
    return { ok: true, zhi: 'tool:' + body };
  }
  if (/^path:/i.test(zhi)) {
    try {
      const abs = yiLai.resolvePath(zhi.slice(5));
      if (!yiLai.isFile(abs)) return { ok: false, why: 'path: 指针指向的文件不存在' };
      return { ok: true, zhi: 'path:' + yiLai.relativePath(abs).replace(/\\/g, '/') };
    } catch {
      return { ok: false, why: 'path: 指针不在当前会话工作区内' };
    }
  }
  return { ok: false, why: '证据指针必须以 tool: 或 path: 开头' };
}

/** 已有步骤只允许 id/title 原样回传 + status/note/evidence；title/acceptance 不可改写。 */
export function jiHuaBuKeBian(
  old: { title?: string; acceptance?: string } | undefined,
  incoming: Record<string, unknown>,
): string[] {
  const allowed = ['id', 'title', 'acceptance', 'status', 'note', 'evidence'];
  const errors: string[] = [];
  if (Object.keys(incoming).some((k) => !allowed.includes(k))) {
    errors.push('包含未授权字段；步骤只允许 status/note/evidence');
  }
  if (!old) return errors;
  const title = String(incoming.title || '').trim();
  const acceptance = String(incoming.acceptance || '').trim();
  if (title && jiHuaBiaoTiGuiYi(title) !== jiHuaBiaoTiGuiYi(old.title)) {
    errors.push('title 已存在，模型不能改写');
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'acceptance') && acceptance !== String(old.acceptance || '').trim()) {
    errors.push('acceptance 已存在，模型不能改写');
  }
  return errors;
}
