/**
 * R287 P4-7：归档主函数（总结一个会话的新增内容进知识库）唯一 owner，自 electron-main 迁出，行为逐字保持。
 * 管线：在途跳过 → 抽干待整理/智能配置整理 → 印象归纳 → 游标增量选取 → 模型调用链整理（失败如实降级）→
 * 双时间知识写入 → 资产登记 → 短记忆频率补充 → 对外脱敏概要派生（宁缺勿泄）→ 双时态整理（取代不删除＋派生血缘重算）→
 * 核心摘要（手动/自动同一管线）→ 游标推进 → 派遣经验/话题反馈落盘 → 迪文落点/置信度复盘 → flush → 总结简报。
 * 纯函数 guiHuaZhengLi/paiShengDuiWaiGaiLao 直接复用模块；状态(Map/knowledge/settings/audit/fs)与其余副作用窄注入；
 * 时钟注入（生产默认 Date.now，差分冻结）。构造无副作用。
 */
import type { LogEntry } from '../context-renderer.js';
import type { ZhishiCang, ZhishiCeng } from '@warmy/knowledge-base';
import { guiHuaZhengLi } from '../zhi-shi-zheng-li.js';
import { paiShengDuiWaiGaiLao, type NengLiTiao } from '../zhi-shi-fen-ceng.js';
import type { CaiJue, FenJuQiPeiZhi } from './harness-zi-jin-hua.js';

export interface MoXingGongYingXinXi { presetId: string; baseURL: string; protocol: 'openai-compatible' | 'anthropic' | 'ollama'; apiKey: string; biaoQian: string }
export interface GuiDangHuiHuaJieGuo { ok: boolean; tiaoShu?: number; zhiShiJian?: string; jiangJi?: boolean; guiDangHeXin?: boolean; skipped?: string; error?: string }
export interface ShuangShiJianJieGuo { jiluTs: number; fashengTs?: number; fashengBiao?: string; fashengJingDu: string; fashengLaiYuan: 'stated' | 'none'; xuHao?: number; yiChang: string }
export interface ZhiNengPeiZhiDuiXiang { zhengLi: () => void; tianJia: (x: { lei: string; huiHua: string; beiZhu: string }) => void; du: () => string }

export interface GuiDangHuiHuaYiLai {
  zaiTuLiao: Map<string, number>;
  chatLogs: Map<string, LogEntry[]>;
  knowledge: ZhishiCang | null;
  ziLiPaiQianJiLu: Map<string, Array<{ ts: number; muDi: string; renWu: string; jieGuo?: string }>>;
  huaTiFanKuiJiLu: Map<string, Array<{ ts: number; panDuan: string; jiaoZheng?: string }>>;
  settingsStore: { load: () => unknown } | null;
  audit: { log: (op: string, detail?: unknown, user?: string) => void } | null;
  fs: { existsSync: (p: string) => boolean; writeFileSync: (p: string, d: string, enc: string) => void; appendFileSync: (p: string, d: string, enc: string) => void };
  harnessZiJinHua: {
    zongJieDuan: () => string;
    jieXiCaiJue: (txt: string) => CaiJue[];
    yingYongCaiJue: (pan: CaiJue[]) => { applied: number; needsAuth: string[] };
    jieXiFenJuQi: (txt: string) => Partial<FenJuQiPeiZhi> | null;
    yingYongFenJuQi: (p: Partial<FenJuQiPeiZhi> | null) => boolean;
    boLiCaiJueKuai: (txt: string) => string;
  };
  TI_SHI_CENG_BAN_BEN: string;
  shiZhong: () => number;
  isoShiZhong: () => string;
  guiYiJiaoSe: (role: unknown) => string;
  xiaoXiShiJian: (x: { seq?: number | string; ts?: number | string } | null | undefined) => number;
  shuangShiJian: (wen: string, jiLuTs: number, xuHao?: number) => ShuangShiJianJieGuo;
  nengLiBiao: () => NengLiTiao[];
  kbWriteLayers: (sid: string) => ZhishiCeng[];
  neiRongWenBen: (x: unknown) => string;
  xiJingCuoWu: (e: unknown) => string;
  sessionMingOf: (sid: string) => string;
  chouGanDaiZhengLi: (sid: string) => void;
  zhiNengPeiZhi: () => ZhiNengPeiZhiDuiXiang;
  moXingGuiNaYinXiang: (sid: string, hua: string[], zanCai: Array<{ pingJia: string; wenTi: string; moXing: string }>) => Promise<void>;
  guiDangYouBiaoQu: () => Record<string, number>;
  guiDangYouBiaoCun: (next: Record<string, number>) => void;
  jieMoXingGongYingShang: (mo: string) => Promise<MoXingGongYingXinXi | null>;
  congYuSheChuangJian: (presetId: string, cfg: unknown, protocol: string) => { chat: (req: unknown) => Promise<unknown> };
  duYaoQiu: (sid: string) => string;
  duGuiFan: (sid: string) => string;
  zhuCeLiaoTianZiChan: (x: { id: string; biaoTi: string; ti: string; scope: string }) => void;
  guiNaDuanJiYi: (sid: string) => void;
  shengChengHuiHuaZhaiYao: (sid: string, auto: boolean) => Promise<{ ok: boolean } | null>;
  ziLiJingYanLu: () => string;
  huaTiFanKuiLu: () => string;
  duHuaTiFanKuiCi: () => void;
  luoDianDiwenHua: (kind: string, x: { text: string }) => Promise<void>;
  zhiXinMoXing: () => { fuPanZiWoGaiJin: () => void };
  jiZongJieJianBao: (title: string, body: string) => void;
}

export function chuangJianGuiDangHuiHua(yiLai: GuiDangHuiHuaYiLai) {
  async function guiDangYiGeHuiHua(
    sessionId: string,
    opts?: { moXing?: string; biaoTi?: string; quanLiang?: boolean; auto?: boolean },
  ): Promise<GuiDangHuiHuaJieGuo> {
    try {
      const sid = String(sessionId || '');
      if (!sid) return { ok: false, error: 'bad-session' };
      if (yiLai.zaiTuLiao.has(sid)) {
        try {
          yiLai.audit?.log('chat.archive-skipped-inflight', {
            sessionId: sid, kaiShi: yiLai.zaiTuLiao.get(sid), chuFa: opts?.auto ? 'auto' : 'manual',
          });
        } catch { /* noop */ }
        return { ok: false, skipped: 'in-flight', error: 'in-flight（这个会话正在生成回复，本轮总结跳过；下一轮会自动补上）' };
      }
      yiLai.chouGanDaiZhengLi(sid);
      try {
        const cfg0 = yiLai.zhiNengPeiZhi();
        cfg0.zhengLi();
        cfg0.tianJia({
          lei: 'archive-note',
          huiHua: sid,
          beiZhu: `总结整理：本次总结 ${String(opts?.biaoTi || '')}`.slice(0, 160),
        });
      } catch { /* 整理失败不影响总结本身 */ }
      const suoyou = yiLai.chatLogs.get(sid) || [];
      try {
        const yongHuHua = suoyou
          .filter((x) => yiLai.guiYiJiaoSe(x.role) === 'user' && !((x as { hidden?: boolean }).hidden))
          .slice(-40)
          .map((x) => String(x.content || ''));
        const zanCai = (() => {
          try {
            const wen = String(yiLai.zhiNengPeiZhi().du() || '');
            return wen.split(/\r?\n/)
              .filter((l) => /踩|赞|👍|👎/.test(l))
              .slice(-20)
              .map((l) => ({ pingJia: /踩|👎/.test(l) ? '踩' : '赞', wenTi: l.replace(/^[-*\s]+/, '').slice(0, 60), moXing: '' }));
          } catch { return []; }
        })();
        await yiLai.moXingGuiNaYinXiang(String(sessionId || ''), yongHuHua.concat(zanCai.map((v) => v.wenTi || '').filter(Boolean)), zanCai);
      } catch { /* 印象整理失败不影响总结 */ }
      const youBiao = yiLai.guiDangYouBiaoQu();
      const qiDian = opts?.quanLiang ? 0 : Number(youBiao[sid] || 0);
      const xin = suoyou.filter((x) => yiLai.xiaoXiShiJian(x) > qiDian && !((x as { hidden?: boolean }).hidden));
      if (!xin.length) return { ok: true, tiaoShu: 0 };
      const zuiHou = xin.reduce((mx, x) => Math.max(mx, yiLai.xiaoXiShiJian(x)), qiDian);

      const yuanWen = xin.map((x) => `[${yiLai.guiYiJiaoSe(x.role)}] ${String(x.content || '')}`).join('\n');
      let zhengLi = yuanWen;
      let jiangJi = false;
      const archiveCand = (() => {
        const st = yiLai.settingsStore?.load() as { archiveModel?: string; archiveChain?: string[]; archiveChainDisabled?: string[] } | undefined;
        const explicit = String(opts?.moXing || '').trim();
        if (explicit) return [explicit];
        const dis = new Set(st?.archiveChainDisabled || []);
        const ch = (st?.archiveChain || []).filter((m) => m && !dis.has(m));
        if (ch.length) return ch;
        const am = String(st?.archiveModel || '').trim();
        return am ? [am] : [];
      })();
      for (const moQuan of archiveCand) {
      const mo = moQuan.includes('·') ? moQuan.split('·').pop()!.trim() : moQuan;
      if (mo) {
        try {
          const an = await yiLai.jieMoXingGongYingShang(mo);
          if (an && (an.apiKey || an.protocol === 'ollama')) {
            const p = yiLai.congYuSheChuangJian(an.presetId, { apiKey: an.apiKey, baseURL: an.baseURL || undefined, protocol: an.protocol } as never, an.protocol);
            const r = await Promise.race([
              p.chat({
                model: mo,
                xiaoXiJi: [{
                  role: 'user',
                  content: '把下面这段会话整理成一条可检索的知识条目：先给一句概括标题，再列要点/决定/待办/风险，最后保留关键事实。只输出整理结果，不要寒暄。\n'
                    + '【放置规则】同一事实/偏好只能放在知识库或模型可改的提示词（术/印象）中的**一处**；本条只做知识记录，不要建议把同一条再抄进术/印象。要求、短记忆、道、教条、束缚、认知不参与互斥，可以重复。\n\n'
                    + (() => {
                      const yq = yiLai.duYaoQiu(sid).trim();
                      const gf = yiLai.duGuiFan(sid).trim();
                      return (yq ? '【本会话的用户要求（用户亲写，只读；不得改写/删除）】\n' + yq.slice(0, 1500) + '\n\n' : '')
                        + (gf ? '【本会话的短记忆（按它归置；它由宿主按知识库使用频率更新，不需要你重写）】\n' + gf.slice(0, 1500) + '\n\n' : '');
                    })()
                    + '短记忆由宿主按**知识库使用频率**维护，你只负责把本次会话整理成知识条目；**不要输出对「要求」的修改建议**。\n\n'
                    + yiLai.harnessZiJinHua.zongJieDuan() + '\n'
                    + yuanWen.slice(0, 12000),
                }],
                maxTokens: 900,
              }),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('archive-timeout')), 60000)),
            ]);
            const txt = yiLai.neiRongWenBen((r as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content) || '';
            if (txt.trim()) {
              try {
                const cai = yiLai.harnessZiJinHua.jieXiCaiJue(txt);
                if (cai.length) yiLai.harnessZiJinHua.yingYongCaiJue(cai);
                const fen = yiLai.harnessZiJinHua.jieXiFenJuQi(txt);
                if (fen) yiLai.harnessZiJinHua.yingYongFenJuQi(fen);
              } catch { /* noop */ }
              zhengLi = yiLai.harnessZiJinHua.boLiCaiJueKuai(txt.trim()) || txt.trim(); jiangJi = false; break;
            }
            else jiangJi = true;
          } else {
            jiangJi = true;
          }
        } catch {
          jiangJi = true; // 模型没跑通：如实降级，不假装整理过；继续链上下一个
        }
      }
      }

      const biaoTi = String(opts?.biaoTi || '')
        || (zhengLi.split('\n')[0] || '').slice(0, 60)
        || ('会话总结 ' + yiLai.isoShiZhong().slice(0, 10));
      const evId = 'ev-arc-' + yiLai.shiZhong().toString(36);
      const jiLuTs = xin.reduce((mx, x) => Math.max(mx, Number(yiLai.xiaoXiShiJian(x)) || 0), 0) || yiLai.shiZhong();
      const zuiHouX = xin.reduce((mx, x) => Math.max(mx, Number(x.seq) || 0), 0);
      const ssj = yiLai.shuangShiJian(zhengLi + '\n' + yuanWen.slice(0, 8000), jiLuTs, zuiHouX);
      yiLai.knowledge?.internal.upsertEntity({ id: 'sess-' + sid, kind: 'project', ming: sid, attrs: {}, anchors: [] });
      yiLai.knowledge?.internal.addEvent({
        id: evId,
        biaoTi,
        result: zhengLi.slice(0, 500),
        entityIds: ['sess-' + sid],
        anchors: [],
        ts: yiLai.shiZhong(),
        jiluTs: ssj.jiluTs,
        fashengTs: ssj.fashengTs,
        fashengBiao: ssj.fashengBiao,
        fashengJingDu: ssj.fashengJingDu as 'ri' | 'yue' | 'nian' | 'wu',
        fashengLaiYuan: ssj.fashengLaiYuan,
        xuHao: ssj.xuHao,
        laiYuan: opts?.auto ? 'archive:auto' : 'archive:manual',
        tiShiCiBanBen: yiLai.TI_SHI_CENG_BAN_BEN,
      });
      try {
        yiLai.audit?.log('kb.time-written', {
          sessionId: sid, eventId: evId, jingDu: ssj.fashengJingDu, youFaSheng: !!ssj.fashengTs, yiChang: ssj.yiChang,
        });
      } catch { /* noop */ }
      yiLai.zhuCeLiaoTianZiChan({ id: evId, biaoTi, ti: zhengLi, scope: 'session' });
      try { yiLai.guiNaDuanJiYi(sid); } catch { /* 短记忆更新失败不影响总结 */ }

      try {
        const bieDe = (yiLai.knowledge?.internal.query('').events || [])
          .filter((e) => e.id !== evId && !e.shiXiaoTs).map((e) => e.result || '');
        const dm = paiShengDuiWaiGaiLao([zhengLi + '\n' + yuanWen.slice(0, 8000), ...bieDe], undefined, yiLai.nengLiBiao());
        if (!dm.ok || !dm.gai) {
          try { yiLai.audit?.log('kb.tumin-suppressed', { sessionId: sid, nengLi: dm.nengLi.length, why: dm.why.slice(0, 3).join(' | ').slice(0, 160) }); } catch { /* noop */ }
        } else if (yiLai.kbWriteLayers(sid).includes('session') && yiLai.knowledge) {
          const yaoTs = yiLai.shuangShiJian(dm.gai, jiLuTs);
          yiLai.knowledge.session.addEvent({
            id: 'ev-tu-' + yiLai.shiZhong().toString(36),
            biaoTi: '能力清单（脱敏概要）',
            result: dm.gai,
            entityIds: ['sess-' + sid],
            anchors: [],
            ts: yiLai.shiZhong(),
            jiluTs: yaoTs.jiluTs,
            laiYuan: 'derived:redaction',
            tiShiCiBanBen: yiLai.TI_SHI_CENG_BAN_BEN,
            yinZi: [evId],
          });
          try { yiLai.audit?.log('kb.tumin-written', { sessionId: sid, nengLi: dm.nengLi.length, chars: dm.gai.length }); } catch { /* noop */ }
        } else {
          try { yiLai.audit?.log('kb.tumin-denied', { sessionId: sid, why: '本会话不可写会话库' }); } catch { /* noop */ }
        }
      } catch { /* 脱敏概要失败不影响总结本身 */ }

      try {
        if (yiLai.knowledge) {
          const chaoQi: string[] = [];
          for (const ceng of yiLai.kbWriteLayers(sid)) {
            const kb = yiLai.knowledge.allow(ceng);
            const quan = kb.query('').events;
            const ji = guiHuaZhengLi(quan.map((e) => ({ id: e.id, biaoTi: e.biaoTi, result: e.result, ts: e.ts })));
            for (const id of ji.shanChu) { if (kb.supersedeEvent(id)) chaoQi.push(id); }
            for (const g of ji.gaiXie) {
              const jiu = quan.find((e) => e.id === g.id);
              if (!jiu) continue;
              kb.addEvent({ ...jiu, biaoTi: g.biaoTi, result: g.result });
            }
            if (ji.shanChu.length || ji.gaiXie.length) {
              yiLai.audit?.log('kb.tidy', {
                sessionId: sid, ceng, yuan: ji.yuan, hou: ji.hou,
                shan: ji.shanChu.length, gai: ji.gaiXie.length,
                fangShi: 'shiXiao（不删除）',
                liYou: ji.liYou.slice(0, 6).map((x) => x.lei).join(','),
              });
            }
          }
          if (chaoQi.length) {
            const yinYong = (yiLai.knowledge.session.query('').events || []).filter((e) => (e.yinZi || []).some((s) => chaoQi.includes(s)));
            for (const y of yinYong) {
              const re = paiShengDuiWaiGaiLao(yiLai.knowledge.internal.activeEvents().map((x) => x.result || ''), undefined, yiLai.nengLiBiao());
              if (re.ok && re.gai) { yiLai.knowledge.session.addEvent({ ...y, result: re.gai, ts: yiLai.shiZhong() }); yiLai.audit?.log('kb.derived-rebuilt', { id: y.id }); }
              else { yiLai.knowledge.session.supersedeEvent(y.id); yiLai.audit?.log('kb.derived-retired', { id: y.id, why: re.why.slice(0, 2).join(' | ') }); }
            }
            if (yinYong.length) { try { yiLai.audit?.log('kb.stale-propagated', { sessionId: sid, yuan: chaoQi.length, yingXiang: yinYong.length }); } catch { /* noop */ } }
          }
        }
      } catch { /* 整理失败不影响总结本身 */ }

      let heXinOk = false;
      try {
        const hx = await yiLai.shengChengHuiHuaZhaiYao(sid, opts?.auto === true);
        heXinOk = !!(hx && hx.ok);
      } catch { heXinOk = false; }
      if (!heXinOk) { try { yiLai.audit?.log('chat.archive-core-fail', { sessionId: sid }); } catch { /* noop */ } }

      const next = yiLai.guiDangYouBiaoQu();
      next[sid] = zuiHou;
      yiLai.guiDangYouBiaoCun(next);
      try {
        yiLai.audit?.log('chat.archive-done', { sessionId: sid, tiaoShu: xin.length, jiangJi, hasMoXing: archiveCand.length > 0, guiDangHeXin: heXinOk, chuFa: opts?.auto ? 'auto' : 'manual' });
      } catch { /* noop */ }
      try {
        const now = yiLai.isoShiZhong();
        const pai = yiLai.ziLiPaiQianJiLu.get(sid) || [];
        if (pai.length) {
          const lu1 = yiLai.ziLiJingYanLu();
          if (!yiLai.fs.existsSync(lu1)) {
            yiLai.fs.writeFileSync(lu1, '# 子代理派遣经验（总结/总结时更新；派遣前先读本文件）\n\n> 判定式：拆分价值 = 隔离目的（噪音/时间/权限/并行） × 边界清晰度 ÷ 通信开销。能不分就不分。\n> 评分列：5=成功 3=中性/无结论 1=失败（崩/截断/超时/被过滤）——下次派活优先挑评分高的模式。\n\n| 时间 | 隔离目的 | 任务 | 结果/影响 | 评分 |\n| --- | --- | --- | --- | --- |\n', 'utf8');
          }
          const ping = (guo: string) => /败|红|崩|超时|截断|失败|被过滤/.test(guo) ? 1 : (/成|绿|好|通过|完成/.test(guo) ? 5 : 3);
          yiLai.fs.appendFileSync(lu1, pai.map((x) => {
            const guo = String(x.jieGuo || '完成').replace(/[|\n]/g, ' ').slice(0, 80);
            return '| ' + now + ' | ' + x.muDi.replace(/[|\n]/g, ' ') + ' | ' + x.renWu.replace(/[|\n]/g, ' ').slice(0, 120) + ' | ' + guo + ' | ' + ping(String(x.jieGuo || '')) + ' |';
          }).join('\n') + '\n', 'utf8');
          yiLai.ziLiPaiQianJiLu.delete(sid);
        }
        const tp = yiLai.huaTiFanKuiJiLu.get(sid) || [];
        if (tp.length) {
          const lu2 = yiLai.huaTiFanKuiLu();
          if (!yiLai.fs.existsSync(lu2)) {
            yiLai.fs.writeFileSync(lu2, '# 话题判定反馈（总结/总结时更新；判定前对照，成功/失败都记录）\n\n> 补充词表（会被读回生效）：\n> +换题词: 示例\n> +回题词: 示例\n\n| 时间 | 判定 | 用户纠正/备注 |\n| --- | --- | --- |\n', 'utf8');
          }
          yiLai.fs.appendFileSync(lu2, tp.map((x) => '| ' + now + ' | ' + x.panDuan.replace(/[|\x0a]/g, ' ') + ' | ' + String(x.jiaoZheng || '（未见纠正，判为成功）').replace(/[|\x0a]/g, ' ') + ' |').join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
          yiLai.huaTiFanKuiJiLu.delete(sid);
          try { yiLai.duHuaTiFanKuiCi(); } catch { /* noop */ }
        }
      } catch { /* 总结写文件失败不影响总结 */ }
      try { void yiLai.luoDianDiwenHua('reflection', { text: String(jiangJi || '') }).catch(() => { /* noop */ }); } catch { /* noop */ }
      try { yiLai.zhiXinMoXing().fuPanZiWoGaiJin(); } catch { /* noop */ }
      try { yiLai.knowledge?.flushAll(); } catch { /* noop */ }
      try { yiLai.jiZongJieJianBao('总结简报 · ' + yiLai.sessionMingOf(sid), `会话「${yiLai.sessionMingOf(sid)}」总结完成：本次归档 ${xin.length} 条对话。要点：${String(jiangJi || '').replace(/\s+/g, ' ').slice(0, 300)}`); } catch { /* noop */ }
      return { ok: true, tiaoShu: xin.length, zhiShiJian: evId, jiangJi, guiDangHeXin: heXinOk };
    } catch (e) {
      return { ok: false, error: yiLai.xiJingCuoWu(e) };
    }
  }
  return { guiDangYiGeHuiHua };
}