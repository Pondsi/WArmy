/**
 * R287 P3-3：会话安全档位＋记忆作用域规则唯一 owner（自 electron-main 迁出，行为保持）。
 *  · 档位按会话独立（settings.sessionSecurity），没有才回落全局默认（p1.security.getMode → globalSecurity → normal）；
 *  · full/strict/normal 三档；askOnExceed 缺省 true；任何读取异常 ⇒ 收窄到 normal+ask（不放开）；
 *  · 记忆作用域（ADR000 不变量 #9「权限过滤先于相关性检索」）：外部群只许查本群记录；
 *    单聊/内部项目不加作用域；查群类型出错时**收窄**（按本会话作用域）而不是放开。
 * 构造无副作用；设置仓/全局模式/群类型查询窄注入。
 */
import type { AnquanDang } from '../agent-tools.js';

export interface AnQuanDangWeiYiLai {
  duSheZhi: () => { globalSecurity?: string; askOnExceed?: boolean; sessionSecurity?: Record<string, string> } | undefined;
  /** 全局安全模式（p1.security.getMode()）；未就绪给 '' */
  duMoShi: () => string;
  /** 群类型查询（groupStore 优先、router 兜底）；允许抛错（调用方收窄） */
  chaQunLei: (sid: string) => string | undefined;
}

export function chuangJianAnQuanDangWei(yiLai: AnQuanDangWeiYiLai) {
  function anQuanDangWei(sessionId?: string): { full: boolean; ask: boolean; dang: AnquanDang } {
    try {
      const s = yiLai.duSheZhi();
      /* R251：授权档位按会话独立——先取本会话档位（settings.sessionSecurity），没有才回落全局默认。 */
      const sid = String(sessionId || '');
      const huiHuaRaw = sid ? String((s?.sessionSecurity || {})[sid] || '') : '';
      const raw = huiHuaRaw || String(yiLai.duMoShi() || s?.globalSecurity || 'normal');
      const dang: AnquanDang = raw === 'full' ? 'full' : raw === 'strict' ? 'strict' : 'normal';
      return { full: dang === 'full', ask: s?.askOnExceed !== false, dang };
    } catch {
      return { full: false, ask: true, dang: 'normal' };
    }
  }
  /**
   * 模型自己调 recall/retrieve 时的作用域：外部群里有别人，AI 不许把你在别的会话里说过的话
   * 召回给群里看 ⇒ 只许查这个群自己的记录（召回与解引用两侧都守）。
   * 单聊与内部项目只有你一个人，跨会话"永远记得"是承诺的一部分 ⇒ 不加作用域。
   */
  function jiYiZuoYongYu(sessionId: string): { groupId: string } | undefined {
    const sid = String(sessionId || '');
    if (!sid) return undefined;
    try {
      const lei = yiLai.chaQunLei(sid);
      return lei === 'external' ? { groupId: sid } : undefined;
    } catch {
      return { groupId: sid };
    }
  }
  return { anQuanDangWei, jiYiZuoYongYu };
}
