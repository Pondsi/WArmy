/**
 * R287 P3-2：工具授权仓唯一 owner（自 electron-main 迁出，行为保持）。
 *  · 工具启停表（设置→工具）：默认可见，显式 false 才隐藏；
 *  · 会话授权卡：按「路径＋读写类别」记（写覆盖读、读不覆盖写），同路径换工具不再问；
 *  · 附件只读授权（du:true + cls:'read'，精确路径）；老条目（无 cls）不自动放行写；
 *  · 懒加载：设置仓就绪前不置位，首次读写时再读回，与内存按键合并不丢任何一边；
 *  · 落盘走设置仓 authGrants；变更广播 warmy:shouQuanUpdated。
 * 构造无副作用；平台能力（设置仓/广播/别名表/用户文件夹映射/时钟/随机）窄注入。
 */
import path from 'node:path';

export type ShouQuanTiao = {
  id: string; text: string; ts: number; path?: string;
  /** 项 10：用户附件带来的"只读"授权（精确路径） */
  du?: boolean;
  /** 第 36 轮【项 6】：权限类别 —— 'read' 只覆盖只读工具，'write' 覆盖读+写 */
  cls?: 'read' | 'write';
  /** 这条授权是**对某个路径**的（按路径匹配，不按工具名） */
  luJingQuan?: boolean;
};

export interface GongJuShouQuanYiLai {
  /** 设置仓读（仓未就绪 ⇒ undefined，与旧 settingsStore?.load() 同语义） */
  duSheZhi: () => Record<string, unknown> | undefined;
  /** 设置仓写（仓未就绪时调用方 noop） */
  xieSheZhi: (patch: Record<string, unknown>) => void;
  guangBo: (tongDao: string, shuJu: unknown) => void;
  /** 步骤别名表（create_file→write_file 等） */
  buZhouBieMing: Record<string, string>;
  /** Desktop/… 系统文件夹别名映射 */
  yingSheWenJianJia: (raw: string) => { abs: string; rest: string } | null;
  shiZhong?: () => number;
  suiJi?: () => number;
}

/**
 * 只读工具集合（授权分档用）。
 * 与聊天循环里那份 `ZHI_DU_CHONG_FU` 同口径（两边都只增不改，语义一致）。
 */
const ZHI_DU_GONG_JU_MING = new Set([
  'read_file', 'list_dir', 'find_files', 'search_files', 'list_archive', 'read_archive_entry',
  'read_document', 'read_docx', 'read_pptx', 'read_xlsx', 'read_pdf', 'read_skill', 'read_profile',
  'lsp_diagnostics', 'check_safety', 'monitor_process', 'list_subagents', 'list_plans',
]);

export function chuangJianGongJuShouQuan(yiLai: GongJuShouQuanYiLai) {
  const shiZhong = yiLai.shiZhong || (() => Date.now());
  const suiJi = yiLai.suiJi || (() => Math.random());
  const shouQuanCang = new Map<string, ShouQuanTiao[]>();
  let shouQuanYiHuiFu = false;

  function gongJuQiYongBiao(): Record<string, boolean> {
    try {
      const s = yiLai.duSheZhi() as { toolEnabled?: Record<string, boolean> } | undefined;
      return s?.toolEnabled && typeof s.toolEnabled === 'object' ? { ...s.toolEnabled } : {};
    } catch { return {}; }
  }
  /** 这个工具对模型可见吗（默认可见；显式 false 才隐藏） */
  function gongJuKeJian(ming: string): boolean {
    return gongJuQiYongBiao()[String(ming)] !== false;
  }
  function shouQuanHuiFu(): void {
    /* 与旧版同序：仓未就绪（undefined）⇒ 不置位；仓在但读失败 ≡ 读空（置位后继续，不丢内存侧） */
    let s: Record<string, unknown> | undefined;
    try { s = yiLai.duSheZhi(); } catch { s = {}; }
    if (s === undefined) return;
    shouQuanYiHuiFu = true;
    try {
      const all = (s?.authGrants && typeof s.authGrants === 'object') ? s.authGrants as Record<string, unknown> : {};
      for (const [sid, list] of Object.entries(all)) {
        if (!Array.isArray(list)) continue;
        const he = (list as ShouQuanTiao[]).filter((x) => x && typeof x.text === 'string');
        for (const x of shouQuanCang.get(sid) || []) if (!he.some((y) => y.text === x.text)) he.push(x);
        shouQuanCang.set(sid, he);
      }
    } catch { /* noop */ }
  }
  function shouQuanQu(sid: string): ShouQuanTiao[] {
    if (!shouQuanYiHuiFu) shouQuanHuiFu();
    return shouQuanCang.get(String(sid)) || [];
  }
  /** 授权按「路径＋读写类别」记：写覆盖读，读不覆盖写；同路径换任何工具都不再问。 */
  function gongJuQuanLei(gongJu: string): 'read' | 'write' {
    const m = yiLai.buZhouBieMing[gongJu] || gongJu;
    return ZHI_DU_GONG_JU_MING.has(m) ? 'read' : 'write';
  }
  /** 授权卡里有没有一条"覆盖这次请求"的路径授权 */
  function luJingQuanPiPei(sid: string, abs: string, yao: 'read' | 'write'): ShouQuanTiao | null {
    let mu = '';
    try { mu = path.resolve(String(abs || '')); } catch { return null; }
    if (!mu) return null;
    for (const x of shouQuanQu(sid)) {
      const px = String((x as { path?: string }).path || '');
      if (!px) continue;
      let pu = '';
      try { pu = path.resolve(px); } catch { continue; }
      if (pu !== mu) continue;
      const c = (x as { cls?: string }).cls;
      if (c === 'write') return x;
      if (c === 'read') return yao === 'read' ? x : null;
      /** 老条目（没有 cls）：附件带来的 du 只算读；其它老条目按"一次性"看待，不自动放行 */
      if ((x as { du?: boolean }).du && yao === 'read') return x;
    }
    return null;
  }
  /** 把一次批准记成路径授权（同路径同类别只留一条） */
  function jiLuLuJingQuan(sid: string, abs: string, yao: 'read' | 'write'): void {
    try {
      let mu = '';
      try { mu = path.resolve(String(abs || '')); } catch { return; }
      if (!mu) return;
      const list = shouQuanQu(sid);
      const yiYou = list.find((x) => String((x as { path?: string }).path || '') && path.resolve(String((x as { path?: string }).path)) === mu
        && ((x as { cls?: string }).cls === yao || ((x as { cls?: string }).cls === 'write' && yao === 'read')));
      if (yiYou) return;
      list.push({
        id: 'lu-' + shiZhong() + '-' + Math.floor(suiJi() * 1000),
        text: (yao === 'write' ? '允许读写：' : '允许读取：') + mu,
        ts: shiZhong(),
        path: mu,
        cls: yao,
        luJingQuan: true,
      } as never);
      shouQuanCun(sid, list);
    } catch { /* 记账失败不影响放行 */ }
  }
  /** 授权条目的完整绝对路径：新条目登记时就存了 path；旧条目从键里解析，`Desktop/…` 映射到系统真实文件夹 */
  function shouQuanLuQuan(x: { text?: string; path?: string }): string {
    const cun = String(x.path || '').trim();
    if (cun) return cun;
    const m = /(?:路径|path)[:：]\s*(.+?)(?:\s*[（(]拒绝|\s*$)/im.exec(String(x.text || ''));
    const p0 = m && m[1] ? m[1].trim() : '';
    if (!p0) return '';
    if (/^[a-zA-Z]:[\\/]/.test(p0) || p0.startsWith('/') || p0.startsWith('\\\\')) return p0;
    try {
      const ys = yiLai.yingSheWenJianJia(p0);
      if (ys) return ys.rest ? path.join(ys.abs, ys.rest) : ys.abs;
    } catch { /* 映射不了就原样给 */ }
    return p0;
  }
  function shouQuanCun(sid: string, list: ShouQuanTiao[]): void {
    if (!shouQuanYiHuiFu) shouQuanHuiFu();
    shouQuanCang.set(String(sid), list);
    try {
      const s = (yiLai.duSheZhi() as { authGrants?: Record<string, unknown> } | undefined) || {};
      const all = (s.authGrants && typeof s.authGrants === 'object') ? { ...s.authGrants } : {};
      all[String(sid)] = list;
      yiLai.xieSheZhi({ authGrants: all });
    } catch { /* 落盘失败不影响本次 */ }
    try { yiLai.guangBo('warmy:shouQuanUpdated', { sessionId: String(sid) }); } catch { /* noop */ }
  }

  return {
    gongJuQiYongBiao, gongJuKeJian, gongJuQuanLei,
    shouQuanQu, luJingQuanPiPei, jiLuLuJingQuan, shouQuanLuQuan, shouQuanCun, shouQuanHuiFu,
  };
}
