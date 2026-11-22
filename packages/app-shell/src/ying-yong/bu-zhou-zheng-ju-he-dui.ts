/**
 * R287 P5-3：计划步骤证据核对唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 一步的证据核对：renDe＝宿主认得这类步骤；you＝已有证据；que＝还缺什么（人话，写给模型看）。
 * 规则：等待→wait_seconds 成功；打开→open_path/open_file 成功；写 N 字→落盘/回复字数达 95%；
 * 生成某类文件→本任务写出过该扩展名文件；纯回答→本轮回复有正文（≥8 字且有实义）。
 * 认不出类型的步骤不替模型做主（留给它自己 plan_verify）。证据需求解析复用 ji-chu/bu-zhou-zheng-ju；
 * 任务状态 Map（工具集/产物/字数）与 renWuZiShu/youShiZhiWenBen 窄注入；构造无副作用。
 */
import path from 'node:path';
import { buZhouXuYaoZhengJu } from '../ji-chu/bu-zhou-zheng-ju.js';

export interface JiHuaBuLike { title?: string }
export interface BuZhouZhengJuHeDuiYiLai {
  benCiRenWuGongJu: Map<string, Set<string>>;
  benCiRenWuChanPin: Map<string, Array<{ abs: string; name: string; ts: number }>>;
  benCiRenWuZiShu: Map<string, number>;
  renWuZiShu: (sid: string) => number;
  youShiZhiWenBen: (wen: string) => boolean;
}

export function chuangJianBuZhouZhengJuHeDui(yiLai: BuZhouZhengJuHeDuiYiLai) {
  function buZhouZhengJuHeDui(sid: string, b: JiHuaBuLike, huiFu?: string): { renDe: boolean; you: string[]; que: string[] } {
    const zj = buZhouXuYaoZhengJu(String(b.title || ''));
    const gongJu = yiLai.benCiRenWuGongJu.get(sid) || new Set<string>();
    const chanPin = yiLai.benCiRenWuChanPin.get(sid) || [];
    const you: string[] = [];
    const que: string[] = [];
    let renDe = false;
    if (zj.deng) {
      renDe = true;
      if (gongJu.has('wait_seconds')) you.push('wait_seconds 已执行成功'); else que.push('还没有成功执行过 wait_seconds');
    }
    if (zj.kai) {
      renDe = true;
      if (gongJu.has('open_path') || gongJu.has('open_file')) you.push('open_path 已执行成功'); else que.push('还没有成功执行过 open_path');
    }
    if (zj.ziShu > 0) {
      renDe = true;
      const zi = yiLai.renWuZiShu(sid);
      if (zi >= zj.ziShu * 0.95) you.push(`已写约 ${zi} 字（要求 ${zj.ziShu} 字）`);
      else que.push(`字数还不够：目前约 ${zi} 字，要求 ${zj.ziShu} 字`);
    } else if (zj.xie) {
      renDe = true;
      if (zj.zu.length) {
        for (const z of zj.zu) {
          const hit = [...chanPin].reverse().find((c) => z.includes(path.extname(c.abs).slice(1).toLowerCase()));
          if (hit) you.push('已生成 ' + hit.abs); else que.push(`本次任务还没有写出 .${z[z.length - 1]} 文件`);
        }
      } else if (chanPin.length) you.push('已生成 ' + chanPin[chanPin.length - 1]!.abs);
      else que.push('本次任务还没有写出任何文件');
    }
    if (!renDe && zj.da) {
      renDe = true;
      const youDa = huiFu === undefined
        ? (yiLai.benCiRenWuZiShu.get(sid) || 0) > 0
        : yiLai.youShiZhiWenBen(huiFu) && String(huiFu).trim().length >= 8;
      if (youDa) you.push('已在回复中作答'); else que.push('还没有在回复里作答');
    }
    return { renDe, you, que };
  }
  return { buZhouZhengJuHeDui };
}