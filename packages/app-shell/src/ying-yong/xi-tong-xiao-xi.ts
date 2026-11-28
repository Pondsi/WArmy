/**
 * R287 P2：系统消息唯一状态 owner（自 electron-main.ts 原 39373–39454 区迁出）。
 * 行为保持：消息格式/ID 时钟调用顺序/200 上限/简报 4000 截断/已读历史 5 条/
 * 写失败保留内存态/广播通道与计数/已读不广播/错误净化，全部与原实现逐字同序。
 * 构造无副作用：不读盘、不注册；读取与注册由组合根在原时机显式调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { qingLiGuoQiXiaoXi } from '../fan-chan-mei.js';

export interface XiTongXiaoXi {
  id: string;
  ts: number;
  kind: 'update' | 'remote' | 'ssh' | 'system' | 'anti-sycophancy' | 'briefing' | 'schedule-missed' | 'governance-approval' | 'capability-audit';
  title: string;
  body: string;
  read: boolean;
}

/** 窄依赖：文件边界可注入（差分/故障测试），广播与错误净化沿用宿主既有实现。 */
export interface XiTongXiaoXiYiLai {
  wenJianLu: string;
  wenJianXiTong?: Pick<typeof fs, 'readFileSync' | 'mkdirSync' | 'writeFileSync' | 'renameSync'>;
  guangBo: (channel: 'warmy:xiTongXiaoXiXin', payload: { count: number }) => void;
  jingHuaCuoWu: (e: unknown) => string;
}

export function chuangJianXiTongXiaoXi(yiLai: XiTongXiaoXiYiLai) {
  const fsX = yiLai.wenJianXiTong ?? fs;
  const xiTongXiaoXiLu = yiLai.wenJianLu;
  let xiTongXiaoXiJi: XiTongXiaoXi[] = [];
  function duXiTongXiaoXi(): void {
    try {
      const j = JSON.parse(fsX.readFileSync(xiTongXiaoXiLu, 'utf8') as string);
      xiTongXiaoXiJi = (Array.isArray(j?.items) ? j.items : [])
        .filter((x: Partial<XiTongXiaoXi>) => x && typeof x.id === 'string' && typeof x.ts === 'number')
        .map((x: Partial<XiTongXiaoXi>) => ({
          id: String(x.id), ts: Number(x.ts), kind: (x.kind === 'update' || x.kind === 'remote' || x.kind === 'ssh' || x.kind === 'anti-sycophancy' || x.kind === 'briefing' || x.kind === 'schedule-missed' || x.kind === 'governance-approval' || x.kind === 'capability-audit' ? x.kind : 'system'),
          title: String(x.title || '').slice(0, 120), body: String(x.body || '').slice(0, x.kind === 'briefing' || x.kind === 'schedule-missed' || x.kind === 'governance-approval' || x.kind === 'capability-audit' ? 4000 : 400), read: !!x.read,
        }))
        .slice(-200);
      /* R260 项30：反谄媚系统消息时效清理——早于最新 10 条且超 30 天的删除（按模型观点处理）。 */
      xiTongXiaoXiJi = qingLiGuoQiXiaoXi(xiTongXiaoXiJi, Date.now()).messages;
      /* R298：恢复时整理历史重复未读通知——错过与自我改进各自全局最多一条。 */
      const piZhun = xiTongXiaoXiJi.filter((x) => x.kind === 'governance-approval' && !x.read);
      if (piZhun.length > 1) {
        const ti = piZhun.map((x) => x.body).filter(Boolean).join('\n──\n').slice(0, 4000);
        const zui = piZhun[piZhun.length - 1]!;
        xiTongXiaoXiJi = xiTongXiaoXiJi.filter((x) => !(x.kind === 'governance-approval' && !x.read));
        xiTongXiaoXiJi.push({ ...zui, body: ti });
      }
      const cuoWei = xiTongXiaoXiJi.filter((x) => x.kind === 'schedule-missed' && !x.read);
      if (cuoWei.length > 1) {
        const heTi = cuoWei.map((x) => x.body).filter(Boolean).join('\n──\n').slice(0, 4000);
        const zuiXin = cuoWei[cuoWei.length - 1]!;
        xiTongXiaoXiJi = xiTongXiaoXiJi.filter((x) => !(x.kind === 'schedule-missed' && !x.read));
        xiTongXiaoXiJi.push({ ...zuiXin, body: heTi });
      }
    } catch { xiTongXiaoXiJi = []; }
  }
  /** 200 条上限不得淘汰未读错过通知与治理申请（未决业务不靠消息淘汰清除） */
  function youJieQu200(lie: XiTongXiaoXi[]): XiTongXiaoXi[] {
    if (lie.length <= 200) return lie;
    const weiJue = (x: XiTongXiaoXi) => !x.read
      && (x.kind === 'schedule-missed' || x.kind === 'governance-approval');
    const bao = lie.filter(weiJue);
    const qiTa = lie.filter((x) => !weiJue(x));
    return [...qiTa.slice(-Math.max(0, 200 - bao.length)), ...bao];
  }
  function cunXiTongXiaoXi(): void {
    try {
      fsX.mkdirSync(path.dirname(xiTongXiaoXiLu), { recursive: true });
      const tmp = xiTongXiaoXiLu + '.tmp';
      fsX.writeFileSync(tmp, JSON.stringify({ items: youJieQu200(xiTongXiaoXiJi) }, null, 2), 'utf8');
      fsX.renameSync(tmp, xiTongXiaoXiLu);
    } catch { /* 写盘失败不阻断内存态 */ }
  }
  /** 记一条系统消息（产品文案，非用户内容）；有界 200；广播给界面亮徽标 */
  function jiXiTongXiaoXi(kind: XiTongXiaoXi['kind'], title: string, body: string): void {
    try {
      xiTongXiaoXiJi.push({ id: 'sys-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now(), kind, title: String(title).slice(0, 120), body: String(body).slice(0, kind === 'briefing' ? 4000 : 400), read: false });
      xiTongXiaoXiJi = youJieQu200(xiTongXiaoXiJi);
      cunXiTongXiaoXi();
      yiLai.guangBo('warmy:xiTongXiaoXiXin', { count: xiTongXiaoXiJi.filter((x) => !x.read).length });
    } catch { /* 系统消息失败绝不影响业务 */ }
  }
  /**
   * R280：总结简报系统消息（全面但不详细）。**始终只有一条未读简报**：
   * 已有未读简报⇒合并为一条（旧正文＋新段落）；已读简报保留最近 5 条作历史。
   */
  function jiZongJieJianBao(title: string, body: string): void {
    try {
      const weiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'briefing' && !x.read);
      const yiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'briefing' && x.read);
      const heBing = [...weiDu.map((x) => x.body), String(body || '')].filter(Boolean).join('\n──\n');
      xiTongXiaoXiJi = xiTongXiaoXiJi.filter((x) => x.kind !== 'briefing');
      xiTongXiaoXiJi.push(...yiDu.slice(-5));
      xiTongXiaoXiJi.push({ id: 'brief-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), ts: Date.now(), kind: 'briefing', title: String(title || '总结简报').slice(0, 120), body: heBing.slice(0, 4000), read: false });
      xiTongXiaoXiJi = youJieQu200(xiTongXiaoXiJi);
      cunXiTongXiaoXi();
      yiLai.guangBo('warmy:xiTongXiaoXiXin', { count: xiTongXiaoXiJi.filter((x) => !x.read).length });
    } catch { /* 简报失败绝不影响业务 */ }
  }
  /**
   * R298：定时错过通知。**全局（所有会话/窗口合计）最多一条未读**：
   * 已有未读错过通知 ⇒ 立即由唯一 owner 合并为一条（正文按任务归组、时刻与遗漏次数）；
   * 已读历史保留最近 5 条。逐项结构化数据在定时账本（ding-shi-zhang-ben），
   * 正文只是摘要且按 4000 字上限（不塞 400 字后截断）；已读≠决定“不补”，未决入口仍在定时卡。
   * 只在新错过事项发生时调用；旧未决不会自动重新变未读。
   */
  function jiDingShiCuoGuo(title: string, body: string): void {
    try {
      const weiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'schedule-missed' && !x.read);
      const yiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'schedule-missed' && x.read);
      const heBing = [...weiDu.map((x) => x.body), String(body || '')].filter(Boolean).join('\n──\n');
      xiTongXiaoXiJi = xiTongXiaoXiJi.filter((x) => x.kind !== 'schedule-missed');
      xiTongXiaoXiJi.push(...yiDu.slice(-5));
      xiTongXiaoXiJi.push({ id: 'schmiss-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), ts: Date.now(), kind: 'schedule-missed', title: String(title || '定时任务错过').slice(0, 120), body: heBing.slice(0, 4000), read: false });
      xiTongXiaoXiJi = youJieQu200(xiTongXiaoXiJi);
      cunXiTongXiaoXi();
      yiLai.guangBo('warmy:xiTongXiaoXiXin', { count: xiTongXiaoXiJi.filter((x) => !x.read).length });
    } catch { /* 通知失败绝不影响业务 */ }
  }
  /** 自我改进待批准：全局最多一条未读；逐项批准仍由治理 owner 独立裁决。 */
  function jiJinHuaShenPi(body: string): void {
    try {
      const weiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'governance-approval' && !x.read);
      const yiDu = xiTongXiaoXiJi.filter((x) => x.kind === 'governance-approval' && x.read);
      const heBing = [...weiDu.map((x) => x.body), String(body || '')].filter(Boolean).join('\n──\n').slice(0, 4000);
      xiTongXiaoXiJi = xiTongXiaoXiJi.filter((x) => x.kind !== 'governance-approval');
      xiTongXiaoXiJi.push(...yiDu.slice(-5));
      xiTongXiaoXiJi.push({ id: 'jinpi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), ts: Date.now(), kind: 'governance-approval', title: '自我改进申请（需你批准）', body: heBing, read: false });
      xiTongXiaoXiJi = youJieQu200(xiTongXiaoXiJi);
      cunXiTongXiaoXi();
      yiLai.guangBo('warmy:xiTongXiaoXiXin', { count: xiTongXiaoXiJi.filter((x) => !x.read).length });
    } catch { /* 通知失败不影响提案 */ }
  }
  /** 全部决定后收起未读提示；已读不等于批准，决定仍以治理 owner 为准。 */
  function qingLiJinHuaShenPi(): void {
    let gai = false;
    for (const m of xiTongXiaoXiJi) if (m.kind === 'governance-approval' && !m.read) { m.read = true; gai = true; }
    if (!gai) return;
    cunXiTongXiaoXi();
    yiLai.guangBo('warmy:xiTongXiaoXiXin', { count: xiTongXiaoXiJi.filter((x) => !x.read).length });
  }
  /** IPC 适配：注册顺序与原实现一致；安全闸仍由宿主 chuliIpc 承担。 */
  function zhuCeIpc(zhuCe: (channel: string, fn: (event: any, ...args: any[]) => any) => void): void {
    zhuCe('warmy:zongJieJianBao', (_e, p0?: { title?: string; body?: string }) => {
      try { jiZongJieJianBao(String(p0?.title || '总结简报'), String(p0?.body || '')); return { ok: true, unread: xiTongXiaoXiJi.filter((x) => !x.read && x.kind === 'briefing').length }; }
      catch (e) { return { ok: false, error: yiLai.jingHuaCuoWu(e) }; }
    });
    zhuCe('warmy:xiTongXiaoXiLieBiao', () => ({ ok: true, items: xiTongXiaoXiJi.slice().reverse() }));
    /** R264 项8：拟态异常走系统消息（不弹提示音/不亮未读圆点），渲染层上报 */
    zhuCe('warmy:xiTongXiaoXiTianJia', (_e, p0?: { kind?: string; title?: string; body?: string }) => {
      try {
        const kind = (['update', 'remote', 'ssh', 'system'].includes(String(p0?.kind || '')) ? String(p0?.kind) : 'system') as XiTongXiaoXi['kind'];
        jiXiTongXiaoXi(kind, String(p0?.title || ''), String(p0?.body || ''));
        return { ok: true };
      } catch (e) { return { ok: false, error: yiLai.jingHuaCuoWu(e) }; }
    });
    zhuCe('warmy:xiTongXiaoXiYiDu', (_e, id?: string) => {
      const m = xiTongXiaoXiJi.find((x) => x.id === String(id || ''));
      if (m) { m.read = true; cunXiTongXiaoXi(); }
      return { ok: true, unread: xiTongXiaoXiJi.filter((x) => !x.read).length };
    });
    zhuCe('warmy:xiTongXiaoXiQuanBuYiDu', () => {
      for (const m of xiTongXiaoXiJi) m.read = true;
      cunXiTongXiaoXi();
      return { ok: true, unread: 0 };
    });
  }
  return { duXiTongXiaoXi, jiXiTongXiaoXi, jiZongJieJianBao, jiDingShiCuoGuo, jiJinHuaShenPi, qingLiJinHuaShenPi, zhuCeIpc };
}
