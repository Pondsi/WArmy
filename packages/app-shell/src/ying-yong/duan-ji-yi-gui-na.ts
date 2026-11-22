/**
 * R287 P5-6：短记忆归纳唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · duanJiYiHuiHuaSuCai：从本会话聊天提取素材（用户明确规则/偏好优先，最近发言兜底；去重/要点互斥/KB 互斥；180 天半衰期打分）。
 *  · guiNaDuanJiYi：按使用频率把知识事件＋聊天素材补进短记忆规范文件——要点去重、KB/聊天 3/5 比例闸、段内 40 条裁切、频率衰减排序。
 * 纯助手（duanJiYiNorm/Hash/shiDuanJiYiTiao/ShiYongFen/ZhaoShiJian/YuYaoDianChongFu＋常量）复用 ji-chu/duan-ji-yi；
 * 状态（chatLogs/knowledge/规范路径/频率表/层/要点/时间窗）与副作用（写文件/压缩/审计）窄注入；时钟注入；构造无副作用。
 */
import type { ZhishiCeng } from '@warmy/knowledge-base';
import path from 'node:path';
import { duanJiYiNorm, duanJiYiHash, shiDuanJiYiTiao, duanJiYiShiYongFen, duanJiYiZhaoShiJian, duanJiYiYuYaoDianChongFu, DUAN_JIYI_BAN_SHUAI_RI } from '../ji-chu/duan-ji-yi.js';

export const GUI_FAN_GUI_BIAO = '## 短记忆（总结自动整理；界面不可见）';
export interface DuanJiYiPin { n: number; last: number }
export interface DuanJiYiShiJian { id?: string; biaoTi?: string; result?: string; useCount?: number; useLog?: number[]; lastUsedAt?: number; jiluTs?: number; ts?: number }
export interface DuanJiYiShiJianChuang { start: number; end: number; today: number; activeDays: number; capped: boolean }
export interface DuanJiYiGuiNaYiLai {
  chatLogs: Map<string, Array<{ role?: string; content?: string; ts?: number; system?: boolean; hidden?: boolean }>>;
  knowledge: { activeEventsIn: (layers: ZhishiCeng[]) => DuanJiYiShiJian[] } | null;
  guiFanLu: (sid: string) => string;
  fs: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string; mkdirSync: (p: string, o: { recursive: boolean }) => void; writeFileSync: (p: string, d: string, enc: string) => void };
  duanJiYiPinLu: (sid: string) => Record<string, DuanJiYiPin>;
  xieDuanJiYiPinLu: (sid: string, items: Record<string, DuanJiYiPin>) => void;
  kbLayersFor: (sid: string) => ZhishiCeng[];
  duBenHuiHuaYaoDian: (sid: string) => string[];
  huiHuaShiJianChuang: (sid: string) => DuanJiYiShiJianChuang;
  yaSuoDuanJiYi: (sid: string) => void;
  guiFanMaxChars: () => number;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong: () => number;
}

export function chuangJianDuanJiYiGuiNa(yiLai: DuanJiYiGuiNaYiLai) {
  function duanJiYiHuiHuaSuCai(
    sessionId: string,
    yaoDian: readonly string[],
    kbNorm: readonly string[],
  ): Array<{ wen: string; n: number; last: number; score: number }> {
    const sid = String(sessionId || '');
    if (!sid) return [];
    const out: Array<{ wen: string; n: number; last: number; score: number }> = [];
    const seen = new Set<string>();
    const kbSet = new Set((kbNorm || []).map((x) => String(x || '')).filter((x) => x.length >= 6));
    const logs = (yiLai.chatLogs.get(sid) || []).filter((m) => m && !m.system && !(m as { hidden?: boolean }).hidden
      && String(m.content || '').trim().length >= 6).slice(-300);
    const chong = (w: string): boolean => {
      const k = duanJiYiNorm(w);
      if (k.length < 6 || seen.has(k)) return true;
      if (duanJiYiYuYaoDianChongFu(w, yaoDian)) return true;
      for (const y of kbSet) {
        if (y && (y.includes(k) || k.includes(y)) && Math.min(y.length, k.length) >= 6) return true;
      }
      return false;
    };
    const push = (text: unknown, ts: number, n: number): void => {
      const w = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (w.length < 6 || chong(w)) return;
      const k = duanJiYiNorm(w);
      if (!k) return;
      seen.add(k);
      const age = Math.max(0, yiLai.shiZhong() - (Number(ts) || yiLai.shiZhong())) / 86400000;
      out.push({ wen: w, n, last: Number(ts) || yiLai.shiZhong(), score: n * Math.pow(0.5, age / DUAN_JIYI_BAN_SHUAI_RI) });
    };
    const users = logs.filter((m) => m.role === 'user');
    /** 用户明确说过的规则/偏好：优先级高于普通聊天 */
    const explicit = /记住|以后|每次|不要|必须|喜欢|偏好|习惯|统一|默认|约定|规则|禁止|别再|别用|总是/;
    for (const m of users.slice(-80)) {
      const s = String(m.content || '');
      if (explicit.test(s)) push(s, Number(m.ts) || 0, 2.5);
    }
    /** 兜底：最近几条用户发言也算本会话内容（保证 2/5 有余量） */
    for (const m of users.slice(-8)) push(m.content, Number(m.ts) || 0, 1);
    return out.sort((a, b) => b.score - a.score || b.last - a.last).slice(0, 12);
  }

  function guiNaDuanJiYi(sessionId: string): number {
    try {
      const sid = String(sessionId || '');
      if (!sid || !yiLai.knowledge) return 0;
      const p = yiLai.guiFanLu(sid);
      let yuan = '';
      try { yuan = yiLai.fs.existsSync(p) ? yiLai.fs.readFileSync(p, 'utf8') : ''; } catch { yuan = ''; }
      const pin = yiLai.duanJiYiPinLu(sid);
      const layers = yiLai.kbLayersFor(sid);
      const eventsAll = yiLai.knowledge.activeEventsIn(layers);
      const yaoDian = yiLai.duBenHuiHuaYaoDian(sid);
      const hs0 = yuan.split('\n');
      const yiYouNorm: string[] = [];
      const keptLines: string[] = [];
      const removedPoints: string[] = [];
      let existingKb = 0;
      let existingChat = 0;
      for (const line of hs0) {
        if (!shiDuanJiYiTiao(line)) { keptLines.push(line); continue; }
        const w = String(line).replace(/^\s*-\s+/, '').trim();
        const key = duanJiYiHash(w);
        if (!pin[key]) pin[key] = { n: 1, last: 0 };
        if (duanJiYiYuYaoDianChongFu(w, yaoDian)) {
          removedPoints.push(w);
          delete pin[key];
          continue;
        }
        const ev = duanJiYiZhaoShiJian(w, eventsAll);
        if (ev) existingKb += 1; else existingChat += 1;
        yiYouNorm.push(duanJiYiNorm(w));
        keptLines.push(line);
      }
      yuan = keptLines.join('\n');
      const chuang = yiLai.huiHuaShiJianChuang(sid);
      const events = eventsAll
        .filter((e) => Number(e.useCount) > 0)
        .map((e) => {
          const biao = String(e.biaoTi || '').trim();
          const jie = String(e.result || '').trim();
          let wen = /^(会话总结|测试知识|短记忆溢出|短记忆迁移)$/.test(biao) || !biao ? jie : biao;
          if (jie && wen && !duanJiYiNorm(jie).startsWith(duanJiYiNorm(wen).slice(0, 12))) wen += '：' + jie;
          wen = wen.replace(/\s+/g, ' ').trim().slice(0, 160);
          return {
            wen, n: Number(e.useCount) || 0,
            last: Number(e.lastUsedAt) || Number(e.jiluTs) || Number(e.ts) || 0,
            id: e.id,
            score: duanJiYiShiYongFen(e as never, chuang, false),
          };
        })
        .filter((x) => x.wen.length >= 6)
        .filter((x) => !duanJiYiYuYaoDianChongFu(x.wen, yaoDian))
        .filter((x) => {
          const k = duanJiYiNorm(x.wen);
          return !yiYouNorm.some((y) => y && (y.includes(k) || k.includes(y)) && Math.min(y.length, k.length) >= 6);
        })
        .sort((a, b) => b.score - a.score || b.last - a.last);
      const kbNorm = [
        ...yiYouNorm,
        ...events.map((x) => duanJiYiNorm(x.wen)),
        ...eventsAll.map((e) => duanJiYiNorm([e.biaoTi, e.result].filter(Boolean).join('：'))),
      ].filter((x) => x.length >= 6);
      const chatNew = duanJiYiHuiHuaSuCai(sid, yaoDian, kbNorm);
      const add: Array<{ wen: string; n: number; last: number; id: string; score: number }> = [];
      const seen = new Set<string>();
      let totalCount = yiYouNorm.length;
      let kbCount = existingKb;
      let chatCount = existingChat;
      const addOne = (x: { wen: string; n: number; last: number; id?: string; score: number }): boolean => {
        const key = duanJiYiHash(x.wen);
        if (seen.has(key) || add.length >= 10) return false;
        seen.add(key);
        add.push({ wen: x.wen, n: x.n, last: x.last, id: String(x.id || ''), score: x.score });
        totalCount += 1;
        return true;
      };
      for (const x of chatNew) {
        if (add.length >= 10) break;
        if (addOne(x)) chatCount += 1;
      }
      const kbCap = (): number => (chatCount === 0 ? 3 : Math.floor((chatCount * 3) / 2));
      for (const x of events) {
        if (add.length >= 10 || kbCount >= kbCap()) break;
        if (addOne(x)) kbCount += 1;
      }
      if (!add.length && !removedPoints.length) return 0;
      let quan = yuan.trimEnd();
      if (add.length) {
        const xinHang = add.map((x) => '- ' + x.wen);
        if (quan.includes(GUI_FAN_GUI_BIAO)) {
          quan = quan.replace(GUI_FAN_GUI_BIAO, GUI_FAN_GUI_BIAO + '\n' + xinHang.join('\n'));
        } else {
          quan += (quan ? '\n\n' : '') + GUI_FAN_GUI_BIAO + '\n' + xinHang.join('\n');
        }
        for (const x of add) pin[duanJiYiHash(x.wen)] = { n: x.n, last: x.last };
      }
      const cat = () => {
        const hs = quan.split('\n');
        const i0 = hs.indexOf(GUI_FAN_GUI_BIAO);
        if (i0 < 0) return;
        const i1 = hs.findIndex((l, i) => i > i0 && /^##\s/.test(l));
        const duan = hs.slice(i0 + 1, i1 < 0 ? hs.length : i1);
        const tiao = duan.filter((l) => /^\s*-\s+/.test(l));
        if (tiao.length > 40) {
          const qu = new Set(tiao.slice(0, tiao.length - 40));
          const jian = duan.filter((l) => !qu.has(l));
          quan = hs.slice(0, i0 + 1).concat(jian, i1 < 0 ? [] : hs.slice(i1)).join('\n');
        }
      };
      cat();
      yiLai.fs.mkdirSync(path.dirname(p), { recursive: true });
      yiLai.fs.writeFileSync(p, quan, 'utf8');
      yiLai.xieDuanJiYiPinLu(sid, pin);
      yiLai.yaSuoDuanJiYi(sid);
      try {
        yiLai.auditLog('duanjiyi.archive-summary', {
          sessionId: sid, jia: add.length, chars: quan.length,
          kb: { entries: kbCount, total: totalCount },
          chat: chatCount,
          pointsPruned: removedPoints.length,
          window: { start: chuang.start, end: chuang.end, activeDays: chuang.activeDays, capped: chuang.capped },
          top: add.slice(0, 5).map((x) => ({ score: Number(x.score.toFixed(2)), n: x.n, wen: x.wen.slice(0, 40) })),
        });
      } catch { /* noop */ }
      return add.length;
    } catch { return 0; }
  }

  /** R287 P5-7：按使用频率压缩短记忆——KB 抽取≤3/5，超字数从衰减分最低丢（并列更久没用先丢）；丢的只是副本，KB 仍保有。 */
  function yaSuoDuanJiYi(sessionId: string): void {
    try {
      const sid = String(sessionId || '');
      const p = yiLai.guiFanLu(sid);
      if (!yiLai.fs.existsSync(p)) return;
      let quan = yiLai.fs.readFileSync(p, 'utf8');
      const max = yiLai.guiFanMaxChars();
      const pin = yiLai.duanJiYiPinLu(sid);
      const hs = quan.split('\n');
      const chuang = yiLai.huiHuaShiJianChuang(sid);
      const events = yiLai.knowledge ? yiLai.knowledge.activeEventsIn(yiLai.kbLayersFor(sid)) : [];
      type Tiao = { idx: number; key: string; text: string; score: number; last: number; kb: boolean };
      const tiao: Tiao[] = [];
      for (let i = 0; i < hs.length; i++) {
        if (!shiDuanJiYiTiao(hs[i]!)) continue;
        const text = String(hs[i]).replace(/^\s*-\s+/, '').trim();
        const key = duanJiYiHash(text);
        const ev = duanJiYiZhaoShiJian(text, events);
        const kb = !!ev;
        let score = ev ? duanJiYiShiYongFen(ev as never, chuang, false) : 0;
        let last = Number((ev as { lastUsedAt?: number } | null)?.lastUsedAt || 0);
        if (!score) {
          const c = pin[key] || { n: 1, last: 0 };
          score = duanJiYiShiYongFen({ useCount: c.n, lastUsedAt: c.last, ts: c.last }, chuang, true);
          last = Number(c.last) || last;
        }
        if (!score) score = 0.001;
        tiao.push({ idx: i, key, text, score, last, kb });
      }
      if (!tiao.length) return;
      const removed: string[] = [];
      const removedKb: string[] = [];
      const pickLowest = (pool: Tiao[]): Tiao | null => {
        let best: Tiao | null = null;
        for (const x of pool) {
          if (!best || x.score < best.score || (x.score === best.score && x.last < best.last)) best = x;
        }
        return best;
      };
      const drop = (x: Tiao) => {
        hs[x.idx] = '';
        delete pin[x.key];
        removed.push(x.text);
        if (x.kb) removedKb.push(x.text);
        quan = hs.filter((l) => l !== '').join('\n');
      };
      let kbCount = tiao.filter((x) => x.kb).length;
      let totalCount = tiao.length;
      const chatCount = () => totalCount - kbCount;
      const kbCap = () => (chatCount() === 0 ? Math.min(3, totalCount) : Math.floor((chatCount() * 3) / 2));
      while (kbCount > kbCap()) {
        const x = pickLowest(tiao.filter((t) => t.kb && hs[t.idx] !== ''));
        if (!x) break;
        drop(x);
        kbCount -= 1;
        totalCount -= 1;
      }
      while (quan.length > max) {
        const x = pickLowest(tiao.filter((t) => hs[t.idx] !== ''));
        if (!x) break;
        drop(x);
        totalCount -= 1;
      }
      if (!removed.length) return;
      yiLai.fs.writeFileSync(p, quan.replace(/\x0a{3,}/g, String.fromCharCode(10, 10)).trim() + (quan.trim() ? String.fromCharCode(10) : ''), 'utf8');
      yiLai.xieDuanJiYiPinLu(sid, pin);
      if (removed.length) {
        try {
          yiLai.auditLog('prompt.duanjiyi-compressed', {
            sessionId: sid, removed: removed.length, kbRemoved: removedKb.length,
            chars: quan.length, max, window: { start: chuang.start, end: chuang.end, activeDays: chuang.activeDays, capped: chuang.capped },
          });
        } catch { /* noop */ }
      }
    } catch { /* 压缩失败不挡对话 */ }
  }

  return { duanJiYiHuiHuaSuCai, guiNaDuanJiYi, yaSuoDuanJiYi };
}