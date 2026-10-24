/**
 * **产物审计**（第 45 轮 · 压力档 A 抓出来的那一类）：模型回一句"文件已写入 /workspace/youxi.html"，
 * 而工作区里根本没有这个文件 —— 这叫**口头执行**。
 *
 * 为什么必须有它：`道` 的第一条是"永远诚实，不许编造"，而产品以前只在**工具真跑了**之后做读回核对；
 * 工具一次没调、话却说完，就没人对得上账。真机（6 轮小游戏压力档）第一轮就是这样：
 * 回复里连操作说明表格都编好了，`gongJuDiaoYongJi = 0`，文件不存在。
 *
 * 判据要**保守**（宁可漏报也不冤枉）：
 *  · 必须同时出现"完成时态的写/存/生成"与一个带扩展名的文件名，才算一条产物声称；
 *  · 绝对路径能 `existsSync` 到 ⇒ 满足；工作区里能按文件名找到 ⇒ 满足；
 *  · 本轮真的调过工具 ⇒ 不判（可能写到别处去了，交给工具自己的读回核对，不在这里越权报错）。
 *
 * 纯函数、零依赖（把"文件在不在"作为回调传进来），门禁可以直接 import 负向验证。
 */

/** 完成时态 + 动作（"我打算写/我会写"不算声称完成） */
const WAN_CHENG = /(已(经)?(写入|保存|存|创建|生成|导出|落盘|做完|完成)|写完|写好|保存到|生成(好|完|了)|创建(了|好)|路径(是|如下)|saved?|created|written|generated|exported)/i;
/**
 * 带扩展名的文件名（扩展名白名单，避免把 "3.5"、"v1.2" 之类当文件名）。
 * ⚠️ 字符类里必须带 `:` 与 `\\`：Windows 绝对路径 `C:\\Users\\p\\Desktop\\r16.txt` 少了 `:` 就只截到
 * "16.txt" —— 那会让"文件其实存在"被判成"编造"（误伤比漏报更糟：用户会看到一句冤枉模型的道歉）。
 * 前面的边界组保证我们从**路径开头**截，不从中间咬一半。
 */
const WEN_JIAN = /(?:^|[^A-Za-z0-9_.:\\/-])([\w\-. :/\\]+\.(?:html?|txt|md|json|csv|js|cjs|mjs|ts|py|css|xml|ya?ml|docx|pptx|xlsx|pdf|png|jpe?g|gif|webp|svg|zip))/gi;
const YUN_XU_KUO_ZHAN = new Set(['html', 'htm', 'txt', 'md', 'json', 'csv', 'js', 'cjs', 'mjs', 'ts', 'py', 'css', 'xml', 'yaml', 'yml', 'docx', 'pptx', 'xlsx', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'zip']);

/** 从一段回复里抓出"它说自己产出了哪些文件"（去重、保序） */
export function shengChengDeWenJian(huiFu: string): string[] {
  const s = String(huiFu || '');
  if (!WAN_CHENG.test(s)) return [];
  const chu: string[] = [];
  const kan = new Set<string>();
  for (const m of s.matchAll(WEN_JIAN)) {
    const lu = String(m[1] || '').trim().replace(/^[`'"“”]+|[`'"“”。,，;；)）]+$/g, '');
    if (!lu) continue;
    // 扩展名从文件名本身取（正则里那组已经改成非捕获组，别再依赖 m[2] —— 依赖错号位会静默全丢）
    const kuo = String(lu.split('.').pop() || '').toLowerCase();
    if (!YUN_XU_KUO_ZHAN.has(kuo)) continue;
    const ke = lu.replace(/\\/g, '/');
    if (kan.has(ke)) continue;
    kan.add(ke);
    chu.push(ke);
  }
  return chu;
}

export interface ChanWuJieLun {
  /** 这一轮有没有"产物声称" */
  youShengCheng: boolean;
  shengCheng: string[];
  /** 已经找到的（绝对路径或工作区里同名文件） */
  zhaoDao: string[];
  /** **说了却没找到**的那些 */
  queShao: string[];
  /**
   * 该不该按"口头执行"处理：有声称、有缺件、**且本轮一次工具都没调**才为 true。
   * 调过工具就不在这里判死（工具自己那侧有读回核对，越权误报会把"其实写成了"说成"没写"）。
   */
  kouTouZhiXing: boolean;
}

/**
 * @param cunZai      判断某个路径是否存在（主进程传 `fs.existsSync`）
 * @param zaiGongZuoQu 在工作区里按**文件名**找（返回找到的绝对路径或空串），由调用方决定递归多深
 */
export function chanWuShenJi(p: {
  huiFu: string;
  gongJuTiaoYongShu: number;
  cunZai: (jueDuiLuJing: string) => boolean;
  zaiGongZuoQu: (wenJianMing: string) => string;
}): ChanWuJieLun {
  const shengCheng = shengChengDeWenJian(p.huiFu);
  const zhaoDao: string[] = [];
  const queShao: string[] = [];
  for (const lu of shengCheng) {
    const jueDui = lu.startsWith('/') || /^[a-zA-Z]:\//.test(lu);
    if (jueDui && p.cunZai(lu)) { zhaoDao.push(lu); continue; }
    const ming = lu.split('/').pop() || lu;
    const zhaodao2 = p.zaiGongZuoQu(ming);
    if (zhaodao2) { zhaoDao.push(zhaodao2); continue; }
    if (jueDui) { queShao.push(lu); continue; }
    queShao.push(lu);
  }
  return {
    youShengCheng: shengCheng.length > 0,
    shengCheng,
    zhaoDao,
    queShao,
    kouTouZhiXing: shengCheng.length > 0 && queShao.length > 0 && !(Number(p.gongJuTiaoYongShu) > 0),
  };
}

/** 给用户看的如实说明（与 `truth-guard` 的措辞区分开：这里具体到"哪个文件没找到"） */
export function chanWuKouTouTiShi(queShao: string[]): string {
  return '\n\n⚠️ 【如实说明】上面提到"' + queShao.slice(0, 6).join('、') + '"已经写好，'
    + '但我在本会话工作区与这些路径上都**没有找到它们**（本轮一次工具都没调 ⇒ 那些内容是编的）。'
    + '文件不会凭空出现。回一句「重试」我就真的用 write_file 把它们写出来。';
}
