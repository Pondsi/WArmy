#!/usr/bin/env node
/**
 * verify-features-99 —— 99 任务里那一堆「必须在源码里真的存在」的断言。
 * 一条断言 = 一个可独立验收的点；缺了就 FAIL，不静默放过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const emTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const css = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const neng = fs.readFileSync(path.join(root, 'packages/providers/src/mo-xing-neng-li.ts'), 'utf8');
const nmTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/nm-wen-jian.ts'), 'utf8');
const zh = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/zh-CN.json'), 'utf8'));

let pass = 0, fail = 0;
const fails = [];
const check = (label, ok) => {
  if (ok) { pass++; console.log('  PASS', label); }
  else { fail++; fails.push(label); console.log('  FAIL', label); }
};

console.log('[1] 多循环自动继续（预警上限 + 模型判卡死）');
check('有自动续派实现', /yanXuJiHuaRenWu/.test(emTs) && /yanXuZhuangTai/.test(emTs));
check('计划落盘 plans.json', /plans\.json/.test(emTs) && /huiFuJiHua/.test(emTs));
check('重启后广播 jiHuaHuiFu', /jiHuaHuiFu/.test(emTs) && /onJiHuaHuiFu/.test(appJs));
check('「继续/重试」按钮', /huiFuRenWuBtn/.test(appJs) && zh['chat.resumeTask']);
check('发新消息按钮失效', /planResumeDisabled/.test(appJs));
check('是预警上限而不是硬上限', /YANXU_YUJING_CI/.test(emTs) && /ciYuJing \*= 2/.test(emTs));
check('时间预警 + 翻倍', /YANXU_YUJING_SHIJIAN_MS/.test(emTs) && /shiJianYuJing \*= 2/.test(emTs));
check('到达预警点请模型判卡死', /panDuanKaSi/.test(emTs));
check('分析云模型优先、本地兜底', /yun\.forEach\(jia\)/.test(emTs) && /benDi\.forEach\(jia\)/.test(emTs));
check('分析最多试 5 个模型', /KASI_CHANGSHI = 5/.test(emTs));
check('「只说不做」也会续派', /talk-only/.test(emTs) && /ZHISHUO_BUZUO/.test(emTs));

console.log('\n[2] 第二列：第二行 [N] 最新回复 + 打断标记');
check('行首计数样式 CSS', /\.weiDuQianZhui/.test(css));
check('打断任务问号 CSS', /\.renWuZhongDuanMark/.test(css));
check('计数按新回复 +1', /state\.unread\[chatId\]/.test(appJs));
check('点击该聊天任意元素清零', /bindUnreadAck/.test(appJs));
check('attachChatMarks 挂到列表行', /attachChatMarks/.test(appJs));
check('无新回复显示灰色 [无]', /weiDuQianZhui wu/.test(appJs));

console.log('\n[3] 流式思考过程');
check('流式包装 baoZhuangLiuShi', /baoZhuangLiuShi/.test(emTs));
check('增量广播 suiXingPianDuan', /suiXingPianDuan/.test(emTs) && /onSuiXingPianDuan/.test(appJs));
check('思考块默认展开', /siKaoKuai" open/.test(appJs) || /class="siKaoKuai" open/.test(appJs));
check('正式回复到了就折叠', /shouLiuShiKuai/.test(appJs));
check('流式缓冲上限', /200000/.test(appJs));

console.log('\n[4] 看图模型（图像理解）');
check('kind 含 imageUnd', /imageUnd/.test(neng));
check('kindZhongWen 认识它', /'imageUnd': return '看图模型'/.test(neng) || /case 'imageUnd': return '看图模型'/.test(neng));
check('链里有 imageUnd', /imageUnd: 'smImageUndLian'/.test(appJs));
check('i18n 有看图模型', !!zh['model.kind.imageUnd'] && !!zh['settings.imageUndModel']);
check('放行带视觉的对话模型', /key === 'imageUnd' && n\.kind === 'chat' && n\.vision === true/.test(appJs));

console.log('\n[5] 加强 AI 语言约束');
check('界面勾选项', /yanGeYuYan/.test(appJs));
check('主进程注入语言约束', /llm\.strictLanguage/.test(emTs) && /strictAiLanguage/.test(emTs));
check('i18n 有文案', !!zh['settings.strictAiLanguage'] && !!zh['llm.strictLanguage']);

console.log('\n[6] `.NM` 导出/导入');
check('nm-wen-jian 有 aes-256-gcm', /aes-256-gcm/.test(nmTs));
check('导出 IPC', /warmy:peiZhiDaoChu/.test(emTs));
check('导入 IPC（全新/合并）', /mode === 'fresh'/.test(emTs) && /mode === 'merge'/.test(emTs) || /'fresh' : 'merge'/.test(emTs));
check('口令非空且 ≥4 位', /weak-password/.test(emTs));
check('导出项目为 .nm', /warmy:xiangMuDaoChu/.test(emTs));
check('内置查看 .nm（read_file 认 .nm）', /\.nm\$/i.test(fs.readFileSync(path.join(root, 'packages/app-shell/src/work-tools.ts'), 'utf8')));

console.log('\n[7] 自动滚动语义（DeepSeek 式）');
check('未勾选：长回复顶部对齐 / 短回复底部对齐', /lastH <= heZi\.clientHeight/.test(appJs) && /lastTop \+ lastH - heZi\.clientHeight/.test(appJs) && /Math\.min\(lastTop, maxScroll\)/.test(appJs));
check('勾选 = 滚到底', /autoScrollChat\)\s*\{[\s\S]{0,80}scrollToBottom/.test(appJs));

console.log('\n[8] 分类模型 = 决策模型（RLCD）');
check('简中叫「分类模型」', zh['model.fenLei'] === '分类模型');
check('链只收专业决策模型', /fenLei: \['decision'\]/.test(appJs));
check('没有时回退对话模型链', /回退到/.test(String(zh['model.fenLeiHint'] || '')));
check('真实调用 fenLeiPanDing', /fenLeiPanDing/.test(emTs));

console.log('\n[9] 决策卡');
check('按 id 记账只响一次', /yiJingXiangGuo/.test(appJs));
check('创建那一刻就播音', /onAiWenTi/.test(appJs) && /chuanBoYinXiao\('request'\)/.test(appJs));
check('X/N 按时间正序', /createdAt\) \|\| 0\) - \(Number\(b\.createdAt/.test(appJs));
check('徽章 CSS', /\.aiqJiShu/.test(css));

console.log('\n[10] 文件卡片 / 看板');
check('文件名超链接样式', /\.pfMing/.test(css) && /text-decoration: underline/.test(css));
check('工作区只显文件夹名', /jianMing\(state\.gongZuoQuLuJing\)/.test(appJs));
check('去掉「生成于」', !/panel\.workfiles\.genAt/.test(appJs) || !/生成于/.test(appJs));
check('📁 右对齐', /margin-left: auto/.test(css));
check('词元消耗', zh['dashboard.tokenCost'] === '词元消耗');
check('成本有本地/估算/未定价', !!zh['cost.local'] && !!zh['cost.estHint'] && !!zh['cost.unpriced']);

console.log(`\n==== verify-features-99: ${pass} ok / ${fail} FAIL ====`);
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
