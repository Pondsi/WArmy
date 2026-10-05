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
check('是预警上限而不是硬上限', /YANXU_YUJING_CI/.test(emTs) && /ciYuJing \+= YANXU_YUJING_CI/.test(emTs));
check('时间预警 + 固定加一档（不是翻倍）', /YANXU_YUJING_SHIJIAN_MS/.test(emTs) && /shiJianYuJing \+= YANXU_YUJING_SHIJIAN_MS/.test(emTs));
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

console.log('\n[11] 工具调用在流式里不许丢（纯文本对话的根因）');
{
  const ollamaTs = fs.readFileSync(path.join(root, 'packages/providers/src/ollama.ts'), 'utf8');
  const openaiTs = fs.readFileSync(path.join(root, 'packages/providers/src/openai.ts'), 'utf8');
  check('Ollama 流式解析 tool_calls', /tool_calls/.test(ollamaTs) && /gongJuDiaoYongJi: liuGongJu/.test(ollamaTs));
  check('OpenAI 流式解析 tool_calls', /delta\?\.tool_calls/.test(openaiTs) && /gongJuDiaoYongJi: liuGongJu/.test(openaiTs));
  check('流式包装按 id 归并参数', /yiYou\.function\.arguments/.test(emTs));
  check('端点说 tool_calls 却没解析到 ⇒ 退回非流式', /chat\.stream-fallback-tools/.test(emTs));
}
console.log('\n[12] 看图模型能力识别（Ollama /api/show）');
{
  const ollamaTs = fs.readFileSync(path.join(root, 'packages/providers/src/ollama.ts'), 'utf8');
  check('Ollama 有 listModelsDetailed', /listModelsDetailed/.test(ollamaTs));
  check('走 /api/show 问能力', /api\/show/.test(ollamaTs));
  check('unknown 不盖掉已知表', /qBuZhi/.test(fs.readFileSync(path.join(root, 'packages/providers/src/mo-xing-neng-li.ts'), 'utf8')));
}
console.log('\n[13] 特殊模型链手动添加 + 牛马局分类模型已删');
check('手动添加下拉', /data-sml-add/.test(appJs) && !!zh['model.addManually']);
check('牛马局分类模型已移除', !/id="iFenLei"/.test(appJs));
check('预警点固定加一档', /ciYuJing \+=/.test(emTs) && !/ciYuJing \*=/.test(emTs));

console.log('\n[14] 引导卡：两份 CSS 必须一致，且在主界面右下角');
{
  const appCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
  const rCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
  // 取各自 .yinDaoTiao 规则块
  const block = (s) => (s.match(/\.yinDaoTiao\s*\{[^}]*\}/s) || [''])[0];
  const bApp = block(appCss);
  const bRen = block(rCss);
  check('两份 .yinDaoTiao 都存在', !!bApp && !!bRen);
  check('都不能有 translateY(-50%)（会让卡片拉高）', !/translateY\(-50%\)/.test(bApp) && !/translateY\(-50%\)/.test(bRen));
  check('都必须 top:auto（与 bottom 同时生效会拉伸）', /top:\s*auto/.test(bApp) && /top:\s*auto/.test(bRen));
  check('都必须有 bottom（右下角定位）', /bottom:\s*\d+px/.test(bApp) && /bottom:\s*\d+px/.test(bRen));
  check('都必须 height:auto（按内容收）', /height:\s*auto/.test(bApp) && /height:\s*auto/.test(bRen));
  check('两份定位参数一致（不许一份 top 一份 bottom）', /right:\s*16px/.test(bApp) === /right:\s*16px/.test(bRen) && /bottom:\s*16px/.test(bApp) && /bottom:\s*16px/.test(bRen));
}

console.log('\n[15] 历史不许被全省略 + 多任务能跑完 + 手动添加留得住');
{
  const cr = fs.readFileSync(path.join(root, 'packages/app-shell/src/context-renderer.ts'), 'utf8');
  check('视图绝不给空（日志非空时至少带最后一条）', /zhenShi\.length === 0/.test(cr) && /绝不给空视图/.test(cr));
  check('工具轮数默认 ≥12（多任务要跑完）', /zuiDaLunShu: Number\.isFinite\(lunShu\) \? Math\.min\(32/.test(emTs));
  check('手动添加的模型重绘不被踢掉', /st\.manual/.test(appJs) && /shouLiu = \(m\) => ids\.includes\(m\) \|\| st\.manual\.includes\(m\)/.test(appJs));
  check('manual 随设置落盘', /Manual'\]/.test(appJs));
}

console.log('\n[16] 思考过程：可滚动 + 自动跟最新 + 用户滚动就停');
{
  check('思考块可滚动（max-height + overflow）', /\.siKaoKuai pre\s*\{[^}]*max-height/.test(css) && /\.siKaoKuai pre\s*\{[^}]*overflow:\s*auto/.test(css));
  check('用户手动滚动就停止跟随', /userScrolled/.test(appJs));
  check('流式只改文本不重建 DOM（否则滚动被拍回顶部）', /si\.textContent = b\.reasoning/.test(appJs) && !/kuai\.innerHTML =[\s\S]{0,80}siKaoKuai/.test(appJs));
  check('限频带尾随（最后一段不丢）', /_liuShiDaiHua/.test(appJs));
}

console.log('\n[17] 提示音：AudioContext 主路（决策卡第 1 张没声音的根因）');
check('用 AudioContext 解码播放', /deDaoShangXiaWen/.test(appJs) && /jieMaYinPin/.test(appJs));
check('手势里 resume 解锁', /ctx\.resume\(\)/.test(appJs) && /createBufferSource/.test(appJs));
check('HTMLAudioElement 作兜底', /yinXiaoYuan\[k\]/.test(appJs));
check('播不出去排队补播', /yinXiaoDaiBo/.test(appJs) && /buBoChenJiYinXiao/.test(appJs));
check('音效失败有视觉兜底', /aiq\.newCard/.test(appJs) || /aiq\.newCard/.test(String(zh['aiq.newCard'] || '')));

console.log(`\n==== verify-features-99: ${pass} ok / ${fail} FAIL ====`);
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
