#!/usr/bin/env node
/**
 * verify-r97-static —— 第 97 轮静态/真值表门禁（不启 Electron）。
 *
 * 覆盖：
 *  1 助记拼音只留拼音本体、中文与序号并排；
 *  2/3/11 滚动控制器：用户接管不清除、下箭头强制到底、未勾选新内容首行锚点；
 *  4 工具记录按消息归属 + 内部续派不清空思考分段 + 主进程也攒分段；
 *  5 二进制编辑框 placeholder = 原字节；
 *  6 nm 菜单同按钮/点外部收起；
 *  7 新 nm 永远贴主窗口右侧同高、右侧已占不吸附、拖 nm 不反向拖主窗；
 *  8 智能选型：链顺序优先；P3 优先本地/免费；默认模型下拉会退出智能模式；
 *  9 默认落点工作区：提示词 + 宿主兜底改道。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/app-shell');
const app = fs.readFileSync(path.join(PKG, 'src/renderer/app.js'), 'utf8');
const auth = fs.readFileSync(path.join(PKG, 'src/renderer/auth-gate.js'), 'utf8');
const authCss = fs.readFileSync(path.join(PKG, 'src/renderer/auth-gate.css'), 'utf8');
const nm = fs.readFileSync(path.join(PKG, 'src/renderer/nm-viewer.js'), 'utf8');
const nmCss = fs.readFileSync(path.join(PKG, 'src/renderer/nm-viewer.css'), 'utf8');
const main = fs.readFileSync(path.join(PKG, 'src/electron-main.ts'), 'utf8');
const pick = fs.readFileSync(path.join(PKG, 'src/model-pick.ts'), 'utf8');
const work = fs.readFileSync(path.join(PKG, 'src/work-tools.ts'), 'utf8');
const nmWin = fs.readFileSync(path.join(PKG, 'src/nm-viewer-win.ts'), 'utf8');
const pickJs = path.join(PKG, 'dist/model-pick.js');
const M = fs.existsSync(pickJs) ? await import(pathToFileURL(pickJs).href) : null;

let pass = 0, fail = 0;
const failures = [];
const jian = (m, c, d) => {
  if (c) { pass++; console.log('  ok   ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 260))); }
  else { fail++; failures.push(m); console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))); }
};
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return j < 0 ? s.slice(i) : s.slice(i, j); };
const fnBody = (s, name) => { const i = s.indexOf('function ' + name); if (i < 0) return ''; let d = 0, st = -1; for (let k = i; k < s.length; k++) { if (s[k] === '{') { if (d === 0) st = k; d++; } else if (s[k] === '}') { d--; if (d === 0) return s.slice(i, k + 1); } } return s.slice(i); };

console.log('[1] 助记拼音');
{
  const mark = fnBody(auth, 'mnemonicMarkup');
  jian('勾选拼音的分支只渲染中文+拼音，不再渲染英文本体',
    /useFriendly[\s\S]{0,900}warmyAuthWordText[\s\S]{0,400}warmyAuthWordPinyin[\s\S]{0,200}:\s*`<span class="warmyAuthWordEn"/.test(mark));
  jian('中文与序号同排（第 1 行），拼音第 2 行且主题色',
    /\.warmyAuthWordFriendly \.warmyAuthWordText\s*\{[^}]*grid-row:\s*1/.test(authCss)
    && /\.warmyAuthWordFriendly \.warmyAuthWordPinyin\s*\{[^}]*grid-row:\s*2[^}]*color:\s*var\(--accent\)/.test(authCss));
}

console.log('[2/3/11] 聊天滚动控制器');
{
  jian('用户滚回底部/点下箭头才解除接管；发新消息不再 delete topAlignSuppress',
    !/role === 'wo' && !\(opts && opts\.system\)\) \{\s*topAlignSuppress\.delete/.test(app));
  jian('下箭头：清接管 + forceBottom，随后滚动到底', /function scrollToBottom[\s\S]{0,900}topAlignSuppress\.delete\(sid\)[\s\S]{0,500}forceBottom = true[\s\S]{0,300}sheZhiChatGunDong\(heZi, heZi\.scrollHeight/.test(app));
  jian('scroll 事件位置对不上程序目标即判用户（不再只靠 180ms）',
    /Math\.abs\(topNow - muBiao\) > 2[\s\S]{0,300}markUserScrolled\(\)/.test(app));
  jian('同会话重画不再被 chatScrollPos 强制 keepScroll（只有切换会话才恢复）',
    /const qieHuiHua = !!sid0 && !!domSid0 && domSid0 !== String\(sid0\)/.test(app)
    && /if \(sid0 && he0 && qieHuiHua && !opts\?\.keepScroll\)/.test(app));
  jian('未勾选新内容锚点：记录元素并在最终 DOM 改动后重新量、再应用',
    /st\.anchorEl = anchorNode/.test(app) && /function chatAnchorTop/.test(app)
    && /requestAnimationFrame\(buZuiZhongGunDong\)/.test(app));
  jian('流式锚点用元素重新量，不再只存一次偏移', /stLiu\.anchorEl !== kuai/.test(app) && /chatAnchorTop\(heZi, stLiu\)/.test(app));
}

console.log('[4] 思考/工具时序');
{
  jian('每条操作按时间归到所属回复（guiShuMuBiao + 流式目标）',
    /function guiShuMuBiao\(/.test(app) && /const assign = new Map/.test(app)
    && /guiShuMuBiao\(thems, yongHuTs, liuShiNode/.test(app));
  jian('旧数据单块思考按时间切段后仍可穿插', /function chaiDanSiKao/.test(app) && /siKaoGuSuan/.test(app));
  jian('内部续派轮不再清空思考分段/中间回复', /第 97 轮项 4：\*\*内部续派只是同一轮里的下一次模型请求\*\*/.test(app)
    && /if \(xinRenWu\) \{[\s\S]{0,500}siKaoQing\(sid\)/.test(app));
  jian('主进程也按工具开始封段，并在最终日志/返回值带 reasoningDuan',
    /function zhuSiKaoZhui/.test(main) && /zhuSiKaoFeng\(sessionId\)/.test(main)
    && /reasoningDuan: (?:siKaoBenLun|zhuSiKaoQu\(sessionId\))/.test(main));
  jian('最终回复的 reasoningDuan 回到渲染层', /reasoningDuan: Array\.isArray\(r\.reasoningDuan\)/.test(app));
}

console.log('[5/6/10] nm 查看器');
{
  jian('二进制编辑框为空时 placeholder 是当前字节原值', /shu\.placeholder = yuanZiJie == null \? '\?\?' : yuanZiJie\.toString\(16\)\.toUpperCase\(\)\.padStart\(2, '0'\)/.test(nm));
  jian('同一个菜单按钮再点收起', /caiDanZuiHou\.anchor === anchor && caiDanZuiHou\.zhongLei === zhongLei/.test(nm));
  jian('点菜单外任意位置收起（不再放过整个工具栏）', /const anchor = caiDanZuiHou && caiDanZuiHou\.anchor;[\s\S]{0,200}guanCaiDan\(\)/.test(nm));
  jian('拖动分隔条时预览 iframe 不吃指针事件', /body\.tuoFenGe #yuLanLie,[\s\S]{0,120}pointer-events:\s*none !important/.test(nmCss));
  jian('收起预览后源码铺满', /el\('juanCuo'\)\.style\.flex = zt\.fenLanYouShou \? '1 1 0'/.test(nm));
}

console.log('[7] 窗口吸附/新窗口落点');
{
  jian('新 nm 永远贴主窗右侧、高度同主窗', /let x = zb\.x \+ zb\.width/.test(nmWin)
    && /let gao2 = Math\.max\(300, zb\.height\)/.test(nmWin));
  jian('只有主窗右边空闲才默认吸附；已占则重叠不吸附', /const youBianKong = zhu\.xiFu && zhu\.bian\.you == null/.test(nmWin)
    && /fuZhu: keFu && youBianKong \? zhu : null/.test(nmWin));
  jian('拖 nm 不反向拖主窗（分量循环里也排除主窗）', /if \(id === NM_ZHU_CHUANG_ID && Z\.id !== NM_ZHU_CHUANG_ID\) continue;/.test(nmWin));
}

console.log('[8] 模型路由');
{
  if (!M) { jian('模型决策器构建产物存在', false); }
  else {
    const chain = ['Ollama · qwen', 'MiMo · pro'];
    for (const u of ['P0', 'P1', 'P2', 'P3']) {
      const r = M.jueCeMoXing({ defaultModel: '__smart__', chain, benDiMoXing: ['qwen'], urgency: u });
      jian(`第 98 轮：${u} 不再改变链位次（严格取链头）`, r.model === 'qwen' && r.chainIndex === 0, r);
    }
    const failed = M.jueCeMoXing({ defaultModel: 'qwen', chain, tiaoGuo: ['qwen'] });
    jian('默认失败 ⇒ 严格顺链到下一个', failed.model === 'pro' && failed.chainIndex === 1, failed);
    const smHi = M.jueCeMoXing({ smartMode: true, modelTier: 'high', chain, benDiMoXing: ['qwen'] });
    jian('智能 high ⇒ 链上云端强模型（pro）', smHi.model === 'pro' && smHi.why === 'smart' && smHi.chainIndex === 1, smHi);
    const smLow = M.jueCeMoXing({ smartMode: true, modelTier: 'low', chain, benDiMoXing: ['qwen'] });
    jian('智能 low ⇒ 链上本地/免费（qwen）', smLow.model === 'qwen' && smLow.why === 'smart' && smLow.chainIndex === 0, smLow);
  }
  jian('默认模型下拉选具体模型时退出智能模式', /inst2\.smartMode = zhiNeng;/.test(app)
    && /inst2\.defaultModel = zhiNeng \? '' : defSel\.value;/.test(app));
  jian('智能模式才用本地/免费清单与难易度档位（非智能严格链不看它们）',
    /smartMode/.test(main) && /modelTier/.test(main) && /benDiMoXing/.test(main) && /lieBenDiMoXing/.test(main));
}

console.log('[9] 默认落点工作区');
{
  jian('系统提示明确默认落点=工作区，桌面需用户明确要求', /默认落点/.test(main) && /不要为了"方便用户找"自行放到桌面/.test(main));
  jian('write_file 工具说明默认工作区、用户未要求禁止 Desktop', /用户没有明确要求桌面\/文档\/下载时，禁止自行使用 Desktop/.test(work));
  jian('宿主兜底：未点名桌面/文档/下载时把系统目录写入改回工作区',
    /chat\.default-workspace-fixed/.test(main) && /用户没有指定桌面\/文档\/下载，按默认规则写到工作区/.test(main));
}

console.log(`\n==== verify-r97-static: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
process.exitCode = fail ? 1 : 0;
