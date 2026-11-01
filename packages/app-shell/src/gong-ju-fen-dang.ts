/**
 * 工具面截尾（窗口装不下整套工具规格时）——纯函数，主进程**计价侧与发送侧同调**（`zuJingGongJuGuiGe`）。
 * ADR000 P5「Skill 渐进式暴露」在预算不足时的落法：按档位保留，而不是"谁在前留谁"。
 *
 * 档位（小的先留）：
 *   -1 用户这一轮**点名**的工具，或从这句话里明显要用的（"压缩包/.zip" ⇒ list_archive…）
 *    0 最小干活集（记忆双刀 + 读写改文件 + 命令 + 打开 + 计划 + 问用户 + 时间）
 *    1 读取类（搜文件、读压缩包、读文档、找技能…）
 *    2 其它
 *    3 派小弟
 *    4 用户自定义工具
 * -1 与 0 两档**永远不许被裁**（条数上限因此可能被撑大，计价侧用的是同一个函数，所以撑大的那部分也算进了预算）。
 *
 * 真机事故（第 48 轮 live，`verify-round16` ④）：用户说"请用 list_archive 查看 r16-1.zip"，
 * 窗口只够 12 条工具 ⇒ list_archive（第 1 档）被裁掉，模型试了 list_dir / read_file / run_shell，
 * 最后用 open_path 把压缩包用系统默认程序打开了 —— 用户点名要用的工具被裁，比超预算更坏。
 */
export const ZUI_XIAO_GAN_HUO_JI: readonly string[] = ['recall', 'retrieve', 'read_file', 'write_file', 'list_dir', 'edit_file', 'run_shell', 'open_path', 'plan_update', 'ask_user', 'get_time'];
const DU_QU_LEI = /^(read_file|search_files|find_files|read_archive_entry|list_archive|find_skill|read_skill|get_time|read_document)$/;

function zhuanYi(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 这一轮用户点名的工具 + 从这句话里明显要用的（只从真实可用的工具名里挑；内容为空 ⇒ 空集） */
export function dianMingGongJu(wen: string, keYong: readonly string[]): Set<string> {
  const t = String(wen || '');
  const chu = new Set<string>();
  if (!t) return chu;
  for (const n of keYong) {
    if (n && new RegExp(`(^|[^A-Za-z0-9_])${zhuanYi(n)}([^A-Za-z0-9_]|$)`).test(t)) chu.add(n);
  }
  const jia = (ming: string[]) => { for (const n of ming) if (keYong.includes(n)) chu.add(n); };
  if (/\.(zip|7z|rar|tar|tgz)\b|\.tar\.gz\b|压缩包|解压/i.test(t)) jia(['list_archive', 'read_archive_entry']);
  if (/\.(docx?|pptx?|xlsx?|pdf)\b/i.test(t)) jia(['read_document']);
  /**
   * 用户要的**产物类型**与**等待**也算点名（第 48 轮真机：窗口兜底偏小时"生成一个ppt / 完成后等待30秒"
   * 这句里的 make_pptx、wait_seconds 被裁掉，模型只好回"本轮无 make_pptx 工具"）。
   */
  if (/\bpptx?\b|幻灯片|演示文稿/i.test(t)) jia(['make_pptx']);
  if (/\bdocx?\b|\bword\b/i.test(t)) jia(['make_docx']);
  if (/\bxlsx?\b|\bexcel\b|电子表格/i.test(t)) jia(['make_xlsx']);
  if (/\bpdf\b/i.test(t)) jia(['make_pdf']);
  if (/(?:等待?|wait)\s*\d+(?:\.\d+)?\s*(?:秒|分钟|分|s\b|sec|min)|等(?:一)?(?:会儿|下再)/i.test(t)) jia(['wait_seconds']);
  return chu;
}

export interface FenDangJieGuo<T> {
  liu: T[];
  diu: string[];
  /** 不许被裁的条数（点名 + 最小干活集） */
  baoDi: number;
  /** 实际保留条数 = max(上限, 保底) */
  shou: number;
  jieWei: boolean;
}

export function fenDangJieWei<T extends { function: { name: string } }>(
  quan: readonly T[],
  zuiDuo: number,
  o: { ziDingMing?: ReadonlySet<string>; dianMing?: ReadonlySet<string> } = {},
): FenDangJieGuo<T> {
  if (zuiDuo <= 0 || quan.length <= zuiDuo) return { liu: quan.slice(), diu: [], baoDi: 0, shou: quan.length, jieWei: false };
  const t0 = new Set(ZUI_XIAO_GAN_HUO_JI);
  const dang = (g: T): number => {
    const n = String(g.function.name || '');
    if (o.dianMing?.has(n)) return -1;
    if (t0.has(n)) return 0;
    if (DU_QU_LEI.test(n)) return 1;
    if (n === 'spawn_subagent' || n.startsWith('subagent')) return 3;
    if (o.ziDingMing?.has(n)) return 4;
    return 2;
  };
  const baoDi = Math.max(1, quan.filter((g) => dang(g) <= 0).length);
  const shou = Math.max(zuiDuo, baoDi);
  if (quan.length <= shou) return { liu: quan.slice(), diu: [], baoDi, shou, jieWei: false };
  /** 稳定排序：同一档内保持原顺序 */
  const liu = quan.slice().sort((a, b) => dang(a) - dang(b)).slice(0, shou);
  const diu = quan.filter((g) => !liu.includes(g)).map((g) => g.function.name);
  return { liu, diu, baoDi, shou, jieWei: true };
}
