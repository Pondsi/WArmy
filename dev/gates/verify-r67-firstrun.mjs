/**
 * verify-r67-firstrun —— 第 67 轮首启 / 认证 UI 静态门禁
 *
 * 覆盖：首启语言页（只有下拉+开始）、像素风循环动画、完整条款 + 3 秒 + 底部判据、
 * 有账号/无账号分流、拼音勾选修复、用户名 grapheme 校验、PIN 文案替换、10 语言字典、
 * 我的页账号卡 / openMnemonic、auth-service 新增方法、自动化旁路。
 * 第 68 轮追加：我的页三块布局、助记词已保存/查看、自动登录与修改 PIN 联动、
 * 助记词登录/自动登录后旧 PIN 与旧自动登录必须失效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const js = rd(path.join(SRC, 'renderer/auth-gate.js'));
const css = rd(path.join(SRC, 'renderer/auth-gate.css'));
const svc = rd(path.join(SRC, 'auth-service.ts'));
const core = rd(path.join(SRC, 'auth-core.mjs'));

const jie = [];
const panding = (ming, zhen, xiang) => jie.push({ ming, ok: !!zhen, xiang: xiang === undefined ? '' : String(xiang).slice(0, 320) });

function between(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}
function fnBody(src, name) {
  const marker = `function ${name}(`;
  const i = src.indexOf(marker);
  if (i < 0) return '';
  let depth = 0;
  let started = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') {
      depth--;
      if (started && depth === 0) return src.slice(i, k + 1);
    }
  }
  return '';
}

const renderLanguage = fnBody(js, 'renderLanguage');
const sceneFn = fnBody(js, 'firstRunSceneLight');
const beastFn = fnBody(js, 'beastSvg');
const renderTerms = fnBody(js, 'renderTerms');
const syncTermsGate = fnBody(js, 'syncTermsGate');
const enterTerms = fnBody(js, 'enterTerms');
const enterAuth = fnBody(js, 'enterAuth');
const renderRegisterIntro = fnBody(js, 'renderRegisterIntro');
const onClick = fnBody(js, 'onClick');
const renderPinSetup = fnBody(js, 'renderPinSetup');
const decorateMyPage = fnBody(js, 'decorateMyPage');
const openMnemonic = fnBody(js, 'openMnemonic');
const submitUsername = fnBody(js, 'submitUsername');
const loadPack = fnBody(js, 'loadPack');
const renderFn = fnBody(js, 'render');
const bootFn = between(js, 'async function boot()', '// ── My page card');
const pinSubmitBranch = between(js, 'if (action === \'pin-submit\')', 'if (action === \'username-finish\')');
const viewerBranch = between(js, 'if (action === \'viewer-later\'', 'async function submitUsername');

/* ── 1. 首启第一屏：语言平铺（R78 取代下拉） ─────────────────────── */
panding('项1 首启语言页平铺 10 种语言 + 开始按钮（不再有下拉框）',
  /warmyAuthLangGrid/.test(renderLanguage) && /warmyAuthLangTile/.test(renderLanguage)
  && /language-start/.test(renderLanguage) && /warmyAuthSceneEmbed/.test(js)
  && !/warmyAuthLangMenu|aria-haspopup|<select/.test(renderLanguage)
  && /LOCALES\.map/.test(renderLanguage)
  && /data-auth-action="lang-pick"/.test(renderLanguage));
panding('项1 语言块是两列平铺网格，选中态本地标出（点一下即选）',
  /\.warmyAuthLangGrid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/.test(css)
  && /\.warmyAuthLangTile\s*\{/.test(css) && /\.warmyAuthLangTile\.is-on\s*\{/.test(css)
  && /\.warmyAuthFirstCard\.warmyAuthLangCard\s*\{[^}]*flex-direction:\s*column/.test(css));
panding('项1 语言页不渲染标题/说明/品牌块',
  !/warmyAuthTitle|warmyAuthSub|warmyAuthBrand|warmyAuthLogo|header\(/.test(renderLanguage)
  && !/<select/.test(renderLanguage)
  && (renderLanguage.match(/t\('/g) || []).length === 1);
panding('项1 开始按钮文案来自 10 语言字典的 start',
  /t\('start'\)/.test(renderLanguage));
panding('项1 选项用短名（≤10 字符）且 10 种语言都有',
  (() => {
    const m = js.match(/const LOCALE_SHORT = (\{[\s\S]*?\n  \});/);
    if (!m) return false;
    try {
      const map = new Function('return (' + m[1] + ')')();
      const want = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
      return want.every((k) => typeof map[k] === 'string' && map[k].trim() && Array.from(map[k]).length <= 10)
        && Object.keys(map).length === 10;
    } catch { return false; }
  })());
panding('项1 语言选项不带国旗（Windows 不依赖国旗 emoji），卡片宽度收窄',
  !/flagSvg|warmyAuthFlag|starPoly/.test(js) && !/warmyAuthFlag/.test(css)
  && /width:\s*min\(360px,\s*92vw\)/.test(between(css, '.warmyAuthFirstCard.warmyAuthLangCard {', '}')));
panding('项1 切换语言立即改文案与 html lang，并落盘',
  /document\.documentElement\.lang = state\.locale/.test(fnBody(js, 'applyLocale'))
  && /render\(\);/.test(fnBody(js, 'applyLocale'))
  && /settingsSave/.test(fnBody(js, 'applyLocale')));
panding('项1 角落悬浮 logo 已移除',
  !/warmyAuthCornerLogo/.test(js) && !/warmyAuthCornerLogo/.test(css) && !/<img/.test(renderLanguage));
panding('项1 首启场景换成亮色：晨曦/太阳/云/山/一匹站着的牛马（不再有品牌浮层）',
  /warmyAuthSceneLight/.test(sceneFn) && /warmyAuthLightSun/.test(sceneFn)
  && /warmyAuthLightHorse/.test(sceneFn) && /warmyAuthCloudA/.test(sceneFn) && /warmyAuthCloudB/.test(sceneFn)
  && !/warmyAuthLogoMascot|warmyAuthCommander|warmyAuthBanner|warmyAuthMoon|warmyAuthRunner/.test(sceneFn));
panding('项1 亮色主题：门/卡/输入/按钮/菜单全部转亮，主色仍是暖橙',
  /#f7f2e9/.test(css) && /background:\s*#fffdf9/.test(css) && /background:\s*#fff;/.test(css)
  && /\.warmyAuthBtnPrimary\s*\{[^}]*background:\s*#c97a4a/.test(css)
  && /\.warmyAuthFirstCard\s*\{[^}]*background:\s*rgba\(255,\s*253,\s*249/.test(css));
panding('项1 首启用我们的真实 logo 牛马，且是站着的（只呼吸，不原地跑）',
  /warmyAuthLightHorse/.test(sceneFn) && /warmyAuthLightHorseImg/.test(sceneFn)
  && /href="\.\/icons\/logo-tight\.png"/.test(sceneFn)
  && /warmyAuthBob/.test(sceneFn)
  && !/warmyAuthLegA|warmyAuthLegB|warmyAuthCharge|warmyAuthGallop/.test(sceneFn)
  && /\.warmyAuthLightHorse\s+\.warmyAuthBob\s*\{[^}]*animation:\s*warmyAuthBob/.test(css));

/* ── 2. 内联 SVG 亮色场景与循环动画 ────────────────────────────────── */
panding('项2 首启背景是内联 SVG + 本地 logo 图，无任何外链',
  /<svg/.test(sceneFn) && /warmyAuthSceneSvg/.test(sceneFn)
  && /<image[^>]*href="\.\/icons\/logo-tight\.png"/.test(sceneFn)
  && !/(?:src|href)="https?:|url\(https?:/.test(sceneFn));
panding('项2 亮色场景的云真的在循环飘（computed 用 warmyAuthCloudFloat）',
  /@keyframes\s+warmyAuthCloudFloat/.test(css) && /\.warmyAuthCloudA\s*\{[^}]*animation:\s*warmyAuthCloudFloat/.test(css)
  && /\.warmyAuthCloudB\s*\{[^}]*animation:\s*warmyAuthCloudFloat/.test(css));

/* ── 3. 条款页：全文 + 3 秒 + 底部 4px + 重渲染不重置 ───────────────── */
panding('项3 loadPack 取 warmy:i18n 的 strings（不再只取 pack.t）',
  /pack\.strings/.test(loadPack) && /state\.pack\s*=\s*strings/.test(loadPack));
panding('项3 条款正文取 privacy.body 全文',
  /privacy\.body/.test(renderTerms) && /warmyAuthTermsBody/.test(renderTerms));
panding('项3 同意需要滚到底部（容差 4px）',
  /scrollHeight\s*-\s*4/.test(syncTermsGate) && /clientHeight\s*\+\s*4/.test(syncTermsGate));
panding('项3 到达底部后再等待 3 秒（termsBottomAt）',
  /termsBottomAt/.test(syncTermsGate) && /Date\.now\(\)\s*-\s*state\.termsBottomAt\s*>=\s*3000/.test(syncTermsGate)
  && /Date\.now\(\)\s*-\s*state\.termsBottomAt\s*>=\s*3000/.test(between(js, "if (action === 'terms-continue')", "if (action === 'terms-decline')")));
panding('项3 条款页没有勾选框/提示，按钮只由滚到底+3秒控制',
  !/warmyAuthTermsAgree|terms-check|termsGateHint|termsAgreed/.test(renderTerms)
  && !/termsAgreed/.test(syncTermsGate) && /btn\.disabled\s*=\s*!ready/.test(syncTermsGate)
  && /disabled'\}>/.test(renderTerms) && !/checkbox/.test(renderTerms));
panding('项3 重新 render 不重置进度（只有 enterTerms 设起点）',
  /state\.termsOpenedAt\s*=\s*Date\.now\(\)/.test(enterTerms)
  && !/termsOpenedAt\s*=/.test(renderFn) && !/termsScrolled\s*=\s*false/.test(renderFn));
panding('项3 有「不同意并退出」',
  /termsDecline/.test(renderTerms) && /aptQuit|appQuit/.test(between(js, "if (action === 'terms-decline')", "if (action === 'login-back')")));

/* ── 4. 同意后分流：有账号→登录，无账号→注册 ───────────────────────── */
panding('项4 enterAuth 读 authState；无账号也进入同一个极简入口页',
  /authState/.test(enterAuth) && /hasAccount/.test(enterAuth)
  && /showLogin/.test(enterAuth) && !/showRegisterIntro|register-intro/.test(enterAuth));
panding('项4 boot：首启先语言/条款，未同意前不进入登录',
  /!st\.hasAccount\s*&&\s*!state\.setupDone/.test(bootFn)
  && bootFn.indexOf('!state.consented') > bootFn.indexOf('!st.hasAccount')
  && bootFn.indexOf('await enterAuth()') > bootFn.indexOf('!state.consented'));
panding('项4 已删除「创建助记词账号」介绍页；注册新账号直接生成助记词',
  !/renderRegisterIntro|showRegisterIntro|register-intro|register-begin/.test(js)
  && /setStep\('mnemonic-register'\)/.test(between(js, "if (action === 'register-open')", "if (action === 'login-pin')")));
panding('项4 登录页无品牌/标题：PIN + 确认 + 两个入口',
  !/warmyAuthBrand|warmyAuthLogo|warmyAuthTitle|header\(/.test(fnBody(js, 'renderLogin'))
  && /warmyAuthPin/.test(fnBody(js, 'renderLogin'))
  && /login-pin/.test(fnBody(js, 'renderLogin'))
  && /recover-open/.test(fnBody(js, 'renderLogin')) && /register-open/.test(fnBody(js, 'renderLogin')));
panding('项4 PIN 提交成功后进入用户名页（不是直接 finishAuth）',
  /enterUsernameStep\(\)/.test(pinSubmitBranch) && !/finishAuth\(\)/.test(pinSubmitBranch));

/* ── 5. 拼音勾选修复 ──────────────────────────────────────────────── */
const pinYinAt = onClick.indexOf("'toggle-pinyin'");
const preventAt = onClick.indexOf('e.preventDefault()');
panding('项5 onClick 对 toggle-pinyin/viewer-pinyin 不 preventDefault',
  pinYinAt > 0 && preventAt > 0 && pinYinAt < preventAt && /viewer-pinyin/.test(onClick.slice(0, preventAt)));
panding('项5 拼音勾选后重绘，词组/成语切换可用',
  /action === 'toggle-pinyin'/.test(fnBody(js, 'onChange'))
  && /friendlyItems/.test(js) && /mnemonicMarkup/.test(js)
  && /data-auth-action="pinyin-group"/.test(fnBody(js, 'pinyinGroupControls'))
  && /role="switch"/.test(fnBody(js, 'pinyinGroupControls')));
panding('项5 中文友好型用真实两字词/四字成语并保留格子序号，拼音连写无数字/连字符',
  /friendlyWords/.test(js) && /friendlyIdioms/.test(js)
  && /warmyAuthWordIndex/.test(fnBody(js, 'mnemonicMarkup'))
  && /warmyAuthWordPinyin/.test(fnBody(js, 'mnemonicMarkup'))
  && /is-pinyin-\$\{isIdiom \? 4 : 2\}/.test(fnBody(js, 'mnemonicMarkup')));
panding('项5 简体中文默认勾选中文友好型，其他语言默认不勾选',
  /resetPinyinDisplay/.test(js)
  && /resolveLocale\(state\.locale\) === 'zh-CN'/.test(fnBody(js, 'resetPinyinDisplay'))
  && /state\.pinyinGroup = 2/.test(fnBody(js, 'resetPinyinDisplay'))
  && /resetPinyinDisplay\(\)/.test(between(js, "if (action === 'register-open')", "if (action === 'login-pin')")));
panding('项5 PIN 页入口函数存在（恢复/助记词确认两条路都走它）',
  /function openPinSetup\(/.test(js) && (js.match(/openPinSetup\(\)/g) || []).length >= 2);
panding('项5 助记词正文/确认文案为用户定稿（含唯一凭证警告）',
  /助记词是你唯一的凭证，没有任何找回的方法！/.test(js)
  && /刚刚的助记词将被销毁，之后无法再次查看，确定你已抄写两份并分开放置了吗？/.test(js));

/* ── 6. 用户名：grapheme 1–30 + 自动填入全选 + IPC 回退 ─────────────── */
panding('项6 用户名使用 Intl.Segmenter(zh-CN, grapheme) 校验 1–30',
  /Intl\.Segmenter\('zh-CN',\s*\{\s*granularity:\s*'grapheme'\s*\}\)/.test(js)
  && /count\s*>=\s*1\s*&&\s*count\s*<=\s*30/.test(fnBody(js, 'usernameValid')));
panding('项6 trim 非空 + 控制字符拒绝（允许 ZWJ/Emoji）',
  /\.trim\(\)/.test(fnBody(js, 'usernameValid'))
  && /\\u0000-\\u001F/.test(fnBody(js, 'usernameValid'))
  && !/\\u200D/.test(fnBody(js, 'usernameValid')));
panding('项6 称呼页去掉说明与「称呼」标签，保留输入框和无障碍名称',
  !/usernameBody|usernameLabel|这个称呼只保存在本机/.test(fnBody(js, 'renderUsername'))
  && /aria-label=/.test(fnBody(js, 'renderUsername'))
  && /usernameTitle/.test(fnBody(js, 'renderUsername')));
panding('项6 输入框自动填入并全选',
  /state\.username\s*=\s*defaultUsername\(\)/.test(fnBody(js, 'enterUsernameStep'))
  && /el\.focus\(\);\s*el\.select\(\)/.test(js));
panding('项6 完成调用 authSetUsername，不可用回退 profileBaoCun/profileSave',
  /authSetUsername/.test(submitUsername) && /profileBaoCun/.test(submitUsername) && /profileSave/.test(submitUsername));
panding('项6 默认称呼 10 语言本地化',
  (() => {
    const m = js.match(/const DEFAULT_USERNAME = (\{[\s\S]*?\n  \});/);
    if (!m) return false;
    const map = new Function('return (' + m[1] + ')')();
    const want = { 'zh-CN': '老板', 'zh-TW': '老闆', 'en-US': 'Boss', ja: 'ボス', ko: '사장님', fr: 'Patron', es: 'Jefe', pt: 'Chefe', ru: 'Шеф', eo: 'Ĉefo' };
    return Object.keys(want).every((k) => map[k] === want[k]);
  })());
panding('项6 恢复流程也走用户名页（PIN 提交分支共用）',
  /authRecoverCommit/.test(pinSubmitBranch) && /enterUsernameStep/.test(pinSubmitBranch));
panding('项6 真实执行 grapheme 校验（大写/空格/Emoji ZWJ/31 字/空）',
  (() => {
    try {
      const src = fnBody(js, 'graphemeCount') + '\n' + fnBody(js, 'usernameValid');
      const check = new Function(src + '; return usernameValid;')();
      return check('BOSS 01') === true
        && check('👨‍👩‍👧‍👦') === true
        && check('老板') === true
        && check('a'.repeat(30)) === true
        && check('a'.repeat(31)) === false
        && check('   ') === false
        && check('a\nb') === false;
    } catch { return false; }
  })());

/* ── 7. PIN 页文案 / 无品牌块 / 无返回登录 ──────────────────────────── */
panding('项7 PIN 页不渲染「牛马」品牌块',
  !/warmyAuthBrand|warmyAuthLogo|header\(/.test(renderPinSetup) && /plainHeader/.test(renderPinSetup));
panding('项7 PIN 页去掉「返回登录」按钮',
  !/pin-cancel|返回登录/.test(renderPinSetup));
panding('项7 文案替换为「更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！」',
  /更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！/.test(js)
  && !/未开启自动登录：必须设置 PIN。/.test(js)
  && !/绑定系统账号 \+ CPU \+ 随机硬件 ID；/.test(js) && !/需用助记词恢复/.test(js));
panding('项7 自动登录勾选保留；开启后 PIN 输入禁用',
  /warmyAuthAuto/.test(renderPinSetup)
  && /p1\.disabled\s*=\s*autoOn/.test(fnBody(js, 'refreshPinForm'))
  && /p2\.disabled\s*=\s*autoOn/.test(fnBody(js, 'refreshPinForm')));

/* ── 8. 10 语言字典齐全 ──────────────────────────────────────────── */
let DICTS = null;
panding('项8 内置字典覆盖 10 种语言',
  (() => {
    const a = js.indexOf('/* R67_DICT_START */');
    const b = js.indexOf('/* R67_DICT_END */');
    if (a < 0 || b < 0) return false;
    let block = js.slice(a, b).replace('/* R67_DICT_START */', '').trim();
    block = block.replace(/^const DICTS =/, '').trim().replace(/;\s*$/, '');
    try { DICTS = new Function('return (' + block + ')')(); } catch { return false; }
    return ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'].every((k) => DICTS && DICTS[k]);
  })());
panding('项8 每种语言键集合与中文一致且无空值',
  !!DICTS && (() => {
    const master = Object.keys(DICTS['zh-CN']);
    return Object.keys(DICTS).every((l) => {
      const d = DICTS[l];
      return master.every((k) => typeof d[k] === 'string' && d[k].trim()) && Object.keys(d).length === master.length;
    });
  })());
panding('项8 其余 8 种是真实翻译（不是整段英文占位）',
  !!DICTS && ['zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'].every((l) => {
    const d = DICTS[l];
    const en = DICTS['en-US'];
    let diff = 0;
    for (const k of Object.keys(en)) if (d[k] !== en[k]) diff++;
    return diff / Object.keys(en).length > 0.85;
  }));
panding('项8 中文关键定稿文案与语言 start 正确',
  !!DICTS && DICTS['zh-CN'].start === '开始'
  && DICTS['zh-CN'].mnemonicBody === '请立刻用笔抄写两份，分别放在不同地方。不要截图、不要复制、不要存在电脑或云端。助记词是你唯一的凭证，没有任何找回的方法！'
  && DICTS['zh-CN'].confirmBody === '助记词是你唯一的凭证，没有任何找回的方法！刚刚的助记词将被销毁，之后无法再次查看，确定你已抄写两份并分开放置了吗？'
  && DICTS['zh-CN'].termsAgree !== undefined
  && DICTS['zh-CN'].recoverTitle === '请输入助记词'
  && DICTS['zh-CN'].autoOffHint === '更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！'
  && DICTS['zh-CN'].autoOnHint === DICTS['zh-CN'].autoOffHint);
panding('项8 10 语言都有全拼分组标签',
  !!DICTS && Object.keys(DICTS).every((l) => typeof DICTS[l].pinyinGroupTwo === 'string' && typeof DICTS[l].pinyinGroupFour === 'string'));
panding('项8 语言切换落盘 + 调 __warmyLoadI18n；首启 setupComplete 只在开始时做',
  /settingsSave/.test(fnBody(js, 'applyLocale')) && /__warmyLoadI18n/.test(fnBody(js, 'applyLocale'))
  && /setupComplete/.test(between(js, "if (action === 'language-start')", "if (action === 'terms-continue')"))
  && !/setupComplete/.test(fnBody(js, 'applyLocale')));

/* ── 9. 我的页账号卡 / openMnemonic ───────────────────────────────── */
panding('项9 账号卡只剩助记词状态/保存、自动登录、退出、修改 PIN',
  /warmyAuthMyCard/.test(decorateMyPage) && /save-mnemonic/.test(decorateMyPage)
  && /authSetAutoLogin/.test(decorateMyPage) && /myAutoUnavailable/.test(decorateMyPage)
  && /change-pin/.test(decorateMyPage) && /logout/.test(decorateMyPage));
panding('项9 账号卡不含品牌/头像/邮箱/凭证布局',
  !/avatar|email|warmyAuthBrand|warmyAuthLogo/.test(decorateMyPage.slice(decorateMyPage.indexOf('card.innerHTML'))));
panding('项9 暴露 __warmyAuthGate.openMnemonic',
  /window\.__warmyAuthGate\s*=\s*\{[\s\S]*openMnemonic/.test(js) && /async function openMnemonic/.test(js));
panding('项9 未确认时查看页可确认并直接关闭遮罩；仍有「稍后再保存」',
  /authConfirmMnemonic',\s*'confirm'/.test(viewerBranch)
  && /closeViewer\(\)/.test(viewerBranch) && /viewer-later/.test(js) && /saveLater/.test(js));
panding('项9 authSetAutoLogin 不可用时禁用并说明',
  /typeof window\.warmy\.authSetAutoLogin === 'function'/.test(decorateMyPage)
  && /canAuto/.test(decorateMyPage) && /disabled/.test(decorateMyPage));

/* ── 10. auth-service 新增方法 ────────────────────────────────────── */
const setAuto = between(svc, 'setAutoLogin(enabled: unknown): AuthResult {', 'setUsername(name: unknown): AuthResult {');
const setUser = between(svc, 'setUsername(name: unknown): AuthResult {', 'logout(): AuthResult {');
panding('项10 setAutoLogin(enabled: unknown) 签名正确',
  /setAutoLogin\(enabled:\s*unknown\):\s*AuthResult/.test(svc));
panding('项10 开启自动登录要求 mnemonicConfirmed + protector 可用，并写 wrappedMnemonicOs/binding',
  /file\.mnemonicConfirmed/.test(setAuto) && /this\.protector\.available\(\)/.test(setAuto)
  && /randomMachineId\(\)/.test(setAuto) && /wrappedMnemonicOs/.test(setAuto) && /makeBindingRecord/.test(setAuto));
panding('项10 关闭自动登录删除 autoLogin',
  /file\.autoLogin\s*=\s*null/.test(setAuto));
panding('项10 setUsername(name: unknown) 签名正确',
  /setUsername\(name:\s*unknown\):\s*AuthResult/.test(svc));
panding('项10 setUsername 用 Intl.Segmenter 校验 1–30 grapheme、trim、控制字符',
  /Intl\.Segmenter\('zh-CN',\s*\{\s*granularity:\s*'grapheme'\s*\}\)/.test(setUser)
  && /\.trim\(\)/.test(setUser) && /count\s*<\s*1\s*\|\|\s*count\s*>\s*30/.test(setUser)
  && /\\u0000-\\u001F/.test(setUser));
panding('项10 setUsername 写 profile 且保留 deviceId 等既有字段',
  /\.\.\.prev,\s*username:\s*trimmed/.test(setUser) && /this\.profile\.saveProfile/.test(setUser));
panding('项10 auth-core 接受展示用全拼（无数字/连字符）并映射回同一英文明文',
  /DISPLAY_PINYIN_TO_INDEX/.test(core) && /displayPinyinSyllables/.test(core)
  && /parseMnemonicInput/.test(core) && /mnemonicFromDisplayPinyin/.test(core)
  && /replace\(\/\[0-9\\-–—\]\/g,\s*' '\)/.test(core));

/* ── 11. 自动化旁路 / 既有语义 ───────────────────────────────────── */
panding('项11 WARMY_AUTH_BYPASS 旁路仍生效（st.bypass 直接放行）',
  /st\.bypass === true/.test(bootFn) && /finishAuth\(\)/.test(bootFn));
panding('项11 未改 auth-core（本轮文件清单外）',
  !/auth-core/.test(rd(path.join(SRC, 'renderer/auth-gate.js'))));

/* ── 12. 第 68 轮：我的页三块布局 / 凭证失效 ─────────────────────── */
const appJs = rd(path.join(SRC, 'renderer/app.js'));
const cardTpl = decorateMyPage.slice(decorateMyPage.indexOf('card.innerHTML'));
const changePinBody = between(svc, 'changePin(payload: { pin?: string; confirmPin?: string; disableAutoLogin?: boolean }): AuthResult {', 'viewMnemonic(): AuthResult {');
const recoverBody = between(svc, 'recoverCommit(payload: {', '// ── session / My page');
const registerBody = between(svc, 'registerCommit(payload: {', 'registerCancel(): AuthResult {');
panding('项12 我的页：左侧品牌（logo + 名称）、右侧资料列 + 账号列',
  /woDing woDingR68/.test(appJs)
  && /woBrandR68[\s\S]{0,400}pinPailogo[\s\S]{0,200}woBrandMing/.test(appJs)
  && /woR68Body[\s\S]{0,400}woR68Profile[\s\S]{0,3200}warmyAuthMyCard/.test(appJs));
panding('项12 名片在用户名右侧；邮箱在账号列、位于助记词上方',
  /woMingHang[\s\S]{0,500}id="pMingDisplay"[\s\S]{0,300}id="pMingPianBtn"/.test(appJs)
  && /woR68Account[\s\S]{0,500}id="pYouJian"[\s\S]{0,500}id="warmyAuthMyCard"/.test(appJs));
panding('项12 左品牌 27%、资料 40%、账号 46%，窄屏回退为上下布局',
  /\.woBrandR68\s*\{[^}]*flex:\s*0 0 27%/.test(css)
  && /\.woR68Profile\s*\{[^}]*flex:\s*0 1 40%/.test(css)
  && /\.woR68Account\s*\{[^}]*flex:\s*0 1 46%/.test(css)
  && /@media \(max-width: 980px\)[\s\S]*?\.woBrandR68\s*\{[^}]*flex-basis:\s*100%/.test(css));
panding('项12 账号卡有助记词行 + 自动登录 + 并排按钮，不再有“账号与助记词”标题',
  /warmyAuthMyMnemonicLine/.test(cardTpl) && /myConfirmed/.test(cardTpl)
  && /warmyAuthMyView/.test(cardTpl) && /warmyMyAuto/.test(cardTpl)
  && /warmyAuthMyButtons/.test(cardTpl) && !/myTitle/.test(cardTpl));
panding('项12 中文冒号、自动登录开启时修改 PIN 按钮禁用',
  /const sep = \/\^zh\/i\.test\(resolveLocale\(state\.locale\)\) \? '：' : ': '/.test(decorateMyPage)
  && /a\.autoLogin\s*\?\s*'disabled'/.test(cardTpl)
  && /\.warmyAuthMyButtons\s*\{[^}]*display:\s*flex/.test(css));
panding('项12 开启自动登录会清掉旧 PIN、失败计数与锁定时间',
  /file\.autoLogin\s*=\s*\{/.test(setAuto) && /file\.pin\s*=\s*null/.test(setAuto)
  && /file\.failedAttempts\s*=\s*0/.test(setAuto) && /file\.lockUntil\s*=\s*0/.test(setAuto));
panding('项12 设置 PIN 与关闭自动登录同一笔写入；该路径不锁当前会话',
  changePinBody.length > 0 && !/pin-not-configured/.test(changePinBody)
  && /validatePinPair/.test(changePinBody) && /disableAutoLogin/.test(changePinBody)
  && /disableAutoLogin !== true/.test(changePinBody) && /lockSession\(\)/.test(changePinBody));
panding('项12 注册/助记词恢复都重建完整 vault，旧 PIN/旧自动登录不会续用',
  /const file: AuthVaultFile = \{/.test(registerBody) && /pin: pinRecord/.test(registerBody) && /autoLogin: autoRecord/.test(registerBody)
  && /const file: AuthVaultFile = \{/.test(recoverBody) && /pin: pinRecord/.test(recoverBody) && /autoLogin: autoRecord/.test(recoverBody));
panding('项12 “已保存”在 10 种语言里都有',
  !!DICTS && Object.keys(DICTS).every((l) => typeof DICTS[l].myConfirmed === 'string' && DICTS[l].myConfirmed.trim()));

/* ── 13. 第 78 轮：首启/登录 7 项（静态判据，真机见 verify-r78-auth-tour） ── */
const onMyCardChange = fnBody(js, 'onMyCardChange');
const tourSyncBody = between(js, 'function tourSync()', 'function tourLayout()');
const tourLayoutBody = between(js, 'function tourLayout()', '// 漫游层要一直');
const tourStartBody = between(js, 'function tourStart()', 'function tourTeardown()');
panding('R78④ 首启各页共用同一六幕背景（常驻 iframe，进入软件后隐藏）',
  /function stepHasScene/.test(js)
  && /step !== 'done'/.test(fnBody(js, 'stepHasScene')) && /step !== 'fatal'/.test(fnBody(js, 'stepHasScene'))
  && /warmyAuthSceneEmbed/.test(fnBody(js, 'ensureOverlay'))
  && /firstrun-scenes\/index\.html\?embed=1/.test(fnBody(js, 'ensureOverlay'))
  && /sceneEl\.hidden = !scene/.test(fnBody(js, 'render'))
  && /warmyAuthCardOnScene/.test(fnBody(js, 'render')));
panding('R78③ PIN 输入框内嵌登录按钮（同一行容器 + 绝对定位覆盖在输入框里）',
  /warmyAuthPinRow/.test(fnBody(js, 'renderLogin')) && /warmyAuthPinGo/.test(fnBody(js, 'renderLogin'))
  && /warmyAuthPinInline/.test(fnBody(js, 'renderLogin'))
  && /\.warmyAuthPinRow\s*\{[^}]*position:\s*relative/.test(css)
  && /\.warmyAuthPinGo\s*\{[^}]*position:\s*absolute[^}]*right:\s*4px/.test(css)
  && /\.warmyAuthPinRow \.warmyAuthPinInline\s*\{[^}]*padding-right:\s*110px/.test(css));
panding('R78③ 登录页更小（≤420px）且保留返回首启语言页',
  /\.warmyAuthCard\.warmyAuthCardScene\.warmyAuthCardCompact\s*\{[^}]*width:\s*min\(400px/.test(css)
  && /login-lang-back/.test(fnBody(js, 'renderLogin'))
  && /enterLanguage\(\)/.test(between(js, "if (action === 'login-lang-back')", "if (action === 'language-start')")));
panding('R78⑥ 成语模式 12 格（每格覆盖 2 个 BIP-39 索引，配对码本有序）',
  /function pairIdiomItems/.test(js)
  && /pairIdiomItems\(friendly\)/.test(fnBody(js, 'mnemonicMarkup'))
  && /data-cover=/.test(fnBody(js, 'mnemonicMarkup'))
  && /cover\[0\]\}-\$\{cover\[1\]\}/.test(fnBody(js, 'mnemonicMarkup')));
panding('R97① 助记拼音：序号与中文并排（第一行）+ 拼音本体主题色（第二行），不再重复英文',
  /warmyAuthWordFriendly/.test(fnBody(js, 'mnemonicMarkup'))
  && /\.warmyAuthMnemonic\.is-pinyin \.warmyAuthWordFriendly\s*\{[^}]*display:\s*grid/.test(css)
  && /grid-template-rows:\s*auto auto(?:;|\s*\})/.test(between(css, '.warmyAuthMnemonic.is-pinyin .warmyAuthWordFriendly {', '}'))
  && /\.warmyAuthWordFriendly \.warmyAuthWordText\s*\{[^}]*grid-row:\s*1/.test(css)
  && /\.warmyAuthWordFriendly \.warmyAuthWordPinyin\s*\{[^}]*grid-row:\s*2[^}]*color:\s*var\(--accent\)/.test(css)
  && /\.warmyAuthMnemonic\s*\{[^}]*max-height:\s*min\(56vh/.test(css));
panding('R98 开始使用清单：供应商 → 模型 → 牛马 → 第一句，四步都在',
  /startGuide\.step\.provider\.title/.test(appJs) && /startGuide\.step\.model\.title/.test(appJs)
  && /startGuide\.step\.niuma\.title/.test(appJs) && /startGuide\.step\.chat\.title/.test(appJs));
panding('R98 清单可跳过/稍后/重开，旧 spotlight 漫游层已删除',
  /data-sg="skip"/.test(appJs) && /data-sg="later"/.test(appJs) && /__startGuideOpen/.test(appJs)
  && !/warmyTour|yinDao/.test(js) && !/warmyTour/.test(css));
panding('R78① 我的页勾选自动登录先二次确认，取消保持未勾选',
  /askConfirm\(/.test(onMyCardChange)
  && /myAutoConfirmTitle/.test(onMyCardChange) && /myAutoConfirmBody/.test(onMyCardChange)
  && /box\.checked = false/.test(onMyCardChange)
  && /toggleMyAuto\(true\)/.test(onMyCardChange));

const ok = jie.filter((x) => x.ok).length;
const bad = jie.length - ok;
for (const x of jie) console.log((x.ok ? '  ok   ' : '  FAIL ') + x.ming + (x.xiang ? '  ← ' + x.xiang : ''));
console.log(`\n==== verify-r67-firstrun：${ok} ok / ${bad} FAIL ====`);
process.exit(bad ? 1 : 0);
