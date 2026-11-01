/**
 * 长文副本判定（第 44 轮，纯函数 + 零依赖，与 `mo-xing-gui-ge.ts` 同一套做法）
 *
 * 为什么要单独立个文件：真机 r34-mimo 里，小说已经写完（5945 字），模型为了"自己数一遍、取个尾"
 * 先写了个 `get_tail.ps1`，接着**用 `copy_file` 把整篇拷成 `novel_full.txt`** ⇒ 同一次任务里出现两份
 * 一模一样的长文。原本那条"换个名字另存副本就拦下"的防护只挂在 `write_file` 上，换一条工具路就绕开了。
 * 判据本身（重合率算法 + 放行条件）是这段改动的全部风险所在：**它必须能挡住"白多一份副本"，
 * 又绝不能挡住"用户真的要我复制一份"** —— 所以做成可单测的纯函数，让门禁直接跑真值表，
 * 而不是只在源码里钉一句措辞。
 */

/** 不计空白与换行的净字数（与主进程口径同源：主进程 import 这里，不留第二份实现） */
export function jingZiShu(s: string): number {
  return [...String(s || '').replace(/\s+/g, '')].length;
}

/**
 * 8 字切片的重合率（**以旧文为分母**）：续写的下一段与旧文几乎不重合；
 * 改写过的整篇或原样复制的一份会大量重合。旧文短于一个切片 ⇒ 视为完全重合。
 * 抽样步长控制在 ~400 个切片，避免长文逐位比较把主线程拖住。
 */
export function chongHeLv(jiu: string, xin: string): number {
  const K = 8;
  const a = [...String(jiu || '')];
  if (a.length < K) return 1;
  const b = [...String(xin || '')];
  const xinJi = new Set<string>();
  for (let i = 0; i + K <= b.length; i++) xinJi.add(b.slice(i, i + K).join(''));
  let zong = 0;
  let zhong = 0;
  const bu = Math.max(1, Math.floor((a.length - K + 1) / 400));
  for (let i = 0; i + K <= a.length; i += bu) {
    zong++;
    if (xinJi.has(a.slice(i, i + K).join(''))) zhong++;
  }
  return zong ? zhong / zong : 1;
}

/** 多长的正文才算"那篇长文"（同一任务里顺手写的短文件不算副本） */
export const CHANG_WEN_XIAN = 800;

export interface FuBenYueDing {
  /** 要被复制/另存出去的那份正文 */
  neiRong: string;
  /** 目标路径是不是已经存在（存在 ⇒ 那是覆盖，交给别的防护，不在这里判副本） */
  muBiaoYiCunZai: boolean;
  /** 源与目标是不是同一个文件（同路径的自我复制不算"多一份"） */
  tongYiWenJian?: boolean;
  /** 只看文本类（txt/md），别把复制图片/脚本也管进来 */
  wenBenLei: boolean;
  /** 用户在原话里就要一份副本 ⇒ 一律放行 */
  yongHuYaoFuBen: boolean;
  /** 模型带了 overwrite:true ⇒ 视为明确确认，放行（与 write_file 那套逃生口一致） */
  yiQueRen: boolean;
  /** 追加写不是另存副本 */
  zhuiJia: boolean;
  /** 与"本任务已写好的那份"的重合率；没比过就留空，函数自己不会瞎算 */
  chongHe?: number;
}

/**
 * 该不该拦下这次"另存一份长文"。返回 true ⇒ 拦。
 * 每条放行理由都单独可测（真值表进门禁），因为"防护挡住真需求"比"少拦一次"更坏。
 */
export function shiChangWenFuBen(p: FuBenYueDing): boolean {
  if (p.yiQueRen || p.zhuiJia || p.yongHuYaoFuBen) return false;
  if (p.muBiaoYiCunZai || p.tongYiWenJian) return false;
  if (!p.wenBenLei) return false;
  if (jingZiShu(p.neiRong) < CHANG_WEN_XIAN) return false;
  const lv = typeof p.chongHe === 'number' ? p.chongHe : 1;
  return lv >= 0.8;
}

/** 拦下时给模型看的那句为什么（把路径与重合率填进去，不让它猜） */
export function fuBenBoHuiWen(moBan: string, yuan: string, muB: string, lv: number): string {
  return String(moBan || '')
    .replace(/\{q\}/g, () => muB)
    .replace(/\{p\}/g, () => yuan)
    .replace(/\{r\}/g, () => String(Math.round(lv * 100)));
}
