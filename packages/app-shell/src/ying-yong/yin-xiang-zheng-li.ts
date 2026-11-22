/**
 * R287 P6-2：印象总结归纳唯一 owner（自 electron-main 迁出，行为逐字保持；与 shu-gui-na 同范式姊妹批）。
 * 四路素材（用户原话长期口径/摘要决策要点/赞踩/整理模型候选行）过同一道闸：
 *  · 幻觉硬闸：模型候选行必须能在素材里找到 ≥10 字连续原话（去空白标点），找不到就丢＋审计；
 *  · 互斥组（KB＋术）已有不写；同义旧条先迁KB再写新；用户否认过的永不再写；
 *  · 隐私不进印象：敏感类目改投私密知识库，写不进就丢弃＋审计（不退回印象）；
 *  · 防膨胀：行数闸（YIN_XIANG_MAX_LINES）＋字符闸（yinXiangMaxChars），被裁旧条先迁KB，迁不动保留。
 * 用户手写段一字不动；只改「## 牛马归纳」段。
 * 互斥/同义（prompt-placement）＋敏感（yinxiang-guolv）纯函数直接 import；
 * 印象读写/互斥文本/迁KB/字符上限/私密库/审计/时钟/随机窄注入；构造无副作用。
 */
import { shiTongYiNeiRong, zhaoHuChiWeiZhi } from '../prompt-placement.js';
import { minGanLeiMing } from '../yinxiang-guolv.js';

/** 印象行数硬上限（防膨胀）；字符闸取 yinXiangMaxChars（同一份上限表）。 */
export const YIN_XIANG_MAX_LINES = 120;

export interface YinXiangZhengLiYiLai {
  duYinXiang: () => string;
  xieYinXiang: (wen: string) => boolean;
  huChiZhiShiWenBen: () => string[];
  tiShiXingWenBen: (ceng: 'shu' | 'yinXiang') => string[];
  qianYiTiShiDaoZhiShi: (wen: string, from: 'shu' | 'yinXiang', sid?: string) => boolean;
  yinXiangMaxChars: () => number;
  knowledge: { allow?: (ceng: never) => unknown } | null;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong: () => number;
  suiJi: () => number;
}

export function chuangJianYinXiangZhengLi(yiLai: YinXiangZhengLiYiLai) {
  function zhengLiYinXiang(caiLiao: { zhaiYao?: string; yuanHua?: string[]; zanCai?: Array<{ pingJia: string; wenTi?: string; moXing?: string }>; /** 第 38 轮 项 5：整理模型给出的候选行（必须能在素材里找到原话，见下面的幻觉闸） */ moXingHang?: string[]; suCaiZhengWen?: string; sid?: string }): { jia: number; shan: number; ziShu: number } {
    let yuan = yiLai.duYinXiang();
    /** 已经存在的行（保持用户手写/已修订的内容不动） */
    const jiu = yuan.split('\n');
    /** 只有“牛马归纳”段里的条目允许被自动替换；用户手写段一字不动 */
    const ziDongHang = new Set<string>();
    {
      const i0 = jiu.findIndex((l) => /^##\s*牛马归纳/.test(l));
      if (i0 >= 0) {
        const i1 = jiu.findIndex((l, i) => i > i0 && /^##\s/.test(l));
        for (const l of jiu.slice(i0 + 1, i1 < 0 ? jiu.length : i1)) {
          if (/^\s*-\s+/.test(l)) ziDongHang.add(l.replace(/^\s*-\s+/, '').trim());
        }
      }
    }
    /** 互斥组：知识库 + 术 */
    const zhiShi = yiLai.huChiZhiShiWenBen();
    const shuXian = yiLai.tiShiXingWenBen('shu');
    const tiHuanCu: string[] = [];
    let tiaoGuo = 0;
    const yiYou = new Set(jiu.filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim()));
    /** 用户否认过的内容：永不再次写入 */
    const fouRen = new Set(
      jiu.filter((l) => /已被用户否认/.test(l)).map((l) => l.replace(/\s*[（(]已被用户否认[^）)]*[）)]\s*/g, '').replace(/^\s*-\s+/, '').trim()).filter(Boolean),
    );
    const xin: string[] = [];
    const tian = (s: string) => {
      const w = String(s || '').replace(/\s+/g, ' ').trim();
      if (!w || w.length < 4 || w.length > 60) return;
      if (yiYou.has(w) || fouRen.has(w) || xin.includes(w)) return;
      /** 互斥组：同一内容已在知识库或「术」里，就不再写进印象 */
      const yiZhan = zhaoHuChiWeiZhi(w, { knowledge: zhiShi, shu: shuXian }, 'yinXiang');
      if (yiZhan) { tiaoGuo += 1; return; }
      /** 自动段里有同义旧条目 ⇒ 旧条目先迁进知识库，再写新说法 */
      const jiuTiao = [...ziDongHang].find((old) => old !== w && !tiHuanCu.includes(old) && shiTongYiNeiRong(old, w));
      if (jiuTiao) {
        if (!yiLai.qianYiTiShiDaoZhiShi(jiuTiao, 'yinXiang', caiLiao.sid)) return;
        tiHuanCu.push(jiuTiao);
      }
      /**
       * **隐私不进印象**（用户定稿）：印象是"一个人可以对外公开的形象"，
       * 命中敏感类目的那一条一律不写印象 —— 改投**私密知识库**（私密层写得进去时），
       * 写不进去就直接丢弃并记审计。宁可少记一条，也不把健康/财务/家庭这类事留在每轮都注入的文本里。
       */
      const minGan = minGanLeiMing(w);
      if (minGan) {
        let zhuan = 'diu';
        try {
          const ceng = yiLai.knowledge?.allow ? yiLai.knowledge!.allow('private' as never) : null;
          const add = (ceng as unknown as { addEvent?: (e: Record<string, unknown>) => unknown } | null)?.addEvent;
          if (typeof add === 'function') {
            add.call(ceng, {
              id: 'ev-min-' + yiLai.shiZhong().toString(36) + '-' + Math.floor(yiLai.suiJi() * 46656).toString(36),
              biaoTi: '私密·' + minGan,
              result: w.slice(0, 500),
              entityIds: [],
              anchors: [],
              ts: yiLai.shiZhong(),
            });
            zhuan = 'private-kb';
          }
        } catch { /* 私密层写不进去：如实丢弃，不退回印象 */ }
        try { yiLai.auditLog('yinxiang.sensitive-skipped', { lei: minGan, quXiang: zhuan, chars: w.length }); } catch { /* noop */ }
        return;
      }
      xin.push(w);
    };
    /** ① 用户原话里带"长期口径"的句子 */
    const changQi = /(以后|今后|每次|永远|一直|记住|不要再|别再|不许再|我不喜欢|我喜欢|我习惯|我偏好|请务必|约定)/;
    for (const h of (caiLiao.yuanHua || [])) {
      for (const j of String(h || '').split(/[。！？!?\n]/)) {
        const s = j.trim();
        if (s && s.length <= 60 && changQi.test(s)) tian(s.replace(/^[-—\s]+/, ''));
      }
    }
    /** ② 总结摘要里"决策/要点"中带长期措辞的 */
    for (const j of String(caiLiao.zhaiYao || '').split(/[\n•·]/)) {
      const s = j.replace(/^[-—\s•·]+/, '').trim();
      if (s && s.length <= 60 && changQi.test(s)) tian(s);
    }
    /** ③ 赞/踩：赞 = 这个模型/做法合口味；踩 = 别再用 */
    for (const v of (caiLiao.zanCai || []).slice(-20)) {
      if (!v) continue;
      if (v.pingJia === '赞' && v.moXing) tian('这种回答方式合口味（' + String(v.moXing).slice(0, 24) + '）');
      /**
       * 第 38 轮 项 5：**踩也是重要信息**（旧实现只处理赞）。
       * 用户点踩的那条 = "这种答案/这个模型不要再用"，同样是长期偏好，必须进印象。
       */
      if (v.pingJia === '踩') tian('不喜欢这种回答' + (v.wenTi ? '（关于"' + String(v.wenTi).slice(0, 24) + '"）' : '')
        + (v.moXing ? '，别再走 ' + String(v.moXing).slice(0, 24) : ''));
    }
    /**
     * ④ 第 38 轮 项 5：**整理模型给的候选行**也要过同一道闸，而且加一条**幻觉硬闸**：
     * 每一行必须能在本次总结的素材原文里找到一段 ≥10 字的连续原话（去掉空白与标点后比对），
     * 找不到就丢 ⇒ 模型只能"挑选与压缩用户说过的话"，不许创作。
     */
    const zheng = (s: string) => String(s || '').replace(/[\s\p{P}]/gu, '');
    const suCai = zheng(caiLiao.suCaiZhengWen || (caiLiao.yuanHua || []).join('\n'));
    for (const h of (caiLiao.moXingHang || [])) {
      const w = String(h || '').replace(/^\s*[-•·\d.、]+\s*/, '').replace(/\s+/g, ' ').trim();
      if (!w) continue;
      const a = w.slice(0, 12);
      const b = w.slice(0, 8);
      const zhaoDao = suCai.length >= 10 && (suCai.includes(zheng(a)) || suCai.includes(zheng(b)));
      if (!zhaoDao) {
        try { yiLai.auditLog('yinxiang.hallucination-dropped', { hang: w.slice(0, 40) }); } catch { /* noop */ }
        continue;
      }
      tian(w);
    }
    if (tiHuanCu.length) {
      yuan = yuan.split('\n').filter((l) => !tiHuanCu.includes(l.replace(/^\s*-\s+/, '').trim())).join('\n');
    }
    if (!xin.length) {
      /** 即使没有新条目，也要按上限整理一次（防止用户手工写超） */
    }
    /** 组装：保留原文（含用户手写的标题/纪律），只把新条目追加到「## 牛马归纳」段末尾 */
    const xinHang = xin.map((s) => '- ' + s);
    let quan = yuan.trimEnd();
    if (xinHang.length) {
      if (/##\s*牛马归纳/.test(quan)) {
        /** 追加在该段末尾（下一个 ## 之前） */
        const i = quan.search(/##\s*牛马归纳/);
        const hou = quan.slice(i).search(/\n##\s/);
        const chaRu = hou >= 0 ? i + hou : quan.length;
        quan = quan.slice(0, chaRu).trimEnd() + '\n' + xinHang.join('\n') + '\n' + quan.slice(chaRu);
      } else {
        const ri = new Date(yiLai.shiZhong()).toISOString().slice(0, 10);
        quan += '\n\n## 牛马归纳（后台总结时自动补充；可直接改或删）\n<!-- ' + ri + ' -->\n' + xinHang.join('\n');
      }
    }
    /** ④ 防膨胀：只保留最近 N 条（丢最旧的自增条目），再按字符上限硬裁 */
    const hang = quan.split('\n');
    const ziZeng = hang.map((l, i) => ({ l, i })).filter((x) => /^\s*-\s+/.test(x.l));
    let diu = 0;
    if (ziZeng.length > YIN_XIANG_MAX_LINES) {
      /** 被裁掉的旧条目先迁进知识库；迁不动就保留（绝不静默丢） */
      const sha = ziZeng.slice(0, ziZeng.length - YIN_XIANG_MAX_LINES);
      const keShan: number[] = [];
      for (const x of sha) {
        const w = x.l.replace(/^\s*-\s+/, '').trim();
        if (yiLai.qianYiTiShiDaoZhiShi(w, 'yinXiang', caiLiao.sid)) { keShan.push(x.i); diu += 1; }
      }
      for (const i of keShan.sort((a, b) => b - a)) hang.splice(i, 1);
    }
    let jie = hang.join('\n');
    while (jie.length > yiLai.yinXiangMaxChars() && /\n-\s[^\n]*$/.test(jie)) {
      const m = jie.match(/\n-\s([^\n]*)$/);
      const w = m && m[1] ? m[1].trim() : '';
      if (!w || !yiLai.qianYiTiShiDaoZhiShi(w, 'yinXiang', caiLiao.sid)) break;
      jie = jie.slice(0, jie.length - String(m![0]).length);
      diu += 1;
    }
    if (jie !== yuan) yiLai.xieYinXiang(jie);
    try { yiLai.auditLog('yinxiang.zhengli', { jia: xinHang.length, shan: diu, ziShu: jie.length, tiHuan: tiHuanCu.length, huChiTiaoGuo: tiaoGuo }); } catch { /* noop */ }
    return { jia: xinHang.length, shan: diu, ziShu: jie.length };
  }
  return { zhengLiYinXiang };
}
