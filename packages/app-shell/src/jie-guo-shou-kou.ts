/**
 * **工具结果收口**（纯模块，无副作用 ⇒ 门禁可以直接对真函数跑真值表）。
 *
 * 第 51 轮真机事故（小游戏三连第 2 遍判红的根因）：`read_file` 读 7411 字节的 `youxi.html`，
 * 工具侧没截（上限 20000），但结果回给模型时在 `electron-main.ts` 被 `slice(0, 4000)` 一刀切走，
 * **截断处一个字都没提** ⇒ 模型以为看到了全文，对没看到的 `draw()`/主循环没法定点编辑 ⇒
 * 转去撞 `search_files`（只回 `not-a-directory`）和 `run_shell`（被授权档拒 9 次），
 * 602 秒 mtime 不前进 ⇒ 判据如实判红。
 *
 * 口径：**每条结果的字符上限一个都不抬高**（先给提示行留位、再截断 ⇒ 注入量恒定不变），
 * 只是不再让模型看不见自己少看了什么、以及怎么把剩下的取回来。
 *
 * 提示行**本身不许再被切一刀**（第 52 轮自查抓到的缺陷：固定预留 60 字时
 * 「续读 offset=N」正好被切在半截数字上 ⇒ 等于没修）。做法：先把提示写完，
 * 再按它的**实际长度**回补正文，迭代到不再变动为止；上限小到装不下时**优先保提示**，
 * 且把 offset 写在提示最前面。
 */

/** 提示行正文（续读方式写在最前，保证极端情况下先保住它） */
function jianTiShi(
  gongJuMing: string,
  yuanChang: number,
  max: number,
  yiFangKai: number,
  xuDu?: (yiFangKai: number) => string,
): string {
  const xu = xuDu
    ? xuDu(yiFangKai)
    : '别推测没显示的部分：分段读、缩小范围、换关键词，先把剩下的取回来再说。';
  return `[结果不完整] 续读：${xu}｜${gongJuMing || '本工具'} 的返回共 ${yuanChang} 字，受每条结果上限（${max} 字）只放出前 ${yiFangKai} 字，后面 ${yuanChang - yiFangKai} 字**你看不到**。`;
}

/**
 * 把工具结果压进单条上限：装得下**一字不改**；装不下则如实告知还剩多少没看到 + 怎么续读。
 *
 * @param xuDu 续读指引（拿到「实际放出的字符数」，好算下一次从哪读）；不传给通用指引。
 */
export function jieGuoShouWei(
  wen: unknown,
  shangXian: number,
  gongJuMing = '',
  xuDu?: (yiFangKai: number) => string,
): string {
  const s = String(wen ?? '');
  const max = Math.max(200, Math.floor(Number(shangXian)) || 4000);
  if (s.length <= max) return s;
  let kai = Math.max(1, max - 200);
  let ti = jianTiShi(gongJuMing, s.length, max, kai, xuDu);
  for (let i = 0; i < 8; i++) {
    const xia = max - ti.length - 1;
    if (xia === kai) break;
    kai = Math.max(0, xia);
    ti = jianTiShi(gongJuMing, s.length, max, kai, xuDu);
  }
  /** 上限小到期连提示都塞不下：宁可一个字正文不给，也要把「还有多少没看到 + offset」送到 */
  if (kai < 1 || kai + ti.length + 1 > max) return jianTiShi(gongJuMing, s.length, max, 0, xuDu).slice(0, max);
  return s.slice(0, kai) + '\n' + ti;
}

/** `read_file` 的结果里被宿主看见的那部分（段首提示行不算正文） */
export type DuZheShouKou = { tool?: string; path?: string; offset?: number; bodyChars?: number; error?: string };

/**
 * **续读游标**：`read_file` 的结果被宿主收口后，告诉模型下一次从正文第几字符读。
 * 段首那句「本段是第 X~Y 字符」提示行**不是正文**，先扣掉它、再夹进本段真实正文以内 ⇒
 * **宁可和上一段重叠，也绝不跳过**没显示的字。
 */
export function readFileXuDu(meta: DuZheShouKou | undefined, yuanChang: number, yiFangKai: number): string {
  const m = meta || {};
  if (m.tool !== 'read_file' || m.error) return '别把没显示的部分当成已知内容：缩小范围、分段再来一次。';
  const qi = Number(m.offset) || 0;
  const benDuan = Number(m.bodyChars) || 0;
  const feiZhengWen = Math.max(0, Number(yuanChang) - benDuan);
  const kanDao = Math.max(0, Math.min(benDuan, yiFangKai - feiZhengWen));
  const lu = String(m.path || '').slice(0, 80);
  return `再调一次 read_file，path="${lu}"、offset=${qi + kanDao}（本段正文实际放出了 ${kanDao}/${benDuan} 字）。`;
}
