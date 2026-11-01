#!/usr/bin/env node
/**
 * verify-r99-five-axis —— 第 99 轮五级三轴 / 模型档位映射 / 派发权限 / 本轮 UI 接缝。
 *
 * 判据尽量落在**行为**上（调用纯函数、喂输入、断言输出），源码只用于“接线存在”的静态检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const dist = (f) => pathToFileURL(path.join(pkg, 'dist', f)).href;
const [D, M, P, A, R, T] = await Promise.all([
  import(dist('nan-yi-du.js')),
  import(dist('model-pick.js')),
  import(dist('zhi-ban-pai-fa.js')),
  import(dist('agent-tools.js')),
  import(dist('runtime.js')),
  import(pathToFileURL(path.join(pkg, '..', '..', 'packages', 'providers', 'dist', 'mo-xing-neng-li.js')).href),
]);

let pass = 0; let fail = 0; const bad = [];
const jian = (m, c, d) => {
  if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; bad.push(m); console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + JSON.stringify(d))); }
};
const read = (p) => { try { return fs.readFileSync(path.join(pkg, p), 'utf8'); } catch { return ''; } };
const app = read('src/renderer/app.js');
const html = read('src/renderer/index.html');
const css = read('src/renderer/app.css');
const main = read('src/electron-main.ts');
const preload = read('src/preload.cjs');

console.log('[1] 三轴各五档与中文档名');
{
  jian('难易五档', ['很难', '较难', '难易适中', '较易', '极易'].every((x) => Object.values(D.NAN_BAN).includes(x)));
  jian('杂简五档', ['很杂', '较杂', '杂简适中', '较简', '极简'].every((x) => Object.values(D.ZA_BAN).includes(x)));
  jian('急缓五档', ['很急', '较急', '急缓适中', '较缓', '极缓'].every((x) => Object.values(D.JI_BAN).includes(x)));
  jian('P0–P4 → 5..1', [5, 4, 3, 2, 1].every((v, i) => D.jinJiCongP('P' + i) === v));
  jian('“马上”抬一档、“不急”压一档', D.jiCongWenBen('P2', '马上做') === 4 && D.jiCongWenBen('P2', '不急，慢慢来') === 2);
}

console.log('[2] 难易定模型档、杂简定思考档，急缓只在允许范围压思考');
{
  const a = D.panDuanNanZa(5, 5, 3, 0.8, 'P1');
  jian('很难+很杂+较急 ⇒ high/l6', a.modelTier === 'high' && a.thinkLevel === 'l6', a);
  const b = D.panDuanNanZa(1, 1, 1, 0.8, 'P4');
  jian('极易+极简+极缓 ⇒ low/off', b.modelTier === 'low' && b.thinkLevel === 'off', b);
  const c = D.panDuanNanZa(2, 5, 3, 0.8, 'P2');
  jian('较易+很杂 ⇒ low/l6（杂不冒充难）', c.modelTier === 'low' && c.thinkLevel === 'l6', c);
  const d = D.panDuanNanZa(4, 1, 3, 0.8, 'P2');
  jian('较难+极简 ⇒ high/l3（难不冒充杂）', d.modelTier === 'high' && d.thinkLevel === 'l3', d);
  const e = D.panDuanNanZa(2, 1, 1, 0.8, 'P0');
  jian('很急+简单 ⇒ 思考可低，但不低于难易下限 l1', e.thinkLevel === 'l1', e);
  const f = D.panDuanNanZa(4, 1, 3, 0.4, 'P2');
  jian('顶模型低置信 ⇒ 简任务也抬到 l6', f.thinkLevel === 'l6', f);
  const g = D.panDuanNanZa(4, 3, 3, 0.8, 'P1');
  const h = D.panDuanNanZa(4, 3, 3, 0.8, 'P2');
  jian('难/杂已定下限时，急缓不改思考与模型档', g.thinkLevel === h.thinkLevel && g.modelTier === h.modelTier, [g, h]);
}

console.log('[3] 派发：插话五档 + 值班者自执行门槛');
{
  const C = (id, extra = {}) => ({ id, ming: id, status: 'running', order: 0, ...extra });
  const du = (ji) => ({ nan: 3, za: 3, ji, importance: 3, modelTier: 'mid', thinkLevel: 'l4' });
  const mk = (u, stop = false) => P.paiFaZhiXingZhe({ urgency: u, content: '干活', difficulty: du(D.jinJiCongP(u)), stopIntent: stop, candidates: [C('a', { busy: true })] });
  jian('P0 + 明确停止 ⇒ stop', mk('P0', true).assignments[0]?.interrupt === 'stop');
  jian('P1 + 忙碌 ⇒ urgent', mk('P1').assignments[0]?.interrupt === 'urgent');
  jian('P2 + 忙碌 ⇒ insert', mk('P2').assignments[0]?.interrupt === 'insert');
  jian('P3 + 忙碌 ⇒ queue', mk('P3').assignments[0]?.interrupt === 'queue');
  jian('P4 + 忙碌 ⇒ queue', mk('P4').assignments[0]?.interrupt === 'queue');
  jian('执行者 66% / 值班者 44% ⇒ 可自执行', P.zhiBanKeZiXing({ hasExecutor: true, executorConfidence: 0.66, dutyConfidence: 0.44 }).ok);
  jian('执行者 65% ⇒ 不可自执行', !P.zhiBanKeZiXing({ hasExecutor: true, executorConfidence: 0.65, dutyConfidence: 0.1 }).ok);
  jian('值班者 45% ⇒ 不可自执行', !P.zhiBanKeZiXing({ hasExecutor: true, executorConfidence: 0.9, dutyConfidence: 0.45 }).ok);
  jian('没有执行者 ⇒ 可自执行', P.zhiBanKeZiXing({ hasExecutor: false, executorConfidence: 0, dutyConfidence: 0.9 }).ok);
  jian('用户明确要求 ⇒ 可自执行', P.zhiBanKeZiXing({ hasExecutor: true, userAsked: true, executorConfidence: 0, dutyConfidence: 0.9 }).ok);
  jian('用户说“你自己做”能被识别', P.yongHuYaoQiuZhiBanZiZuo('你自己做吧，别派了'));
}

console.log('[4] 智能模式：难⇒强模型、急⇒快/云端；非智能严格链');
{
  const chain = ['local-small', 'cloud-pro', 'cloud-flash'];
  const benDi = ['local-small'];
  const hard = M.jueCeMoXing({ smartMode: true, chain, benDiMoXing: benDi, nan: 5, ji: 3 });
  jian('很难 ⇒ 云端强模型 cloud-pro', hard.model === 'cloud-pro', hard);
  const easy = M.jueCeMoXing({ smartMode: true, chain, benDiMoXing: benDi, nan: 1, ji: 3 });
  jian('极易 ⇒ 本地小模型 local-small', easy.model === 'local-small', easy);
  const urgent = M.jueCeMoXing({ smartMode: true, chain, benDiMoXing: benDi, nan: 3, ji: 5 });
  jian('很急 + 中等难 ⇒ 带 flash 的快模型', urgent.model === 'cloud-flash', urgent);
  const strict1 = M.jueCeMoXing({ smartMode: false, chain, defaultModel: '', nan: 5, ji: 5 });
  jian('非智能 ⇒ 严格按链头（急/难都不跳位）', strict1.model === 'local-small' && strict1.why === 'chain' && strict1.chainIndex === 0, strict1);
  const strict2 = M.jueCeMoXing({ smartMode: false, chain, defaultModel: 'cloud-flash', nan: 5, ji: 5 });
  jian('非智能 ⇒ 默认模型先试', strict2.model === 'cloud-flash' && strict2.why === 'default', strict2);
  const skipped = M.jueCeMoXing({ smartMode: false, chain, defaultModel: 'cloud-flash', tiaoGuo: ['cloud-flash'], nan: 5 });
  jian('默认失败 ⇒ 严格从链头再来', skipped.model === 'local-small' && skipped.chainIndex === 0, skipped);
}

console.log('[5] 思考档位按模型实际档位百分比映射（6 档 / 3 档 / 10 档）');
{
  const a = T.gouJianDangWeiAnShe(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  jian('6 档：off→最弱、l6→最强', a.woDaoMo.off === 'none' && a.woDaoMo.l6 === 'max', a.woDaoMo);
  jian('6 档：l3+l4 都落在 high（比例映射允许重合）', a.woDaoMo.l3 === 'high' && a.woDaoMo.l4 === 'high', a.woDaoMo);
  const b = T.gouJianDangWeiAnShe(['low', 'medium', 'high']);
  jian('3 档：低/低/中/中/中/高/高', ['low', 'low', 'medium', 'medium', 'medium', 'high', 'high'].every((v, i) => b.woDaoMo[['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'][i]] === v), b.woDaoMo);
  const ten = Array.from({ length: 10 }, (_, i) => 'lv' + (i + 1));
  const c = T.gouJianDangWeiAnShe(ten);
  jian('10 档：7 个内部档都有实际档位（不出现“不支持”）', ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'].every((k) => !!c.woDaoMo[k]), c.woDaoMo);
  jian('10 档：off=最弱、l6=最强', c.woDaoMo.off === 'lv1' && c.woDaoMo.l6 === 'lv10', c.woDaoMo);
  jian('auto 单独映射，不占具体档比例', T.gouJianDangWeiAnShe(['low', 'medium', 'high', 'auto']).woDaoMo.auto === 'auto');
}

console.log('[6] 三档授权语义（常规/严格/完全）');
{
  const base = path.join(pkg, 'dist');
  const B = path.join(base, '..', '..', '..'); // 仅用于工作区字符串
  const p = (dang, cmd) => A.panDuanMingLingShouQuan(dang, true, cmd, base);
  jian('常规：工作区内 tar 直接放行', p('normal', 'tar -czf out.tgz .').allow);
  jian('常规：工作区内非白名单 ffmpeg 询问', p('normal', 'ffmpeg -i a.mp4 b.mp4').needAsk);
  jian('常规：工作区外 /etc/passwd 询问', p('normal', 'cat /etc/passwd').needAsk);
  jian('严格：白名单命令也询问', p('strict', 'tar -czf out.tgz .').needAsk);
  jian('完全：任意命令放行（项目/他人会话由上层再问）', p('full', 'rm -rf /tmp/x').allow);
  jian('常规：工作区内绝对路径允许（防判据过严）', A.mingLingZaiGongZuoQu('cat ' + path.join(base, 'x.txt'), base).ok);
  void B;
}

console.log('[7] 本轮 UI 接缝（静态）');
{
  jian('滚动：只有“跟底”事实，旧 anchorTurn 置顶逻辑不在重画路径',
    /function chatGenDi/.test(app) && /function sheZhiGenDi/.test(app)
    && !/st\.anchorTurn = turnKey/.test(app) && /const baoHuTop = genDiLiu \? null : heZi\.scrollTop/.test(app));
  jian('语音：发送置灰 + 重组语言 + 自动发送 + 整理模型 IPC',
    /yuYinJinZhi/.test(app) && /zhengLiKeYong/.test(app) && /zhengLiWenBen/.test(app)
    && /yuYinChongZuBox/.test(html) && /yuYinZiDongFaSongBox/.test(html));
  jian('语音快捷键已进设置注册表并挂到发送/话筒',
    /id: 'voiceInput'/.test(app) && /id: 'sendMessage'/.test(app) && /anNiuFaSong: 'sendMessage'/.test(app));
  jian('文本编辑器改为 nm 查看器聊天编辑模式（实时回传、不保存）',
    /warmy:chatEditorKai/.test(main) && /warmy:chatEditorSync/.test(main) && /chatEditorSync/.test(read('src/renderer/nm-viewer.js'))
    && /chatEditor/.test(read('src/renderer/nm-viewer.js')));
  jian('nm 查看器最大化时按第四列宽度贴右缘',
    /nmSheZhiMianBanKuan/.test(main) && /isMaximized\(\)/.test(read('src/nm-viewer-win.ts'))
    && /zb\.x \+ zb\.width - kuan2/.test(read('src/nm-viewer-win.ts')));
  jian('独立会话窗标题用会话名（不再被 i18n 改写）',
    /mode.*=== 'fu'/.test(app) && /document\.title = duLi && ming0 \? ming0 : displayName\(\)/.test(app));
  jian('引导卡可拖动/贴边且 z-index 高于普通弹窗',
    /startGuidePos/.test(app) && /startGuide/.test(css) && /z-index: 1100/.test(css));
  jian('授权卡删除“本会话允许工作区内命令”',
    !/shouQuanCmdHang/.test(app) && !/workspaceCmdAllowed/.test(main) && !/authWorkspaceCmd/.test(preload));
  jian('急缓五档有 P4 选项与 10 语言标签',
    /data-u="P4"/.test(html) && ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'fr', 'es', 'pt', 'eo']
      .every((l) => { try { return !!JSON.parse(read('src/i18n/' + l + '.json'))['urgency.verySlowLabel']; } catch { return false; } }));
  jian('实例上限至少 10', R.jianYiZuiDaShiLiShu(2) === 10 && R.jianYiZuiDaShiLiShu(64) === 16);
}

console.log('');
if (fail) {
  console.log(`==== verify-r99-five-axis: ${pass} ok / ${fail} FAIL ====`);
  console.log('失败项：\n - ' + bad.join('\n - '));
  process.exit(1);
}
console.log(`==== verify-r99-five-axis: ${pass} ok / 0 FAIL ====`);
