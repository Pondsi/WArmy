/**
 * R287 P5-8：「术」的总结归纳唯一 owner（自 electron-main 迁出，行为逐字保持）。
 * 只从**用户自己说过的话**里挑"做事章法"（顺序、流程、验收、禁止），带与印象同一道幻觉硬闸
 * （必须能在素材里找到连续原话 ⇒ 只能挑选与压缩，不许创作），敏感类目不落，去重后追加在自己的小节里；
 * **用户手写的其它部分一字不动**，段内最多留 20 条（丢最旧的，迁不动保留不静默丢）。
 * 互斥/同义判据复用 prompt-placement，敏感类目复用 yinxiang-guolv（纯函数直接 import）；
 * 状态（术文件/互斥文本/迁KB/总量上限/路径）与副作用（写文件/备份/审计）窄注入；构造无副作用。
 */
import path from 'node:path';
import { shiTongYiNeiRong, zhaoHuChiWeiZhi } from '../prompt-placement.js';
import { minGanLeiMing } from '../yinxiang-guolv.js';

export const SHU_GUI_ZE = /(先.+再|第一步|按.{1,10}(顺序|来|办|做)|每次|以后|从现在起|不要.+要|必须|禁止|验收|检查|核对)/;
export const SHU_GUI_BIAO = '## 牛马归纳（总结时自动整理；可直接改或删）';

export interface ShuGuiNaYiLai {
  duShu: () => string;
  huChiZhiShiWenBen: () => string[];
  tiShiXingWenBen: (ceng: 'shu' | 'yinXiang') => string[];
  qianYiTiShiDaoZhiShi: (wen: string, from: 'shu' | 'yinXiang', sid?: string) => boolean;
  shuZongLiangMax: () => number;
  shuLu: () => string;
  beiFenTiShi: (lu: string) => void;
  fs: { mkdirSync: (p: string, o: { recursive: boolean }) => void; writeFileSync: (p: string, d: string, enc: string) => void };
  auditLog: (op: string, detail: unknown) => void;
}

export function chuangJianShuGuiNa(yiLai: ShuGuiNaYiLai) {
  function guiNaShu(caiLiao: { yuanHua?: string[]; suCaiZhengWen?: string; sid?: string }): { jia: number; diu: number } {
    try {
      const yuan = yiLai.duShu();
      const yiYou = new Set(yuan.split('\n').filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim()));
      /** 只有“牛马归纳”段里的条目允许被自动替换；用户手写段一字不动 */
      const ziDongWeiZhi = new Map<string, number>();
      {
        const hs = yuan.split('\n');
        const i0 = hs.indexOf(SHU_GUI_BIAO);
        if (i0 >= 0) {
          const i1 = hs.findIndex((l, i) => i > i0 && /^##\s/.test(l));
          hs.slice(i0 + 1, i1 < 0 ? hs.length : i1).forEach((l, k) => {
            if (/^\s*-\s+/.test(l)) ziDongWeiZhi.set(l.replace(/^\s*-\s+/, '').trim(), i0 + 1 + k);
          });
        }
      }
      const quZheng = (s: string) => String(s || '').replace(/[\s\p{P}]/gu, '');
      const suCai = quZheng(String(caiLiao.suCaiZhengWen || '') + (caiLiao.yuanHua || []).join('\n'));
      /** 互斥组：知识库 + 印象；同一条内容已经在别处就不再写进「术」 */
      const zhiShi = yiLai.huChiZhiShiWenBen();
      const yinXian = yiLai.tiShiXingWenBen('yinXiang');
      const xian: string[] = [];
      const tiHuanCu: string[] = [];
      let tiaoGuo = 0;
      for (const h of (caiLiao.yuanHua || [])) {
        for (const j of String(h || '').split(/[。！？!?\n]/)) {
          const w = j.replace(/^\s*[-—•·]+\s*/, '').replace(/\s+/g, ' ').trim();
          if (!w || w.length < 6 || w.length > 80) continue;
          if (!SHU_GUI_ZE.test(w)) continue;
          if (yiYou.has(w) || xian.includes(w)) continue;
          if (minGanLeiMing(w)) continue;
          if (suCai.length >= 10 && !suCai.includes(quZheng(w.slice(0, 12)))) continue;
          const yiZhan = zhaoHuChiWeiZhi(w, { knowledge: zhiShi, yinXiang: yinXian }, 'shu');
          if (yiZhan) { tiaoGuo += 1; continue; }
          /** 自动段里已有同义旧条目 ⇒ 旧条目先迁进知识库，再在这里写新说法 */
          const jiuTiao = [...ziDongWeiZhi.keys()].find((old) => old !== w && !tiHuanCu.includes(old) && shiTongYiNeiRong(old, w));
          if (jiuTiao) {
            if (!yiLai.qianYiTiShiDaoZhiShi(jiuTiao, 'shu', caiLiao.sid)) continue;
            tiHuanCu.push(jiuTiao);
          }
          xian.push(w);
        }
      }
      const jia = xian.slice(0, 8);
      if (!jia.length) return { jia: 0, diu: 0 };
      /** 总量闸：整份「术」超过 8000 字就**不再追加**（用户手写的部分一个字都不动，只停止归纳侧的膨胀） */
      if (yuan.length > yiLai.shuZongLiangMax()) {
        try { yiLai.auditLog('shu.over-cap', { ziShu: yuan.length, max: yiLai.shuZongLiangMax(), benLunYi: jia.length }); } catch { /* noop */ }
        return { jia: 0, diu: 0 };
      }
      let quan = yuan.trimEnd();
      if (tiHuanCu.length) {
        quan = quan.split('\n').filter((l) => !(tiHuanCu.includes(l.replace(/^\s*-\s+/, '').trim()))).join('\n');
      }
      if (quan.includes(SHU_GUI_BIAO)) {
        quan = quan.replace(SHU_GUI_BIAO, SHU_GUI_BIAO + '\n' + jia.map((s) => '- ' + s).join('\n'));
      } else {
        quan += (quan ? '\n\n' : '') + SHU_GUI_BIAO + '\n' + jia.map((s) => '- ' + s).join('\n') + '\n';
      }
      /** 段内防膨胀：最多留最近 20 条；被裁掉的旧条目**先迁进知识库**，迁不动就保留（绝不静默丢） */
      const hang = quan.split('\n');
      let diu = 0;
      const biaoHang = hang.indexOf(SHU_GUI_BIAO);
      if (biaoHang >= 0) {
        const jieShu = hang.findIndex((l, i) => i > biaoHang && /^##\s/.test(l));
        const qian = hang.slice(0, biaoHang + 1);
        const duan = hang.slice(biaoHang + 1, jieShu < 0 ? hang.length : jieShu);
        const hou = jieShu < 0 ? [] : hang.slice(jieShu);
        const feiTiao = duan.filter((l) => !/^\s*-\s+/.test(l));
        const tiao = duan.filter((l) => /^\s*-\s+/.test(l));
        let liu = tiao.slice(-20);
        if (tiao.length > 20) {
          for (const l of tiao.slice(0, tiao.length - 20)) {
            const w = l.replace(/^\s*-\s+/, '').trim();
            if (yiLai.qianYiTiShiDaoZhiShi(w, 'shu', caiLiao.sid)) diu += 1;
            else liu = [l, ...liu]; // 迁不动就留着，不能丢
          }
        }
        quan = qian.concat(feiTiao, liu, hou).join('\n');
      }
      yiLai.fs.mkdirSync(path.dirname(yiLai.shuLu()), { recursive: true });
      yiLai.beiFenTiShi(yiLai.shuLu());
      yiLai.fs.writeFileSync(yiLai.shuLu(), quan, 'utf8');
      try { yiLai.auditLog('shu.zhengli', { jia: jia.length, diu, yiYou: yiYou.size, tiHuan: tiHuanCu.length, huChiTiaoGuo: tiaoGuo }); } catch { /* noop */ }
      return { jia: jia.length, diu };
    } catch { return { jia: 0, diu: 0 }; }
  }
  return { guiNaShu };
}
