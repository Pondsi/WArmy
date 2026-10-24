/**
 * 归档之后的**知识库整理**（第 52 轮项 7）：前后不矛盾、不重复、简洁、有上限。
 *
 * 纯规划器（不碰磁盘）⇒ 可以直接跑真值表；落盘由调用方按 `shanChu` / `gaiXie` 执行并记审计。
 * 为什么放在归档之后：一次归档会往库里追加事件与实体，跨会话攒久了必然出现
 * 「同一件事被记了两遍」「同一件事前后说法不一样」「标题越写越长」这三种退化 ——
 * 检索时它们一起挤进上下文，既吃预算又让模型拿到互相打脸的事实。
 */
export type YaoZhengLiShiJian = { id: string; biaoTi: string; result?: string; ts: number };
export type ZhengLiJiHua = {
  /** 要删掉的事件 id（重复 / 被更新说法取代的旧说法） */
  shanChu: string[];
  /** 要改写的事件（截断超长标题/结果），按 upsert 口径回填 */
  gaiXie: Array<{ id: string; biaoTi: string; result?: string }>;
  yuan: number;
  hou: number;
  liYou: Array<{ id: string; lei: string }>;
};

export const BIAO_TI_MAX = 60;
export const JIE_GUO_MAX = 500;

/** 归一化标题：去空白与标点、转小写 —— "同一件事"的判定基准（不是字符串全等，那会被标点骗过） */
export function guiYiHua(biaoTi: string): string {
  return String(biaoTi || '').toLowerCase().replace(/[\s　\-—_·、,，.。:：;；!！?？"'"'()（）\[\]【】/\\]+/g, '');
}

/** 两条内容是否"实质相同"（一条包含另一条，或去掉标点后完全一致） */
function shiZhiXiangTong(a?: string, b?: string): boolean {
  const x = guiYiHua(a || ''), y = guiYiHua(b || '');
  if (!x || !y) return !x && !y;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * 规划一次整理：
 *  ① **同标题且内容实质相同** ⇒ 重复，保留最新一条（时间戳最大），其余删；
 *  ② **同标题但内容不同** ⇒ 前后矛盾，保留最新说法（新的覆盖旧的），旧的删；
 *  ③ **标题/结果超长** ⇒ 截到上限（简洁，别让一条吃光注入预算）；
 *  ④ 全部按 id 报告理由，便于审计复查。
 */
export function guiHuaZhengLi(shiJian: readonly YaoZhengLiShiJian[]): ZhengLiJiHua {
  const shanChu = new Set<string>();
  const gaiXie = new Map<string, { id: string; biaoTi: string; result?: string }>();
  const liYou: Array<{ id: string; lei: string }> = [];
  const zu = new Map<string, YaoZhengLiShiJian[]>();
  for (const e of shiJian || []) {
    const key = guiYiHua(e.biaoTi) || e.id;
    const t = zu.get(key) || [];
    t.push(e);
    zu.set(key, t);
  }
  for (const [, list] of zu) {
    const xian = list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]!;
    for (const e of list) {
      if (e.id === xian.id) continue;
      const chongFu = shiZhiXiangTong(e.result, xian.result);
      shanChu.add(e.id);
      liYou.push({ id: e.id, lei: chongFu ? '重复' : '被更新的说法取代' });
    }
    const chaoChuan = String(xian.biaoTi || '').length > BIAO_TI_MAX || String(xian.result || '').length > JIE_GUO_MAX;
    if (chaoChuan) {
      gaiXie.set(xian.id, {
        id: xian.id,
        biaoTi: String(xian.biaoTi || '').slice(0, BIAO_TI_MAX),
        result: xian.result === undefined ? undefined : String(xian.result).slice(0, JIE_GUO_MAX),
      });
      liYou.push({ id: xian.id, lei: '超长截断' });
    }
  }
  const yuan = (shiJian || []).length;
  return { shanChu: [...shanChu], gaiXie: [...gaiXie.values()], yuan, hou: yuan - shanChu.size, liYou };
}
