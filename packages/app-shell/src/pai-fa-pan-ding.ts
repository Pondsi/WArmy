/**
 * pai-fa-pan-ding —— 并行 / 接力判定（第 51 轮硬门禁，纯函数、零依赖，可单测）
 *
 * 用户口径：
 *  · 我的牛马：派发者判断重复/同资源 ⇒ 接力；互不干扰 ⇒ 并行
 *  · 项目：值班者决定，同样要判
 *  · 群聊：只能聊天（无工具/分身），默认并行
 *
 * 资源键 = 任务文本里出现的：绝对路径、带扩展名的文件名、命令首词。
 * 两个任务共享任一资源键 ⇒ 必须接力（后者等前者完成），否则可并行。
 */

export function paiFaZiYuanJian(renWu: string): string[] {
  const s = String(renWu || '');
  const jian = new Set<string>();
  for (const m of s.matchAll(/([A-Za-z]:[\\/][^\s，。；、"'<>|]+)/g)) jian.add('path:' + String(m[1] || '').toLowerCase());
  for (const m of s.matchAll(/([^\s\\/，。；、"'<>|]+\.(?:txt|md|html|htm|js|ts|json|docx?|xlsx?|pptx?|pdf|csv|py|css|png|jpg|jpeg|gif|svg|zip|exe|bat|sh|ps1|mjs|cjs|tsx|jsx))/gi)) {
    jian.add('file:' + String(m[1] || '').toLowerCase());
  }
  for (const m of s.matchAll(/(?:运行|执行|跑|run|cmd|powershell|node|python|npm|pnpm|yarn|git)\s+([^\s，。；、"'<>|]+)/gi)) {
    jian.add('cmd:' + String(m[1] || '').toLowerCase());
  }
  return [...jian];
}

export type PaiFaPanJue = { fangShi: 'parallel' | 'serial'; chongTu: string[]; liYou: string };

/**
 * 判定一组子任务该并行还是接力。`active` = 已在跑任务的资源键。
 */
export function panDuanPaiFa(renWu: Array<{ task: string }>, active: string[] = []): PaiFaPanJue {
  const suoYou = [...active];
  const chongTu: string[] = [];
  for (const r of renWu) {
    const jian = paiFaZiYuanJian(r.task);
    const zhuang = jian.filter((k) => suoYou.includes(k));
    if (zhuang.length) chongTu.push(...zhuang);
    suoYou.push(...jian);
  }
  const du = [...new Set(chongTu)];
  return du.length
    ? { fangShi: 'serial', chongTu: du, liYou: '共享资源：' + du.slice(0, 6).join('、') + ' ⇒ 必须接力，避免重复或抢资源' }
    : { fangShi: 'parallel', chongTu: [], liYou: '没有共享资源 ⇒ 可以并行' };
}


/**
 * **项目值班者派发多执行者时的并行/接力判定**（第 51 轮）。
 * 与 `panDuanPaiFa` 的区别：多执行者拿到的是**同一份 brief**，按资源键比会永远"冲突"。
 * 真正会互相踩的是「**写**同一个文件/跑同一条会改状态的命令」；只读或纯分析可以并行。
 * 判定：brief 里同时出现「写类动词」和「具体文件/路径」⇒ 接力；否则并行。
 */
export function xuYaoJieLi(brief: string): { fangShi: 'parallel' | 'serial'; liYou: string; chongTu: string[] } {
  const s = String(brief || '');
  const jian = paiFaZiYuanJian(s);
  const xie = /(写入|写到|保存|创建|生成|新建|重写|覆盖|写入文件|write|save|create|overwrite|append|edit_file|write_file)/i.test(s);
  const wenJian = jian.filter((k) => k.startsWith('file:') || k.startsWith('path:'));
  if (xie && wenJian.length) {
    return { fangShi: 'serial', liYou: '同一份 brief 里要写具体文件 ⇒ 多个执行者会互相覆盖，必须接力', chongTu: wenJian.slice(0, 6) };
  }
  return { fangShi: 'parallel', liYou: '没有"写同一文件"的冲突 ⇒ 可以并行（多执行者各自给结论，宿主按配额汇总）', chongTu: [] };
}
