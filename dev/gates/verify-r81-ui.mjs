/** R81 UI/数据回归：引导自动前进、删除模型彻底清理、预算文案、微信入站展示、流式滚动抑制。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/auth-gate.js'), 'utf8');
const gateCss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/auth-gate.css'), 'utf8');
let ok = 0, fail = 0;
const j = (n, p, d) => { p ? ok++ : fail++; console.log(`${p ? 'ok  ' : 'FAIL'} ${n}${p ? '' : ' ← ' + String(d || '').slice(0, 300)}`); };

j('开始使用清单按真实状态自动判定（供应商/模型/牛马/第一句）',
  /function sgReady\(\)/.test(app) && /startGuide\.step\.provider/.test(app) && /startGuide\.step\.chat/.test(app)
  && /__startGuideChatDone/.test(app));
j('清单去操作能定位供应商入口 / 拉取模型 / 创建牛马',
  /provTianJiaRuKou/.test(app) && /data-prov-id/.test(app) && /data-fetch/.test(app) && /lieBiaoDongZuo/.test(app));
j('删除模型走全局清理（供应商 models/默认/链/牛马/特殊链）',
  /function shanChuMoXingQuanJu/.test(app) && /window\.__shanChuMoXingQuanJu = shanChuMoXingQuanJu/.test(app)
  && (app.match(/__shanChuMoXingQuanJu\?\./g) || []).length >= 2);
j('#14 模型管理器里 ×/右键删除也走全局清理，不会从供应商补回链尾',
  /const shanMoXing = async[\s\S]{0,1400}__shanChuMoXingQuanJu/.test(app));
j('#9/#10 第四列不再有“项目记忆/印象”卡（印象只剩「我的」页入口）',
  !/id="xiangMuJiYiKuai"/.test(html) && !/id="mianBanYinXiangKuai"/.test(html));
j('#11 「要求」卡在每个会话都可见；「规范」卡已移除',
  /set\('mianBanYaoQiuKuai', vis\.mianBanYaoQiuKuai\);/.test(app)
  && /single: \[[^\]]*mianBanYaoQiuKuai/.test(app)
  && !/id="mianBanGuiFanKuai"/.test(html));
j('#8 默认道随语言变化（用户手动改过的道保持原样）',
  /\{ ceng: '道', lu: daoLu, wen: yu\.dao \}/.test(main) && /shiChuChangGao\(cur\)/.test(main));
j('设置「最近删除」在功能分区，不在关于底部',
  /<div class="sheZhiSection sheZhiKa" id="laJiKuai" data-sec="func">/.test(app)
  && !/<div class="aboutKuai" id="laJiKuai">/.test(app));
j('首启窗口：大屏固定 1280×800、小屏缩到不小于 960×600、更小全屏',
  /SHOU_QI_KUAN = 1280/.test(main) && /SHOU_QI_ZUI_XIAO_KUAN = 960/.test(main) && /setFullScreen\(true\)/.test(main));
j('首启右上角关闭：热区隐藏、悬停显示、点击退出程序',
  /warmyAuthCloseHot/.test(gate) && /warmyAuthCloseX/.test(gate) && /appQuit\?\.\('first-run-close'\)/.test(gate)
  && /\.warmyAuthCloseHot:hover \.warmyAuthCloseX/.test(gateCss));
j('#112 项目/群/联系人右键有「查看」并打开信息弹窗',
  /biaoQian: tOr\('ctx\.view', '查看'\)[\s\S]{0,120}kanQunKuang\(g\)/.test(app)
  && /biaoQian: tOr\('ctx\.view', '查看'\)[\s\S]{0,120}kanLianXiRenKuang\(c\)/.test(app)
  && /function kanQunKuang\(g\)/.test(app) && /function kanLianXiRenKuang\(c\)/.test(app));
j('上下文预算不再显示“约等于词元”',
  /iCtxBudgetTokens/.test(app) && /上下文长度/.test(app) && !/约等于/.test(app));
j('#26 提示词上限与简体中文一致，切语言清缓存（所有语言按同一数字判，不再放大）',
  /__tiShiShangXianBiao/.test(app) && /cun\.lang === state\.yuYan/.test(app)
  && /state\.yuYan = pack\.yuYan;[\s\S]{0,260}__tiShiShangXianBiao = null/.test(app));
j('微信入站展示用主题色图标 + 可折叠标题，不再方括号前缀',
  /WECHAT_TU_BIAO/.test(app) && /jieXiWechatLaiXin/.test(app) && /wechatLaiXinHead/.test(app));
j('流式渲染也受“用户已接管”锁约束',
  /!topAlignSuppress\.has\(sidLiu\)/.test(app) && /_liuShiDaiHua/.test(app));

/* ── 法律文案：10 语言正文 + 联系方式去重 + 中文完整版入口 ── */
const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/i18n', l + '.json'), 'utf8'))]));
const oneMail = (s) => (String(s).match(/Public@numumu\.com/g) || []).length === 1 && String(s).includes('232307860@qq.com');
j('隐私/使用条款：10 语言正文非空、联系方式去重且含 QQ 邮箱',
  LANGS.every((l) => String(packs[l]['privacy.body'] || '').trim().length > 500 && oneMail(packs[l]['privacy.body']) && oneMail(packs[l]['about.contactBody'])),
  LANGS.filter((l) => !(String(packs[l]['privacy.body'] || '').trim().length > 500 && oneMail(packs[l]['privacy.body']) && oneMail(packs[l]['about.contactBody']))));
const NON_CJK = ['fr', 'es', 'pt', 'ru', 'eo'];
const enBody = String(packs['en-US']['privacy.body'] || '');
j('其余 8 语言法律全文不再英文兜底（非英文；拉丁/西里尔语言无残留中文）',
  ['zh-TW', 'ja', 'ko', ...NON_CJK].every((l) => String(packs[l]['privacy.body'] || '') !== enBody)
  && NON_CJK.every((l) => !/[\u4e00-\u9fff]/.test(String(packs[l]['privacy.body'] || '').replace(/无限牛马/g, ''))),
  ['zh-TW', 'ja', 'ko', ...NON_CJK].filter((l) => String(packs[l]['privacy.body'] || '') === enBody));
const LLM_KEYS = ['llm.identityAnchor', 'llm.delegateUseIt', 'llm.modelLine', 'shejiao.hint', 'model.kindHint.fenLei', 'settings.skillsHotReload', 'model.kindHint.imageUnd', 'model.kindHint.chat', 'model.kindHint.reasoning'];
j('9 个提示词片段在 8 种语言里都已翻译（不再等于英文）',
  ['zh-TW', 'ja', 'ko', ...NON_CJK].every((l) => LLM_KEYS.every((k) => String(packs[l][k] || '') !== String(packs['en-US'][k] || ''))),
  ['zh-TW', 'ja', 'ko', ...NON_CJK].flatMap((l) => LLM_KEYS.filter((k) => String(packs[l][k] || '') === String(packs['en-US'][k] || '')).map((k) => l + ':' + k)));
const zhBody = String(packs['zh-CN']['privacy.body'] || '');
j('zh-CN 联系方式逐字符合要求，且“完整版”指向仓库两份文档',
  zhBody.includes('Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy')
  && zhBody.includes('docs/PRIVACY.md') && zhBody.includes('docs/TERMS.md') && !/第九节删除/.test(zhBody)
  && packs['zh-CN']['about.contactBody'] === 'Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy');
const privacyMd = fs.readFileSync(path.join(ROOT, 'docs/PRIVACY.md'), 'utf8');
const termsMd = fs.readFileSync(path.join(ROOT, 'docs/TERMS.md'), 'utf8');
j('文档版隐私政策/使用条款含同一联系方式与版本号',
  oneMail(privacyMd) && oneMail(termsMd) && /版本\*\*：2\.0/.test(privacyMd) && /版本\*\*：2\.0/.test(termsMd)
  && privacyMd.includes('Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy')
  && termsMd.includes('Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy'));

console.log(`\nverify-r81-ui: ${ok} ok / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
