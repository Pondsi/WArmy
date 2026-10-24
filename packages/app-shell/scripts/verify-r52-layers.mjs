/**
 * verify-r52-layers.mjs（fast 档）—— 第 52 轮三件事的判据：
 *   ① 印象隐私过滤器的真值表（哪些算敏感、哪些不算）+ 私密改道的行为；
 *   ② 「什么进认知」的判据真值表；
 *   ③ 两条归档入口走同一条管线（关系断言，不钉字节）。
 * 每条判据都配负向：故意改坏必红（见文件末尾的变异体说明）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const g = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/yinxiang-guolv.js')).href);
const MAIN = fs.readFileSync(path.join(SRC, 'electron-main.ts'), 'utf8');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 120) : '')); } };

// ── ① 敏感类目真值表 ───────────────────────────────────────────────────
const MIN = [
  ['我确诊了抑郁症，一直在吃药', 'jiankang'],
  ['我离婚了，孩子抚养权在前妻那里', 'jiating-xinxi'],
  ['我的身份证号码请存好', 'shenfen-zhanghu'],
  ['信用卡逾期被起诉了', 'caiwu-falv'],
  ['我是同性恋，还没出柜', 'xing-bie-xiang'],
  ['我信佛，每月初一去寺庙', 'zongjiao-zhengzhi'],
  ['我妈妈叫王秀英，住某某小区', 'jiating-xinxi'],
  ['我怀孕三个月了', 'shengyu'],
  ['我的银行卡号是 6222 开头', 'caiwu-falv'],
];
const FEI = [
  '我不喜欢长篇大论，回复请简短',
  '以后都用中文回我',
  '这份报告我要 markdown 格式',
  '我习惯晚上十点之后别打扰我',
  '行不行你先说一声再动手',
  '我要一杯拿铁，别太甜',
  '验收时把截图一并给我',
];
for (const [wen, lei] of MIN) jian('敏感：' + wen.slice(0, 18) + ' → ' + lei, g.minGanLeiMing(wen) === lei, '实际=' + g.minGanLeiMing(wen));
for (const wen of FEI) jian('不算敏感：' + wen.slice(0, 18), g.minGanLeiMing(wen) === '', '实际=' + g.minGanLeiMing(wen));

// ── ② 认知判据真值表 ───────────────────────────────────────────────────
const RZ = [
  ['我习惯先写门禁再写实现', true],
  ['我的口吻偏简洁，不用敬语', true],
  ['我不喜欢把没跑通的命令说成跑完了', true],
  ['用户喜欢表格形式的汇报', false],
  ['以后都用中文回我', false],
  ['我确诊了抑郁症', false],
  ['我要一杯拿铁，别太甜', false],
  ['我一般先把验收标准写清楚再动手', true],
];
for (const [wen, yao] of RZ) jian('认知判定 ' + (yao ? '进' : '不进') + '：' + wen.slice(0, 16), g.qingShuYinRenZhi(wen) === yao, '实际=' + g.qingShuYinRenZhi(wen));

// ── ③ 归档两条入口 = 同一条管线（关系断言）────────────────────────────
jian('自动归档改为只调 guiDangYiGeHuiHua（不再自己走摘要核心）',
  /const r = await guiDangYiGeHuiHua\(k, \{ auto: true \}\)/.test(MAIN)
  && !/await shengChengHuiHuaZhaiYao\(k, true\)/.test(MAIN));
jian('手动归档也调同一个摘要核心（kind:archive + 锚点 + 结构化摘要两边都有）',
  /shengChengHuiHuaZhaiYao\(sid, opts\?\.auto === true\)/.test(MAIN));
jian('审计能分出是谁触发的、核心有没有成（chufa=auto|manual + guiDangHeXin）',
  /chuFa: opts\?\.auto \? 'auto' : 'manual'/.test(MAIN) && /guiDangHeXin: heXinOk/.test(MAIN)
  && /chat\.archive-core-fail/.test(MAIN));
jian('术参与归档归纳，且只在成功与降级两条路上都调', (MAIN.match(/guiNaShu\(\{ yuanHua/g) || []).length >= 2
  && /shu\.zhengli/.test(MAIN));
jian('术归纳有幻觉硬闸（必须能在素材里找到连续原话）',
  /if \(suCai\.length >= 10 && !suCai\.includes\(quZheng\(w\.slice\(0, 12\)\)\)\) continue;/.test(MAIN));
jian('敏感条目不写印象（改道私密库或丢弃，两条都记审计）',
  /const minGan = minGanLeiMing\(w\);/.test(MAIN) && /yinxiang\.sensitive-skipped/.test(MAIN));
jian('规范归档时交给整理模型（按规范归置结果）', /【本会话的规范（按它来归置）】/.test(MAIN));
jian('规范是每会话一份的文件 + 读写 IPC + 空则不注入',
  /function guiFanLu/.test(MAIN) && /warmy:guiFanDu/.test(MAIN) && /warmy:guiFanShe/.test(MAIN));

// ── ④ 道/术分工（第 52 轮项 1：做事的章法归术，道只留思想要领）────────
{
  const dao = fs.readFileSync(path.join(SRC, 'dao-default.ts'), 'utf8');
  const shu = fs.readFileSync(path.join(SRC, 'shu-default.ts'), 'utf8');
  for (const bu of ['## 五、节制', '## 六、把事做成', '## 七、与人协作']) {
    jian('道里不再有成篇的做事章法：' + bu, !dao.includes(bu));
  }
  for (const yao of ['先判后果', '不作恶、不操控', '求真', '不谄媚', '边界情形', '自检']) {
    jian('道的思想要领仍在场：' + yao, dao.includes(yao));
  }
  for (const yao of ['一、节制', '二、把事做成', '三、与人协作', '四、否定项 X 必须有出处']) {
    jian('术的出厂稿带上这条章法：' + yao, shu.includes(yao));
  }
  jian('术有出厂稿模块并真的被播种（缺失时写一次，之后归用户）',
    /function boZhongShuMoRen/.test(MAIN) && /boZhongDaoMoRen\(\);[\s\S]{0,40}boZhongShuMoRen\(\);/.test(MAIN)
    && /settings\.shu-md-seeded/.test(MAIN));
  jian('搬走之后道更短（不可压缩的那份要省着占窗口）', (() => {
    const zi = (t) => (/export const (?:DAO|SHU)_MOREN = `([\s\S]*?)`;/.exec(t) || [null, ''])[1].length;
    return zi(shu) > 900 && zi(dao) < 2600;
  })());
  jian('术仍可压缩（搬进术的东西必须让得了位）', !/BU_KE_YA_SUO = \[[^\]]*'术'/.test(fs.readFileSync(path.join(SRC, 'yuSuan-jiage.ts'), 'utf8')));
}

// ── ⑤ 卡片上的文件地址 = 超链接（第 52 轮项 5：与聊天框同一套打开/右键菜单）──
{
  const appJs = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const han = appJs.slice(appJs.indexOf('const huaLuJingChaoLian'), appJs.indexOf('const huaLuJingChaoLian') + 3200);
  jian('路径渲染成 <a class="pfLink luJingLian" data-open 的超链接（不是纯文本）',
    /className = 'pfLink luJingLian'/.test(han) && /setAttribute\('data-open', lu\)/.test(han) && /setAttribute\('data-link', '1'\)/.test(han));
  jian('左键 = 复用聊天框的 daKaiWenJian（nm 插件优先，停用回系统默认）', /daKaiWenJian\(p\)/.test(han) && !/window\.warmy\.openPath|shell\.openPath/.test(han));
  jian('右键 = 复用聊天框的 shouWenJianYouJianCaiDan（复制/复制路径/打开所在目录）', /shouWenJianYouJianCaiDan\(/.test(han));
  jian('第 53 轮项 3：右键菜单**不管存不存在都给**（复制路径对不存在的路径同样有用）',
    !/link\.getAttribute\('data-real'\) !== '1'/.test(han) && /if \(!link\) return;/.test(han));
  jian('第 53 轮项 3：左键点不存在的路径 ⇒ 如实提示"路径不存在"（不再把链接退化成纯文本）',
    /chat\.pathNotFound/.test(han) && /daKaiWenJian\(p\); return;/.test(han) && !/biaoJiZhenShiLuJing\(el\)/.test(han)
    && /luJingCunZai\?\.\(\[lu\]\)/.test(han));
  jian('卡片渲染只剩这一条路径（旧的"纯文本地址"写法已全部替换）',
    (appJs.match(/huaLuJingChaoLian/g) || []).length >= 3 && !/lu\.textContent = tOr\('wo\.beliefFile'/.test(appJs));
}

console.log('\n==== verify-r52-layers: ' + okN + ' ok / ' + failN + ' FAIL ====');
process.exit(failN ? 1 : 0);
