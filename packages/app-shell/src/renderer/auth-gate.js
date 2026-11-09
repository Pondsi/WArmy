/* WArmy auth gate — first-run language → full terms → Login/Register → mnemonic → PIN → username.
 *
 * This file is intentionally self-contained and loaded BEFORE app.js. It blocks
 * the whole renderer until a login succeeds, so every launch (including the
 * first one) shows the auth screen. The first launch starts with a language-only
 * screen (animated pixel scene) and never jumps straight to Login before the
 * privacy terms have been accepted.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  /* R149 项1：简体第一、繁体第二、其余按中文名拼音首字母排（阿→波→丹→德→俄→法→韩→荷→捷→挪→葡→日→瑞→世→泰→土→乌→西→匈→意→印→英→越） */
  const LOCALES = [
    ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'],
    ['ar', 'العربية'], ['pl', 'Polski'], ['fa', 'فارسی'],
    ['da', 'Dansk'], ['de', 'Deutsch'],
    ['ru', 'Русский'], ['fr', 'Français'],
    ['ko', '한국어'], ['nl', 'Nederlands'],
    ['cs', 'Čeština'], ['nb', 'Norsk bokmål'],
    ['pt', 'Português'], ['ja', '日本語'], ['sv', 'Svenska'],
    ['eo', 'Esperanto'], ['th', 'ไทย'], ['tr', 'Türkçe'],
    ['uk', 'Українська'], ['es', 'Español'], ['hu', 'Magyar'],
    ['it', 'Italiano'], ['hi', 'हिन्दी'], ['en-US', 'English'],
    ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'],
  ];
  /** 从右往左书写的语言 */
  const RTL_LOCALES = ['ar', 'fa'];
  /**
   * 瓦片上的显示名。R147 项8（用户定稿）：**不再用字符数当门禁** ——
   * 布局整齐交给 CSS（minmax(0,1fr) + 自然换行 + 兜底截断），显示名只负责「看得懂」。
   * 挪威语必须带变体 qualifier：Norsk (Bokmål)，否则挪威用户分不清自己该点哪个。
   * 完整母语名挂在瓦片 title 上，截断/缩写时悬停仍然拿得到全名。
   */
  const LOCALE_SHORT = {
    'zh-CN': '简体', 'zh-TW': '繁體', 'en-US': 'English', ja: '日本語',
    ko: '한국어', ru: 'Русский', es: 'Español', fr: 'Français',
    pt: 'Português', eo: 'Esperanto', de: 'Deutsch', it: 'Italiano',
    nl: 'Nederlands', pl: 'Polski', sv: 'Svenska', cs: 'Čeština',
    hu: 'Magyar', da: 'Dansk', nb: 'Norsk (Bokmål)', tr: 'Türkçe',
    uk: 'Українська', id: 'Indonesia', vi: 'Tiếng Việt', th: 'ไทย',
    hi: 'हिन्दी', ar: 'العربية', fa: 'فارسی',
  };
  /**
   * 首启/登录背景：本次启动**随机选一幕并固定**，不在页面内轮播。
   * 只在模块加载时取一次随机数 —— 进程内的语言切换、登录/注册各步都保持同一幕。
   */
  const SHOU_QI_CHANG_JING = [1, 2, 4, 6, 9, 10];
  const BEN_CI_CHANG_JING = (() => {
    try {
      const cun = Number(sessionStorage.getItem('warmy.firstScene'));
      if (SHOU_QI_CHANG_JING.includes(cun)) return cun;
      const xuan = SHOU_QI_CHANG_JING[Math.floor(Math.random() * SHOU_QI_CHANG_JING.length)];
      sessionStorage.setItem('warmy.firstScene', String(xuan));
      return xuan;
    } catch {
      return SHOU_QI_CHANG_JING[Math.floor(Math.random() * SHOU_QI_CHANG_JING.length)];
    }
  })();


  const DEFAULT_USERNAME = {
    'zh-CN': '老板',
    'zh-TW': '老闆',
    'en-US': 'Boss',
    ja: 'ボス',
    ko: '사장님',
    fr: 'Patron',
    es: 'Jefe',
    pt: 'Chefe',
    ru: 'Шеф',
    eo: 'Ĉefo',
    de: 'Chef',
    it: 'Capo',
    nl: 'Baas',
    pl: 'Szef',
    sv: 'Chef',
    cs: 'Šéf',
    hu: 'Főnök',
    da: 'Chef',
    nb: 'Sjef',
    tr: 'Patron',
    uk: 'Шеф',
    id: 'Bos',
    vi: 'Sếp',
    th: 'นาย',
    hi: 'बॉस',
    ar: 'المدير',
    fa: 'رئیس',
  };
  const state = {
    step: 'loading',
    auth: null,
    locale: 'zh-CN',
    pack: null,
    error: '',
    busy: false,
    reg: null,
    rec: null,
    reminder: null,
    viewer: null,
    /** 窗口失焦时把助记词藏起来；回来要用户主动点一下才显示（防截图/防旁人瞥见） */
    mnemonicHidden: false,
    mnemonicConfirmed: false,
    pinyinPref: false,
    pinAuto: false,
    bootPromise: null,
    resolveBoot: null,
    overlayHidden: false,
    windowFitted: false,
    bootDone: false,
    lockTimer: null,
    fatal: '',
    setupDone: false,
    consented: false,
    termsOpenedAt: 0,
    termsBottomAt: 0,
    termsScrolled: false,
    termsTimer: null,
    username: '',
    usernameFocusPending: false,
    recoveryCells: [],
    recoveryIdiom: false,
    pinyinGroup: 2,
    mySig: '',
    myError: '',
    myAutoBlocked: '',
  };

  /* R67_DICT_START */
  const DICTS = {
    'zh-CN': {
      loading: '正在加载账号…',
      start: '开始',
      fatal: '账号模块不可用，无法安全启动。请确认 preload/main 已加载 auth-gate。',
      seconds: '秒',
      error: '操作失败',
      close: '关闭',
      quitBack: '返回界面',
      quitApp: '关闭程序',
      termsTitle: '隐私与使用条款',
      termsFallback: '请阅读并同意以下条款后继续。',
      termsAgree: '我已阅读并同意以上全部条款',
      termsContinue: '同意并继续',
      termsDecline: '不同意并退出',
      termsRequired: '请先滚动到条款底部并等待 3 秒。',
      termsGateHint: '滚动到条款底部并等待 3 秒后，才能勾选同意。',
      loginTitle: '登录',
      loginBody: '每次启动都需要登录。凭证已由助记词接管，不再保存。',
      pinLogin: '使用 PIN 登录',
      pinPlaceholder: 'PIN（4–20 位字母或数字）',
      login: '登录',
      autoLogin: '本机自动登录',
      autoLoginHint: '绑定当前系统账号与硬件；系统升级后可能失效，助记词是唯一的恢复方法。',
      autoLoginInvalid: '本机自动登录已失效：系统账号 / CPU / 硬件标识发生变化。请用 PIN 或助记词恢复。',
      recover: '使用助记词登录',
      register: '注册新账号',
      noAccount: '此设备还没有账号。请注册新账号，或用已有助记词恢复。',
      registerTitle: '创建助记词账号',
      registerBody: '将生成一份 24 词助记词。它是唯一的恢复方法，请准备纸笔抄写。',
      registerBegin: '生成 24 词助记词',
      existingMnemonic: '我已有助记词',
      existingAccountWarn: '此设备已有账号。继续注册会替换当前账号及其本机身份（旧认证库会先备份）。确定吗？',
      back: '返回',
      recoverTitle: "请输入助记词",
      recoverBody: '输入 24 词英文助记词，或助记拼音（全拼，无数字、无符号）。',
      recoverHint: '助记词只在本机校验，不会上传。',
      verify: '验证助记词',
      badPin: 'PIN 不正确',
      locked: '已锁定，建议过段时间再回来查看。',
      lockHint: '再失败 {n} 次就会被锁定一段时间',
      pinRule: 'PIN 必须是 4–20 位字母或数字，且两次输入一致。',
      pinMismatch: '两次输入的 PIN 不一致。',
      badMnemonic: '助记词无效（单词、顺序或校验位不正确）。',
      accountExists: '账号已存在',
      vaultCorrupt: '认证库损坏或无法读取。为避免覆盖，已保留原文件。',
      osUnavailable: '系统安全存储不可用。请改用 PIN，助记词是唯一的恢复方法。',
      authManaged: '该操作已由助记词账号接管。',
      mnemonicTitle: '助记词（24 词）',
      mnemonicHidden: '已隐藏助记词 · 点击显示',
      mnemonicBody: '请立刻用笔抄写两份，分别放在不同地方。不要截图、不要复制、不要存在电脑或云端。助记词是你唯一的凭证，没有任何找回的方法！',
      mnemonicReminderBody: '你上次选择了“稍后提醒我”。请现在补抄：请立刻用笔抄写两份，分别放在不同地方。不要截图、不要复制、不要存在电脑或云端。助记词是你唯一的凭证，没有任何找回的方法！',
      pinyinFriendly: '助记拼音',
      pinyinGroupTwo: "词组",
      pinyinGroupFour: "成语",
      later: '稍后提醒我',
      saved: '我记下了',
      laterConfirmTitle: '稍后提醒',
      laterConfirmBody: '你没有确认已抄写助记词。下次启动会先显示助记词确认页；自动登录将不可用，必须先设置 PIN。确定稍后吗？',
      laterConfirmOk: '确定稍后',
      confirmBody: '助记词是你唯一的凭证，没有任何找回的方法！刚刚的助记词将被销毁，之后无法再次查看，确定你已抄写两份并分开放置了吗？',
      confirmOk: '我记好了',
      cancel: '取消',
      pinTitle: '设置 PIN',
      pinBody: 'PIN 用于本机登录（4–20 位字母或数字，不能有特殊字符）。',
      pin1: '输入 PIN',
      pin2: '再次输入 PIN',
      autoEnable: '自动登录（绑定本机）',
      autoDisabledHint: '只有确认已抄写助记词后才能开启自动登录。',
      autoOnHint: "更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！",
      autoOffHint: "更改设备的硬件，或者系统升级都有可能导致PIN失效，助记词是唯一的恢复方法！",
      confirmCreate: '完成创建',
      confirmRecover: '完成恢复',
      autoLoginFail: '自动登录设置失败，请稍后重试。',
      usernameTitle: '给自己起个称呼',
      usernameBody: '这个称呼只保存在本机，用于软件里对你的称呼。',
      usernameLabel: '称呼',
      usernameRule: '1–30 个字符（字母、数字、空格、Emoji 均可），不能为空。',
      usernameFinish: '完成',
      usernameSaveFail: '称呼保存失败，请重试。',
      viewTitle: '查看助记词',
      viewBody: '请确认周围无人偷看。助记词泄露 = 账号被接管；关闭本页后不会留在界面上。',
      saveMnemonic: '保存助记词',
      saveLater: '稍后再保存',
      saveConfirm: '我已抄好并确认',
      myTitle: '账号与助记词',
      myMnemonic: '助记词',
      myConfirmed: '已保存',
      myUnconfirmed: '未确认',
      myAuto: '本机自动登录',
      myAutoHint: '自动登录绑定本机；系统升级或硬件变化可能失效，助记词是唯一的恢复方法。',
      myAutoNeedsMnemonic: '先确认助记词后才能开启自动登录。',
      myAutoUnavailable: '当前版本不支持自动登录开关，请使用 PIN 登录。',
      logout: '退出账号',
      logoutConfirm: '退出后回到登录页，需要 PIN 或助记词才能再次进入。确定退出吗？',
      myPinChange: '修改 PIN',
      myPinDisabled: '自动登录开启时不能修改 PIN。',
      myChangeOk: 'PIN 已修改，请用新 PIN 重新登录。',
      myChangeFail: 'PIN 修改失败。',
    },
    'zh-TW': {
      loading: '正在載入帳號…',
      start: '開始',
      fatal: '帳號模組無法使用，無法安全啟動。請確認 preload/main 已載入 auth-gate。',
      seconds: '秒',
      error: '操作失敗',
      close: '關閉',
      quitBack: '返回介面',
      quitApp: '關閉程式',
      termsTitle: '隱私與使用條款',
      termsFallback: '請閱讀並同意以下條款後繼續。',
      termsAgree: '我已閱讀並同意以上全部條款',
      termsContinue: '同意並繼續',
      termsDecline: '不同意並退出',
      termsRequired: '請先滾動到條款底部並等待 3 秒。',
      termsGateHint: '滾動到條款底部並等待 3 秒後，才能勾選同意。',
      loginTitle: '登入',
      loginBody: '每次啟動都需要登入。憑證已由助記詞接管，不再保存。',
      pinLogin: '使用 PIN 登入',
      pinPlaceholder: 'PIN（4–20 位字母或數字）',
      login: '登入',
      autoLogin: '本機自動登入',
      autoLoginHint: '綁定目前系統帳號與硬體；系統升級後可能失效，助記詞是唯一的恢復方法。',
      autoLoginInvalid: '本機自動登入已失效：系統帳號 / CPU / 硬體識別碼發生變化。請用 PIN 或助記詞恢復。',
      recover: '使用助記詞登入',
      register: '註冊新帳號',
      noAccount: '此裝置還沒有帳號。請註冊新帳號，或用既有助記詞恢復。',
      registerTitle: '建立助記詞帳號',
      registerBody: '將產生一份 24 詞助記詞。它是唯一的恢復方法，請準備紙筆抄寫。',
      registerBegin: '產生 24 詞助記詞',
      existingMnemonic: '我已有助記詞',
      existingAccountWarn: '此裝置已有帳號。繼續註冊會替換目前帳號及其本機身分（舊認證庫會先備份）。確定嗎？',
      back: '返回',
      recoverTitle: "請輸入助記詞",
      recoverBody: '輸入 24 詞英文助記詞，或助記拼音（全拼，無數字、無符號）。',
      recoverHint: '助記詞只在本機驗證，不會上傳。',
      verify: '驗證助記詞',
      badPin: 'PIN 不正確',
      locked: '已鎖定，建議過段時間再回來查看。',
      lockHint: '再失敗 {n} 次就會被鎖定一段時間',
      pinRule: 'PIN 必須是 4–20 位字母或數字，且兩次輸入一致。',
      pinMismatch: '兩次輸入的 PIN 不一致。',
      badMnemonic: '助記詞無效（單詞、順序或校驗位不正確）。',
      accountExists: '帳號已存在',
      vaultCorrupt: '認證庫損壞或無法讀取。為避免覆蓋，已保留原檔案。',
      osUnavailable: '系統安全儲存不可用。請改用 PIN，助記詞是唯一的恢復方法。',
      authManaged: '此操作已由助記詞帳號接管。',
      mnemonicTitle: '助記詞（24 詞）',
      mnemonicHidden: '已隱藏助記詞 · 點擊顯示',
      mnemonicBody: '請立刻用筆抄寫兩份，分別放在不同地方。不要截圖、不要複製、不要存在電腦或雲端。助記詞是你唯一的憑證，沒有任何找回的方法！',
      mnemonicReminderBody: '你上次選擇了「稍後提醒我」。請現在補抄：請立刻用筆抄寫兩份，分別放在不同地方。不要截圖、不要複製、不要存在電腦或雲端。助記詞是你唯一的憑證，沒有任何找回的方法！',
      pinyinFriendly: '助記拼音',
      pinyinGroupTwo: "詞組",
      pinyinGroupFour: "成語",
      later: '稍後提醒我',
      saved: '我記下了',
      laterConfirmTitle: '稍後提醒',
      laterConfirmBody: '你沒有確認已抄寫助記詞。下次啟動會先顯示助記詞確認頁；自動登入將不可用，必須先設定 PIN。確定稍後嗎？',
      laterConfirmOk: '確定稍後',
      confirmBody: '助記詞是你唯一的憑證，沒有任何找回的方法！剛剛的助記詞將被銷毀，之後無法再次查看，確定你已抄寫兩份並分開放嗎？',
      confirmOk: '我記好了',
      cancel: '取消',
      pinTitle: '設定 PIN',
      pinBody: 'PIN 用於本機登入（4–20 位字母或數字，不能有特殊字元）。',
      pin1: '輸入 PIN',
      pin2: '再次輸入 PIN',
      autoEnable: '自動登入（綁定本機）',
      autoDisabledHint: '只有確認已抄寫助記詞後才能開啟自動登入。',
      autoOnHint: "更改裝置的硬體，或者系統升級都有可能導致 PIN 失效，助記詞是唯一的復原方法！",
      autoOffHint: "更改裝置的硬體，或者系統升級都有可能導致 PIN 失效，助記詞是唯一的復原方法！",
      confirmCreate: '完成建立',
      confirmRecover: '完成恢復',
      autoLoginFail: '自動登入設定失敗，請稍後再試。',
      usernameTitle: '幫自己取個稱呼',
      usernameBody: '這個稱呼只保存在本機，用於軟體裡對你的稱呼。',
      usernameLabel: '稱呼',
      usernameRule: '1–30 個字元（字母、數字、空格、Emoji 均可），不能為空。',
      usernameFinish: '完成',
      usernameSaveFail: '稱呼儲存失敗，請重試。',
      viewTitle: '查看助記詞',
      viewBody: '請確認周圍無人偷看。助記詞洩露 = 帳號被接管；關閉本頁後不會留在介面上。',
      saveMnemonic: '儲存助記詞',
      saveLater: '稍後再儲存',
      saveConfirm: '我已抄好並確認',
      myTitle: '帳號與助記詞',
      myMnemonic: '助記詞',
      myConfirmed: '已儲存',
      myUnconfirmed: '未確認',
      myAuto: '本機自動登入',
      myAutoHint: '自動登入綁定本機；系統升級或硬體變化可能失效，助記詞是唯一的恢復方法。',
      myAutoNeedsMnemonic: '先確認助記詞後才能開啟自動登入。',
      myAutoUnavailable: '目前版本不支援自動登入開關，請使用 PIN 登入。',
      logout: '退出帳號',
      logoutConfirm: '退出後回到登入頁，需要 PIN 或助記詞才能再次進入。確定退出嗎？',
      myPinChange: '修改 PIN',
      myPinDisabled: '自動登入開啟時不能修改 PIN。',
      myChangeOk: 'PIN 已修改，請用新 PIN 重新登入。',
      myChangeFail: 'PIN 修改失敗。',
    },
    'en-US': {
      loading: 'Loading account…',
      start: 'Start',
      fatal: 'The account module is unavailable; refusing to start insecurely. Ensure preload/main load auth-gate.',
      seconds: 's',
      error: 'Operation failed',
      close: 'Close',
      quitBack: 'Back to app',
      quitApp: 'Quit app',
      termsTitle: 'Privacy & terms',
      termsFallback: 'Please read and accept the terms below to continue.',
      termsAgree: 'I have read and agree to all of the above',
      termsContinue: 'Agree and continue',
      termsDecline: 'Decline and quit',
      termsRequired: 'Scroll to the bottom and wait 3 seconds first',
      termsGateHint: 'Scroll to the bottom and wait 3 seconds before you can tick consent.',
      loginTitle: 'Sign in',
      loginBody: 'Sign-in is required on every launch. The credential is now managed by the mnemonic and is no longer stored.',
      pinLogin: 'Sign in with PIN',
      pinPlaceholder: 'PIN (4–20 letters/digits)',
      login: 'Sign in',
      autoLogin: 'Automatic sign-in on this device',
      autoLoginHint: 'Bound to this OS account and hardware. An OS upgrade may invalidate it; the mnemonic is the only way to recover.',
      autoLoginInvalid: 'Automatic sign-in is no longer valid (OS account/CPU/hardware changed). Use the PIN or the mnemonic.',
      recover: 'Sign in with mnemonic',
      register: 'Register a new account',
      noAccount: 'No account on this device. Register a new account or recover one with its mnemonic.',
      registerTitle: 'Create mnemonic account',
      registerBody: 'A 24-word mnemonic will be generated. It is the only way to recover; prepare pen and paper.',
      registerBegin: 'Generate 24-word mnemonic',
      existingMnemonic: 'I already have a mnemonic',
      existingAccountWarn: 'An account already exists. Continuing replaces the current account and local identity (the old vault is backed up first). Continue?',
      back: 'Back',
      recoverTitle: "Enter your mnemonic",
      recoverBody: 'Enter the 24-word English mnemonic, or the mnemonic pinyin (full pinyin, no digits or symbols).',
      recoverHint: 'The mnemonic is verified locally and never uploaded.',
      verify: 'Verify mnemonic',
      badPin: 'Incorrect PIN',
      locked: 'Locked. Please try again later.',
      lockHint: 'After {n} more failed attempt(s), you will be locked for a while',
      pinRule: 'PIN must be 4–20 letters/digits and both entries must match.',
      pinMismatch: 'The two PINs do not match.',
      badMnemonic: 'Invalid mnemonic (words, order or checksum).',
      accountExists: 'Account already exists',
      vaultCorrupt: 'The auth vault is corrupt/unreadable. The original file was preserved.',
      osUnavailable: 'OS secure storage is unavailable. Use a PIN; the mnemonic is the only way to recover.',
      authManaged: 'This action is managed by the mnemonic account.',
      mnemonicTitle: 'Mnemonic (24 words)',
      mnemonicHidden: 'Mnemonic hidden · click to show',
      mnemonicBody: 'Write it down on paper right now — two copies, kept in different places. Do not screenshot it, do not copy it, and do not store it on a computer or in the cloud. The mnemonic is your only credential; there is no way to recover it.',
      mnemonicReminderBody: 'You chose “Remind me later” last time. Please write it down now: two copies on paper, kept in different places. Do not screenshot it, do not copy it, and do not store it on a computer or in the cloud. The mnemonic is your only credential; there is no way to recover it.',
      pinyinFriendly: 'Mnemonic pinyin',
      pinyinGroupTwo: "Words",
      pinyinGroupFour: "Idioms",
      later: 'Remind me later',
      saved: 'I wrote it down',
      laterConfirmTitle: 'Remind later',
      laterConfirmBody: 'You have not confirmed writing down the mnemonic. The confirmation screen will appear first on every launch, automatic sign-in will be unavailable, and you must set a PIN. Continue?',
      laterConfirmOk: 'Remind me later',
      confirmBody: 'The mnemonic is your only credential; there is no way to recover it. The mnemonic just shown will be destroyed and cannot be viewed again. Are you sure you have written two copies and stored them separately?',
      confirmOk: 'I wrote it down',
      cancel: 'Cancel',
      pinTitle: 'Set a PIN',
      pinBody: 'The PIN is used to sign in on this device (4–20 letters/digits, no special characters).',
      pin1: 'Enter PIN',
      pin2: 'Repeat PIN',
      autoEnable: 'Automatic sign-in (bind this device)',
      autoDisabledHint: 'Automatic sign-in can only be enabled after the mnemonic is confirmed.',
      autoOnHint: "Changing device hardware or upgrading the system may invalidate your PIN. The mnemonic is the only way to recover.",
      autoOffHint: "Changing device hardware or upgrading the system may invalidate your PIN. The mnemonic is the only way to recover.",
      confirmCreate: 'Finish registration',
      confirmRecover: 'Finish recovery',
      autoLoginFail: 'Could not update automatic sign-in. Try again later.',
      usernameTitle: 'Choose your name',
      usernameBody: 'This name is stored only on this device and is how the app addresses you.',
      usernameLabel: 'Name',
      usernameRule: '1–30 characters (letters, digits, spaces and emoji are fine); must not be empty.',
      usernameFinish: 'Finish',
      usernameSaveFail: 'Could not save the name. Try again.',
      viewTitle: 'View mnemonic',
      viewBody: 'Make sure no one is watching. A leaked mnemonic takes over the account; it will not remain on screen after closing.',
      saveMnemonic: 'Save mnemonic',
      saveLater: 'Save later',
      saveConfirm: 'I have written it down',
      myTitle: 'Account & mnemonic',
      myMnemonic: 'Mnemonic',
      myConfirmed: 'Saved',
      myUnconfirmed: 'Not confirmed',
      myAuto: 'Automatic sign-in on this device',
      myAutoHint: 'Automatic sign-in is bound to this device. An OS upgrade or hardware change may invalidate it; the mnemonic is the only way to recover.',
      myAutoNeedsMnemonic: 'Confirm the mnemonic before enabling automatic sign-in.',
      myAutoUnavailable: 'This build does not support the automatic sign-in switch; use the PIN.',
      logout: 'Sign out',
      logoutConfirm: 'Signing out returns to the sign-in screen. A PIN or mnemonic will be required. Sign out?',
      myPinChange: 'Change PIN',
      myPinDisabled: 'The PIN cannot be changed while automatic sign-in is on.',
      myChangeOk: 'PIN changed. Sign in with the new PIN.',
      myChangeFail: 'PIN change failed.',
    },
    ja: {
      loading: 'アカウントを読み込み中…',
      start: '開始',
      fatal: 'アカウントモジュールが利用できないため、安全に起動できません。preload/main が auth-gate を読み込んでいるか確認してください。',
      seconds: '秒',
      error: '操作に失敗しました',
      close: '閉じる',
      quitBack: '画面に戻る',
      quitApp: 'アプリを終了',
      termsTitle: 'プライバシーと利用規約',
      termsFallback: '以下の規約を読んで同意すると続行できます。',
      termsAgree: '上記の規約をすべて読み、同意します',
      termsContinue: '同意して続行',
      termsDecline: '同意しないで終了',
      termsRequired: '先に規約の最後までスクロールし、3 秒お待ちください',
      termsGateHint: '規約の最後までスクロールし、3 秒待つと同意にチェックできます。',
      loginTitle: 'ログイン',
      loginBody: '起動のたびにログインが必要です。認証情報は助記詞（ニーモニック）に置き換わり、保存されません。',
      pinLogin: 'PIN でログイン',
      pinPlaceholder: 'PIN（4〜20 文字の英数字）',
      login: 'ログイン',
      autoLogin: 'この端末で自動ログイン',
      autoLoginHint: '現在の OS アカウントとハードウェアに紐付けます。OS のアップグレードで無効になる場合があり、助記詞だけが復元方法です。',
      autoLoginInvalid: '自動ログインは無効になりました（OS アカウント/CPU/ハードウェアが変更）。PIN または助記詞で復元してください。',
      recover: '助記句でログイン',
      register: '新しいアカウントを登録',
      noAccount: 'この端末にはアカウントがありません。新規登録するか、既存の助記詞で復元してください。',
      registerTitle: '助記詞アカウントを作成',
      registerBody: '24 語の助記詞を生成します。これが唯一の復元方法です。紙とペンを用意してください。',
      registerBegin: '24 語の助記詞を生成',
      existingMnemonic: '助記詞をすでに持っている',
      existingAccountWarn: 'この端末には既にアカウントがあります。続行すると現在のアカウントと端末 ID を置き換えます（旧認証庫は先にバックアップされます）。続行しますか？',
      back: '戻る',
      recoverTitle: "助記詞を入力してください",
      recoverBody: '24 語の英語助記詞、または助記ピンイン（フルピンイン、数字・記号なし）を入力してください。',
      recoverHint: '助記詞はこの端末内だけで検証され、アップロードされません。',
      verify: '助記詞を検証',
      badPin: 'PIN が正しくありません',
      locked: 'ロックされました。しばらくしてからもう一度お試しください。',
      lockHint: 'あと {n} 回失敗すると、しばらくロックされます',
      pinRule: 'PIN は 4〜20 文字の英数字で、2 回の入力が一致している必要があります。',
      pinMismatch: '2 回の PIN が一致しません。',
      badMnemonic: '助記詞が無効です（単語、順序、チェックサム）。',
      accountExists: 'アカウントは既に存在します',
      vaultCorrupt: '認証庫が破損しているか読み取れません。上書きを避けるため元ファイルを保存しました。',
      osUnavailable: 'OS の安全な保存領域が利用できません。PIN を使用してください。助記詞だけが復元方法です。',
      authManaged: 'この操作は助記詞アカウントが管理しています。',
      mnemonicTitle: '助記詞（24 語）',
      mnemonicHidden: '助記詞を隠しました · クリックで表示',
      mnemonicBody: 'すぐに紙に 2 部書き写し、それぞれ別の場所に保管してください。スクリーンショット、コピー、パソコンやクラウドへの保存は禁止です。助記句は唯一の証明であり、取り戻す方法はありません。',
      mnemonicReminderBody: '前回「後で通知」を選びました。今すぐ書き写してください：紙に 2 部、別々の場所に。スクリーンショット、コピー、パソコンやクラウドへの保存は禁止です。助記句は唯一の証明であり、取り戻す方法はありません。',
      pinyinFriendly: '助記ピンイン',
      pinyinGroupTwo: "単語",
      pinyinGroupFour: "成語",
      later: '後で通知',
      saved: '書き留めました',
      laterConfirmTitle: '後で通知',
      laterConfirmBody: '助記詞の書き写しを確認していません。次回起動時に確認画面が先に表示され、自動ログインは使えず、PIN の設定が必要になります。後でよいですか？',
      laterConfirmOk: '後で通知',
      confirmBody: '助記句は唯一の証明であり、取り戻す方法はありません。表示中の助記句は破棄され、二度と確認できません。2 部を別々の場所に書き留めましたか？',
      confirmOk: '書き留めました',
      cancel: 'キャンセル',
      pinTitle: 'PIN を設定',
      pinBody: 'PIN はこの端末でのログインに使います（4〜20 文字の英数字、記号不可）。',
      pin1: 'PIN を入力',
      pin2: 'PIN を再入力',
      autoEnable: '自動ログイン（この端末に紐付け）',
      autoDisabledHint: '助記詞の書き写しを確認した後でのみ自動ログインを有効にできます。',
      autoOnHint: "デバイスのハードウェア変更やシステムアップグレードで PIN が無効になることがあります。助記詞だけが復元方法です。",
      autoOffHint: "デバイスのハードウェア変更やシステムアップグレードで PIN が無効になることがあります。助記詞だけが復元方法です。",
      confirmCreate: '作成を完了',
      confirmRecover: '復元を完了',
      autoLoginFail: '自動ログインの設定に失敗しました。後でもう一度お試しください。',
      usernameTitle: '呼び名を決める',
      usernameBody: 'この呼び名は本端末にのみ保存され、アプリ内であなたを呼ぶのに使われます。',
      usernameLabel: '呼び名',
      usernameRule: '1〜30 文字（英字、数字、スペース、絵文字可）。空にはできません。',
      usernameFinish: '完了',
      usernameSaveFail: '呼び名を保存できませんでした。もう一度お試しください。',
      viewTitle: '助記詞を表示',
      viewBody: '周りに見られていないことを確認してください。助記詞が漏れるとアカウントを乗っ取られます。閉じると画面には残りません。',
      saveMnemonic: '助記詞を保存',
      saveLater: '後で保存',
      saveConfirm: '書き留めて確認しました',
      myTitle: 'アカウントと助記詞',
      myMnemonic: '助記詞',
      myConfirmed: '保存済み',
      myUnconfirmed: '未確認',
      myAuto: 'この端末で自動ログイン',
      myAutoHint: '自動ログインはこの端末に紐付きます。OS のアップグレードやハードウェア変更で無効になる場合があり、助記詞だけが復元方法です。',
      myAutoNeedsMnemonic: '自動ログインを有効にする前に助記詞を確認してください。',
      myAutoUnavailable: 'このバージョンでは自動ログインの切り替えに対応していません。PIN を使用してください。',
      logout: 'ログアウト',
      logoutConfirm: 'ログアウトするとログイン画面に戻り、再度 PIN または助記詞が必要です。ログアウトしますか？',
      myPinChange: 'PIN を変更',
      myPinDisabled: '自動ログインが有効な間は PIN を変更できません。',
      myChangeOk: 'PIN を変更しました。新しい PIN でログインしてください。',
      myChangeFail: 'PIN の変更に失敗しました。',
    },
    ko: {
      loading: '계정을 불러오는 중…',
      start: '시작',
      fatal: '계정 모듈을 사용할 수 없어 안전하게 시작할 수 없습니다. preload/main에서 auth-gate를 불러왔는지 확인하세요.',
      seconds: '초',
      error: '작업에 실패했습니다',
      close: '닫기',
      quitBack: '화면으로 돌아가기',
      quitApp: '앱 종료',
      termsTitle: '개인정보 및 이용약관',
      termsFallback: '아래 약관을 읽고 동의하면 계속할 수 있습니다.',
      termsAgree: '위 약관을 모두 읽고 동의합니다',
      termsContinue: '동의하고 계속',
      termsDecline: '동의하지 않고 종료',
      termsRequired: '먼저 약관 끝까지 스크롤하고 3초를 기다리세요',
      termsGateHint: '약관 끝까지 스크롤하고 3초를 기다리면 동의에 체크할 수 있습니다.',
      loginTitle: '로그인',
      loginBody: '실행할 때마다 로그인해야 합니다. 자격 증명은 니모닉으로 대체되어 더 이상 저장되지 않습니다.',
      pinLogin: 'PIN으로 로그인',
      pinPlaceholder: 'PIN(4–20자 영문/숫자)',
      login: '로그인',
      autoLogin: '이 기기에서 자동 로그인',
      autoLoginHint: '현재 OS 계정과 하드웨어에 연결됩니다. OS 업그레이드 후 무효가 될 수 있으며, 니모닉이 유일한 복구 방법입니다.',
      autoLoginInvalid: '자동 로그인이 더 이상 유효하지 않습니다(OS 계정/CPU/하드웨어 변경). PIN 또는 니모닉으로 복구하세요.',
      recover: '니모닉으로 로그인',
      register: '새 계정 등록',
      noAccount: '이 기기에는 계정이 없습니다. 새로 등록하거나 기존 니모닉으로 복구하세요.',
      registerTitle: '니모닉 계정 만들기',
      registerBody: '24단어 니모닉이 생성됩니다. 이것이 유일한 복구 방법이므로 종이와 펜을 준비하세요.',
      registerBegin: '24단어 니모닉 생성',
      existingMnemonic: '이미 니모닉이 있습니다',
      existingAccountWarn: '이 기기에 이미 계정이 있습니다. 계속하면 현재 계정과 로컬 신원이 교체됩니다(이전 보관함은 먼저 백업됨). 계속할까요?',
      back: '뒤로',
      recoverTitle: "니모닉을 입력하세요",
      recoverBody: '24단어 영어 니모닉 또는 니모닉 병음(전체 병음, 숫자·기호 없음)을 입력하세요.',
      recoverHint: '니모닉은 이 기기에서만 검증되며 업로드되지 않습니다.',
      verify: '니모닉 확인',
      badPin: 'PIN이 올바르지 않습니다',
      locked: '잠겼습니다. 잠시 후 다시 시도해 주세요.',
      lockHint: '실패를 {n}회 더 하면 잠시 잠깁니다',
      pinRule: 'PIN은 4–20자 영문/숫자여야 하며 두 입력이 일치해야 합니다.',
      pinMismatch: '두 PIN이 일치하지 않습니다.',
      badMnemonic: '잘못된 니모닉입니다(단어, 순서 또는 체크섬).',
      accountExists: '계정이 이미 존재합니다',
      vaultCorrupt: '인증 보관함이 손상되었거나 읽을 수 없습니다. 덮어쓰지 않도록 원본 파일을 보존했습니다.',
      osUnavailable: 'OS 보안 저장소를 사용할 수 없습니다. PIN을 사용하세요. 니모닉이 유일한 복구 방법입니다.',
      authManaged: '이 작업은 니모닉 계정이 관리합니다.',
      mnemonicTitle: '니모닉(24단어)',
      mnemonicHidden: '니모닉 숨김 · 클릭하여 표시',
      mnemonicBody: '지금 바로 종이에 두 부를 적어 서로 다른 곳에 보관하세요. 스크린샷, 복사, 컴퓨터나 클라우드 저장은 하지 마세요. 니모닉은 유일한 증명이며 되찾을 방법이 없습니다.',
      mnemonicReminderBody: '지난번에 “나중에 알림”을 선택했습니다. 지금 적어 주세요: 종이에 두 부, 서로 다른 곳에. 스크린샷, 복사, 컴퓨터나 클라우드 저장은 하지 마세요. 니모닉은 유일한 증명이며 되찾을 방법이 없습니다.',
      pinyinFriendly: '니모닉 병음',
      pinyinGroupTwo: "단어",
      pinyinGroupFour: "성어",
      later: '나중에 알림',
      saved: '적어 두었습니다',
      laterConfirmTitle: '나중에 알림',
      laterConfirmBody: '니모닉을 적었다고 확인하지 않았습니다. 다음 실행 시 확인 화면이 먼저 표시되고, 자동 로그인을 쓸 수 없으며 PIN을 설정해야 합니다. 나중에 할까요?',
      laterConfirmOk: '나중에 알림',
      confirmBody: '니모닉은 유일한 증명이며 되찾을 방법이 없습니다. 방금 표시된 니모닉은 파기되어 다시 볼 수 없습니다. 두 부를 서로 다른 곳에 적어 두셨나요?',
      confirmOk: '적어 두었습니다',
      cancel: '취소',
      pinTitle: 'PIN 설정',
      pinBody: 'PIN은 이 기기 로그인에 사용됩니다(4–20자 영문/숫자, 특수문자 불가).',
      pin1: 'PIN 입력',
      pin2: 'PIN 다시 입력',
      autoEnable: '자동 로그인(이 기기에 연결)',
      autoDisabledHint: '니모닉을 적었다고 확인한 뒤에만 자동 로그인을 켤 수 있습니다.',
      autoOnHint: "기기 하드웨어를 변경하거나 시스템을 업그레이드하면 PIN이 무효화될 수 있습니다. 니모닉만이 유일한 복구 방법입니다.",
      autoOffHint: "기기 하드웨어를 변경하거나 시스템을 업그레이드하면 PIN이 무효화될 수 있습니다. 니모닉만이 유일한 복구 방법입니다.",
      confirmCreate: '생성 완료',
      confirmRecover: '복구 완료',
      autoLoginFail: '자동 로그인 설정에 실패했습니다. 나중에 다시 시도하세요.',
      usernameTitle: '이름 정하기',
      usernameBody: '이 이름은 이 기기에만 저장되며 앱에서 사용자를 부르는 데 쓰입니다.',
      usernameLabel: '이름',
      usernameRule: '1–30자(영문, 숫자, 공백, 이모지 가능), 비워 둘 수 없습니다.',
      usernameFinish: '완료',
      usernameSaveFail: '이름을 저장하지 못했습니다. 다시 시도하세요.',
      viewTitle: '니모닉 보기',
      viewBody: '주변에 보는 사람이 없는지 확인하세요. 니모닉이 유출되면 계정을 빼앗길 수 있습니다. 닫으면 화면에 남지 않습니다.',
      saveMnemonic: '니모닉 저장',
      saveLater: '나중에 저장',
      saveConfirm: '적고 확인했습니다',
      myTitle: '계정 및 니모닉',
      myMnemonic: '니모닉',
      myConfirmed: '저장됨',
      myUnconfirmed: '미확인',
      myAuto: '이 기기에서 자동 로그인',
      myAutoHint: '자동 로그인은 이 기기에 연결됩니다. OS 업그레이드나 하드웨어 변경으로 무효가 될 수 있으며, 니모닉이 유일한 복구 방법입니다.',
      myAutoNeedsMnemonic: '자동 로그인을 켜기 전에 니모닉을 확인하세요.',
      myAutoUnavailable: '이 버전은 자동 로그인 전환을 지원하지 않습니다. PIN을 사용하세요.',
      logout: '로그아웃',
      logoutConfirm: '로그아웃하면 로그인 화면으로 돌아가며 PIN 또는 니모닉이 다시 필요합니다. 로그아웃할까요?',
      myPinChange: 'PIN 변경',
      myPinDisabled: '자동 로그인이 켜져 있는 동안에는 PIN을 변경할 수 없습니다.',
      myChangeOk: 'PIN을 변경했습니다. 새 PIN으로 로그인하세요.',
      myChangeFail: 'PIN 변경에 실패했습니다.',
    },
    fr: {
      loading: 'Chargement du compte…',
      start: 'Commencer',
      fatal: "Le module de compte est indisponible ; démarrage refusé pour des raisons de sécurité. Vérifiez que preload/main charge auth-gate.",
      seconds: 's',
      error: 'Échec de l’opération',
      close: 'Fermer',
      quitBack: "Retour à l'interface",
      quitApp: "Quitter l'application",
      termsTitle: 'Confidentialité et conditions',
      termsFallback: 'Veuillez lire et accepter les conditions ci-dessous pour continuer.',
      termsAgree: 'J’ai lu et j’accepte l’ensemble de ce qui précède',
      termsContinue: 'Accepter et continuer',
      termsDecline: 'Refuser et quitter',
      termsRequired: 'Faites d’abord défiler jusqu’en bas et attendez 3 secondes',
      termsGateHint: 'Faites défiler jusqu’en bas et attendez 3 secondes pour pouvoir cocher le consentement.',
      loginTitle: 'Connexion',
      loginBody: 'Une connexion est requise à chaque démarrage. Le justificatif est géré par la phrase mnémonique et n’est plus stocké.',
      pinLogin: 'Se connecter avec un code PIN',
      pinPlaceholder: 'PIN (4 à 20 lettres/chiffres)',
      login: 'Se connecter',
      autoLogin: 'Connexion automatique sur cet appareil',
      autoLoginHint: 'Liée au compte système et au matériel. Une mise à niveau du système peut l’invalider ; la phrase mnémonique est le seul moyen de récupération.',
      autoLoginInvalid: 'La connexion automatique n’est plus valide (compte système/CPU/matériel modifié). Utilisez le PIN ou la phrase mnémonique.',
      recover: 'Se connecter avec la phrase mnémonique',
      register: 'Créer un nouveau compte',
      noAccount: 'Aucun compte sur cet appareil. Créez-en un ou récupérez un compte existant avec sa phrase mnémonique.',
      registerTitle: 'Créer un compte mnémonique',
      registerBody: 'Une phrase mnémonique de 24 mots va être générée. C’est le seul moyen de récupération : préparez papier et stylo.',
      registerBegin: 'Générer la phrase de 24 mots',
      existingMnemonic: 'J’ai déjà une phrase mnémonique',
      existingAccountWarn: 'Un compte existe déjà. Continuer remplace le compte actuel et l’identité locale (l’ancien coffre est d’abord sauvegardé). Continuer ?',
      back: 'Retour',
      recoverTitle: "Введите мнемоническую фразу",
      recoverBody: 'Saisissez la phrase mnémonique anglaise de 24 mots, ou le pinyin complet adapté au chinois (sans chiffres ni symboles).',
      recoverHint: 'La phrase est vérifiée localement et n’est jamais envoyée.',
      verify: 'Vérifier la phrase',
      badPin: 'PIN incorrect',
      locked: 'Verrouillé. Veuillez réessayer plus tard.',
      lockHint: 'Encore {n} échec(s), puis verrouillage temporaire',
      pinRule: 'Le PIN doit comporter 4 à 20 lettres/chiffres et les deux saisies doivent correspondre.',
      pinMismatch: 'Les deux PIN ne correspondent pas.',
      badMnemonic: 'Phrase mnémonique invalide (mots, ordre ou somme de contrôle).',
      accountExists: 'Le compte existe déjà',
      vaultCorrupt: 'Le coffre d’authentification est corrompu ou illisible. Le fichier d’origine a été conservé.',
      osUnavailable: 'Le stockage sécurisé du système est indisponible. Utilisez un PIN ; la phrase mnémonique est le seul moyen de récupération.',
      authManaged: 'Cette action est gérée par le compte mnémonique.',
      mnemonicTitle: 'Phrase mnémonique (24 mots)',
      mnemonicHidden: 'Phrase masquée · cliquez pour afficher',
      mnemonicBody: 'Recopiez-la immédiatement sur papier en deux exemplaires, conservés à des endroits différents. Ne faites pas de capture d’écran, ne la copiez pas et ne la stockez pas sur un ordinateur ou dans le cloud. La phrase mnémonique est votre seul justificatif ; aucun moyen de récupération n’existe.',
      mnemonicReminderBody: 'Vous avez choisi « Me le rappeler plus tard » la dernière fois. Recopiez-la maintenant : deux exemplaires sur papier, à des endroits différents. Pas de capture d’écran, pas de copie, pas de stockage sur ordinateur ou dans le cloud. La phrase mnémonique est votre seul justificatif ; aucun moyen de récupération n’existe.',
      pinyinFriendly: 'Pinyin mnémonique',
      pinyinGroupTwo: "Слова",
      pinyinGroupFour: "Идиомы",
      later: 'Me le rappeler plus tard',
      saved: 'Je l’ai notée',
      laterConfirmTitle: 'Rappel ultérieur',
      laterConfirmBody: 'Vous n’avez pas confirmé avoir noté la phrase. L’écran de confirmation s’affichera d’abord à chaque démarrage, la connexion automatique sera indisponible et vous devrez définir un PIN. Continuer ?',
      laterConfirmOk: 'Me le rappeler plus tard',
      confirmBody: 'La phrase mnémonique est votre seul justificatif ; aucun moyen de récupération n’existe. La phrase affichée va être détruite et ne pourra plus être consultée. Avez-vous écrit deux exemplaires et les avez-vous rangés séparément ?',
      confirmOk: 'Je l’ai notée',
      cancel: 'Annuler',
      pinTitle: 'Définir un PIN',
      pinBody: 'Le PIN sert à se connecter sur cet appareil (4 à 20 lettres/chiffres, sans caractères spéciaux).',
      pin1: 'Saisir le PIN',
      pin2: 'Confirmer le PIN',
      autoEnable: 'Connexion automatique (lier cet appareil)',
      autoDisabledHint: 'La connexion automatique ne peut être activée qu’après confirmation de la phrase mnémonique.',
      autoOnHint: "Изменение оборудования или обновление системы может сделать PIN недействительным. Мнемоническая фраза — единственный способ восстановления.",
      autoOffHint: "Изменение оборудования или обновление системы может сделать PIN недействительным. Мнемоническая фраза — единственный способ восстановления.",
      confirmCreate: 'Terminer la création',
      confirmRecover: 'Terminer la récupération',
      autoLoginFail: 'Impossible de modifier la connexion automatique. Réessayez plus tard.',
      usernameTitle: 'Choisissez votre nom',
      usernameBody: 'Ce nom est stocké uniquement sur cet appareil et sert à vous désigner dans l’application.',
      usernameLabel: 'Nom',
      usernameRule: '1 à 30 caractères (lettres, chiffres, espaces et emoji acceptés), non vide.',
      usernameFinish: 'Terminer',
      usernameSaveFail: 'Impossible d’enregistrer le nom. Réessayez.',
      viewTitle: 'Afficher la phrase mnémonique',
      viewBody: 'Vérifiez que personne ne regarde. Une phrase divulguée permet de prendre le contrôle du compte ; elle disparaît de l’écran à la fermeture.',
      saveMnemonic: 'Enregistrer la phrase',
      saveLater: 'Enregistrer plus tard',
      saveConfirm: 'Je l’ai écrite et vérifiée',
      myTitle: 'Compte et phrase mnémonique',
      myMnemonic: 'Phrase mnémonique',
      myConfirmed: 'Enregistrée',
      myUnconfirmed: 'Non confirmée',
      myAuto: 'Connexion automatique sur cet appareil',
      myAutoHint: 'La connexion automatique est liée à cet appareil. Une mise à niveau du système ou un changement de matériel peut l’invalider ; la phrase mnémonique est le seul moyen de récupération.',
      myAutoNeedsMnemonic: 'Confirmez la phrase mnémonique avant d’activer la connexion automatique.',
      myAutoUnavailable: 'Cette version ne permet pas de modifier la connexion automatique ; utilisez le PIN.',
      logout: 'Se déconnecter',
      logoutConfirm: 'La déconnexion ramène à l’écran de connexion. Un PIN ou la phrase mnémonique sera nécessaire. Se déconnecter ?',
      myPinChange: 'Modifier le PIN',
      myPinDisabled: 'Le PIN ne peut pas être modifié tant que la connexion automatique est active.',
      myChangeOk: 'PIN modifié. Reconnectez-vous avec le nouveau PIN.',
      myChangeFail: 'Échec de la modification du PIN.',
    },
    es: {
      loading: 'Cargando cuenta…',
      start: 'Empezar',
      fatal: 'El módulo de cuenta no está disponible; no se iniciará de forma insegura. Comprueba que preload/main carga auth-gate.',
      seconds: 's',
      error: 'La operación falló',
      close: 'Cerrar',
      quitBack: 'Volver a la interfaz',
      quitApp: 'Cerrar la aplicación',
      termsTitle: 'Privacidad y condiciones',
      termsFallback: 'Lee y acepta las condiciones siguientes para continuar.',
      termsAgree: 'He leído y acepto todo lo anterior',
      termsContinue: 'Aceptar y continuar',
      termsDecline: 'Rechazar y salir',
      termsRequired: 'Desplázate primero hasta el final y espera 3 segundos',
      termsGateHint: 'Desplázate hasta el final y espera 3 segundos para poder marcar el consentimiento.',
      loginTitle: 'Iniciar sesión',
      loginBody: 'Se requiere iniciar sesión en cada arranque. La credencial ahora la gestiona la frase mnemónica y ya no se guarda.',
      pinLogin: 'Iniciar sesión con PIN',
      pinPlaceholder: 'PIN (4–20 letras/dígitos)',
      login: 'Iniciar sesión',
      autoLogin: 'Inicio de sesión automático en este equipo',
      autoLoginHint: 'Vinculado a la cuenta del sistema y al hardware. Una actualización del sistema puede invalidarlo; la frase mnemónica es la única forma de recuperación.',
      autoLoginInvalid: 'El inicio automático ya no es válido (cambió la cuenta del sistema/CPU/hardware). Usa el PIN o la frase mnemónica.',
      recover: 'Iniciar sesión con frase mnemónica',
      register: 'Registrar una cuenta nueva',
      noAccount: 'No hay ninguna cuenta en este equipo. Registra una nueva o recupera una existente con su frase mnemónica.',
      registerTitle: 'Crear cuenta con mnemónica',
      registerBody: 'Se generará una frase mnemónica de 24 palabras. Es la única forma de recuperación; prepara papel y lápiz.',
      registerBegin: 'Generar frase de 24 palabras',
      existingMnemonic: 'Ya tengo una frase mnemónica',
      existingAccountWarn: 'Ya existe una cuenta en este equipo. Continuar reemplaza la cuenta actual y la identidad local (la bóveda anterior se respalda primero). ¿Continuar?',
      back: 'Volver',
      recoverTitle: "Introduce la frase mnemónica",
      recoverBody: 'Introduce la frase mnemónica en inglés de 24 palabras, o el pinyin completo adaptado al chino (sin números ni símbolos).',
      recoverHint: 'La frase se verifica solo en este equipo y nunca se sube.',
      verify: 'Verificar frase',
      badPin: 'PIN incorrecto',
      locked: 'Bloqueado. Inténtelo de nuevo más tarde.',
      lockHint: 'Tras {n} intento(s) fallido(s) más, se bloqueará por un tiempo',
      pinRule: 'El PIN debe tener 4–20 letras/dígitos y ambas entradas deben coincidir.',
      pinMismatch: 'Los dos PIN no coinciden.',
      badMnemonic: 'Frase mnemónica inválida (palabras, orden o checksum).',
      accountExists: 'La cuenta ya existe',
      vaultCorrupt: 'La bóveda de autenticación está dañada o no se puede leer. Se conservó el archivo original.',
      osUnavailable: 'El almacenamiento seguro del sistema no está disponible. Usa un PIN; la frase mnemónica es la única forma de recuperación.',
      authManaged: 'Esta acción la gestiona la cuenta mnemónica.',
      mnemonicTitle: 'Frase mnemónica (24 palabras)',
      mnemonicHidden: 'Frase oculta · clic para mostrar',
      mnemonicBody: 'Cópiala ahora mismo en papel por duplicado y guárdalas en lugares distintos. No hagas capturas, no la copies y no la guardes en un ordenador ni en la nube. La frase mnemónica es tu única credencial; no existe ningún método de recuperación.',
      mnemonicReminderBody: 'La última vez elegiste «Recordármelo más tarde». Cópiala ahora: dos copias en papel, en lugares distintos. Sin capturas, sin copiar y sin guardarla en un ordenador ni en la nube. La frase mnemónica es tu única credencial; no existe ningún método de recuperación.',
      pinyinFriendly: 'Pinyin mnemónico',
      pinyinGroupTwo: "Palabras",
      pinyinGroupFour: "Modismos",
      later: 'Recordármelo más tarde',
      saved: 'La he anotado',
      laterConfirmTitle: 'Recordar más tarde',
      laterConfirmBody: 'No has confirmado que anotaste la frase. La pantalla de confirmación aparecerá primero en cada arranque, el inicio automático no estará disponible y deberás definir un PIN. ¿Continuar?',
      laterConfirmOk: 'Recordármelo más tarde',
      confirmBody: 'La frase mnemónica es tu única credencial; no existe ningún método de recuperación. La frase mostrada se destruirá y no podrá volver a verse. ¿Has escrito dos copias y las has guardado por separado?',
      confirmOk: 'La he anotado',
      cancel: 'Cancelar',
      pinTitle: 'Definir un PIN',
      pinBody: 'El PIN se usa para iniciar sesión en este equipo (4–20 letras/dígitos, sin caracteres especiales).',
      pin1: 'Introduce el PIN',
      pin2: 'Repite el PIN',
      autoEnable: 'Inicio automático (vincular este equipo)',
      autoDisabledHint: 'El inicio automático solo puede activarse tras confirmar la frase mnemónica.',
      autoOnHint: "Cambiar el hardware del dispositivo o actualizar el sistema puede invalidar el PIN. La frase mnemónica es la única forma de recuperación.",
      autoOffHint: "Cambiar el hardware del dispositivo o actualizar el sistema puede invalidar el PIN. La frase mnemónica es la única forma de recuperación.",
      confirmCreate: 'Terminar registro',
      confirmRecover: 'Terminar recuperación',
      autoLoginFail: 'No se pudo cambiar el inicio automático. Inténtalo más tarde.',
      usernameTitle: 'Elige tu nombre',
      usernameBody: 'Este nombre se guarda solo en este equipo y es como la aplicación se dirige a ti.',
      usernameLabel: 'Nombre',
      usernameRule: 'De 1 a 30 caracteres (letras, dígitos, espacios y emoji), no puede estar vacío.',
      usernameFinish: 'Terminar',
      usernameSaveFail: 'No se pudo guardar el nombre. Inténtalo de nuevo.',
      viewTitle: 'Ver frase mnemónica',
      viewBody: 'Comprueba que nadie esté mirando. Una frase filtrada permite tomar la cuenta; no permanecerá en pantalla al cerrar.',
      saveMnemonic: 'Guardar frase',
      saveLater: 'Guardar más tarde',
      saveConfirm: 'La he escrito y confirmado',
      myTitle: 'Cuenta y frase mnemónica',
      myMnemonic: 'Frase mnemónica',
      myConfirmed: 'Guardada',
      myUnconfirmed: 'Sin confirmar',
      myAuto: 'Inicio automático en este equipo',
      myAutoHint: 'El inicio automático está vinculado a este equipo. Una actualización del sistema o un cambio de hardware puede invalidarlo; la frase mnemónica es la única forma de recuperación.',
      myAutoNeedsMnemonic: 'Confirma la frase mnemónica antes de activar el inicio automático.',
      myAutoUnavailable: 'Esta versión no permite cambiar el inicio automático; usa el PIN.',
      logout: 'Cerrar sesión',
      logoutConfirm: 'Al cerrar sesión volverás a la pantalla de inicio y necesitarás el PIN o la frase mnemónica. ¿Cerrar sesión?',
      myPinChange: 'Cambiar PIN',
      myPinDisabled: 'No se puede cambiar el PIN mientras el inicio automático esté activo.',
      myChangeOk: 'PIN cambiado. Inicia sesión con el nuevo PIN.',
      myChangeFail: 'No se pudo cambiar el PIN.',
    },
    pt: {
      loading: 'Carregando conta…',
      start: 'Começar',
      fatal: 'O módulo de conta não está disponível; não vou iniciar de forma insegura. Verifique se preload/main carrega o auth-gate.',
      seconds: 's',
      error: 'A operação falhou',
      close: 'Fechar',
      quitBack: 'Voltar à interface',
      quitApp: 'Fechar o aplicativo',
      termsTitle: 'Privacidade e termos',
      termsFallback: 'Leia e aceite os termos abaixo para continuar.',
      termsAgree: 'Li e aceito tudo o que está acima',
      termsContinue: 'Aceitar e continuar',
      termsDecline: 'Recusar e sair',
      termsRequired: 'Role até o fim e aguarde 3 segundos primeiro',
      termsGateHint: 'Role até o fim e aguarde 3 segundos para poder marcar o consentimento.',
      loginTitle: 'Entrar',
      loginBody: 'É necessário entrar a cada inicialização. A credencial agora é gerenciada pela frase mnemônica e não é mais armazenada.',
      pinLogin: 'Entrar com PIN',
      pinPlaceholder: 'PIN (4–20 letras/números)',
      login: 'Entrar',
      autoLogin: 'Entrada automática neste dispositivo',
      autoLoginHint: 'Vinculada à conta do sistema e ao hardware. Uma atualização do sistema pode invalidá-la; a frase mnemônica é a única forma de recuperação.',
      autoLoginInvalid: 'A entrada automática não é mais válida (conta do sistema/CPU/hardware mudou). Use o PIN ou a frase mnemônica.',
      recover: 'Entrar com frase mnemônica',
      register: 'Registrar nova conta',
      noAccount: 'Não há conta neste dispositivo. Registre uma nova ou recupere uma existente com a frase mnemônica.',
      registerTitle: 'Criar conta mnemônica',
      registerBody: 'Será gerada uma frase mnemônica de 24 palavras. É a única forma de recuperação; prepare papel e caneta.',
      registerBegin: 'Gerar frase de 24 palavras',
      existingMnemonic: 'Já tenho uma frase mnemônica',
      existingAccountWarn: 'Já existe uma conta neste dispositivo. Continuar substitui a conta atual e a identidade local (o cofre antigo é copiado antes). Continuar?',
      back: 'Voltar',
      recoverTitle: "Saisissez la phrase mnémonique",
      recoverBody: 'Digite a frase mnemônica em inglês de 24 palavras, ou o pinyin completo adaptado ao chinês (sem números ou símbolos).',
      recoverHint: 'A frase é verificada apenas neste dispositivo e nunca é enviada.',
      verify: 'Verificar frase',
      badPin: 'PIN incorreto',
      locked: 'Bloqueado. Tente novamente mais tarde.',
      lockHint: 'Após mais {n} tentativa(s) falha(s), bloqueio temporário',
      pinRule: 'O PIN deve ter 4–20 letras/números e as duas entradas devem coincidir.',
      pinMismatch: 'Os dois PINs não coincidem.',
      badMnemonic: 'Frase mnemônica inválida (palavras, ordem ou checksum).',
      accountExists: 'A conta já existe',
      vaultCorrupt: 'O cofre de autenticação está corrompido ou ilegível. O arquivo original foi preservado.',
      osUnavailable: 'O armazenamento seguro do sistema não está disponível. Use um PIN; a frase mnemônica é a única forma de recuperação.',
      authManaged: 'Esta ação é gerenciada pela conta mnemônica.',
      mnemonicTitle: 'Frase mnemônica (24 palavras)',
      mnemonicHidden: 'Frase oculta · clique para mostrar',
      mnemonicBody: 'Copie agora mesmo à mão em duas folhas e guarde-as em lugares diferentes. Não tire print, não copie e não guarde no computador ou na nuvem. A frase mnemônica é sua única credencial; não existe método de recuperação.',
      mnemonicReminderBody: 'Você escolheu “Lembrar mais tarde” da última vez. Copie agora: duas folhas de papel, em lugares diferentes. Sem print, sem copiar e sem guardar no computador ou na nuvem. A frase mnemônica é sua única credencial; não existe método de recuperação.',
      pinyinFriendly: 'Pinyin mnemônico',
      pinyinGroupTwo: "Mots",
      pinyinGroupFour: "Idiomes",
      later: 'Lembrar mais tarde',
      saved: 'Já anotei',
      laterConfirmTitle: 'Lembrar mais tarde',
      laterConfirmBody: 'Você não confirmou que anotou a frase. A tela de confirmação aparecerá primeiro em cada inicialização, a entrada automática ficará indisponível e será preciso definir um PIN. Continuar?',
      laterConfirmOk: 'Lembrar mais tarde',
      confirmBody: 'A frase mnemônica é sua única credencial; não existe método de recuperação. A frase exibida será destruída e não poderá ser vista novamente. Você escreveu duas cópias e as guardou separadamente?',
      confirmOk: 'Já anotei',
      cancel: 'Cancelar',
      pinTitle: 'Definir PIN',
      pinBody: 'O PIN é usado para entrar neste dispositivo (4–20 letras/números, sem caracteres especiais).',
      pin1: 'Digite o PIN',
      pin2: 'Repita o PIN',
      autoEnable: 'Entrada automática (vincular este dispositivo)',
      autoDisabledHint: 'A entrada automática só pode ser ativada após confirmar a frase mnemônica.',
      autoOnHint: "Changer le matériel de l’appareil ou mettre à jour le système peut invalider le PIN. La phrase mnémonique est le seul moyen de récupération.",
      autoOffHint: "Changer le matériel de l’appareil ou mettre à jour le système peut invalider le PIN. La phrase mnémonique est le seul moyen de récupération.",
      confirmCreate: 'Concluir registro',
      confirmRecover: 'Concluir recuperação',
      autoLoginFail: 'Não foi possível alterar a entrada automática. Tente mais tarde.',
      usernameTitle: 'Escolha seu nome',
      usernameBody: 'Este nome fica apenas neste dispositivo e é como o aplicativo se refere a você.',
      usernameLabel: 'Nome',
      usernameRule: 'De 1 a 30 caracteres (letras, números, espaços e emoji), não pode ficar vazio.',
      usernameFinish: 'Concluir',
      usernameSaveFail: 'Não foi possível salvar o nome. Tente novamente.',
      viewTitle: 'Ver frase mnemônica',
      viewBody: 'Confirme que ninguém está olhando. Uma frase vazada permite tomar a conta; ela não permanece na tela após fechar.',
      saveMnemonic: 'Salvar frase',
      saveLater: 'Salvar mais tarde',
      saveConfirm: 'Escrevi e confirmei',
      myTitle: 'Conta e frase mnemônica',
      myMnemonic: 'Frase mnemônica',
      myConfirmed: 'Salva',
      myUnconfirmed: 'Não confirmada',
      myAuto: 'Entrada automática neste dispositivo',
      myAutoHint: 'A entrada automática está vinculada a este dispositivo. Uma atualização do sistema ou troca de hardware pode invalidá-la; a frase mnemônica é a única forma de recuperação.',
      myAutoNeedsMnemonic: 'Confirme a frase mnemônica antes de ativar a entrada automática.',
      myAutoUnavailable: 'Esta versão não permite alterar a entrada automática; use o PIN.',
      logout: 'Sair da conta',
      logoutConfirm: 'Sair volta à tela de entrada e exigirá PIN ou frase mnemônica. Sair?',
      myPinChange: 'Alterar PIN',
      myPinDisabled: 'O PIN não pode ser alterado enquanto a entrada automática estiver ativada.',
      myChangeOk: 'PIN alterado. Entre com o novo PIN.',
      myChangeFail: 'Falha ao alterar o PIN.',
    },
    ru: {
      loading: 'Загрузка аккаунта…',
      start: 'Начать',
      fatal: 'Модуль аккаунта недоступен; запуск в небезопасном режиме запрещён. Проверьте, что preload/main загружает auth-gate.',
      seconds: 'с',
      error: 'Операция не удалась',
      close: 'Закрыть',
      quitBack: 'Вернуться в интерфейс',
      quitApp: 'Закрыть приложение',
      termsTitle: 'Конфиденциальность и условия',
      termsFallback: 'Прочитайте и примите условия ниже, чтобы продолжить.',
      termsAgree: 'Я прочитал(а) и принимаю всё вышеизложенное',
      termsContinue: 'Принять и продолжить',
      termsDecline: 'Отказаться и выйти',
      termsRequired: 'Сначала прокрутите до конца и подождите 3 секунды',
      termsGateHint: 'Прокрутите до конца и подождите 3 секунды, чтобы поставить галочку согласия.',
      loginTitle: 'Вход',
      loginBody: 'Вход требуется при каждом запуске. Учётные данные теперь управляются мнемонической фразой и не хранятся.',
      pinLogin: 'Войти с PIN',
      pinPlaceholder: 'PIN (4–20 букв/цифр)',
      login: 'Войти',
      autoLogin: 'Автоматический вход на этом устройстве',
      autoLoginHint: 'Привязан к учётной записи системы и оборудованию. Обновление системы может его аннулировать; мнемоническая фраза — единственный способ восстановления.',
      autoLoginInvalid: 'Автоматический вход больше недействителен (изменились учётная запись/CPU/оборудование). Используйте PIN или мнемоническую фразу.',
      recover: 'Войти с мнемонической фразой',
      register: 'Зарегистрировать новый аккаунт',
      noAccount: 'На этом устройстве нет аккаунта. Зарегистрируйте новый или восстановите существующий по мнемонической фразе.',
      registerTitle: 'Создать аккаунт с мнемоникой',
      registerBody: 'Будет создана мнемоническая фраза из 24 слов. Это единственный способ восстановления; приготовьте бумагу и ручку.',
      registerBegin: 'Создать фразу из 24 слов',
      existingMnemonic: 'У меня уже есть мнемоническая фраза',
      existingAccountWarn: 'На этом устройстве уже есть аккаунт. Продолжение заменит текущий аккаунт и локальную идентичность (старое хранилище сначала будет сохранено). Продолжить?',
      back: 'Назад',
      recoverTitle: "Digite a frase mnemônica",
      recoverBody: 'Введите мнемоническую фразу из 24 английских слов или полный пиньинь для китайского (без цифр и символов).',
      recoverHint: 'Фраза проверяется только на этом устройстве и никуда не отправляется.',
      verify: 'Проверить фразу',
      badPin: 'Неверный PIN',
      locked: 'Заблокировано. Попробуйте позже.',
      lockHint: 'Ещё {n} неудачных попыток — временная блокировка',
      pinRule: 'PIN должен состоять из 4–20 букв/цифр, и оба ввода должны совпадать.',
      pinMismatch: 'PIN-коды не совпадают.',
      badMnemonic: 'Неверная мнемоническая фраза (слова, порядок или контрольная сумма).',
      accountExists: 'Аккаунт уже существует',
      vaultCorrupt: 'Хранилище аутентификации повреждено или недоступно для чтения. Исходный файл сохранён.',
      osUnavailable: 'Безопасное хранилище ОС недоступно. Используйте PIN; мнемоническая фраза — единственный способ восстановления.',
      authManaged: 'Это действие управляется аккаунтом с мнемоникой.',
      mnemonicTitle: 'Мнемоническая фраза (24 слова)',
      mnemonicHidden: 'Фраза скрыта · нажмите, чтобы показать',
      mnemonicBody: 'Немедленно перепишите её от руки в двух экземплярах и храните в разных местах. Не делайте скриншотов, не копируйте и не храните на компьютере или в облаке. Мнемоническая фраза — ваше единственное подтверждение; способа восстановления не существует.',
      mnemonicReminderBody: 'В прошлый раз вы выбрали «Напомнить позже». Перепишите сейчас: два экземпляра на бумаге, в разных местах. Без скриншотов, копирования и хранения на компьютере или в облаке. Мнемоническая фраза — ваше единственное подтверждение; способа восстановления не существует.',
      pinyinFriendly: 'Мнемонический пиньинь',
      pinyinGroupTwo: "Palavras",
      pinyinGroupFour: "Expressões",
      later: 'Напомнить позже',
      saved: 'Я записал(а)',
      laterConfirmTitle: 'Напомнить позже',
      laterConfirmBody: 'Вы не подтвердили, что записали фразу. Экран подтверждения будет показываться первым при каждом запуске, автоматический вход станет недоступен, и потребуется задать PIN. Продолжить?',
      laterConfirmOk: 'Напомнить позже',
      confirmBody: 'Мнемоническая фраза — ваше единственное подтверждение; способа восстановления не существует. Показанная фраза будет уничтожена, и её больше нельзя будет просмотреть. Вы записали два экземпляра и храните их отдельно?',
      confirmOk: 'Я записал(а)',
      cancel: 'Отмена',
      pinTitle: 'Задать PIN',
      pinBody: 'PIN используется для входа на этом устройстве (4–20 букв/цифр, без специальных символов).',
      pin1: 'Введите PIN',
      pin2: 'Повторите PIN',
      autoEnable: 'Автоматический вход (привязать устройство)',
      autoDisabledHint: 'Автоматический вход можно включить только после подтверждения мнемонической фразы.',
      autoOnHint: "Alterar o hardware do dispositivo ou atualizar o sistema pode invalidar o PIN. A frase mnemónica é a única forma de recuperação.",
      autoOffHint: "Alterar o hardware do dispositivo ou atualizar o sistema pode invalidar o PIN. A frase mnemónica é a única forma de recuperação.",
      confirmCreate: 'Завершить создание',
      confirmRecover: 'Завершить восстановление',
      autoLoginFail: 'Не удалось изменить автоматический вход. Попробуйте позже.',
      usernameTitle: 'Выберите имя',
      usernameBody: 'Это имя хранится только на этом устройстве и используется приложением для обращения к вам.',
      usernameLabel: 'Имя',
      usernameRule: 'От 1 до 30 символов (буквы, цифры, пробелы и эмодзи), не может быть пустым.',
      usernameFinish: 'Готово',
      usernameSaveFail: 'Не удалось сохранить имя. Попробуйте ещё раз.',
      viewTitle: 'Показать мнемоническую фразу',
      viewBody: 'Убедитесь, что никто не смотрит. Утечка фразы означает захват аккаунта; после закрытия она не останется на экране.',
      saveMnemonic: 'Сохранить фразу',
      saveLater: 'Сохранить позже',
      saveConfirm: 'Я записал(а) и подтверждаю',
      myTitle: 'Аккаунт и мнемоника',
      myMnemonic: 'Мнемоническая фраза',
      myConfirmed: 'Сохранена',
      myUnconfirmed: 'Не подтверждена',
      myAuto: 'Автоматический вход на этом устройстве',
      myAutoHint: 'Автоматический вход привязан к этому устройству. Обновление системы или смена оборудования может его аннулировать; мнемоническая фраза — единственный способ восстановления.',
      myAutoNeedsMnemonic: 'Подтвердите мнемоническую фразу, прежде чем включать автоматический вход.',
      myAutoUnavailable: 'Эта версия не поддерживает переключатель автоматического входа; используйте PIN.',
      logout: 'Выйти из аккаунта',
      logoutConfirm: 'После выхода вы вернётесь на экран входа; потребуется PIN или мнемоническая фраза. Выйти?',
      myPinChange: 'Изменить PIN',
      myPinDisabled: 'PIN нельзя изменить, пока включён автоматический вход.',
      myChangeOk: 'PIN изменён. Войдите с новым PIN.',
      myChangeFail: 'Не удалось изменить PIN.',
    },
    eo: {
      loading: 'Ŝargado de konto…',
      start: 'Komenci',
      fatal: 'La konta modulo ne disponeblas; rifuzas starti nesekure. Kontrolu, ĉu preload/main ŝargas auth-gate.',
      seconds: 's',
      error: 'Operacio malsukcesis',
      close: 'Fermi',
      quitBack: 'Reiri al interfaco',
      quitApp: 'Fermu la programon',
      termsTitle: 'Privateco kaj kondiĉoj',
      termsFallback: 'Bonvolu legi kaj akcepti la subajn kondiĉojn por daŭrigi.',
      termsAgree: 'Mi legis kaj akceptas ĉion ĉi-supre',
      termsContinue: 'Akcepti kaj daŭrigi',
      termsDecline: 'Rifuzi kaj eliri',
      termsRequired: 'Unue rulumu ĝis la fino kaj atendu 3 sekundojn',
      termsGateHint: 'Rulumu ĝis la fino kaj atendu 3 sekundojn por povi marki konsenton.',
      loginTitle: 'Ensaluti',
      loginBody: 'Ensaluto necesas ĉe ĉiu lanĉo. La akreditaĵo nun estas administrata de la mnemonika frazo kaj ne plu konserviĝas.',
      pinLogin: 'Ensaluti per PIN',
      pinPlaceholder: 'PIN (4–20 literoj/ciferoj)',
      login: 'Ensaluti',
      autoLogin: 'Aŭtomata ensaluto sur ĉi tiu aparato',
      autoLoginHint: 'Ligita al la sistema konto kaj aparataro. Sistema ĝisdatigo povas malvalidigi ĝin; la mnemonika frazo estas la sola maniero reakiri.',
      autoLoginInvalid: 'Aŭtomata ensaluto ne plu validas (ŝanĝiĝis sistema konto/CPU/aparataro). Uzu PIN aŭ la mnemonikan frazon.',
      recover: 'Ensaluti per mnemonika frazo',
      register: 'Registri novan konton',
      noAccount: 'Neniu konto sur ĉi tiu aparato. Registru novan aŭ reakiru ekzistantan per ĝia mnemonika frazo.',
      registerTitle: 'Krei mnemonikan konton',
      registerBody: 'Estos generita mnemonika frazo de 24 vortoj. Ĝi estas la sola maniero reakiri; preparu paperon kaj skribilon.',
      registerBegin: 'Generi frazon de 24 vortoj',
      existingMnemonic: 'Mi jam havas mnemonikan frazon',
      existingAccountWarn: 'Konto jam ekzistas sur ĉi tiu aparato. Daŭrigi anstataŭigos la nunan konton kaj lokan identecon (la malnova kaŝejo unue kopiiĝos). Ĉu daŭrigi?',
      back: 'Reen',
      recoverTitle: "Enigu la mnemonikan frazon",
      recoverBody: 'Enigu la 24-vortan anglan mnemonikan frazon, aŭ plenan pinyin por la ĉina (sen ciferoj aŭ simboloj).',
      recoverHint: 'La frazo estas kontrolata nur loke kaj neniam suprengluiĝas.',
      verify: 'Kontroli frazon',
      badPin: 'Malĝusta PIN',
      locked: 'Ŝlosita. Bonvolu reprovi poste.',
      lockHint: 'Post {n} pliaj malsukcesoj vi estos ŝlosita dum iom da tempo',
      pinRule: 'PIN devas esti 4–20 literoj/ciferoj kaj ambaŭ enigoj devas kongrui.',
      pinMismatch: 'La du PIN-oj ne kongruas.',
      badMnemonic: 'Nevalida mnemonika frazo (vortoj, ordo aŭ kontrolsumo).',
      accountExists: 'Konto jam ekzistas',
      vaultCorrupt: 'La aŭtentiga kaŝejo estas difektita aŭ nelegebla. La originala dosiero konserviĝis.',
      osUnavailable: 'Sekura konservado de la operaciumo ne disponeblas. Uzu PIN; la mnemonika frazo estas la sola maniero reakiri.',
      authManaged: 'Ĉi tiun agon administras la mnemonika konto.',
      mnemonicTitle: 'Mnemonika frazo (24 vortoj)',
      mnemonicHidden: 'Mnemoniko kaŝita · klaku por montri',
      mnemonicBody: 'Tuj kopiu ĝin permane du ekzemplerojn kaj konservu ilin en malsamaj lokoj. Ne faru ekrankopion, ne kopiu, kaj ne konservu ĝin en komputilo aŭ nubo. La mnemonika frazo estas via sola pruvo; ne ekzistas maniero reakiri ĝin.',
      mnemonicReminderBody: 'Vi lastfoje elektis “Rememorigi poste”. Bonvolu kopii nun: du paperajn ekzemplerojn, en malsamaj lokoj. Sen ekrankopio, sen kopio, kaj sen konservado en komputilo aŭ nubo. La mnemonika frazo estas via sola pruvo; ne ekzistas maniero reakiri ĝin.',
      pinyinFriendly: 'Mnemonika pinjino',
      pinyinGroupTwo: "Vortoj",
      pinyinGroupFour: "Idiomoj",
      later: 'Rememorigi min poste',
      saved: 'Mi skribis ĝin',
      laterConfirmTitle: 'Rememorigi poste',
      laterConfirmBody: 'Vi ne konfirmis, ke vi skribis la mnemonikan frazon. La konfirma ekrano aperos unue ĉe ĉiu lanĉo, aŭtomata ensaluto ne disponeblos, kaj vi devos agordi PIN. Ĉu daŭrigi?',
      laterConfirmOk: 'Rememorigi poste',
      confirmBody: 'La mnemonika frazo estas via sola pruvo; ne ekzistas maniero reakiri ĝin. La ĵus montrita frazo estos detruita kaj ne plu videblos. Ĉu vi skribis du ekzemplerojn kaj konservis ilin aparte?',
      confirmOk: 'Mi skribis ĝin',
      cancel: 'Nuligi',
      pinTitle: 'Agordi PIN',
      pinBody: 'PIN estas uzata por ensaluti sur ĉi tiu aparato (4–20 literoj/ciferoj, sen specialaj signoj).',
      pin1: 'Enigu PIN',
      pin2: 'Ripetu PIN',
      autoEnable: 'Aŭtomata ensaluto (ligi ĉi tiun aparaton)',
      autoDisabledHint: 'Aŭtomata ensaluto eblas nur post konfirmo de la mnemonika frazo.',
      autoOnHint: "Ŝanĝi la aparatan hardvaron aŭ ĝisdatigi la sistemon povas malvalidigi la PIN. La mnemonika frazo estas la sola maniero reakiri.",
      autoOffHint: "Ŝanĝi la aparatan hardvaron aŭ ĝisdatigi la sistemon povas malvalidigi la PIN. La mnemonika frazo estas la sola maniero reakiri.",
      confirmCreate: 'Fini registradon',
      confirmRecover: 'Fini reakiron',
      autoLoginFail: 'Ne eblis ŝanĝi aŭtomatan ensaluton. Reprovo poste.',
      usernameTitle: 'Elektu vian nomon',
      usernameBody: 'Ĉi tiu nomo konserviĝas nur sur ĉi tiu aparato kaj estas kiel la aplikaĵo nomas vin.',
      usernameLabel: 'Nomo',
      usernameRule: '1–30 signoj (literoj, ciferoj, spacoj kaj emoĝioj), ne povas esti malplena.',
      usernameFinish: 'Fini',
      usernameSaveFail: 'Ne eblis konservi la nomon. Reprovo.',
      viewTitle: 'Vidi mnemonikan frazon',
      viewBody: 'Kontrolu, ke neniu rigardas. Malkaŝita frazo permesas transpreni la konton; ĝi ne restos sur la ekrano post fermo.',
      saveMnemonic: 'Konservi frazon',
      saveLater: 'Konservi poste',
      saveConfirm: 'Mi skribis kaj konfirmas',
      myTitle: 'Konto kaj mnemoniko',
      myMnemonic: 'Mnemonika frazo',
      myConfirmed: 'Konservita',
      myUnconfirmed: 'Ne konfirmita',
      myAuto: 'Aŭtomata ensaluto sur ĉi tiu aparato',
      myAutoHint: 'Aŭtomata ensaluto estas ligita al ĉi tiu aparato. Sistema ĝisdatigo aŭ aparatara ŝanĝo povas malvalidigi ĝin; la mnemonika frazo estas la sola maniero reakiri.',
      myAutoNeedsMnemonic: 'Konfirmu la mnemonikan frazon antaŭ ol ŝalti aŭtomatan ensaluton.',
      myAutoUnavailable: 'Ĉi tiu versio ne subtenas la ŝaltilon de aŭtomata ensaluto; uzu PIN.',
      logout: 'Elsaluti',
      logoutConfirm: 'Elsaluto revenigos vin al la ensaluta ekrano; PIN aŭ mnemonika frazo necesos. Ĉu elsaluti?',
      myPinChange: 'Ŝanĝi PIN',
      myPinDisabled: 'PIN ne ŝanĝeblas dum aŭtomata ensaluto estas ŝaltita.',
      myChangeOk: 'PIN ŝanĝita. Ensalutu per la nova PIN.',
      myChangeFail: 'Ŝanĝo de PIN malsukcesis.',
    },
    de: {
      loading: 'Konto wird geladen…',
      start: 'Start',
      fatal: 'Das Kontomodul ist nicht verfügbar; der Start wird aus Sicherheitsgründen abgebrochen. Bitte prüfen, ob preload/main auth-gate lädt.',
      seconds: 's',
      error: 'Vorgang fehlgeschlagen',
      close: 'Schließen',
      quitBack: 'Zurück zur App',
      quitApp: 'Programm beenden',
      termsTitle: 'Datenschutz & Bedingungen',
      termsFallback: 'Bitte lies die folgenden Bedingungen und stimme ihnen zu, um fortzufahren.',
      termsAgree: 'Ich habe alles oben gelesen und stimme zu',
      termsContinue: 'Zustimmen und fortfahren',
      termsDecline: 'Ablehnen und beenden',
      termsRequired: 'Bitte zuerst nach unten scrollen und 3 Sekunden warten.',
      termsGateHint: 'Scrolle bis zum Ende und warte 3 Sekunden, dann kannst du zustimmen.',
      loginTitle: 'Anmelden',
      loginBody: 'Bei jedem Start ist eine Anmeldung nötig. Das Kennwort wird jetzt von der Merksatz-Phrase verwaltet und nicht mehr gespeichert.',
      pinLogin: 'Mit PIN anmelden',
      pinPlaceholder: 'PIN (4–20 Buchstaben/Ziffern)',
      login: 'Anmelden',
      autoLogin: 'Automatische Anmeldung auf diesem Gerät',
      autoLoginHint: 'An dieses Systemkonto und die Hardware gebunden. Ein System-Upgrade kann sie ungültig machen; die Merksatz-Phrase ist der einzige Weg zurück.',
      autoLoginInvalid: 'Die automatische Anmeldung ist nicht mehr gültig (Systemkonto/CPU/Hardware geändert). Nutze PIN oder Merksatz-Phrase.',
      recover: 'Mit Merksatz-Phrase anmelden',
      register: 'Neues Konto erstellen',
      noAccount: 'Auf diesem Gerät gibt es noch kein Konto. Erstelle ein neues oder stelle eines mit seiner Merksatz-Phrase wieder her.',
      registerTitle: 'Merksatz-Konto erstellen',
      registerBody: 'Es wird eine Phrase aus 24 Wörtern erzeugt. Sie ist der einzige Weg zur Wiederherstellung; halte Papier und Stift bereit.',
      registerBegin: 'Phrase aus 24 Wörtern erzeugen',
      existingMnemonic: 'Ich habe bereits eine Phrase',
      existingAccountWarn: 'Auf diesem Gerät existiert bereits ein Konto. Fortfahren ersetzt das aktuelle Konto und die lokale Identität (der alte Tresor wird vorher gesichert). Fortfahren?',
      back: 'Zurück',
      recoverTitle: 'Merksatz-Phrase eingeben',
      recoverBody: 'Gib die englische Phrase aus 24 Wörtern ein oder die Pinyin-Variante (volles Pinyin, ohne Ziffern und Zeichen).',
      recoverHint: 'Die Phrase wird nur lokal geprüft und nie hochgeladen.',
      verify: 'Phrase prüfen',
      badPin: 'PIN falsch',
      locked: 'Gesperrt. Bitte später erneut versuchen.',
      lockHint: 'Nach {n} weiteren Fehlversuchen wirst du für eine Weile gesperrt',
      pinRule: 'Die PIN muss 4–20 Buchstaben/Ziffern haben und beide Eingaben müssen übereinstimmen.',
      pinMismatch: 'Die beiden PINs stimmen nicht überein.',
      badMnemonic: 'Ungültige Phrase (Wörter, Reihenfolge oder Prüfsumme).',
      accountExists: 'Konto existiert bereits',
      vaultCorrupt: 'Der Auth-Tresor ist beschädigt oder unlesbar. Die Originaldatei wurde erhalten.',
      osUnavailable: 'Der sichere Systemspeicher ist nicht verfügbar. Nutze eine PIN; die Merksatz-Phrase ist der einzige Weg zurück.',
      authManaged: 'Diese Aktion wird vom Merksatz-Konto verwaltet.',
      mnemonicTitle: 'Merksatz-Phrase (24 Wörter)',
      mnemonicHidden: 'Phrase verborgen · zum Anzeigen klicken',
      mnemonicBody: 'Schreibe sie jetzt sofort mit der Hand ab — zwei Kopien an verschiedenen Orten. Kein Screenshot, keine Kopie, nicht auf Computer oder in der Cloud speichern. Die Phrase ist dein einziger Ausweis; es gibt keine Wiederherstellung!',
      mnemonicReminderBody: 'Du hast letztes Mal „Später erinnern“ gewählt. Bitte jetzt abschreiben: zwei Kopien mit der Hand, an verschiedenen Orten. Kein Screenshot, keine Kopie, nicht auf Computer oder in der Cloud speichern. Die Phrase ist dein einziger Ausweis; es gibt keine Wiederherstellung!',
      pinyinFriendly: 'Phrase als Pinyin',
      pinyinGroupTwo: 'Wörter',
      pinyinGroupFour: 'Redewendungen',
      later: 'Später erinnern',
      saved: 'Notiert',
      laterConfirmTitle: 'Später erinnern',
      laterConfirmBody: 'Du hast das Abschreiben nicht bestätigt. Beim nächsten Start erscheint zuerst die Bestätigungsseite; die automatische Anmeldung bleibt aus, und du musst zuerst eine PIN setzen. Wirklich später?',
      laterConfirmOk: 'Später erinnern',
      confirmBody: 'Die Phrase ist dein einziger Ausweis; es gibt keine Wiederherstellung! Die gerade gezeigte Phrase wird gelöscht und ist danach nicht mehr sichtbar. Hast du zwei Kopien an verschiedenen Orten notiert?',
      confirmOk: 'Notiert',
      cancel: 'Abbrechen',
      pinTitle: 'PIN festlegen',
      pinBody: 'Die PIN dient zur Anmeldung auf diesem Gerät (4–20 Buchstaben/Ziffern, keine Sonderzeichen).',
      pin1: 'PIN eingeben',
      pin2: 'PIN wiederholen',
      autoEnable: 'Automatische Anmeldung (dieses Gerät binden)',
      autoDisabledHint: 'Die automatische Anmeldung lässt sich erst nach bestätigtem Abschreiben aktivieren.',
      autoOnHint: 'Hardwareänderungen oder ein System-Upgrade können die PIN ungültig machen; die Merksatz-Phrase ist der einzige Weg zurück!',
      autoOffHint: 'Hardwareänderungen oder ein System-Upgrade können die PIN ungültig machen; die Merksatz-Phrase ist der einzige Weg zurück!',
      confirmCreate: 'Registrierung abschließen',
      confirmRecover: 'Wiederherstellung abschließen',
      autoLoginFail: 'Automatische Anmeldung konnte nicht gesetzt werden. Später erneut versuchen.',
      usernameTitle: 'Wähle deinen Namen',
      usernameBody: 'Dieser Name wird nur auf diesem Gerät gespeichert und dient als Anrede in der App.',
      usernameLabel: 'Name',
      usernameRule: '1–30 Zeichen (Buchstaben, Ziffern, Leerzeichen, Emoji), darf nicht leer sein.',
      usernameFinish: 'Fertig',
      usernameSaveFail: 'Name konnte nicht gespeichert werden. Bitte erneut versuchen.',
      viewTitle: 'Phrase anzeigen',
      viewBody: 'Stelle sicher, dass niemand zusieht. Eine geleakte Phrase übernimmt das Konto; nach dem Schließen bleibt sie nicht auf dem Bildschirm.',
      saveMnemonic: 'Phrase speichern',
      saveLater: 'Später speichern',
      saveConfirm: 'Ich habe sie notiert',
      myTitle: 'Konto & Merksatz-Phrase',
      myMnemonic: 'Merksatz-Phrase',
      myConfirmed: 'Gesichert',
      myUnconfirmed: 'Nicht bestätigt',
      myAuto: 'Automatische Anmeldung auf diesem Gerät',
      myAutoHint: 'Die automatische Anmeldung ist an dieses Gerät gebunden. Ein System-Upgrade oder Hardwarewechsel kann sie ungültig machen; die Phrase ist der einzige Weg zurück.',
      myAutoNeedsMnemonic: 'Bestätige zuerst die Phrase, dann lässt sich die automatische Anmeldung einschalten.',
      myAutoUnavailable: 'Diese Version unterstützt den Schalter für automatische Anmeldung nicht; nutze die PIN.',
      logout: 'Abmelden',
      logoutConfirm: 'Nach dem Abmelden geht es zurück zur Anmeldeseite; PIN oder Phrase werden wieder benötigt. Abmelden?',
      myPinChange: 'PIN ändern',
      myPinDisabled: 'Bei aktiver automatischer Anmeldung kann die PIN nicht geändert werden.',
      myChangeOk: 'PIN geändert. Melde dich mit der neuen PIN an.',
      myChangeFail: 'PIN-Änderung fehlgeschlagen.',
    },
    it: {
      loading: 'Caricamento account…',
      start: 'Avvia',
      fatal: 'Il modulo account non è disponibile; avvio interrotto per sicurezza. Verifica che preload/main carichino auth-gate.',
      seconds: 's',
      error: 'Operazione non riuscita',
      close: 'Chiudi',
      quitBack: 'Torna all\'app',
      quitApp: 'Esci dal programma',
      termsTitle: 'Privacy e condizioni',
      termsFallback: 'Leggi e accetta le condizioni qui sotto per continuare.',
      termsAgree: 'Ho letto e accetto tutto quanto sopra',
      termsContinue: 'Accetta e continua',
      termsDecline: 'Rifiuta ed esci',
      termsRequired: 'Scorri prima fino in fondo e attendi 3 secondi.',
      termsGateHint: 'Scorri fino in fondo e attendi 3 secondi per poter accettare.',
      loginTitle: 'Accesso',
      loginBody: 'L\'accesso è richiesto a ogni avvio. La credenziale è ora gestita dalla frase mnemonica e non viene più salvata.',
      pinLogin: 'Accedi con PIN',
      pinPlaceholder: 'PIN (4–20 lettere/cifre)',
      login: 'Accedi',
      autoLogin: 'Accesso automatico su questo dispositivo',
      autoLoginHint: 'Legato a questo account di sistema e all\'hardware. Un aggiornamento del sistema può invalidarlo; la frase mnemonica è l\'unico modo per recuperare.',
      autoLoginInvalid: 'L\'accesso automatico non è più valido (account di sistema/CPU/hardware cambiati). Usa il PIN o la frase mnemonica.',
      recover: 'Accedi con la frase mnemonica',
      register: 'Crea un nuovo account',
      noAccount: 'Su questo dispositivo non c\'è ancora un account. Creane uno nuovo o recuperane uno con la sua frase mnemonica.',
      registerTitle: 'Crea account con frase mnemonica',
      registerBody: 'Verrà generata una frase di 24 parole. È l\'unico modo per recuperare: prepara carta e penna.',
      registerBegin: 'Genera la frase di 24 parole',
      existingMnemonic: 'Ho già una frase',
      existingAccountWarn: 'Esiste già un account su questo dispositivo. Continuando sostituirai l\'account attuale e l\'identità locale (il vecchio archivio viene prima salvato). Continuare?',
      back: 'Indietro',
      recoverTitle: 'Inserisci la frase mnemonica',
      recoverBody: 'Inserisci la frase inglese di 24 parole, oppure il pinyin mnemonico (pinyin completo, senza cifre né simboli).',
      recoverHint: 'La frase viene verificata solo in locale e non viene mai caricata.',
      verify: 'Verifica frase',
      badPin: 'PIN errato',
      locked: 'Bloccato. Riprova più tardi.',
      lockHint: 'Dopo altri {n} tentativi falliti verrai bloccato per un po\'',
      pinRule: 'Il PIN deve avere 4–20 lettere/cifre e le due voci devono coincidere.',
      pinMismatch: 'I due PIN non coincidono.',
      badMnemonic: 'Frase non valida (parole, ordine o checksum).',
      accountExists: 'Account già esistente',
      vaultCorrupt: 'L\'archivio di autenticazione è danneggiato o illeggibile. Il file originale è stato conservato.',
      osUnavailable: 'La memoria sicura del sistema non è disponibile. Usa un PIN; la frase mnemonica è l\'unico modo per recuperare.',
      authManaged: 'Questa azione è gestita dall\'account con frase mnemonica.',
      mnemonicTitle: 'Frase mnemonica (24 parole)',
      mnemonicHidden: 'Frase nascosta · clicca per mostrarla',
      mnemonicBody: 'Copiala subito a mano — due copie, in luoghi diversi. Non fare screenshot, non copiarla, non salvarla su computer o cloud. La frase è la tua unica credenziale; non esiste alcun recupero!',
      mnemonicReminderBody: 'L\'altra volta hai scelto «Ricordamelo più tardi». Copiala ora: due copie a mano, in luoghi diversi. Non fare screenshot, non copiarla, non salvarla su computer o cloud. La frase è la tua unica credenziale; non esiste alcun recupero!',
      pinyinFriendly: 'Frase in pinyin',
      pinyinGroupTwo: 'Parole',
      pinyinGroupFour: 'Idiomi',
      later: 'Ricordamelo più tardi',
      saved: 'L\'ho annotata',
      laterConfirmTitle: 'Ricorda più tardi',
      laterConfirmBody: 'Non hai confermato di aver copiato la frase. Al prossimo avvio comparirà prima la pagina di conferma; l\'accesso automatico non sarà disponibile e dovrai impostare un PIN. Continuare?',
      laterConfirmOk: 'Ricordamelo più tardi',
      confirmBody: 'La frase è la tua unica credenziale; non esiste alcun recupero! La frase appena mostrata verrà distrutta e non sarà più visibile. Hai scritto due copie e le hai riposte in luoghi diversi?',
      confirmOk: 'L\'ho annotata',
      cancel: 'Annulla',
      pinTitle: 'Imposta un PIN',
      pinBody: 'Il PIN serve per accedere su questo dispositivo (4–20 lettere/cifre, senza caratteri speciali).',
      pin1: 'Inserisci il PIN',
      pin2: 'Ripeti il PIN',
      autoEnable: 'Accesso automatico (collega questo dispositivo)',
      autoDisabledHint: 'L\'accesso automatico si può attivare solo dopo aver confermato la frase.',
      autoOnHint: 'Cambiare l\'hardware o aggiornare il sistema può invalidare il PIN; la frase mnemonica è l\'unico modo per recuperare!',
      autoOffHint: 'Cambiare l\'hardware o aggiornare il sistema può invalidare il PIN; la frase mnemonica è l\'unico modo per recuperare!',
      confirmCreate: 'Completa la registrazione',
      confirmRecover: 'Completa il recupero',
      autoLoginFail: 'Impossibile aggiornare l\'accesso automatico. Riprova più tardi.',
      usernameTitle: 'Scegli il tuo nome',
      usernameBody: 'Questo nome è salvato solo su questo dispositivo ed è come l\'app ti chiama.',
      usernameLabel: 'Nome',
      usernameRule: 'Da 1 a 30 caratteri (lettere, cifre, spazi ed emoji); non può essere vuoto.',
      usernameFinish: 'Fine',
      usernameSaveFail: 'Impossibile salvare il nome. Riprova.',
      viewTitle: 'Mostra la frase',
      viewBody: 'Assicurati che nessuno guardi. Una frase divulgata prende il controllo dell\'account; dopo la chiusura non resta sullo schermo.',
      saveMnemonic: 'Salva la frase',
      saveLater: 'Salva più tardi',
      saveConfirm: 'L\'ho scritta e confermo',
      myTitle: 'Account e frase mnemonica',
      myMnemonic: 'Frase mnemonica',
      myConfirmed: 'Salvata',
      myUnconfirmed: 'Non confermata',
      myAuto: 'Accesso automatico su questo dispositivo',
      myAutoHint: 'L\'accesso automatico è legato a questo dispositivo. Un aggiornamento del sistema o un cambio hardware può invalidarlo; la frase è l\'unico modo per recuperare.',
      myAutoNeedsMnemonic: 'Conferma prima la frase per attivare l\'accesso automatico.',
      myAutoUnavailable: 'Questa versione non supporta l\'interruttore di accesso automatico; usa il PIN.',
      logout: 'Esci',
      logoutConfirm: 'Uscendo tornerai alla schermata di accesso; serviranno PIN o frase. Uscire?',
      myPinChange: 'Cambia PIN',
      myPinDisabled: 'Non puoi cambiare il PIN mentre l\'accesso automatico è attivo.',
      myChangeOk: 'PIN cambiato. Accedi con il nuovo PIN.',
      myChangeFail: 'Modifica del PIN non riuscita.',
    },
    nl: {
      loading: 'Account laden…',
      start: 'Starten',
      fatal: 'De accountmodule is niet beschikbaar; om veiligheidsredenen wordt niet gestart. Controleer of preload/main auth-gate laden.',
      seconds: 's',
      error: 'Bewerking mislukt',
      close: 'Sluiten',
      quitBack: 'Terug naar de app',
      quitApp: 'Programma sluiten',
      termsTitle: 'Privacy en voorwaarden',
      termsFallback: 'Lees en accepteer de voorwaarden hieronder om door te gaan.',
      termsAgree: 'Ik heb alles hierboven gelezen en ga akkoord',
      termsContinue: 'Akkoord en doorgaan',
      termsDecline: 'Weigeren en afsluiten',
      termsRequired: 'Scroll eerst naar beneden en wacht 3 seconden.',
      termsGateHint: 'Scroll naar het einde en wacht 3 seconden voordat je kunt aanvinken.',
      loginTitle: 'Inloggen',
      loginBody: 'Bij elke start is inloggen nodig. De inloggegevens worden nu beheerd door de mnemonic en niet meer opgeslagen.',
      pinLogin: 'Inloggen met pincode',
      pinPlaceholder: 'Pincode (4–20 letters/cijfers)',
      login: 'Inloggen',
      autoLogin: 'Automatisch inloggen op dit apparaat',
      autoLoginHint: 'Gekoppeld aan dit systeemaccount en de hardware. Een systeemupdate kan het ongeldig maken; de mnemonic is de enige manier om te herstellen.',
      autoLoginInvalid: 'Automatisch inloggen is niet meer geldig (systeemaccount/CPU/hardware gewijzigd). Gebruik de pincode of de mnemonic.',
      recover: 'Inloggen met mnemonic',
      register: 'Nieuw account aanmaken',
      noAccount: 'Er staat nog geen account op dit apparaat. Maak een nieuw account aan of herstel er een met de mnemonic.',
      registerTitle: 'Mnemonic-account aanmaken',
      registerBody: 'Er wordt een mnemonic van 24 woorden gemaakt. Dat is de enige manier om te herstellen; houd pen en papier klaar.',
      registerBegin: '24-woorden mnemonic genereren',
      existingMnemonic: 'Ik heb al een mnemonic',
      existingAccountWarn: 'Er bestaat al een account op dit apparaat. Doorgaan vervangt het huidige account en de lokale identiteit (de oude kluis wordt eerst geback-upt). Doorgaan?',
      back: 'Terug',
      recoverTitle: 'Voer je mnemonic in',
      recoverBody: 'Voer de Engelse mnemonic van 24 woorden in, of de pinyin-variant (volledige pinyin, zonder cijfers of symbolen).',
      recoverHint: 'De mnemonic wordt alleen lokaal gecontroleerd en nooit geüpload.',
      verify: 'Mnemonic controleren',
      badPin: 'Onjuiste pincode',
      locked: 'Vergrendeld. Probeer het later opnieuw.',
      lockHint: 'Na nog {n} mislukte pogingen word je een tijdje vergrendeld',
      pinRule: 'De pincode moet 4–20 letters/cijfers zijn en beide invoervelden moeten overeenkomen.',
      pinMismatch: 'De twee pincodes komen niet overeen.',
      badMnemonic: 'Ongeldige mnemonic (woorden, volgorde of controlesom).',
      accountExists: 'Account bestaat al',
      vaultCorrupt: 'De auth-kluis is beschadigd of onleesbaar. Het originele bestand is bewaard.',
      osUnavailable: 'Veilige systeemopslag is niet beschikbaar. Gebruik een pincode; de mnemonic is de enige manier om te herstellen.',
      authManaged: 'Deze actie wordt beheerd door het mnemonic-account.',
      mnemonicTitle: 'Mnemonic (24 woorden)',
      mnemonicHidden: 'Mnemonic verborgen · klik om te tonen',
      mnemonicBody: 'Schrijf het nu meteen op — twee kopieën, op verschillende plekken. Geen screenshot, niet kopiëren, niet op een computer of in de cloud bewaren. De mnemonic is je enige inloggegevens; er is geen herstel mogelijk!',
      mnemonicReminderBody: 'Je koos vorige keer voor ‘Later herinneren’. Schrijf het nu alsnog over: twee kopieën op papier, op verschillende plekken. Geen screenshot, niet kopiëren, niet op een computer of in de cloud bewaren. De mnemonic is je enige inloggegevens; er is geen herstel mogelijk!',
      pinyinFriendly: 'Mnemonic in pinyin',
      pinyinGroupTwo: 'Woorden',
      pinyinGroupFour: 'Idiomen',
      later: 'Later herinneren',
      saved: 'Opgeschreven',
      laterConfirmTitle: 'Later herinneren',
      laterConfirmBody: 'Je hebt niet bevestigd dat je de mnemonic hebt opgeschreven. Bij de volgende start verschijnt eerst de bevestigingspagina; automatisch inloggen is dan niet beschikbaar en je moet eerst een pincode instellen. Doorgaan?',
      laterConfirmOk: 'Later herinneren',
      confirmBody: 'De mnemonic is je enige inloggegevens; er is geen herstel mogelijk! De zojuist getoonde mnemonic wordt vernietigd en is daarna niet meer te zien. Weet je zeker dat je twee kopieën hebt opgeschreven en apart hebt bewaard?',
      confirmOk: 'Opgeschreven',
      cancel: 'Annuleren',
      pinTitle: 'Pincode instellen',
      pinBody: 'De pincode is voor inloggen op dit apparaat (4–20 letters/cijfers, geen speciale tekens).',
      pin1: 'Voer pincode in',
      pin2: 'Herhaal pincode',
      autoEnable: 'Automatisch inloggen (dit apparaat koppelen)',
      autoDisabledHint: 'Automatisch inloggen kan pas aan nadat de mnemonic is bevestigd.',
      autoOnHint: 'Hardware wijzigen of het systeem upgraden kan je pincode ongeldig maken; de mnemonic is de enige manier om te herstellen!',
      autoOffHint: 'Hardware wijzigen of het systeem upgraden kan je pincode ongeldig maken; de mnemonic is de enige manier om te herstellen!',
      confirmCreate: 'Registratie afronden',
      confirmRecover: 'Herstel afronden',
      autoLoginFail: 'Automatisch inloggen kon niet worden bijgewerkt. Probeer het later opnieuw.',
      usernameTitle: 'Kies je naam',
      usernameBody: 'Deze naam wordt alleen op dit apparaat opgeslagen en is hoe de app je aanspreekt.',
      usernameLabel: 'Naam',
      usernameRule: '1–30 tekens (letters, cijfers, spaties en emoji); mag niet leeg zijn.',
      usernameFinish: 'Klaar',
      usernameSaveFail: 'Naam opslaan mislukt. Probeer het opnieuw.',
      viewTitle: 'Mnemonic tonen',
      viewBody: 'Zorg dat niemand meekijkt. Een uitgelekte mnemonic neemt het account over; na sluiten blijft hij niet op het scherm staan.',
      saveMnemonic: 'Mnemonic opslaan',
      saveLater: 'Later opslaan',
      saveConfirm: 'Ik heb het opgeschreven',
      myTitle: 'Account en mnemonic',
      myMnemonic: 'Mnemonic',
      myConfirmed: 'Opgeslagen',
      myUnconfirmed: 'Niet bevestigd',
      myAuto: 'Automatisch inloggen op dit apparaat',
      myAutoHint: 'Automatisch inloggen is aan dit apparaat gekoppeld. Een systeemupdate of hardwarewijziging kan het ongeldig maken; de mnemonic is de enige manier om te herstellen.',
      myAutoNeedsMnemonic: 'Bevestig eerst de mnemonic voordat je automatisch inloggen aanzet.',
      myAutoUnavailable: 'Deze versie ondersteunt de schakelaar voor automatisch inloggen niet; gebruik de pincode.',
      logout: 'Uitloggen',
      logoutConfirm: 'Uitloggen brengt je terug naar het inlogscherm; pincode of mnemonic is weer nodig. Uitloggen?',
      myPinChange: 'Pincode wijzigen',
      myPinDisabled: 'De pincode kan niet worden gewijzigd zolang automatisch inloggen aan staat.',
      myChangeOk: 'Pincode gewijzigd. Log in met de nieuwe pincode.',
      myChangeFail: 'Pincode wijzigen mislukt.',
    },
    pl: {
      loading: 'Ładowanie konta…',
      start: 'Start',
      fatal: 'Moduł konta jest niedostępny; ze względów bezpieczeństwa uruchomienie zostało wstrzymane. Sprawdź, czy preload/main ładują auth-gate.',
      seconds: 's',
      error: 'Operacja nieudana',
      close: 'Zamknij',
      quitBack: 'Wróć do aplikacji',
      quitApp: 'Zamknij program',
      termsTitle: 'Prywatność i warunki',
      termsFallback: 'Przeczytaj i zaakceptuj poniższe warunki, aby kontynuować.',
      termsAgree: 'Przeczytałem i akceptuję wszystkie powyższe warunki',
      termsContinue: 'Akceptuję i kontynuuję',
      termsDecline: 'Odrzuć i zamknij',
      termsRequired: 'Najpierw przewiń do dołu i odczekaj 3 sekundy.',
      termsGateHint: 'Przewiń do końca i odczekaj 3 sekundy, aby móc zaznaczyć zgodę.',
      loginTitle: 'Logowanie',
      loginBody: 'Przy każdym uruchomieniu wymagane jest logowanie. Dane dostępowe są teraz zarządzane przez frazę mnemoniczną i nie są już zapisywane.',
      pinLogin: 'Zaloguj się PIN-em',
      pinPlaceholder: 'PIN (4–20 liter/cyfr)',
      login: 'Zaloguj się',
      autoLogin: 'Automatyczne logowanie na tym urządzeniu',
      autoLoginHint: 'Powiązane z tym kontem systemowym i sprzętem. Aktualizacja systemu może je unieważnić; fraza mnemoniczna to jedyny sposób odzyskania.',
      autoLoginInvalid: 'Automatyczne logowanie nie jest już ważne (zmiana konta systemowego/CPU/sprzętu). Użyj PIN-u lub frazy mnemonicznej.',
      recover: 'Zaloguj się frazą mnemoniczną',
      register: 'Utwórz nowe konto',
      noAccount: 'To urządzenie nie ma jeszcze konta. Utwórz nowe lub odzyskaj istniejące frazą mnemoniczną.',
      registerTitle: 'Utwórz konto z frazą mnemoniczną',
      registerBody: 'Zostanie wygenerowana fraza 24 słów. To jedyny sposób odzyskania konta; przygotuj kartkę i długopis.',
      registerBegin: 'Wygeneruj frazę 24 słów',
      existingMnemonic: 'Mam już frazę mnemoniczną',
      existingAccountWarn: 'Na tym urządzeniu istnieje już konto. Kontynuacja zastąpi obecne konto i tożsamość lokalną (stary sejf zostanie najpierw zarchiwizowany). Kontynuować?',
      back: 'Wstecz',
      recoverTitle: 'Wpisz frazę mnemoniczną',
      recoverBody: 'Wpisz angielską frazę 24 słów lub pinyin mnemoniczny (pełny pinyin, bez cyfr i symboli).',
      recoverHint: 'Fraza jest sprawdzana wyłącznie lokalnie i nigdy nie jest wysyłana.',
      verify: 'Sprawdź frazę',
      badPin: 'Nieprawidłowy PIN',
      locked: 'Zablokowane. Spróbuj ponownie później.',
      lockHint: 'Po jeszcze {n} nieudanych próbach nastąpi chwilowa blokada',
      pinRule: 'PIN musi mieć 4–20 liter/cyfr, a oba wpisy muszą być identyczne.',
      pinMismatch: 'Oba PIN-y nie są identyczne.',
      badMnemonic: 'Nieprawidłowa fraza (słowa, kolejność lub suma kontrolna).',
      accountExists: 'Konto już istnieje',
      vaultCorrupt: 'Sejf uwierzytelniania jest uszkodzony lub nieczytelny. Oryginalny plik został zachowany.',
      osUnavailable: 'Bezpieczny magazyn systemowy jest niedostępny. Użyj PIN-u; fraza mnemoniczna to jedyny sposób odzyskania.',
      authManaged: 'Ta czynność jest zarządzana przez konto z frazą mnemoniczną.',
      mnemonicTitle: 'Fraza mnemoniczna (24 słowa)',
      mnemonicHidden: 'Fraza ukryta · kliknij, aby pokazać',
      mnemonicBody: 'Zapisz ją teraz odręcznie — dwa egzemplarze, w różnych miejscach. Nie rób zrzutów ekranu, nie kopiuj, nie zapisuj na komputerze ani w chmurze. Fraza to twoje jedyne poświadczenie; nie ma żadnego sposobu jej odzyskania!',
      mnemonicReminderBody: 'Poprzednio wybrałeś „Przypomnij później”. Zapisz ją teraz: dwa egzemplarze na papierze, w różnych miejscach. Nie rób zrzutów ekranu, nie kopiuj, nie zapisuj na komputerze ani w chmurze. Fraza to twoje jedyne poświadczenie; nie ma żadnego sposobu jej odzyskania!',
      pinyinFriendly: 'Fraza w pinyin',
      pinyinGroupTwo: 'Słowa',
      pinyinGroupFour: 'Idiomy',
      later: 'Przypomnij później',
      saved: 'Zapisałem',
      laterConfirmTitle: 'Przypomnij później',
      laterConfirmBody: 'Nie potwierdziłeś zapisania frazy. Przy następnym uruchomieniu najpierw pojawi się strona potwierdzenia; automatyczne logowanie będzie niedostępne i trzeba będzie ustawić PIN. Kontynuować?',
      laterConfirmOk: 'Przypomnij później',
      confirmBody: 'Fraza to twoje jedyne poświadczenie; nie ma żadnego sposobu jej odzyskania! Właśnie pokazana fraza zostanie zniszczona i nie będzie można jej ponownie zobaczyć. Czy na pewno zapisałeś dwa egzemplarze i schowałeś je osobno?',
      confirmOk: 'Zapisałem',
      cancel: 'Anuluj',
      pinTitle: 'Ustaw PIN',
      pinBody: 'PIN służy do logowania na tym urządzeniu (4–20 liter/cyfr, bez znaków specjalnych).',
      pin1: 'Wpisz PIN',
      pin2: 'Powtórz PIN',
      autoEnable: 'Automatyczne logowanie (powiąż to urządzenie)',
      autoDisabledHint: 'Automatyczne logowanie można włączyć dopiero po potwierdzeniu frazy.',
      autoOnHint: 'Zmiana sprzętu lub aktualizacja systemu może unieważnić PIN; fraza mnemoniczna to jedyny sposób odzyskania!',
      autoOffHint: 'Zmiana sprzętu lub aktualizacja systemu może unieważnić PIN; fraza mnemoniczna to jedyny sposób odzyskania!',
      confirmCreate: 'Zakończ rejestrację',
      confirmRecover: 'Zakończ odzyskiwanie',
      autoLoginFail: 'Nie udało się ustawić automatycznego logowania. Spróbuj później.',
      usernameTitle: 'Wybierz swoją nazwę',
      usernameBody: 'Ta nazwa jest zapisywana tylko na tym urządzeniu i służy do zwracania się do ciebie w aplikacji.',
      usernameLabel: 'Nazwa',
      usernameRule: '1–30 znaków (litery, cyfry, spacje i emoji); nie może być puste.',
      usernameFinish: 'Gotowe',
      usernameSaveFail: 'Nie udało się zapisać nazwy. Spróbuj ponownie.',
      viewTitle: 'Pokaż frazę',
      viewBody: 'Upewnij się, że nikt nie patrzy. Wyciek frazy oznacza przejęcie konta; po zamknięciu nie pozostanie na ekranie.',
      saveMnemonic: 'Zapisz frazę',
      saveLater: 'Zapisz później',
      saveConfirm: 'Zapisałem i potwierdzam',
      myTitle: 'Konto i fraza mnemoniczna',
      myMnemonic: 'Fraza mnemoniczna',
      myConfirmed: 'Zapisana',
      myUnconfirmed: 'Niepotwierdzona',
      myAuto: 'Automatyczne logowanie na tym urządzeniu',
      myAutoHint: 'Automatyczne logowanie jest powiązane z tym urządzeniem. Aktualizacja systemu lub zmiana sprzętu może je unieważnić; fraza to jedyny sposób odzyskania.',
      myAutoNeedsMnemonic: 'Najpierw potwierdź frazę, aby włączyć automatyczne logowanie.',
      myAutoUnavailable: 'Ta wersja nie obsługuje przełącznika automatycznego logowania; użyj PIN-u.',
      logout: 'Wyloguj się',
      logoutConfirm: 'Wylogowanie wraca do ekranu logowania; potrzebny będzie PIN lub fraza. Wylogować?',
      myPinChange: 'Zmień PIN',
      myPinDisabled: 'Nie można zmienić PIN-u, gdy automatyczne logowanie jest włączone.',
      myChangeOk: 'PIN zmieniony. Zaloguj się nowym PIN-em.',
      myChangeFail: 'Zmiana PIN-u nieudana.',
    },
    sv: {
      loading: 'Laddar konto…',
      start: 'Starta',
      fatal: 'Kontomodulen är inte tillgänglig; starten stoppas av säkerhetsskäl. Kontrollera att preload/main läser in auth-gate.',
      seconds: 's',
      error: 'Åtgärden misslyckades',
      close: 'Stäng',
      quitBack: 'Tillbaka till appen',
      quitApp: 'Avsluta programmet',
      termsTitle: 'Integritet och villkor',
      termsFallback: 'Läs och godkänn villkoren nedan för att fortsätta.',
      termsAgree: 'Jag har läst och godkänner allt ovan',
      termsContinue: 'Godkänn och fortsätt',
      termsDecline: 'Avböj och avsluta',
      termsRequired: 'Scrolla först till botten och vänta 3 sekunder.',
      termsGateHint: 'Scrolla till slutet och vänta 3 sekunder innan du kan kryssa i.',
      loginTitle: 'Logga in',
      loginBody: 'Inloggning krävs vid varje start. Uppgifterna hanteras nu av minnesfrasen och sparas inte längre.',
      pinLogin: 'Logga in med PIN',
      pinPlaceholder: 'PIN (4–20 bokstäver/siffror)',
      login: 'Logga in',
      autoLogin: 'Automatisk inloggning på den här enheten',
      autoLoginHint: 'Bunden till det här systemkontot och hårdvaran. En systemuppdatering kan göra den ogiltig; minnesfrasen är enda sättet att återställa.',
      autoLoginInvalid: 'Automatisk inloggning är inte längre giltig (systemkonto/CPU/hårdvara har ändrats). Använd PIN eller minnesfrasen.',
      recover: 'Logga in med minnesfras',
      register: 'Skapa nytt konto',
      noAccount: 'Det finns inget konto på den här enheten än. Skapa ett nytt eller återställ ett med dess minnesfras.',
      registerTitle: 'Skapa minnesfras-konto',
      registerBody: 'En fras med 24 ord genereras. Den är enda sättet att återställa; ha papper och penna redo.',
      registerBegin: 'Generera fras med 24 ord',
      existingMnemonic: 'Jag har redan en fras',
      existingAccountWarn: 'Ett konto finns redan på den här enheten. Om du fortsätter ersätts nuvarande konto och lokal identitet (det gamla valvet säkerhetskopieras först). Fortsätta?',
      back: 'Tillbaka',
      recoverTitle: 'Ange din minnesfras',
      recoverBody: 'Ange den engelska frasen med 24 ord, eller pinyin-varianten (fullt pinyin, inga siffror eller tecken).',
      recoverHint: 'Frasen verifieras bara lokalt och laddas aldrig upp.',
      verify: 'Verifiera fras',
      badPin: 'Fel PIN',
      locked: 'Låst. Försök igen senare.',
      lockHint: 'Efter ytterligare {n} misslyckade försök låses du en stund',
      pinRule: 'PIN måste vara 4–20 bokstäver/siffror och båda inmatningarna måste stämma.',
      pinMismatch: 'De två PIN-koderna stämmer inte överens.',
      badMnemonic: 'Ogiltig fras (ord, ordning eller kontrollsumma).',
      accountExists: 'Kontot finns redan',
      vaultCorrupt: 'Auth-valvet är skadat eller oläsbart. Originalfilen har bevarats.',
      osUnavailable: 'Säker systemlagring är inte tillgänglig. Använd en PIN; minnesfrasen är enda sättet att återställa.',
      authManaged: 'Den här åtgärden hanteras av minnesfras-kontot.',
      mnemonicTitle: 'Minnesfras (24 ord)',
      mnemonicHidden: 'Frasen är dold · klicka för att visa',
      mnemonicBody: 'Skriv ner den nu med penna — två kopior på olika ställen. Ta ingen skärmbild, kopiera den inte och spara den inte på dator eller i molnet. Frasen är din enda behörighet; det finns inget sätt att återställa den!',
      mnemonicReminderBody: 'Du valde ”Påminn mig senare” förra gången. Skriv ner den nu: två kopior på papper, på olika ställen. Ta ingen skärmbild, kopiera den inte och spara den inte på dator eller i molnet. Frasen är din enda behörighet; det finns inget sätt att återställa den!',
      pinyinFriendly: 'Fras i pinyin',
      pinyinGroupTwo: 'Ord',
      pinyinGroupFour: 'Idiom',
      later: 'Påminn mig senare',
      saved: 'Jag har skrivit ner den',
      laterConfirmTitle: 'Påminn senare',
      laterConfirmBody: 'Du har inte bekräftat att du skrivit ner frasen. Vid nästa start visas bekräftelsesidan först; automatisk inloggning blir otillgänglig och du måste ange en PIN. Fortsätta?',
      laterConfirmOk: 'Påminn mig senare',
      confirmBody: 'Frasen är din enda behörighet; det finns inget sätt att återställa den! Frasen som just visades förstörs och kan inte visas igen. Är du säker på att du skrivit ner två kopior och lagt dem på olika ställen?',
      confirmOk: 'Jag har skrivit ner den',
      cancel: 'Avbryt',
      pinTitle: 'Ange en PIN',
      pinBody: 'PIN-koden används för inloggning på den här enheten (4–20 bokstäver/siffror, inga specialtecken).',
      pin1: 'Ange PIN',
      pin2: 'Upprepa PIN',
      autoEnable: 'Automatisk inloggning (bind den här enheten)',
      autoDisabledHint: 'Automatisk inloggning kan bara slås på efter att frasen bekräftats.',
      autoOnHint: 'Byte av hårdvara eller systemuppgradering kan göra PIN-koden ogiltig; minnesfrasen är enda sättet att återställa!',
      autoOffHint: 'Byte av hårdvara eller systemuppgradering kan göra PIN-koden ogiltig; minnesfrasen är enda sättet att återställa!',
      confirmCreate: 'Slutför registreringen',
      confirmRecover: 'Slutför återställningen',
      autoLoginFail: 'Det gick inte att uppdatera automatisk inloggning. Försök igen senare.',
      usernameTitle: 'Välj ditt namn',
      usernameBody: 'Namnet sparas bara på den här enheten och är hur appen tilltalar dig.',
      usernameLabel: 'Namn',
      usernameRule: '1–30 tecken (bokstäver, siffror, mellanslag och emoji); får inte vara tomt.',
      usernameFinish: 'Klart',
      usernameSaveFail: 'Det gick inte att spara namnet. Försök igen.',
      viewTitle: 'Visa frasen',
      viewBody: 'Se till att ingen tittar. En läckt fras tar över kontot; efter stängning ligger den inte kvar på skärmen.',
      saveMnemonic: 'Spara frasen',
      saveLater: 'Spara senare',
      saveConfirm: 'Jag har skrivit ner den',
      myTitle: 'Konto och minnesfras',
      myMnemonic: 'Minnesfras',
      myConfirmed: 'Sparad',
      myUnconfirmed: 'Inte bekräftad',
      myAuto: 'Automatisk inloggning på den här enheten',
      myAutoHint: 'Automatisk inloggning är bunden till den här enheten. En systemuppdatering eller hårdvaruändring kan göra den ogiltig; frasen är enda sättet att återställa.',
      myAutoNeedsMnemonic: 'Bekräfta frasen först innan du slår på automatisk inloggning.',
      myAutoUnavailable: 'Den här versionen stöder inte reglaget för automatisk inloggning; använd PIN.',
      logout: 'Logga ut',
      logoutConfirm: 'Utloggning tar dig tillbaka till inloggningsskärmen; PIN eller fras krävs igen. Logga ut?',
      myPinChange: 'Byt PIN',
      myPinDisabled: 'PIN-koden kan inte ändras medan automatisk inloggning är på.',
      myChangeOk: 'PIN-koden har ändrats. Logga in med den nya PIN-koden.',
      myChangeFail: 'Byte av PIN misslyckades.',
    },
    cs: {
      loading: 'Načítání účtu…',
      start: 'Spustit',
      fatal: 'Modul účtu není dostupný; z bezpečnostních důvodů se nespustí. Zkontrolujte, zda preload/main načítají auth-gate.',
      seconds: 's',
      error: 'Operace se nezdařila',
      close: 'Zavřít',
      quitBack: 'Zpět do aplikace',
      quitApp: 'Ukončit program',
      termsTitle: 'Soukromí a podmínky',
      termsFallback: 'Přečtěte si a přijměte níže uvedené podmínky, abyste mohli pokračovat.',
      termsAgree: 'Přečetl jsem si a souhlasím se vším výše uvedeným',
      termsContinue: 'Souhlasím a pokračovat',
      termsDecline: 'Odmítnout a ukončit',
      termsRequired: 'Nejprve se posuňte na konec a počkejte 3 sekundy.',
      termsGateHint: 'Posuňte se na konec a počkejte 3 sekundy, teprve pak můžete zaškrtnout souhlas.',
      loginTitle: 'Přihlášení',
      loginBody: 'Při každém spuštění je nutné přihlášení. Údaje nyní spravuje mnemotechnická fráze a už se neukládají.',
      pinLogin: 'Přihlásit se PINem',
      pinPlaceholder: 'PIN (4–20 písmen/číslic)',
      login: 'Přihlásit se',
      autoLogin: 'Automatické přihlášení na tomto zařízení',
      autoLoginHint: 'Vázáno na tento systémový účet a hardware. Aktualizace systému jej může zneplatnit; fráze je jediný způsob obnovy.',
      autoLoginInvalid: 'Automatické přihlášení už není platné (změna systémového účtu/CPU/hardwaru). Použijte PIN nebo frázi.',
      recover: 'Přihlásit se frází',
      register: 'Vytvořit nový účet',
      noAccount: 'Na tomto zařízení zatím není účet. Vytvořte nový nebo obnovte existující pomocí jeho fráze.',
      registerTitle: 'Vytvořit účet s frází',
      registerBody: 'Vygeneruje se fráze o 24 slovech. Je to jediný způsob obnovy; připravte si papír a tužku.',
      registerBegin: 'Vygenerovat frázi o 24 slovech',
      existingMnemonic: 'Frázi už mám',
      existingAccountWarn: 'Na tomto zařízení už účet existuje. Pokračováním nahradíte současný účet i místní identitu (starý trezor se nejprve zálohuje). Pokračovat?',
      back: 'Zpět',
      recoverTitle: 'Zadejte svou frázi',
      recoverBody: 'Zadejte anglickou frázi o 24 slovech, nebo mnemotechnický pchin-jin (plný pchin-jin, bez číslic a symbolů).',
      recoverHint: 'Fráze se ověřuje pouze lokálně a nikdy se neodesílá.',
      verify: 'Ověřit frázi',
      badPin: 'Nesprávný PIN',
      locked: 'Uzamčeno. Zkuste to prosím později.',
      lockHint: 'Po dalších {n} neúspěšných pokusech budete na chvíli uzamčeni',
      pinRule: 'PIN musí mít 4–20 písmen/číslic a oba záznamy musí být shodné.',
      pinMismatch: 'Zadané PINy se neshodují.',
      badMnemonic: 'Neplatná fráze (slova, pořadí nebo kontrolní součet).',
      accountExists: 'Účet už existuje',
      vaultCorrupt: 'Trezor přihlášení je poškozený nebo nečitelný. Původní soubor byl zachován.',
      osUnavailable: 'Zabezpečené úložiště systému není dostupné. Použijte PIN; fráze je jediný způsob obnovy.',
      authManaged: 'Tuto akci spravuje účet s frází.',
      mnemonicTitle: 'Mnemotechnická fráze (24 slov)',
      mnemonicHidden: 'Fráze skryta · kliknutím zobrazíte',
      mnemonicBody: 'Napište ji hned ručně — dvě kopie na různá místa. Nedělejte snímek obrazovky, nekopírujte ji a neukládejte do počítače ani do cloudu. Fráze je váš jediný údaj; neexistuje žádná možnost obnovy!',
      mnemonicReminderBody: 'Minule jste zvolili „Připomenout později“. Napište si ji nyní: dvě kopie na papíře, na různá místa. Nedělejte snímek obrazovky, nekopírujte ji a neukládejte do počítače ani do cloudu. Fráze je váš jediný údaj; neexistuje žádná možnost obnovy!',
      pinyinFriendly: 'Fráze v pchin-jinu',
      pinyinGroupTwo: 'Slova',
      pinyinGroupFour: 'Idiomy',
      later: 'Připomenout později',
      saved: 'Zapsal jsem si ji',
      laterConfirmTitle: 'Připomenout později',
      laterConfirmBody: 'Nepotvrdili jste, že jste si frázi zapsali. Při příštím spuštění se nejprve zobrazí potvrzovací stránka; automatické přihlášení nebude dostupné a budete muset nastavit PIN. Pokračovat?',
      laterConfirmOk: 'Připomenout později',
      confirmBody: 'Fráze je váš jediný údaj; neexistuje žádná možnost obnovy! Právě zobrazená fráze bude zničena a už ji nebude možné zobrazit. Jste si jistí, že jste si zapsali dvě kopie a uložili je odděleně?',
      confirmOk: 'Zapsal jsem si ji',
      cancel: 'Zrušit',
      pinTitle: 'Nastavit PIN',
      pinBody: 'PIN slouží k přihlášení na tomto zařízení (4–20 písmen/číslic, bez speciálních znaků).',
      pin1: 'Zadejte PIN',
      pin2: 'Zopakujte PIN',
      autoEnable: 'Automatické přihlášení (svázat toto zařízení)',
      autoDisabledHint: 'Automatické přihlášení lze zapnout až po potvrzení fráze.',
      autoOnHint: 'Změna hardwaru nebo aktualizace systému může PIN zneplatnit; fráze je jediný způsob obnovy!',
      autoOffHint: 'Změna hardwaru nebo aktualizace systému může PIN zneplatnit; fráze je jediný způsob obnovy!',
      confirmCreate: 'Dokončit registraci',
      confirmRecover: 'Dokončit obnovu',
      autoLoginFail: 'Automatické přihlášení se nepodařilo nastavit. Zkuste to později.',
      usernameTitle: 'Zvolte si jméno',
      usernameBody: 'Toto jméno se ukládá pouze na tomto zařízení a aplikace vás tak oslovuje.',
      usernameLabel: 'Jméno',
      usernameRule: '1–30 znaků (písmena, číslice, mezery a emoji); nesmí být prázdné.',
      usernameFinish: 'Hotovo',
      usernameSaveFail: 'Jméno se nepodařilo uložit. Zkuste to znovu.',
      viewTitle: 'Zobrazit frázi',
      viewBody: 'Ujistěte se, že se nikdo nedívá. Uniklá fráze znamená převzetí účtu; po zavření nezůstane na obrazovce.',
      saveMnemonic: 'Uložit frázi',
      saveLater: 'Uložit později',
      saveConfirm: 'Zapsal jsem si ji a potvrzuji',
      myTitle: 'Účet a fráze',
      myMnemonic: 'Mnemotechnická fráze',
      myConfirmed: 'Uloženo',
      myUnconfirmed: 'Nepotvrzeno',
      myAuto: 'Automatické přihlášení na tomto zařízení',
      myAutoHint: 'Automatické přihlášení je vázáno na toto zařízení. Aktualizace systému nebo změna hardwaru jej může zneplatnit; fráze je jediný způsob obnovy.',
      myAutoNeedsMnemonic: 'Nejprve potvrďte frázi, teprve pak lze zapnout automatické přihlášení.',
      myAutoUnavailable: 'Tato verze přepínač automatického přihlášení nepodporuje; použijte PIN.',
      logout: 'Odhlásit se',
      logoutConfirm: 'Odhlášením se vrátíte na přihlašovací obrazovku; bude potřeba PIN nebo fráze. Odhlásit?',
      myPinChange: 'Změnit PIN',
      myPinDisabled: 'PIN nelze změnit, dokud je zapnuté automatické přihlášení.',
      myChangeOk: 'PIN změněn. Přihlaste se novým PINem.',
      myChangeFail: 'Změna PINu se nezdařila.',
    },
    hu: {
      loading: 'Fiók betöltése…',
      start: 'Indítás',
      fatal: 'A fiókmodul nem érhető el; biztonsági okból nem indul el. Ellenőrizze, hogy a preload/main betölti-e az auth-gate-et.',
      seconds: 'mp',
      error: 'A művelet nem sikerült',
      close: 'Bezárás',
      quitBack: 'Vissza az alkalmazásba',
      quitApp: 'Program bezárása',
      termsTitle: 'Adatvédelem és feltételek',
      termsFallback: 'A folytatáshoz olvassa el és fogadja el az alábbi feltételeket.',
      termsAgree: 'Elolvastam és elfogadom a fentiek mindegyikét',
      termsContinue: 'Elfogadás és folytatás',
      termsDecline: 'Elutasítás és kilépés',
      termsRequired: 'Először görgessen az aljára, és várjon 3 másodpercet.',
      termsGateHint: 'Görgessen a végére, és várjon 3 másodpercet, csak utána jelölheti be.',
      loginTitle: 'Bejelentkezés',
      loginBody: 'Minden indításkor be kell jelentkezni. A hitelesítő adatot mostantól a mnemonikus mondat kezeli, és már nem tároljuk.',
      pinLogin: 'Bejelentkezés PIN-nel',
      pinPlaceholder: 'PIN (4–20 betű/számjegy)',
      login: 'Bejelentkezés',
      autoLogin: 'Automatikus bejelentkezés ezen az eszközön',
      autoLoginHint: 'Ehhez a rendszerfiókhoz és hardverhez kötött. Egy rendszerfrissítés érvénytelenítheti; a mnemonikus mondat az egyetlen helyreállítási mód.',
      autoLoginInvalid: 'Az automatikus bejelentkezés már nem érvényes (rendszerfiók/CPU/hardver változott). Használjon PIN-t vagy mnemonikus mondatot.',
      recover: 'Bejelentkezés mnemonikus mondattal',
      register: 'Új fiók létrehozása',
      noAccount: 'Ezen az eszközön még nincs fiók. Hozzon létre újat, vagy állítson helyre egyet a mnemonikus mondatával.',
      registerTitle: 'Mnemonikus fiók létrehozása',
      registerBody: 'Egy 24 szavas mondat generálódik. Ez az egyetlen helyreállítási mód; készítsen papírt és tollat.',
      registerBegin: '24 szavas mondat generálása',
      existingMnemonic: 'Már van mondatom',
      existingAccountWarn: 'Ezen az eszközön már létezik fiók. A folytatás lecseréli a jelenlegi fiókot és a helyi identitást (a régi tároló előbb biztonsági mentésre kerül). Folytatja?',
      back: 'Vissza',
      recoverTitle: 'Adja meg a mnemonikus mondatot',
      recoverBody: 'Adja meg a 24 szavas angol mondatot, vagy a mnemotechnikai pinjin változatot (teljes pinjin, számok és jelek nélkül).',
      recoverHint: 'A mondat ellenőrzése csak helyben történik, és soha nem töltődik fel.',
      verify: 'Mondat ellenőrzése',
      badPin: 'Hibás PIN',
      locked: 'Zárolva. Próbálja újra később.',
      lockHint: 'További {n} sikertelen próbálkozás után ideiglenesen zárolják',
      pinRule: 'A PIN 4–20 betű/számjegy lehet, és a két bevitelnek egyeznie kell.',
      pinMismatch: 'A két PIN nem egyezik.',
      badMnemonic: 'Érvénytelen mondat (szavak, sorrend vagy ellenőrző összeg).',
      accountExists: 'A fiók már létezik',
      vaultCorrupt: 'A hitelesítési tároló sérült vagy olvashatatlan. Az eredeti fájlt megőriztük.',
      osUnavailable: 'A biztonságos rendszertároló nem érhető el. Használjon PIN-t; a mnemonikus mondat az egyetlen helyreállítási mód.',
      authManaged: 'Ezt a műveletet a mnemonikus fiók kezeli.',
      mnemonicTitle: 'Mnemonikus mondat (24 szó)',
      mnemonicHidden: 'A mondat rejtve · kattintson a megjelenítéshez',
      mnemonicBody: 'Írja le azonnal kézzel — két példányban, különböző helyekre. Ne készítsen képernyőképet, ne másolja, ne tárolja számítógépen vagy felhőben. A mondat az egyetlen hitelesítő adata; nincs semmilyen helyreállítási lehetőség!',
      mnemonicReminderBody: 'Legutóbb a „Emlékeztetés később” lehetőséget választotta. Most írja le: két példány papíron, különböző helyeken. Ne készítsen képernyőképet, ne másolja, ne tárolja számítógépen vagy felhőben. A mondat az egyetlen hitelesítő adata; nincs semmilyen helyreállítási lehetőség!',
      pinyinFriendly: 'Mondat pinjinben',
      pinyinGroupTwo: 'Szavak',
      pinyinGroupFour: 'Idiómák',
      later: 'Emlékeztetés később',
      saved: 'Leírtam',
      laterConfirmTitle: 'Emlékeztetés később',
      laterConfirmBody: 'Nem erősítette meg, hogy leírta a mondatot. A következő indításkor először a megerősítő oldal jelenik meg; az automatikus bejelentkezés nem lesz elérhető, és PIN-t kell beállítania. Folytatja?',
      laterConfirmOk: 'Emlékeztetés később',
      confirmBody: 'A mondat az egyetlen hitelesítő adata; nincs semmilyen helyreállítási lehetőség! A most megjelenített mondat megsemmisül, és később nem tekinthető meg. Biztosan leírt két példányt, és külön helyezte el őket?',
      confirmOk: 'Leírtam',
      cancel: 'Mégse',
      pinTitle: 'PIN beállítása',
      pinBody: 'A PIN az ezen az eszközön való bejelentkezéshez kell (4–20 betű/számjegy, speciális karakterek nélkül).',
      pin1: 'PIN megadása',
      pin2: 'PIN megismétlése',
      autoEnable: 'Automatikus bejelentkezés (eszköz hozzákötése)',
      autoDisabledHint: 'Az automatikus bejelentkezés csak a mondat megerősítése után kapcsolható be.',
      autoOnHint: 'A hardver cseréje vagy a rendszer frissítése érvénytelenítheti a PIN-t; a mnemonikus mondat az egyetlen helyreállítási mód!',
      autoOffHint: 'A hardver cseréje vagy a rendszer frissítése érvénytelenítheti a PIN-t; a mnemonikus mondat az egyetlen helyreállítási mód!',
      confirmCreate: 'Regisztráció befejezése',
      confirmRecover: 'Helyreállítás befejezése',
      autoLoginFail: 'Az automatikus bejelentkezést nem sikerült beállítani. Próbálja újra később.',
      usernameTitle: 'Válasszon nevet',
      usernameBody: 'Ez a név csak ezen az eszközön tárolódik, és így szólítja meg az alkalmazás.',
      usernameLabel: 'Név',
      usernameRule: '1–30 karakter (betűk, számjegyek, szóközök és emoji); nem lehet üres.',
      usernameFinish: 'Kész',
      usernameSaveFail: 'A nevet nem sikerült menteni. Próbálja újra.',
      viewTitle: 'Mondat megjelenítése',
      viewBody: 'Győződjön meg róla, hogy senki nem látja. Egy kiszivárgott mondat átveszi a fiókot; bezárás után nem marad a képernyőn.',
      saveMnemonic: 'Mondat mentése',
      saveLater: 'Mentés később',
      saveConfirm: 'Leírtam és megerősítem',
      myTitle: 'Fiók és mnemonikus mondat',
      myMnemonic: 'Mnemonikus mondat',
      myConfirmed: 'Mentve',
      myUnconfirmed: 'Nincs megerősítve',
      myAuto: 'Automatikus bejelentkezés ezen az eszközön',
      myAutoHint: 'Az automatikus bejelentkezés ehhez az eszközhöz van kötve. Rendszerfrissítés vagy hardvercsere érvénytelenítheti; a mondat az egyetlen helyreállítási mód.',
      myAutoNeedsMnemonic: 'Először erősítse meg a mondatot, utána kapcsolhatja be az automatikus bejelentkezést.',
      myAutoUnavailable: 'Ez a verzió nem támogatja az automatikus bejelentkezés kapcsolóját; használjon PIN-t.',
      logout: 'Kijelentkezés',
      logoutConfirm: 'A kijelentkezés visszavisz a bejelentkező oldalra; PIN-re vagy mondatra lesz szükség. Kijelentkezik?',
      myPinChange: 'PIN módosítása',
      myPinDisabled: 'A PIN nem módosítható, amíg az automatikus bejelentkezés be van kapcsolva.',
      myChangeOk: 'PIN módosítva. Jelentkezzen be az új PIN-nel.',
      myChangeFail: 'A PIN módosítása nem sikerült.',
    },
    da: {
      loading: 'Indlæser konto…',
      start: 'Start',
      fatal: 'Kontomodulet er ikke tilgængeligt; opstarten stoppes af sikkerhedshensyn. Kontroller, at preload/main indlæser auth-gate.',
      seconds: 's',
      error: 'Handlingen mislykkedes',
      close: 'Luk',
      quitBack: 'Tilbage til appen',
      quitApp: 'Afslut program',
      termsTitle: 'Privatliv og vilkår',
      termsFallback: 'Læs og accepter vilkårene nedenfor for at fortsætte.',
      termsAgree: 'Jeg har læst og accepterer alt ovenstående',
      termsContinue: 'Accepter og fortsæt',
      termsDecline: 'Afvis og afslut',
      termsRequired: 'Rul først til bunden, og vent 3 sekunder.',
      termsGateHint: 'Rul til slutningen, og vent 3 sekunder, før du kan sætte kryds.',
      loginTitle: 'Log ind',
      loginBody: 'Der kræves login ved hver opstart. Loginoplysningerne styres nu af mnemonicsætningen og gemmes ikke længere.',
      pinLogin: 'Log ind med PIN',
      pinPlaceholder: 'PIN (4–20 bogstaver/tal)',
      login: 'Log ind',
      autoLogin: 'Automatisk login på denne enhed',
      autoLoginHint: 'Bundet til denne systemkonto og hardware. En systemopdatering kan gøre den ugyldig; mnemonicsætningen er den eneste vej tilbage.',
      autoLoginInvalid: 'Automatisk login er ikke længere gyldigt (systemkonto/CPU/hardware er ændret). Brug PIN eller mnemonicsætning.',
      recover: 'Log ind med mnemonicsætning',
      register: 'Opret ny konto',
      noAccount: 'Der er endnu ingen konto på denne enhed. Opret en ny, eller gendan en med dens mnemonicsætning.',
      registerTitle: 'Opret mnemonicsætningskonto',
      registerBody: 'Der genereres en sætning på 24 ord. Det er den eneste måde at gendanne; hav papir og pen klar.',
      registerBegin: 'Generér sætning på 24 ord',
      existingMnemonic: 'Jeg har allerede en sætning',
      existingAccountWarn: 'Der findes allerede en konto på denne enhed. Hvis du fortsætter, erstattes den nuværende konto og lokale identitet (den gamle boks sikkerhedskopieres først). Fortsæt?',
      back: 'Tilbage',
      recoverTitle: 'Indtast din mnemonicsætning',
      recoverBody: 'Indtast den engelske sætning på 24 ord, eller pinyin-varianten (fuld pinyin, uden tal og tegn).',
      recoverHint: 'Sætningen kontrolleres kun lokalt og uploades aldrig.',
      verify: 'Kontrollér sætning',
      badPin: 'Forkert PIN',
      locked: 'Låst. Prøv igen senere.',
      lockHint: 'Efter yderligere {n} mislykkede forsøg låses du i et stykke tid',
      pinRule: 'PIN skal være 4–20 bogstaver/tal, og begge indtastninger skal være ens.',
      pinMismatch: 'De to PIN-koder er ikke ens.',
      badMnemonic: 'Ugyldig sætning (ord, rækkefølge eller kontrolsum).',
      accountExists: 'Kontoen findes allerede',
      vaultCorrupt: 'Auth-boksen er beskadiget eller ulæselig. Den originale fil er bevaret.',
      osUnavailable: 'Sikker systemlager er ikke tilgængeligt. Brug en PIN; mnemonicsætningen er den eneste vej tilbage.',
      authManaged: 'Denne handling styres af mnemonicsætningskontoen.',
      mnemonicTitle: 'Mnemonicsætning (24 ord)',
      mnemonicHidden: 'Sætning skjult · klik for at vise',
      mnemonicBody: 'Skriv den ned nu med hånden — to kopier på forskellige steder. Tag ikke skærmbillede, kopiér den ikke, og gem den ikke på computer eller i skyen. Sætningen er din eneste adgang; der findes ingen gendannelse!',
      mnemonicReminderBody: 'Du valgte »Påmind mig senere« sidste gang. Skriv den ned nu: to kopier på papir, på forskellige steder. Tag ikke skærmbillede, kopiér den ikke, og gem den ikke på computer eller i skyen. Sætningen er din eneste adgang; der findes ingen gendannelse!',
      pinyinFriendly: 'Sætning i pinyin',
      pinyinGroupTwo: 'Ord',
      pinyinGroupFour: 'Idiomer',
      later: 'Påmind mig senere',
      saved: 'Jeg har skrevet den ned',
      laterConfirmTitle: 'Påmind senere',
      laterConfirmBody: 'Du har ikke bekræftet, at du skrev sætningen ned. Ved næste opstart vises først bekræftelsessiden; automatisk login er utilgængeligt, og du skal angive en PIN. Fortsæt?',
      laterConfirmOk: 'Påmind mig senere',
      confirmBody: 'Sætningen er din eneste adgang; der findes ingen gendannelse! Sætningen, der netop blev vist, destrueres og kan ikke vises igen. Er du sikker på, at du har skrevet to kopier ned og lagt dem på forskellige steder?',
      confirmOk: 'Jeg har skrevet den ned',
      cancel: 'Annuller',
      pinTitle: 'Angiv en PIN',
      pinBody: 'PIN-koden bruges til login på denne enhed (4–20 bogstaver/tal, ingen specialtegn).',
      pin1: 'Indtast PIN',
      pin2: 'Gentag PIN',
      autoEnable: 'Automatisk login (bind denne enhed)',
      autoDisabledHint: 'Automatisk login kan først slås til, når sætningen er bekræftet.',
      autoOnHint: 'Hardwareændringer eller systemopgradering kan gøre PIN ugyldig; mnemonicsætningen er den eneste vej tilbage!',
      autoOffHint: 'Hardwareændringer eller systemopgradering kan gøre PIN ugyldig; mnemonicsætningen er den eneste vej tilbage!',
      confirmCreate: 'Afslut registrering',
      confirmRecover: 'Afslut gendannelse',
      autoLoginFail: 'Automatisk login kunne ikke angives. Prøv igen senere.',
      usernameTitle: 'Vælg dit navn',
      usernameBody: 'Navnet gemmes kun på denne enhed og er, hvordan appen tiltaler dig.',
      usernameLabel: 'Navn',
      usernameRule: '1–30 tegn (bogstaver, tal, mellemrum og emoji); må ikke være tomt.',
      usernameFinish: 'Færdig',
      usernameSaveFail: 'Navnet kunne ikke gemmes. Prøv igen.',
      viewTitle: 'Vis sætningen',
      viewBody: 'Sørg for, at ingen kigger med. En lækket sætning overtager kontoen; efter lukning bliver den ikke på skærmen.',
      saveMnemonic: 'Gem sætningen',
      saveLater: 'Gem senere',
      saveConfirm: 'Jeg har skrevet den ned',
      myTitle: 'Konto og mnemonicsætning',
      myMnemonic: 'Mnemonicsætning',
      myConfirmed: 'Gemt',
      myUnconfirmed: 'Ikke bekræftet',
      myAuto: 'Automatisk login på denne enhed',
      myAutoHint: 'Automatisk login er bundet til denne enhed. En systemopdatering eller hardwareændring kan gøre den ugyldig; sætningen er den eneste vej tilbage.',
      myAutoNeedsMnemonic: 'Bekræft først sætningen, før du slår automatisk login til.',
      myAutoUnavailable: 'Denne version understøtter ikke kontakten til automatisk login; brug PIN.',
      logout: 'Log ud',
      logoutConfirm: 'Når du logger ud, kommer du tilbage til login-skærmen; PIN eller sætning er nødvendig igen. Log ud?',
      myPinChange: 'Skift PIN',
      myPinDisabled: 'PIN kan ikke ændres, mens automatisk login er slået til.',
      myChangeOk: 'PIN ændret. Log ind med den nye PIN.',
      myChangeFail: 'Ændring af PIN mislykkedes.',
    },
    nb: {
      loading: 'Laster konto…',
      start: 'Start',
      fatal: 'Kontomodulen er ikke tilgjengelig; oppstarten stoppes av sikkerhetshensyn. Kontroller at preload/main laster auth-gate.',
      seconds: 's',
      error: 'Handlingen mislyktes',
      close: 'Lukk',
      quitBack: 'Tilbake til appen',
      quitApp: 'Avslutt programmet',
      termsTitle: 'Personvern og vilkår',
      termsFallback: 'Les og godta vilkårene nedenfor for å fortsette.',
      termsAgree: 'Jeg har lest og godtar alt ovenfor',
      termsContinue: 'Godta og fortsett',
      termsDecline: 'Avvis og avslutt',
      termsRequired: 'Rull først til bunnen og vent 3 sekunder.',
      termsGateHint: 'Rull til slutten og vent 3 sekunder før du kan krysse av.',
      loginTitle: 'Logg inn',
      loginBody: 'Innlogging kreves ved hver oppstart. Påloggingsdataene styres nå av minnefrasen og lagres ikke lenger.',
      pinLogin: 'Logg inn med PIN',
      pinPlaceholder: 'PIN (4–20 bokstaver/tall)',
      login: 'Logg inn',
      autoLogin: 'Automatisk innlogging på denne enheten',
      autoLoginHint: 'Knyttet til denne systemkontoen og maskinvaren. En systemoppdatering kan gjøre den ugyldig; minnefrasen er eneste vei tilbake.',
      autoLoginInvalid: 'Automatisk innlogging er ikke lenger gyldig (systemkonto/CPU/maskinvare er endret). Bruk PIN eller minnefrasen.',
      recover: 'Logg inn med minnefrase',
      register: 'Opprett ny konto',
      noAccount: 'Det finnes ingen konto på denne enheten ennå. Opprett en ny, eller gjenopprett en med minnefrasen.',
      registerTitle: 'Opprett minnefrasekonto',
      registerBody: 'Det genereres en frase med 24 ord. Den er eneste måte å gjenopprette; ha papir og penn klart.',
      registerBegin: 'Generer frase med 24 ord',
      existingMnemonic: 'Jeg har allerede en frase',
      existingAccountWarn: 'Det finnes allerede en konto på denne enheten. Hvis du fortsetter, erstattes gjeldende konto og lokal identitet (den gamle hvelvet sikkerhetskopieres først). Fortsette?',
      back: 'Tilbake',
      recoverTitle: 'Skriv inn minnefrasen',
      recoverBody: 'Skriv inn den engelske frasen med 24 ord, eller pinyin-varianten (full pinyin, uten tall og tegn).',
      recoverHint: 'Frasen kontrolleres bare lokalt og lastes aldri opp.',
      verify: 'Kontroller frase',
      badPin: 'Feil PIN',
      locked: 'Låst. Prøv igjen senere.',
      lockHint: 'Etter ytterligere {n} mislykkede forsøk låses du en stund',
      pinRule: 'PIN må være 4–20 bokstaver/tall, og begge inntastingene må være like.',
      pinMismatch: 'De to PIN-kodene er ikke like.',
      badMnemonic: 'Ugyldig frase (ord, rekkefølge eller kontrollsum).',
      accountExists: 'Kontoen finnes allerede',
      vaultCorrupt: 'Autentiseringshvelvet er skadet eller uleselig. Originalfilen er bevart.',
      osUnavailable: 'Sikker systemlagring er ikke tilgjengelig. Bruk en PIN; minnefrasen er eneste vei tilbake.',
      authManaged: 'Denne handlingen styres av minnefrasekontoen.',
      mnemonicTitle: 'Minnefrase (24 ord)',
      mnemonicHidden: 'Frasen er skjult · klikk for å vise',
      mnemonicBody: 'Skriv den ned nå med hånden — to kopier på forskjellige steder. Ikke ta skjermbilde, ikke kopier den, og ikke lagre den på datamaskin eller i skyen. Frasen er din eneste tilgang; det finnes ingen gjenoppretting!',
      mnemonicReminderBody: 'Du valgte «Påminn meg senere» sist. Skriv den ned nå: to kopier på papir, på forskjellige steder. Ikke ta skjermbilde, ikke kopier den, og ikke lagre den på datamaskin eller i skyen. Frasen er din eneste tilgang; det finnes ingen gjenoppretting!',
      pinyinFriendly: 'Frase i pinyin',
      pinyinGroupTwo: 'Ord',
      pinyinGroupFour: 'Idiomer',
      later: 'Påminn meg senere',
      saved: 'Jeg har skrevet den ned',
      laterConfirmTitle: 'Påminn senere',
      laterConfirmBody: 'Du har ikke bekreftet at du skrev ned frasen. Ved neste oppstart vises bekreftelsessiden først; automatisk innlogging blir utilgjengelig, og du må angi en PIN. Fortsette?',
      laterConfirmOk: 'Påminn meg senere',
      confirmBody: 'Frasen er din eneste tilgang; det finnes ingen gjenoppretting! Frasen som nettopp ble vist, blir ødelagt og kan ikke vises igjen. Er du sikker på at du har skrevet ned to kopier og lagt dem på forskjellige steder?',
      confirmOk: 'Jeg har skrevet den ned',
      cancel: 'Avbryt',
      pinTitle: 'Angi en PIN',
      pinBody: 'PIN-koden brukes til innlogging på denne enheten (4–20 bokstaver/tall, ingen spesialtegn).',
      pin1: 'Skriv inn PIN',
      pin2: 'Gjenta PIN',
      autoEnable: 'Automatisk innlogging (knytt denne enheten)',
      autoDisabledHint: 'Automatisk innlogging kan først slås på etter at frasen er bekreftet.',
      autoOnHint: 'Maskinvareendringer eller systemoppgradering kan gjøre PIN ugyldig; minnefrasen er eneste vei tilbake!',
      autoOffHint: 'Maskinvareendringer eller systemoppgradering kan gjøre PIN ugyldig; minnefrasen er eneste vei tilbake!',
      confirmCreate: 'Fullfør registreringen',
      confirmRecover: 'Fullfør gjenopprettingen',
      autoLoginFail: 'Kunne ikke angi automatisk innlogging. Prøv igjen senere.',
      usernameTitle: 'Velg navnet ditt',
      usernameBody: 'Navnet lagres bare på denne enheten og er hvordan appen tiltaler deg.',
      usernameLabel: 'Navn',
      usernameRule: '1–30 tegn (bokstaver, tall, mellomrom og emoji); kan ikke være tomt.',
      usernameFinish: 'Ferdig',
      usernameSaveFail: 'Kunne ikke lagre navnet. Prøv igjen.',
      viewTitle: 'Vis frasen',
      viewBody: 'Sørg for at ingen ser på. En lekket frase overtar kontoen; etter lukking blir den ikke på skjermen.',
      saveMnemonic: 'Lagre frasen',
      saveLater: 'Lagre senere',
      saveConfirm: 'Jeg har skrevet den ned',
      myTitle: 'Konto og minnefrase',
      myMnemonic: 'Minnefrase',
      myConfirmed: 'Lagret',
      myUnconfirmed: 'Ikke bekreftet',
      myAuto: 'Automatisk innlogging på denne enheten',
      myAutoHint: 'Automatisk innlogging er knyttet til denne enheten. En systemoppdatering eller maskinvareendring kan gjøre den ugyldig; frasen er eneste vei tilbake.',
      myAutoNeedsMnemonic: 'Bekreft frasen først før du slår på automatisk innlogging.',
      myAutoUnavailable: 'Denne versjonen støtter ikke bryteren for automatisk innlogging; bruk PIN.',
      logout: 'Logg ut',
      logoutConfirm: 'Når du logger ut, kommer du tilbake til innloggingsskjermen; PIN eller frase trengs igjen. Logge ut?',
      myPinChange: 'Endre PIN',
      myPinDisabled: 'PIN kan ikke endres mens automatisk innlogging er på.',
      myChangeOk: 'PIN endret. Logg inn med den nye PIN-koden.',
      myChangeFail: 'Endring av PIN mislyktes.',
    },
    tr: {
      loading: 'Hesap yükleniyor…',
      start: 'Başlat',
      fatal: 'Hesap modülü kullanılamıyor; güvenlik nedeniyle başlatma durduruldu. preload/main dosyalarının auth-gate yüklediğini kontrol edin.',
      seconds: 'sn',
      error: 'İşlem başarısız',
      close: 'Kapat',
      quitBack: 'Uygulamaya dön',
      quitApp: 'Programdan çık',
      termsTitle: 'Gizlilik ve koşullar',
      termsFallback: 'Devam etmek için lütfen aşağıdaki koşulları okuyup kabul edin.',
      termsAgree: 'Yukarıdakilerin tamamını okudum ve kabul ediyorum',
      termsContinue: 'Kabul et ve devam et',
      termsDecline: 'Reddet ve çık',
      termsRequired: 'Önce sayfanın sonuna kaydırın ve 3 saniye bekleyin.',
      termsGateHint: 'Onay kutusunu işaretleyebilmek için sona kaydırın ve 3 saniye bekleyin.',
      loginTitle: 'Giriş',
      loginBody: 'Her başlatmada giriş gerekir. Giriş bilgisi artık anımsatıcı sözcük öbeğiyle yönetiliyor ve kaydedilmiyor.',
      pinLogin: 'PIN ile giriş yap',
      pinPlaceholder: 'PIN (4–20 harf/rakam)',
      login: 'Giriş yap',
      autoLogin: 'Bu cihazda otomatik giriş',
      autoLoginHint: 'Bu sistem hesabına ve donanıma bağlıdır. Bir sistem yükseltmesi geçersiz kılabilir; anımsatıcı sözcük öbeği tek kurtarma yoludur.',
      autoLoginInvalid: 'Otomatik giriş artık geçerli değil (sistem hesabı/CPU/donanım değişti). PIN veya anımsatıcı sözcük öbeğini kullanın.',
      recover: 'Anımsatıcı sözcük öbeğiyle giriş yap',
      register: 'Yeni hesap oluştur',
      noAccount: 'Bu cihazda henüz hesap yok. Yeni bir hesap oluşturun veya anımsatıcı sözcük öbeğiyle bir hesabı kurtarın.',
      registerTitle: 'Anımsatıcı hesaplı hesap oluştur',
      registerBody: '24 sözcükten oluşan bir öbek oluşturulacak. Kurtarmanın tek yolu budur; kâğıt ve kalem hazırlayın.',
      registerBegin: '24 sözcüklü öbek oluştur',
      existingMnemonic: 'Zaten bir öbeğim var',
      existingAccountWarn: 'Bu cihazda zaten bir hesap var. Devam ederseniz mevcut hesap ve yerel kimlik değiştirilir (eski kasa önce yedeklenir). Devam edilsin mi?',
      back: 'Geri',
      recoverTitle: 'Anımsatıcı sözcük öbeğini girin',
      recoverBody: '24 sözcüklü İngilizce öbeği veya pinyin sürümünü girin (tam pinyin, rakam ve simge olmadan).',
      recoverHint: 'Öbek yalnızca yerel olarak doğrulanır ve asla yüklenmez.',
      verify: 'Öbeği doğrula',
      badPin: 'PIN yanlış',
      locked: 'Kilitlendi. Lütfen daha sonra tekrar deneyin.',
      lockHint: '{n} başarısız denemeden sonra bir süre kilitleneceksiniz',
      pinRule: 'PIN 4–20 harf/rakam olmalı ve iki giriş aynı olmalıdır.',
      pinMismatch: 'İki PIN birbiriyle aynı değil.',
      badMnemonic: 'Geçersiz öbek (sözcükler, sıra veya sağlama toplamı).',
      accountExists: 'Hesap zaten var',
      vaultCorrupt: 'Kimlik kasası bozuk veya okunamıyor. Özgün dosya korundu.',
      osUnavailable: 'Güvenli sistem deposu kullanılamıyor. PIN kullanın; anımsatıcı sözcük öbeği tek kurtarma yoludur.',
      authManaged: 'Bu işlem anımsatıcı hesaplı hesap tarafından yönetiliyor.',
      mnemonicTitle: 'Anımsatıcı sözcük öbeği (24 sözcük)',
      mnemonicHidden: 'Öbek gizli · göstermek için tıklayın',
      mnemonicBody: 'Şimdi hemen elle yazın — farklı yerlerde iki kopya. Ekran görüntüsü almayın, kopyalamayın, bilgisayara veya buluta kaydetmeyin. Öbek tek kimlik bilginizdir; hiçbir kurtarma yolu yoktur!',
      mnemonicReminderBody: 'Geçen sefer «Daha sonra hatırlat» seçtiniz. Şimdi yazın: kâğıda iki kopya, farklı yerlerde. Ekran görüntüsü almayın, kopyalamayın, bilgisayara veya buluta kaydetmeyin. Öbek tek kimlik bilginizdir; hiçbir kurtarma yolu yoktur!',
      pinyinFriendly: 'Pinyin olarak öbek',
      pinyinGroupTwo: 'Sözcükler',
      pinyinGroupFour: 'Deyimler',
      later: 'Daha sonra hatırlat',
      saved: 'Yazdım',
      laterConfirmTitle: 'Daha sonra hatırlat',
      laterConfirmBody: 'Öbeği yazdığınızı onaylamadınız. Bir sonraki başlatmada önce onay sayfası görünecek; otomatik giriş kullanılamayacak ve bir PIN belirlemeniz gerekecek. Devam edilsin mi?',
      laterConfirmOk: 'Daha sonra hatırlat',
      confirmBody: 'Öbek tek kimlik bilginizdir; hiçbir kurtarma yolu yoktur! Az önce gösterilen öbek yok edilecek ve bir daha görülemeyecek. İki kopya yazıp ayrı yerlere koyduğunuzdan emin misiniz?',
      confirmOk: 'Yazdım',
      cancel: 'İptal',
      pinTitle: 'PIN belirle',
      pinBody: 'PIN bu cihazda giriş için kullanılır (4–20 harf/rakam, özel karakter yok).',
      pin1: 'PIN girin',
      pin2: 'PIN tekrar',
      autoEnable: 'Otomatik giriş (bu cihazı bağla)',
      autoDisabledHint: 'Otomatik giriş ancak öbek onaylandıktan sonra açılabilir.',
      autoOnHint: 'Donanım değişikliği veya sistem yükseltmesi PIN\'i geçersiz kılabilir; anımsatıcı sözcük öbeği tek kurtarma yoludur!',
      autoOffHint: 'Donanım değişikliği veya sistem yükseltmesi PIN\'i geçersiz kılabilir; anımsatıcı sözcük öbeği tek kurtarma yoludur!',
      confirmCreate: 'Kaydı tamamla',
      confirmRecover: 'Kurtarmayı tamamla',
      autoLoginFail: 'Otomatik giriş ayarlanamadı. Daha sonra tekrar deneyin.',
      usernameTitle: 'Adınızı seçin',
      usernameBody: 'Bu ad yalnızca bu cihazda saklanır ve uygulamanın size hitap şeklidir.',
      usernameLabel: 'Ad',
      usernameRule: '1–30 karakter (harf, rakam, boşluk ve emoji); boş olamaz.',
      usernameFinish: 'Bitti',
      usernameSaveFail: 'Ad kaydedilemedi. Tekrar deneyin.',
      viewTitle: 'Öbeği göster',
      viewBody: 'Kimsenin bakmadığından emin olun. Sızan bir öbek hesabı ele geçirir; kapatıldıktan sonra ekranda kalmaz.',
      saveMnemonic: 'Öbeği kaydet',
      saveLater: 'Daha sonra kaydet',
      saveConfirm: 'Yazdım ve onaylıyorum',
      myTitle: 'Hesap ve anımsatıcı sözcük öbeği',
      myMnemonic: 'Anımsatıcı sözcük öbeği',
      myConfirmed: 'Kaydedildi',
      myUnconfirmed: 'Onaylanmadı',
      myAuto: 'Bu cihazda otomatik giriş',
      myAutoHint: 'Otomatik giriş bu cihaza bağlıdır. Sistem yükseltmesi veya donanım değişikliği geçersiz kılabilir; öbek tek kurtarma yoludur.',
      myAutoNeedsMnemonic: 'Otomatik girişi açmadan önce öbeği onaylayın.',
      myAutoUnavailable: 'Bu sürüm otomatik giriş anahtarını desteklemiyor; PIN kullanın.',
      logout: 'Çıkış yap',
      logoutConfirm: 'Çıkış yapınca giriş ekranına dönersiniz; PIN veya öbek yeniden gerekir. Çıkış yapılsın mı?',
      myPinChange: 'PIN değiştir',
      myPinDisabled: 'Otomatik giriş açıkken PIN değiştirilemez.',
      myChangeOk: 'PIN değiştirildi. Yeni PIN ile giriş yapın.',
      myChangeFail: 'PIN değiştirilemedi.',
    },
    uk: {
      loading: 'Завантаження облікового запису…',
      start: 'Запустити',
      fatal: 'Модуль облікового запису недоступний; запуск скасовано з міркувань безпеки. Перевірте, чи preload/main завантажують auth-gate.',
      seconds: 'с',
      error: 'Не вдалося виконати дію',
      close: 'Закрити',
      quitBack: 'Повернутися до програми',
      quitApp: 'Вийти з програми',
      termsTitle: 'Конфіденційність і умови',
      termsFallback: 'Прочитайте та прийміть наведені нижче умови, щоб продовжити.',
      termsAgree: 'Я прочитав(-ла) і приймаю все вищезазначене',
      termsContinue: 'Прийняти й продовжити',
      termsDecline: 'Відхилити й вийти',
      termsRequired: 'Спочатку прокрутіть до кінця та зачекайте 3 секунди.',
      termsGateHint: 'Прокрутіть до кінця та зачекайте 3 секунди, після цього можна поставити позначку.',
      loginTitle: 'Вхід',
      loginBody: 'Вхід потрібен під час кожного запуску. Тепер облікові дані керуються мнемонічною фразою і більше не зберігаються.',
      pinLogin: 'Увійти за PIN-кодом',
      pinPlaceholder: 'PIN-код (4–20 літер/цифр)',
      login: 'Увійти',
      autoLogin: 'Автоматичний вхід на цьому пристрої',
      autoLoginHint: 'Прив’язано до цього системного облікового запису й обладнання. Оновлення системи може зробити його недійсним; мнемонічна фраза — єдиний спосіб відновлення.',
      autoLoginInvalid: 'Автоматичний вхід більше не дійсний (змінено системний обліковий запис/ЦП/обладнання). Використайте PIN-код або мнемонічну фразу.',
      recover: 'Увійти за мнемонічною фразою',
      register: 'Створити новий обліковий запис',
      noAccount: 'На цьому пристрої ще немає облікового запису. Створіть новий або відновіть наявний за його мнемонічною фразою.',
      registerTitle: 'Створити обліковий запис із мнемонічною фразою',
      registerBody: 'Буде згенеровано фразу з 24 слів. Це єдиний спосіб відновлення; приготуйте папір і ручку.',
      registerBegin: 'Згенерувати фразу з 24 слів',
      existingMnemonic: 'У мене вже є фраза',
      existingAccountWarn: 'На цьому пристрої вже існує обліковий запис. Продовження замінить поточний обліковий запис і локальну ідентичність (старе сховище спершу буде збережено в резервній копії). Продовжити?',
      back: 'Назад',
      recoverTitle: 'Введіть мнемонічну фразу',
      recoverBody: 'Введіть англійську фразу з 24 слів або піньїнь-варіант (повний піньїнь, без цифр і символів).',
      recoverHint: 'Фраза перевіряється лише локально і ніколи не надсилається.',
      verify: 'Перевірити фразу',
      badPin: 'Невірний PIN-код',
      locked: 'Заблоковано. Спробуйте пізніше.',
      lockHint: 'Після ще {n} невдалих спроб вас буде тимчасово заблоковано',
      pinRule: 'PIN-код має містити 4–20 літер/цифр, і обидва введення мають збігатися.',
      pinMismatch: 'Два PIN-коди не збігаються.',
      badMnemonic: 'Недійсна фраза (слова, порядок або контрольна сума).',
      accountExists: 'Обліковий запис уже існує',
      vaultCorrupt: 'Сховище автентифікації пошкоджене або недоступне для читання. Оригінальний файл збережено.',
      osUnavailable: 'Захищене системне сховище недоступне. Використайте PIN-код; мнемонічна фраза — єдиний спосіб відновлення.',
      authManaged: 'Ця дія керується обліковим записом із мнемонічною фразою.',
      mnemonicTitle: 'Мнемонічна фраза (24 слова)',
      mnemonicHidden: 'Фразу приховано · натисніть, щоб показати',
      mnemonicBody: 'Запишіть її негайно від руки — два примірники в різних місцях. Не робіть знімків екрана, не копіюйте та не зберігайте на комп’ютері чи в хмарі. Фраза — ваш єдиний обліковий документ; відновлення неможливе!',
      mnemonicReminderBody: 'Минулого разу ви обрали «Нагадати пізніше». Запишіть її зараз: два примірники на папері, у різних місцях. Не робіть знімків екрана, не копіюйте та не зберігайте на комп’ютері чи в хмарі. Фраза — ваш єдиний обліковий документ; відновлення неможливе!',
      pinyinFriendly: 'Фраза піньїнем',
      pinyinGroupTwo: 'Слова',
      pinyinGroupFour: 'Ідіоми',
      later: 'Нагадати пізніше',
      saved: 'Я записав(-ла)',
      laterConfirmTitle: 'Нагадати пізніше',
      laterConfirmBody: 'Ви не підтвердили, що записали фразу. Під час наступного запуску спершу з’явиться сторінка підтвердження; автоматичний вхід буде недоступний, і вам доведеться встановити PIN-код. Продовжити?',
      laterConfirmOk: 'Нагадати пізніше',
      confirmBody: 'Фраза — ваш єдиний обліковий документ; відновлення неможливе! Щойно показану фразу буде знищено, і її більше не можна буде побачити. Ви впевнені, що записали два примірники й поклали їх у різні місця?',
      confirmOk: 'Я записав(-ла)',
      cancel: 'Скасувати',
      pinTitle: 'Встановити PIN-код',
      pinBody: 'PIN-код використовується для входу на цьому пристрої (4–20 літер/цифр, без спеціальних символів).',
      pin1: 'Введіть PIN-код',
      pin2: 'Повторіть PIN-код',
      autoEnable: 'Автоматичний вхід (прив’язати цей пристрій)',
      autoDisabledHint: 'Автоматичний вхід можна ввімкнути лише після підтвердження фрази.',
      autoOnHint: 'Заміна обладнання або оновлення системи може зробити PIN-код недійсним; мнемонічна фраза — єдиний спосіб відновлення!',
      autoOffHint: 'Заміна обладнання або оновлення системи може зробити PIN-код недійсним; мнемонічна фраза — єдиний спосіб відновлення!',
      confirmCreate: 'Завершити реєстрацію',
      confirmRecover: 'Завершити відновлення',
      autoLoginFail: 'Не вдалося налаштувати автоматичний вхід. Спробуйте пізніше.',
      usernameTitle: 'Виберіть своє ім’я',
      usernameBody: 'Це ім’я зберігається лише на цьому пристрої; так програма звертатиметься до вас.',
      usernameLabel: 'Ім’я',
      usernameRule: '1–30 символів (літери, цифри, пробіли й емодзі); не може бути порожнім.',
      usernameFinish: 'Готово',
      usernameSaveFail: 'Не вдалося зберегти ім’я. Спробуйте ще раз.',
      viewTitle: 'Показати фразу',
      viewBody: 'Переконайтеся, що ніхто не дивиться. Фраза, яка потрапила до чужих рук, дає доступ до облікового запису; після закриття вона не залишиться на екрані.',
      saveMnemonic: 'Зберегти фразу',
      saveLater: 'Зберегти пізніше',
      saveConfirm: 'Я записав(-ла) і підтверджую',
      myTitle: 'Обліковий запис і мнемонічна фраза',
      myMnemonic: 'Мнемонічна фраза',
      myConfirmed: 'Збережено',
      myUnconfirmed: 'Не підтверджено',
      myAuto: 'Автоматичний вхід на цьому пристрої',
      myAutoHint: 'Автоматичний вхід прив’язаний до цього пристрою. Оновлення системи або зміна обладнання можуть зробити його недійсним; фраза — єдиний спосіб відновлення.',
      myAutoNeedsMnemonic: 'Спершу підтвердьте фразу, а потім вмикайте автоматичний вхід.',
      myAutoUnavailable: 'Ця версія не підтримує перемикач автоматичного входу; використайте PIN-код.',
      logout: 'Вийти',
      logoutConfirm: 'Після виходу ви повернетеся на екран входу; знову знадобиться PIN-код або фраза. Вийти?',
      myPinChange: 'Змінити PIN-код',
      myPinDisabled: 'PIN-код не можна змінити, поки ввімкнено автоматичний вхід.',
      myChangeOk: 'PIN-код змінено. Увійдіть із новим PIN-кодом.',
      myChangeFail: 'Не вдалося змінити PIN-код.',
    },
    id: {
      loading: 'Memuat akun…',
      start: 'Mulai',
      fatal: 'Modul akun tidak tersedia; proses dimulai dihentikan demi keamanan. Pastikan preload/main memuat auth-gate.',
      seconds: 'dtk',
      error: 'Operasi gagal',
      close: 'Tutup',
      quitBack: 'Kembali ke aplikasi',
      quitApp: 'Keluar dari program',
      termsTitle: 'Privasi dan ketentuan',
      termsFallback: 'Baca dan setujui ketentuan di bawah ini untuk melanjutkan.',
      termsAgree: 'Saya telah membaca dan menyetujui semua hal di atas',
      termsContinue: 'Setujui dan lanjutkan',
      termsDecline: 'Tolak dan keluar',
      termsRequired: 'Gulir ke bawah terlebih dahulu dan tunggu 3 detik.',
      termsGateHint: 'Gulir sampai akhir dan tunggu 3 detik sebelum dapat mencentang.',
      loginTitle: 'Masuk',
      loginBody: 'Masuk diperlukan setiap kali aplikasi dimulai. Kredensial kini dikelola oleh frasa mnemonik dan tidak lagi disimpan.',
      pinLogin: 'Masuk dengan PIN',
      pinPlaceholder: 'PIN (4–20 huruf/angka)',
      login: 'Masuk',
      autoLogin: 'Masuk otomatis di perangkat ini',
      autoLoginHint: 'Terikat pada akun sistem dan perangkat keras ini. Peningkatan sistem dapat membuatnya tidak valid; frasa mnemonik adalah satu-satunya cara memulihkan.',
      autoLoginInvalid: 'Masuk otomatis tidak lagi valid (akun sistem/CPU/perangkat keras berubah). Gunakan PIN atau frasa mnemonik.',
      recover: 'Masuk dengan frasa mnemonik',
      register: 'Buat akun baru',
      noAccount: 'Belum ada akun di perangkat ini. Buat akun baru atau pulihkan akun yang ada dengan frasa mnemoniknya.',
      registerTitle: 'Buat akun dengan frasa mnemonik',
      registerBody: 'Akan dibuat frasa 24 kata. Itu satu-satunya cara memulihkan; siapkan kertas dan pena.',
      registerBegin: 'Buat frasa 24 kata',
      existingMnemonic: 'Saya sudah punya frasa',
      existingAccountWarn: 'Sudah ada akun di perangkat ini. Melanjutkan akan menggantikan akun saat ini dan identitas lokal (brankas lama akan dicadangkan terlebih dahulu). Lanjutkan?',
      back: 'Kembali',
      recoverTitle: 'Masukkan frasa mnemonik Anda',
      recoverBody: 'Masukkan frasa bahasa Inggris 24 kata, atau versi pinyin (pinyin penuh, tanpa angka dan simbol).',
      recoverHint: 'Frasa hanya diverifikasi secara lokal dan tidak pernah diunggah.',
      verify: 'Verifikasi frasa',
      badPin: 'PIN salah',
      locked: 'Terkunci. Coba lagi nanti.',
      lockHint: 'Setelah {n} percobaan gagal lagi, Anda akan terkunci sementara',
      pinRule: 'PIN harus 4–20 huruf/angka dan kedua isian harus sama.',
      pinMismatch: 'Kedua PIN tidak sama.',
      badMnemonic: 'Frasa tidak valid (kata, urutan, atau checksum).',
      accountExists: 'Akun sudah ada',
      vaultCorrupt: 'Brankas autentikasi rusak atau tidak dapat dibaca. Berkas asli telah dipertahankan.',
      osUnavailable: 'Penyimpanan sistem yang aman tidak tersedia. Gunakan PIN; frasa mnemonik adalah satu-satunya cara memulihkan.',
      authManaged: 'Tindakan ini dikelola oleh akun dengan frasa mnemonik.',
      mnemonicTitle: 'Frasa mnemonik (24 kata)',
      mnemonicHidden: 'Frasa disembunyikan · klik untuk menampilkan',
      mnemonicBody: 'Tuliskan sekarang juga dengan tangan — dua salinan di tempat berbeda. Jangan tangkapan layar, jangan salin, jangan simpan di komputer atau cloud. Frasa adalah satu-satunya kredensial Anda; tidak ada pemulihan!',
      mnemonicReminderBody: 'Terakhir kali Anda memilih “Ingatkan nanti”. Tuliskan sekarang: dua salinan di kertas, di tempat berbeda. Jangan tangkapan layar, jangan salin, jangan simpan di komputer atau cloud. Frasa adalah satu-satunya kredensial Anda; tidak ada pemulihan!',
      pinyinFriendly: 'Frasa dalam pinyin',
      pinyinGroupTwo: 'Kata',
      pinyinGroupFour: 'Idiom',
      later: 'Ingatkan nanti',
      saved: 'Sudah saya tulis',
      laterConfirmTitle: 'Ingatkan nanti',
      laterConfirmBody: 'Anda belum mengonfirmasi telah menuliskan frasa. Saat aplikasi dimulai berikutnya, halaman konfirmasi akan muncul lebih dulu; masuk otomatis tidak tersedia dan Anda harus menyetel PIN. Lanjutkan?',
      laterConfirmOk: 'Ingatkan nanti',
      confirmBody: 'Frasa adalah satu-satunya kredensial Anda; tidak ada pemulihan! Frasa yang baru ditampilkan akan dimusnahkan dan tidak dapat dilihat lagi. Apakah Anda yakin telah menulis dua salinan dan menyimpannya terpisah?',
      confirmOk: 'Sudah saya tulis',
      cancel: 'Batal',
      pinTitle: 'Setel PIN',
      pinBody: 'PIN digunakan untuk masuk di perangkat ini (4–20 huruf/angka, tanpa karakter khusus).',
      pin1: 'Masukkan PIN',
      pin2: 'Ulangi PIN',
      autoEnable: 'Masuk otomatis (ikat perangkat ini)',
      autoDisabledHint: 'Masuk otomatis baru bisa diaktifkan setelah frasa dikonfirmasi.',
      autoOnHint: 'Mengganti perangkat keras atau meningkatkan sistem dapat membuat PIN tidak valid; frasa mnemonik adalah satu-satunya cara memulihkan!',
      autoOffHint: 'Mengganti perangkat keras atau meningkatkan sistem dapat membuat PIN tidak valid; frasa mnemonik adalah satu-satunya cara memulihkan!',
      confirmCreate: 'Selesaikan pendaftaran',
      confirmRecover: 'Selesaikan pemulihan',
      autoLoginFail: 'Gagal menyetel masuk otomatis. Coba lagi nanti.',
      usernameTitle: 'Pilih nama Anda',
      usernameBody: 'Nama ini disimpan hanya di perangkat ini dan menjadi sapaan aplikasi kepada Anda.',
      usernameLabel: 'Nama',
      usernameRule: '1–30 karakter (huruf, angka, spasi, dan emoji); tidak boleh kosong.',
      usernameFinish: 'Selesai',
      usernameSaveFail: 'Gagal menyimpan nama. Coba lagi.',
      viewTitle: 'Tampilkan frasa',
      viewBody: 'Pastikan tidak ada yang melihat. Frasa yang bocor akan mengambil alih akun; setelah ditutup, frasa tidak tersisa di layar.',
      saveMnemonic: 'Simpan frasa',
      saveLater: 'Simpan nanti',
      saveConfirm: 'Sudah saya tulis dan konfirmasi',
      myTitle: 'Akun dan frasa mnemonik',
      myMnemonic: 'Frasa mnemonik',
      myConfirmed: 'Tersimpan',
      myUnconfirmed: 'Belum dikonfirmasi',
      myAuto: 'Masuk otomatis di perangkat ini',
      myAutoHint: 'Masuk otomatis terikat pada perangkat ini. Peningkatan sistem atau perubahan perangkat keras dapat membuatnya tidak valid; frasa adalah satu-satunya cara memulihkan.',
      myAutoNeedsMnemonic: 'Konfirmasi frasa terlebih dahulu sebelum mengaktifkan masuk otomatis.',
      myAutoUnavailable: 'Versi ini tidak mendukung tombol masuk otomatis; gunakan PIN.',
      logout: 'Keluar',
      logoutConfirm: 'Setelah keluar Anda kembali ke layar masuk; PIN atau frasa diperlukan lagi. Keluar?',
      myPinChange: 'Ubah PIN',
      myPinDisabled: 'PIN tidak dapat diubah selama masuk otomatis aktif.',
      myChangeOk: 'PIN diubah. Masuk dengan PIN baru.',
      myChangeFail: 'Gagal mengubah PIN.',
    },
    vi: {
      loading: 'Đang tải tài khoản…',
      start: 'Bắt đầu',
      fatal: 'Mô-đun tài khoản không khả dụng; quá trình khởi động bị dừng vì lý do an toàn. Hãy kiểm tra preload/main có tải auth-gate hay không.',
      seconds: 'giây',
      error: 'Thao tác thất bại',
      close: 'Đóng',
      quitBack: 'Quay lại ứng dụng',
      quitApp: 'Thoát chương trình',
      termsTitle: 'Quyền riêng tư và điều khoản',
      termsFallback: 'Hãy đọc và chấp nhận các điều khoản bên dưới để tiếp tục.',
      termsAgree: 'Tôi đã đọc và đồng ý với tất cả nội dung trên',
      termsContinue: 'Đồng ý và tiếp tục',
      termsDecline: 'Từ chối và thoát',
      termsRequired: 'Trước tiên hãy cuộn xuống cuối và đợi 3 giây.',
      termsGateHint: 'Cuộn đến cuối và đợi 3 giây rồi mới có thể đánh dấu.',
      loginTitle: 'Đăng nhập',
      loginBody: 'Cần đăng nhập mỗi lần khởi động. Thông tin đăng nhập nay do cụm từ ghi nhớ quản lý và không còn được lưu.',
      pinLogin: 'Đăng nhập bằng PIN',
      pinPlaceholder: 'PIN (4–20 chữ/số)',
      login: 'Đăng nhập',
      autoLogin: 'Đăng nhập tự động trên thiết bị này',
      autoLoginHint: 'Gắn với tài khoản hệ thống và phần cứng này. Bản nâng cấp hệ thống có thể làm nó mất hiệu lực; cụm từ ghi nhớ là cách duy nhất để khôi phục.',
      autoLoginInvalid: 'Đăng nhập tự động không còn hiệu lực (tài khoản hệ thống/CPU/phần cứng đã thay đổi). Hãy dùng PIN hoặc cụm từ ghi nhớ.',
      recover: 'Đăng nhập bằng cụm từ ghi nhớ',
      register: 'Tạo tài khoản mới',
      noAccount: 'Thiết bị này chưa có tài khoản. Hãy tạo mới hoặc khôi phục bằng cụm từ ghi nhớ của tài khoản đó.',
      registerTitle: 'Tạo tài khoản bằng cụm từ ghi nhớ',
      registerBody: 'Hệ thống sẽ tạo cụm từ 24 từ. Đây là cách duy nhất để khôi phục; hãy chuẩn bị giấy và bút.',
      registerBegin: 'Tạo cụm từ 24 từ',
      existingMnemonic: 'Tôi đã có cụm từ',
      existingAccountWarn: 'Thiết bị này đã có tài khoản. Nếu tiếp tục, tài khoản hiện tại và danh tính cục bộ sẽ bị thay thế (kho cũ sẽ được sao lưu trước). Tiếp tục?',
      back: 'Quay lại',
      recoverTitle: 'Nhập cụm từ ghi nhớ',
      recoverBody: 'Nhập cụm từ tiếng Anh 24 từ, hoặc bản pinyin (pinyin đầy đủ, không có số và ký hiệu).',
      recoverHint: 'Cụm từ chỉ được kiểm tra cục bộ và không bao giờ được tải lên.',
      verify: 'Kiểm tra cụm từ',
      badPin: 'PIN không đúng',
      locked: 'Đã khóa. Vui lòng thử lại sau.',
      lockHint: 'Sau {n} lần thất bại nữa, bạn sẽ bị khóa tạm thời',
      pinRule: 'PIN phải có 4–20 chữ/số và hai lần nhập phải khớp nhau.',
      pinMismatch: 'Hai PIN không khớp nhau.',
      badMnemonic: 'Cụm từ không hợp lệ (từ, thứ tự hoặc mã kiểm tra).',
      accountExists: 'Tài khoản đã tồn tại',
      vaultCorrupt: 'Kho xác thực bị hỏng hoặc không đọc được. Tệp gốc đã được giữ lại.',
      osUnavailable: 'Kho lưu trữ an toàn của hệ thống không khả dụng. Hãy dùng PIN; cụm từ ghi nhớ là cách duy nhất để khôi phục.',
      authManaged: 'Thao tác này do tài khoản dùng cụm từ ghi nhớ quản lý.',
      mnemonicTitle: 'Cụm từ ghi nhớ (24 từ)',
      mnemonicHidden: 'Cụm từ đã ẩn · nhấp để hiện',
      mnemonicBody: 'Hãy chép ngay bằng tay - hai bản ở hai nơi khác nhau. Không chụp màn hình, không sao chép, không lưu trên máy tính hay đám mây. Cụm từ là thông tin xác thực duy nhất của bạn; không có cách khôi phục!',
      mnemonicReminderBody: 'Lần trước bạn chọn “Nhắc sau”. Hãy chép ngay: hai bản trên giấy, ở hai nơi khác nhau. Không chụp màn hình, không sao chép, không lưu trên máy tính hay đám mây. Cụm từ là thông tin xác thực duy nhất của bạn; không có cách khôi phục!',
      pinyinFriendly: 'Cụm từ dạng pinyin',
      pinyinGroupTwo: 'Từ',
      pinyinGroupFour: 'Thành ngữ',
      later: 'Nhắc sau',
      saved: 'Tôi đã chép',
      laterConfirmTitle: 'Nhắc sau',
      laterConfirmBody: 'Bạn chưa xác nhận đã chép cụm từ. Lần khởi động tới, trang xác nhận sẽ hiện trước; đăng nhập tự động sẽ không khả dụng và bạn phải đặt PIN. Tiếp tục?',
      laterConfirmOk: 'Nhắc sau',
      confirmBody: 'Cụm từ là thông tin xác thực duy nhất của bạn; không có cách khôi phục! Cụm từ vừa hiển thị sẽ bị xóa và không thể xem lại. Bạn có chắc đã chép hai bản và cất ở hai nơi khác nhau?',
      confirmOk: 'Tôi đã chép',
      cancel: 'Hủy',
      pinTitle: 'Đặt PIN',
      pinBody: 'PIN dùng để đăng nhập trên thiết bị này (4–20 chữ/số, không ký tự đặc biệt).',
      pin1: 'Nhập PIN',
      pin2: 'Nhập lại PIN',
      autoEnable: 'Đăng nhập tự động (gắn thiết bị này)',
      autoDisabledHint: 'Chỉ có thể bật đăng nhập tự động sau khi đã xác nhận cụm từ.',
      autoOnHint: 'Thay phần cứng hoặc nâng cấp hệ thống có thể làm PIN mất hiệu lực; cụm từ ghi nhớ là cách duy nhất để khôi phục!',
      autoOffHint: 'Thay phần cứng hoặc nâng cấp hệ thống có thể làm PIN mất hiệu lực; cụm từ ghi nhớ là cách duy nhất để khôi phục!',
      confirmCreate: 'Hoàn tất đăng ký',
      confirmRecover: 'Hoàn tất khôi phục',
      autoLoginFail: 'Không thể đặt đăng nhập tự động. Hãy thử lại sau.',
      usernameTitle: 'Chọn tên của bạn',
      usernameBody: 'Tên này chỉ được lưu trên thiết bị này và là cách ứng dụng gọi bạn.',
      usernameLabel: 'Tên',
      usernameRule: '1–30 ký tự (chữ, số, dấu cách và emoji); không được để trống.',
      usernameFinish: 'Xong',
      usernameSaveFail: 'Không lưu được tên. Hãy thử lại.',
      viewTitle: 'Hiện cụm từ',
      viewBody: 'Hãy chắc chắn không ai đang nhìn. Cụm từ bị lộ sẽ chiếm tài khoản; sau khi đóng, nó không còn trên màn hình.',
      saveMnemonic: 'Lưu cụm từ',
      saveLater: 'Lưu sau',
      saveConfirm: 'Tôi đã chép và xác nhận',
      myTitle: 'Tài khoản và cụm từ ghi nhớ',
      myMnemonic: 'Cụm từ ghi nhớ',
      myConfirmed: 'Đã lưu',
      myUnconfirmed: 'Chưa xác nhận',
      myAuto: 'Đăng nhập tự động trên thiết bị này',
      myAutoHint: 'Đăng nhập tự động gắn với thiết bị này. Nâng cấp hệ thống hoặc thay phần cứng có thể làm nó mất hiệu lực; cụm từ là cách duy nhất để khôi phục.',
      myAutoNeedsMnemonic: 'Hãy xác nhận cụm từ trước khi bật đăng nhập tự động.',
      myAutoUnavailable: 'Phiên bản này không hỗ trợ công tắc đăng nhập tự động; hãy dùng PIN.',
      logout: 'Đăng xuất',
      logoutConfirm: 'Đăng xuất sẽ đưa bạn về màn hình đăng nhập; cần PIN hoặc cụm từ. Đăng xuất?',
      myPinChange: 'Đổi PIN',
      myPinDisabled: 'Không thể đổi PIN khi đang bật đăng nhập tự động.',
      myChangeOk: 'Đã đổi PIN. Hãy đăng nhập bằng PIN mới.',
      myChangeFail: 'Đổi PIN thất bại.',
    },
    th: {
      loading: 'กำลังโหลดบัญชี…',
      start: 'เริ่ม',
      fatal: 'โมดูลบัญชีไม่พร้อมใช้งาน ระบบหยุดการเริ่มต้นเพื่อความปลอดภัย โปรดตรวจสอบว่า preload/main โหลด auth-gate หรือไม่',
      seconds: 'วิ',
      error: 'ดำเนินการไม่สำเร็จ',
      close: 'ปิด',
      quitBack: 'กลับไปที่แอป',
      quitApp: 'ออกจากโปรแกรม',
      termsTitle: 'ความเป็นส่วนตัวและข้อกำหนด',
      termsFallback: 'โปรดอ่านและยอมรับข้อกำหนดด้านล่างเพื่อดำเนินการต่อ',
      termsAgree: 'ฉันได้อ่านและยอมรับทุกข้อข้างต้นแล้ว',
      termsContinue: 'ยอมรับและดำเนินการต่อ',
      termsDecline: 'ปฏิเสธและออก',
      termsRequired: 'โปรดเลื่อนลงไปด้านล่างสุดและรอ 3 วินาทีก่อน',
      termsGateHint: 'เลื่อนไปจนสุดและรอ 3 วินาที จึงจะสามารถทำเครื่องหมายได้',
      loginTitle: 'เข้าสู่ระบบ',
      loginBody: 'ต้องเข้าสู่ระบบทุกครั้งที่เปิดโปรแกรม ข้อมูลเข้าสู่ระบบได้รับการจัดการด้วยวลีช่วยจำแล้วและไม่ถูกบันทึกอีกต่อไป',
      pinLogin: 'เข้าสู่ระบบด้วย PIN',
      pinPlaceholder: 'PIN (4–20 ตัวอักษร/ตัวเลข)',
      login: 'เข้าสู่ระบบ',
      autoLogin: 'เข้าสู่ระบบอัตโนมัติบนอุปกรณ์นี้',
      autoLoginHint: 'ผูกกับบัญชีระบบและฮาร์ดแวร์นี้ การอัปเกรดระบบอาจทำให้ใช้ไม่ได้ วลีช่วยจำเป็นวิธีเดียวที่จะกู้คืน',
      autoLoginInvalid: 'การเข้าสู่ระบบอัตโนมัติใช้ไม่ได้แล้ว (บัญชีระบบ/CPU/ฮาร์ดแวร์เปลี่ยน) โปรดใช้ PIN หรือวลีช่วยจำ',
      recover: 'เข้าสู่ระบบด้วยวลีช่วยจำ',
      register: 'สร้างบัญชีใหม่',
      noAccount: 'อุปกรณ์นี้ยังไม่มีบัญชี โปรดสร้างใหม่หรือกู้คืนบัญชีที่มีอยู่ด้วยวลีช่วยจำ',
      registerTitle: 'สร้างบัญชีด้วยวลีช่วยจำ',
      registerBody: 'ระบบจะสร้างวลี 24 คำ นี่เป็นวิธีเดียวในการกู้คืน โปรดเตรียมกระดาษและปากกา',
      registerBegin: 'สร้างวลี 24 คำ',
      existingMnemonic: 'ฉันมีวลีอยู่แล้ว',
      existingAccountWarn: 'มีบัญชีอยู่บนอุปกรณ์นี้แล้ว หากดำเนินการต่อจะแทนที่บัญชีปัจจุบันและตัวตนในเครื่อง (ระบบจะสำรองคลังข้อมูลเดิมก่อน) ดำเนินการต่อหรือไม่',
      back: 'ย้อนกลับ',
      recoverTitle: 'ป้อนวลีช่วยจำของคุณ',
      recoverBody: 'ป้อนวลีภาษาอังกฤษ 24 คำ หรือรูปแบบพินอิน (พินอินเต็ม ไม่มีตัวเลขและสัญลักษณ์)',
      recoverHint: 'วลีนี้ตรวจสอบเฉพาะในเครื่องและไม่ถูกอัปโหลด',
      verify: 'ตรวจสอบวลี',
      badPin: 'PIN ไม่ถูกต้อง',
      locked: 'ถูกล็อก โปรดลองใหม่ภายหลัง',
      lockHint: 'หากผิดอีก {n} ครั้ง จะถูกล็อกชั่วคราว',
      pinRule: 'PIN ต้องมี 4–20 ตัวอักษร/ตัวเลข และทั้งสองช่องต้องตรงกัน',
      pinMismatch: 'PIN ทั้งสองไม่ตรงกัน',
      badMnemonic: 'วลีไม่ถูกต้อง (คำ ลำดับ หรือค่าตรวจสอบ)',
      accountExists: 'มีบัญชีอยู่แล้ว',
      vaultCorrupt: 'คลังข้อมูลยืนยันตัวตนเสียหายหรืออ่านไม่ได้ ไฟล์ต้นฉบับถูกเก็บไว้แล้ว',
      osUnavailable: 'ที่จัดเก็บระบบที่ปลอดภัยไม่พร้อมใช้งาน โปรดใช้ PIN วลีช่วยจำเป็นวิธีเดียวในการกู้คืน',
      authManaged: 'การดำเนินการนี้จัดการโดยบัญชีที่ใช้วลีช่วยจำ',
      mnemonicTitle: 'วลีช่วยจำ (24 คำ)',
      mnemonicHidden: 'ซ่อนวลีอยู่ · คลิกเพื่อแสดง',
      mnemonicBody: 'โปรดจดด้วยมือทันที - สองชุดในสถานที่ต่างกัน ห้ามจับภาพหน้าจอ ห้ามคัดลอก ห้ามเก็บในคอมพิวเตอร์หรือคลาวด์ วลีนี้เป็นข้อมูลยืนยันตัวตนเพียงอย่างเดียวของคุณ ไม่มีวิธีกู้คืน!',
      mnemonicReminderBody: 'ครั้งก่อนคุณเลือก “เตือนภายหลัง” โปรดจดตอนนี้: สองชุดบนกระดาษในสถานที่ต่างกัน ห้ามจับภาพหน้าจอ ห้ามคัดลอก ห้ามเก็บในคอมพิวเตอร์หรือคลาวด์ วลีนี้เป็นข้อมูลยืนยันตัวตนเพียงอย่างเดียวของคุณ ไม่มีวิธีกู้คืน!',
      pinyinFriendly: 'วลีแบบพินอิน',
      pinyinGroupTwo: 'คำ',
      pinyinGroupFour: 'สำนวน',
      later: 'เตือนภายหลัง',
      saved: 'จดแล้ว',
      laterConfirmTitle: 'เตือนภายหลัง',
      laterConfirmBody: 'คุณยังไม่ได้ยืนยันว่าจดวลีแล้ว ในการเปิดครั้งถัดไป หน้าต่างยืนยันจะแสดงก่อน การเข้าสู่ระบบอัตโนมัติจะใช้ไม่ได้ และคุณต้องตั้ง PIN ดำเนินการต่อหรือไม่',
      laterConfirmOk: 'เตือนภายหลัง',
      confirmBody: 'วลีนี้เป็นข้อมูลยืนยันตัวตนเพียงอย่างเดียวของคุณ ไม่มีวิธีกู้คืน! วลีที่เพิ่งแสดงจะถูกทำลายและไม่สามารถดูได้อีก คุณแน่ใจว่าจดสองชุดและเก็บไว้ในที่ต่างกันแล้วหรือไม่',
      confirmOk: 'จดแล้ว',
      cancel: 'ยกเลิก',
      pinTitle: 'ตั้ง PIN',
      pinBody: 'PIN ใช้สำหรับเข้าสู่ระบบบนอุปกรณ์นี้ (4–20 ตัวอักษร/ตัวเลข ไม่มีอักขระพิเศษ)',
      pin1: 'ป้อน PIN',
      pin2: 'ป้อน PIN อีกครั้ง',
      autoEnable: 'เข้าสู่ระบบอัตโนมัติ (ผูกอุปกรณ์นี้)',
      autoDisabledHint: 'สามารถเปิดการเข้าสู่ระบบอัตโนมัติได้หลังยืนยันวลีแล้วเท่านั้น',
      autoOnHint: 'การเปลี่ยนฮาร์ดแวร์หรืออัปเกรดระบบอาจทำให้ PIN ใช้ไม่ได้ วลีช่วยจำเป็นวิธีเดียวในการกู้คืน!',
      autoOffHint: 'การเปลี่ยนฮาร์ดแวร์หรืออัปเกรดระบบอาจทำให้ PIN ใช้ไม่ได้ วลีช่วยจำเป็นวิธีเดียวในการกู้คืน!',
      confirmCreate: 'ลงทะเบียนให้เสร็จสิ้น',
      confirmRecover: 'กู้คืนให้เสร็จสิ้น',
      autoLoginFail: 'ตั้งค่าการเข้าสู่ระบบอัตโนมัติไม่สำเร็จ โปรดลองใหม่ภายหลัง',
      usernameTitle: 'เลือกชื่อของคุณ',
      usernameBody: 'ชื่อนี้ถูกเก็บเฉพาะบนอุปกรณ์นี้ และเป็นชื่อที่แอปใช้เรียกคุณ',
      usernameLabel: 'ชื่อ',
      usernameRule: '1–30 ตัวอักษร (ตัวอักษร ตัวเลข ช่องว่าง และอีโมจิ) ต้องไม่ว่าง',
      usernameFinish: 'เสร็จสิ้น',
      usernameSaveFail: 'บันทึกชื่อไม่สำเร็จ โปรดลองอีกครั้ง',
      viewTitle: 'แสดงวลี',
      viewBody: 'ตรวจสอบว่าไม่มีใครกำลังดูอยู่ วลีที่รั่วไหลจะทำให้บัญชีถูกยึด และเมื่อปิดแล้วจะไม่เหลือบนหน้าจอ',
      saveMnemonic: 'บันทึกวลี',
      saveLater: 'บันทึกภายหลัง',
      saveConfirm: 'จดแล้วและยืนยัน',
      myTitle: 'บัญชีและวลีช่วยจำ',
      myMnemonic: 'วลีช่วยจำ',
      myConfirmed: 'บันทึกแล้ว',
      myUnconfirmed: 'ยังไม่ยืนยัน',
      myAuto: 'เข้าสู่ระบบอัตโนมัติบนอุปกรณ์นี้',
      myAutoHint: 'การเข้าสู่ระบบอัตโนมัติผูกกับอุปกรณ์นี้ การอัปเกรดระบบหรือเปลี่ยนฮาร์ดแวร์อาจทำให้ใช้ไม่ได้ วลีเป็นวิธีเดียวในการกู้คืน',
      myAutoNeedsMnemonic: 'โปรดยืนยันวลีก่อนเปิดการเข้าสู่ระบบอัตโนมัติ',
      myAutoUnavailable: 'เวอร์ชันนี้ไม่รองรับสวิตช์การเข้าสู่ระบบอัตโนมัติ โปรดใช้ PIN',
      logout: 'ออกจากระบบ',
      logoutConfirm: 'เมื่อออกจากระบบจะกลับไปที่หน้าเข้าสู่ระบบ และต้องใช้ PIN หรือวลีอีกครั้ง ออกจากระบบหรือไม่',
      myPinChange: 'เปลี่ยน PIN',
      myPinDisabled: 'ไม่สามารถเปลี่ยน PIN ได้ขณะเปิดการเข้าสู่ระบบอัตโนมัติ',
      myChangeOk: 'เปลี่ยน PIN แล้ว โปรดเข้าสู่ระบบด้วย PIN ใหม่',
      myChangeFail: 'เปลี่ยน PIN ไม่สำเร็จ',
    },
    hi: {
      loading: 'खाता लोड हो रहा है…',
      start: 'शुरू करें',
      fatal: 'खाता मॉड्यूल उपलब्ध नहीं है; सुरक्षा के कारण शुरुआत रोक दी गई है। जाँचें कि preload/main auth-gate लोड कर रहे हैं।',
      seconds: 'से',
      error: 'कार्रवाई विफल रही',
      close: 'बंद करें',
      quitBack: 'ऐप पर वापस जाएँ',
      quitApp: 'प्रोग्राम से बाहर निकलें',
      termsTitle: 'गोपनीयता और शर्तें',
      termsFallback: 'जारी रखने के लिए नीचे दी गई शर्तें पढ़ें और स्वीकार करें।',
      termsAgree: 'मैंने ऊपर सब कुछ पढ़ लिया है और सहमत हूँ',
      termsContinue: 'स्वीकार करें और जारी रखें',
      termsDecline: 'अस्वीकार करें और बाहर निकलें',
      termsRequired: 'पहले नीचे तक स्क्रॉल करें और 3 सेकंड प्रतीक्षा करें।',
      termsGateHint: 'अंत तक स्क्रॉल करें और 3 सेकंड प्रतीक्षा करें, तभी टिक कर सकते हैं।',
      loginTitle: 'साइन इन',
      loginBody: 'हर बार शुरू करने पर साइन इन आवश्यक है। क्रेडेंशियल अब स्मरण वाक्यांश द्वारा प्रबंधित होता है और सहेजा नहीं जाता।',
      pinLogin: 'PIN से साइन इन करें',
      pinPlaceholder: 'PIN (4–20 अक्षर/अंक)',
      login: 'साइन इन',
      autoLogin: 'इस डिवाइस पर स्वतः साइन इन',
      autoLoginHint: 'इस सिस्टम खाते और हार्डवेयर से बंधा है। सिस्टम अपग्रेड इसे अमान्य कर सकता है; स्मरण वाक्यांश ही वापसी का एकमात्र रास्ता है।',
      autoLoginInvalid: 'स्वतः साइन इन अब मान्य नहीं है (सिस्टम खाता/CPU/हार्डवेयर बदला)। PIN या स्मरण वाक्यांश का उपयोग करें।',
      recover: 'स्मरण वाक्यांश से साइन इन करें',
      register: 'नया खाता बनाएँ',
      noAccount: 'इस डिवाइस पर अभी कोई खाता नहीं है। नया बनाएँ या किसी मौजूदा खाते को उसके स्मरण वाक्यांश से पुनर्स्थापित करें।',
      registerTitle: 'स्मरण वाक्यांश खाता बनाएँ',
      registerBody: '24 शब्दों का वाक्यांश बनाया जाएगा। यही पुनर्स्थापन का एकमात्र तरीका है; कागज़ और कलम तैयार रखें।',
      registerBegin: '24 शब्दों का वाक्यांश बनाएँ',
      existingMnemonic: 'मेरे पास पहले से वाक्यांश है',
      existingAccountWarn: 'इस डिवाइस पर पहले से एक खाता है। जारी रखने पर मौजूदा खाता और स्थानीय पहचान बदल जाएगी (पुराना तिजोरी पहले बैकअप लिया जाएगा)। जारी रखें?',
      back: 'वापस',
      recoverTitle: 'अपना स्मरण वाक्यांश दर्ज करें',
      recoverBody: '24 शब्दों वाला अंग्रेज़ी वाक्यांश या पिनयिन रूप दर्ज करें (पूरा पिनयिन, बिना अंक और चिह्न)।',
      recoverHint: 'वाक्यांश केवल स्थानीय रूप से जाँचा जाता है और कभी अपलोड नहीं होता।',
      verify: 'वाक्यांश जाँचें',
      badPin: 'गलत PIN',
      locked: 'लॉक है। कृपया बाद में प्रयास करें।',
      lockHint: '{n} और असफल प्रयासों के बाद आप कुछ समय के लिए लॉक हो जाएँगे',
      pinRule: 'PIN में 4–20 अक्षर/अंक होने चाहिए और दोनों प्रविष्टियाँ समान होनी चाहिए।',
      pinMismatch: 'दोनों PIN समान नहीं हैं।',
      badMnemonic: 'अमान्य वाक्यांश (शब्द, क्रम या चेकसम)।',
      accountExists: 'खाता पहले से मौजूद है',
      vaultCorrupt: 'प्रमाणीकरण तिजोरी क्षतिग्रस्त या अपठनीय है। मूल फ़ाइल सुरक्षित रखी गई है।',
      osUnavailable: 'सुरक्षित सिस्टम भंडार उपलब्ध नहीं है। PIN का उपयोग करें; स्मरण वाक्यांश ही वापसी का एकमात्र रास्ता है।',
      authManaged: 'यह कार्रवाई स्मरण वाक्यांश खाते द्वारा प्रबंधित होती है।',
      mnemonicTitle: 'स्मरण वाक्यांश (24 शब्द)',
      mnemonicHidden: 'वाक्यांश छिपा है · दिखाने के लिए क्लिक करें',
      mnemonicBody: 'इसे अभी हाथ से लिखें — दो प्रतियाँ, अलग-अलग जगहों पर। स्क्रीनशॉट न लें, कॉपी न करें, कंप्यूटर या क्लाउड में न रखें। वाक्यांश ही आपका एकमात्र क्रेडेंशियल है; कोई पुनर्स्थापन नहीं!',
      mnemonicReminderBody: 'पिछली बार आपने “बाद में याद दिलाएँ” चुना था। अब इसे लिखें: कागज़ पर दो प्रतियाँ, अलग-अलग जगहों पर। स्क्रीनशॉट न लें, कॉपी न करें, कंप्यूटर या क्लाउड में न रखें। वाक्यांश ही आपका एकमात्र क्रेडेंशियल है; कोई पुनर्स्थापन नहीं!',
      pinyinFriendly: 'वाक्यांश पिनयिन में',
      pinyinGroupTwo: 'शब्द',
      pinyinGroupFour: 'मुहावरे',
      later: 'बाद में याद दिलाएँ',
      saved: 'लिख लिया',
      laterConfirmTitle: 'बाद में याद दिलाएँ',
      laterConfirmBody: 'आपने वाक्यांश लिखने की पुष्टि नहीं की। अगली बार शुरू करने पर पहले पुष्टि पृष्ठ दिखेगा; स्वतः साइन इन उपलब्ध नहीं होगा और आपको PIN सेट करना होगा। जारी रखें?',
      laterConfirmOk: 'बाद में याद दिलाएँ',
      confirmBody: 'वाक्यांश ही आपका एकमात्र क्रेडेंशियल है; कोई पुनर्स्थापन नहीं! अभी दिखाया गया वाक्यांश नष्ट हो जाएगा और फिर कभी नहीं दिखेगा। क्या आपने दो प्रतियाँ लिखकर अलग-अलग जगह रखी हैं?',
      confirmOk: 'लिख लिया',
      cancel: 'रद्द करें',
      pinTitle: 'PIN सेट करें',
      pinBody: 'PIN इस डिवाइस पर साइन इन के लिए है (4–20 अक्षर/अंक, विशेष चिह्न नहीं)।',
      pin1: 'PIN दर्ज करें',
      pin2: 'PIN दोहराएँ',
      autoEnable: 'स्वतः साइन इन (इस डिवाइस को बाँधें)',
      autoDisabledHint: 'वाक्यांश की पुष्टि के बाद ही स्वतः साइन इन चालू किया जा सकता है।',
      autoOnHint: 'हार्डवेयर बदलने या सिस्टम अपग्रेड से PIN अमान्य हो सकता है; स्मरण वाक्यांश ही वापसी का एकमात्र रास्ता है!',
      autoOffHint: 'हार्डवेयर बदलने या सिस्टम अपग्रेड से PIN अमान्य हो सकता है; स्मरण वाक्यांश ही वापसी का एकमात्र रास्ता है!',
      confirmCreate: 'पंजीकरण पूरा करें',
      confirmRecover: 'पुनर्स्थापन पूरा करें',
      autoLoginFail: 'स्वतः साइन इन सेट नहीं हो सका। बाद में पुनः प्रयास करें।',
      usernameTitle: 'अपना नाम चुनें',
      usernameBody: 'यह नाम केवल इस डिवाइस पर सहेजा जाता है और ऐप आपको इसी नाम से संबोधित करता है।',
      usernameLabel: 'नाम',
      usernameRule: '1–30 अक्षर (अक्षर, अंक, स्थान और इमोजी); खाली नहीं हो सकता।',
      usernameFinish: 'पूर्ण',
      usernameSaveFail: 'नाम सहेजा नहीं जा सका। पुनः प्रयास करें।',
      viewTitle: 'वाक्यांश दिखाएँ',
      viewBody: 'सुनिश्चित करें कि कोई न देख रहा हो। लीक हुआ वाक्यांश खाता हड़प सकता है; बंद करने के बाद यह स्क्रीन पर नहीं रहता।',
      saveMnemonic: 'वाक्यांश सहेजें',
      saveLater: 'बाद में सहेजें',
      saveConfirm: 'मैंने लिख लिया और पुष्टि करता/करती हूँ',
      myTitle: 'खाता और स्मरण वाक्यांश',
      myMnemonic: 'स्मरण वाक्यांश',
      myConfirmed: 'सहेजा गया',
      myUnconfirmed: 'पुष्टि नहीं हुई',
      myAuto: 'इस डिवाइस पर स्वतः साइन इन',
      myAutoHint: 'स्वतः साइन इन इस डिवाइस से बंधा है। सिस्टम अपग्रेड या हार्डवेयर बदलाव इसे अमान्य कर सकता है; वाक्यांश ही वापसी का एकमात्र रास्ता है।',
      myAutoNeedsMnemonic: 'स्वतः साइन इन चालू करने से पहले वाक्यांश की पुष्टि करें।',
      myAutoUnavailable: 'यह संस्करण स्वतः साइन इन स्विच का समर्थन नहीं करता; PIN का उपयोग करें।',
      logout: 'साइन आउट',
      logoutConfirm: 'साइन आउट करने पर आप साइन इन स्क्रीन पर लौटेंगे; फिर PIN या वाक्यांश चाहिए होगा। साइन आउट करें?',
      myPinChange: 'PIN बदलें',
      myPinDisabled: 'स्वतः साइन इन चालू रहने पर PIN नहीं बदला जा सकता।',
      myChangeOk: 'PIN बदल गया। नए PIN से साइन इन करें।',
      myChangeFail: 'PIN बदलना विफल रहा।',
    },
    ar: {
      loading: 'جارٍ تحميل الحساب…',
      start: 'ابدأ',
      fatal: 'وحدة الحساب غير متاحة؛ تم إيقاف بدء التشغيل لأسباب أمنية. تحقّق من أن preload/main يحمّلان auth-gate.',
      seconds: 'ث',
      error: 'فشلت العملية',
      close: 'إغلاق',
      quitBack: 'العودة إلى التطبيق',
      quitApp: 'إنهاء البرنامج',
      termsTitle: 'الخصوصية والشروط',
      termsFallback: 'يرجى قراءة الشروط أدناه والموافقة عليها للمتابعة.',
      termsAgree: 'لقد قرأت كل ما سبق وأوافق عليه',
      termsContinue: 'أوافق وأتابع',
      termsDecline: 'أرفض وأخرج',
      termsRequired: 'مرّر إلى الأسفل أولًا وانتظر 3 ثوانٍ.',
      termsGateHint: 'مرّر حتى النهاية وانتظر 3 ثوانٍ لتتمكن من التأشير.',
      loginTitle: 'تسجيل الدخول',
      loginBody: 'يلزم تسجيل الدخول عند كل تشغيل. أصبحت بيانات الاعتماد الآن تُدار بعبارة الاستذكار ولم تُعد تُحفظ.',
      pinLogin: 'تسجيل الدخول باستخدام PIN',
      pinPlaceholder: 'PIN (4–20 حرفًا/رقمًا)',
      login: 'تسجيل الدخول',
      autoLogin: 'تسجيل الدخول تلقائيًا على هذا الجهاز',
      autoLoginHint: 'مرتبط بحساب النظام هذا وبالعتاد. قد يُبطله ترقية النظام؛ عبارة الاستذكار هي السبيل الوحيد للاستعادة.',
      autoLoginInvalid: 'تسجيل الدخول التلقائي لم يعد صالحًا (تغيّر حساب النظام/المعالج/العتاد). استخدم PIN أو عبارة الاستذكار.',
      recover: 'تسجيل الدخول بعبارة الاستذكار',
      register: 'إنشاء حساب جديد',
      noAccount: 'لا يوجد حساب على هذا الجهاز بعد. أنشئ حسابًا جديدًا أو استعد حسابًا بعبارة الاستذكار الخاصة به.',
      registerTitle: 'إنشاء حساب بعبارة الاستذكار',
      registerBody: 'ستُنشأ عبارة من 24 كلمة. وهي السبيل الوحيد للاستعادة؛ جهّز ورقًا وقلمًا.',
      registerBegin: 'إنشاء عبارة من 24 كلمة',
      existingMnemonic: 'لديّ عبارة بالفعل',
      existingAccountWarn: 'يوجد حساب بالفعل على هذا الجهاز. المتابعة ستستبدل الحساب الحالي والهوية المحلية (سيُؤخذ نسخ احتياطي من الخزنة القديمة أولًا). هل تريد المتابعة؟',
      back: 'رجوع',
      recoverTitle: 'أدخل عبارة الاستذكار',
      recoverBody: 'أدخل العبارة الإنجليزية المكوّنة من 24 كلمة، أو نسخة البينيين (بينيين كامل، دون أرقام أو رموز).',
      recoverHint: 'تُتحقّق العبارة محليًا فقط ولا تُرسل أبدًا.',
      verify: 'التحقّق من العبارة',
      badPin: 'PIN غير صحيح',
      locked: 'مقفل. حاول لاحقًا.',
      lockHint: 'بعد {n} محاولات فاشلة أخرى ستُقفل لفترة',
      pinRule: 'يجب أن يتكوّن PIN من 4–20 حرفًا/رقمًا وأن يتطابق الإدخالان.',
      pinMismatch: 'رمزا PIN غير متطابقين.',
      badMnemonic: 'عبارة غير صالحة (الكلمات أو الترتيب أو المجموع الاختباري).',
      accountExists: 'الحساب موجود بالفعل',
      vaultCorrupt: 'خزنة المصادقة تالفة أو غير قابلة للقراءة. تم الاحتفاظ بالملف الأصلي.',
      osUnavailable: 'مخزن النظام الآمن غير متاح. استخدم PIN؛ عبارة الاستذكار هي السبيل الوحيد للاستعادة.',
      authManaged: 'تُدار هذه العملية بواسطة حساب عبارة الاستذكار.',
      mnemonicTitle: 'عبارة الاستذكار (24 كلمة)',
      mnemonicHidden: 'العبارة مخفية · انقر للعرض',
      mnemonicBody: 'اكتبها الآن بخط يدك — نسختان في مكانين مختلفين. لا تلتقط لقطة شاشة، ولا تنسخها، ولا تحفظها على الحاسوب أو السحابة. العبارة هي وثيقتك الوحيدة؛ لا يوجد أي استعادة!',
      mnemonicReminderBody: 'اخترت «التذكير لاحقًا» في المرة السابقة. اكتبها الآن: نسختان على ورق في مكانين مختلفين. لا تلتقط لقطة شاشة، ولا تنسخها، ولا تحفظها على الحاسوب أو السحابة. العبارة هي وثيقتك الوحيدة؛ لا يوجد أي استعادة!',
      pinyinFriendly: 'العبارة بالبينيين',
      pinyinGroupTwo: 'كلمات',
      pinyinGroupFour: 'تعبيرات',
      later: 'التذكير لاحقًا',
      saved: 'كتبتها',
      laterConfirmTitle: 'التذكير لاحقًا',
      laterConfirmBody: 'لم تؤكّد كتابة العبارة. عند التشغيل التالي ستظهر صفحة التأكيد أولًا؛ لن يتوفر تسجيل الدخول التلقائي وسيُطلب منك تعيين PIN. هل تريد المتابعة؟',
      laterConfirmOk: 'التذكير لاحقًا',
      confirmBody: 'العبارة هي وثيقتك الوحيدة؛ لا يوجد أي استعادة! ستُدمَّر العبارة المعروضة الآن ولن يمكن رؤيتها مجددًا. هل أنت متأكد أنك كتبت نسختين ووضعتهما في مكانين منفصلين؟',
      confirmOk: 'كتبتها',
      cancel: 'إلغاء',
      pinTitle: 'تعيين PIN',
      pinBody: 'يُستخدم PIN لتسجيل الدخول على هذا الجهاز (4–20 حرفًا/رقمًا، دون رموز خاصة).',
      pin1: 'أدخل PIN',
      pin2: 'أعد إدخال PIN',
      autoEnable: 'تسجيل الدخول التلقائي (ربط هذا الجهاز)',
      autoDisabledHint: 'لا يمكن تفعيل تسجيل الدخول التلقائي إلا بعد تأكيد العبارة.',
      autoOnHint: 'تغيير العتاد أو ترقية النظام قد يُبطل PIN؛ عبارة الاستذكار هي السبيل الوحيد للاستعادة!',
      autoOffHint: 'تغيير العتاد أو ترقية النظام قد يُبطل PIN؛ عبارة الاستذكار هي السبيل الوحيد للاستعادة!',
      confirmCreate: 'إتمام التسجيل',
      confirmRecover: 'إتمام الاستعادة',
      autoLoginFail: 'تعذّر إعداد تسجيل الدخول التلقائي. حاول لاحقًا.',
      usernameTitle: 'اختر اسمك',
      usernameBody: 'يُحفظ هذا الاسم على هذا الجهاز فقط، وهو الاسم الذي يناديك به التطبيق.',
      usernameLabel: 'الاسم',
      usernameRule: 'من 1 إلى 30 حرفًا (حروف وأرقام ومسافات وإيموجي)؛ لا يجوز أن يكون فارغًا.',
      usernameFinish: 'تم',
      usernameSaveFail: 'تعذّر حفظ الاسم. حاول مجددًا.',
      viewTitle: 'عرض العبارة',
      viewBody: 'تأكد من أن لا أحد يراقب. العبارة المسرّبة تتيح الاستيلاء على الحساب؛ بعد الإغلاق لن تبقى على الشاشة.',
      saveMnemonic: 'حفظ العبارة',
      saveLater: 'الحفظ لاحقًا',
      saveConfirm: 'كتبتها وأؤكد',
      myTitle: 'الحساب وعبارة الاستذكار',
      myMnemonic: 'عبارة الاستذكار',
      myConfirmed: 'محفوظة',
      myUnconfirmed: 'غير مؤكدة',
      myAuto: 'تسجيل الدخول تلقائيًا على هذا الجهاز',
      myAutoHint: 'تسجيل الدخول التلقائي مرتبط بهذا الجهاز. قد يُبطله ترقية النظام أو تغيير العتاد؛ العبارة هي السبيل الوحيد للاستعادة.',
      myAutoNeedsMnemonic: 'أكّد العبارة أولًا قبل تفعيل تسجيل الدخول التلقائي.',
      myAutoUnavailable: 'هذا الإصدار لا يدعم مفتاح تسجيل الدخول التلقائي؛ استخدم PIN.',
      logout: 'تسجيل الخروج',
      logoutConfirm: 'سيؤدي تسجيل الخروج إلى العودة إلى شاشة الدخول؛ ستُطلب PIN أو العبارة مجددًا. هل تريد الخروج؟',
      myPinChange: 'تغيير PIN',
      myPinDisabled: 'لا يمكن تغيير PIN أثناء تفعيل تسجيل الدخول التلقائي.',
      myChangeOk: 'تم تغيير PIN. سجّل الدخول باستخدام PIN الجديد.',
      myChangeFail: 'تعذّر تغيير PIN.',
    },
    fa: {
      loading: 'در حال بارگذاری حساب…',
      start: 'شروع',
      fatal: 'ماژول حساب در دسترس نیست؛ اجرا به دلایل امنیتی متوقف شد. بررسی کنید که preload/main ماژول auth-gate را بارگذاری میکنند.',
      seconds: 'ث',
      error: 'عملیات ناموفق بود',
      close: 'بستن',
      quitBack: 'بازگشت به برنامه',
      quitApp: 'خروج از برنامه',
      termsTitle: 'حریم خصوصی و شرایط',
      termsFallback: 'برای ادامه، شرایط زیر را بخوانید و بپذیرید.',
      termsAgree: 'همه موارد بالا را خواندهام و میپذیرم',
      termsContinue: 'میپذیرم و ادامه میدهم',
      termsDecline: 'رد میکنم و خارج میشوم',
      termsRequired: 'ابتدا تا انتها پیمایش کنید و ۳ ثانیه صبر کنید.',
      termsGateHint: 'تا انتها پیمایش کنید و ۳ ثانیه صبر کنید تا بتوانید تیک بزنید.',
      loginTitle: 'ورود',
      loginBody: 'در هر بار اجرا ورود لازم است. اکنون اطلاعات ورود با عبارت یادسپار مدیریت میشود و دیگر ذخیره نمیشود.',
      pinLogin: 'ورود با PIN',
      pinPlaceholder: 'PIN (۴ تا ۲۰ حرف/رقم)',
      login: 'ورود',
      autoLogin: 'ورود خودکار در این دستگاه',
      autoLoginHint: 'به این حساب سیستمی و سختافزار متصل است. ارتقای سیستم میتواند آن را باطل کند؛ عبارت یادسپار تنها راه بازیابی است.',
      autoLoginInvalid: 'ورود خودکار دیگر معتبر نیست (حساب سیستمی/پردازنده/سختافزار تغییر کرده). از PIN یا عبارت یادسپار استفاده کنید.',
      recover: 'ورود با عبارت یادسپار',
      register: 'ایجاد حساب جدید',
      noAccount: 'هنوز حسابی روی این دستگاه نیست. حساب جدید بسازید یا حسابی را با عبارت یادسپار آن بازیابی کنید.',
      registerTitle: 'ایجاد حساب با عبارت یادسپار',
      registerBody: 'یک عبارت ۲۴ کلمهای ساخته میشود. این تنها راه بازیابی است؛ کاغذ و قلم آماده کنید.',
      registerBegin: 'ساخت عبارت ۲۴ کلمهای',
      existingMnemonic: 'از قبل عبارت دارم',
      existingAccountWarn: 'از قبل حسابی روی این دستگاه وجود دارد. ادامه، حساب فعلی و هویت محلی را جایگزین میکند (ابتدا از گاوصندوق قدیمی نسخه پشتیبان گرفته میشود). ادامه میدهید؟',
      back: 'بازگشت',
      recoverTitle: 'عبارت یادسپار خود را وارد کنید',
      recoverBody: 'عبارت انگلیسی ۲۴ کلمهای یا نسخه پینیین را وارد کنید (پینیین کامل، بدون رقم و علامت).',
      recoverHint: 'عبارت فقط بهصورت محلی بررسی میشود و هرگز بارگذاری نمیشود.',
      verify: 'بررسی عبارت',
      badPin: 'PIN نادرست',
      locked: 'قفل شده است. بعداً دوباره تلاش کنید.',
      lockHint: 'پس از {n} تلاش ناموفق دیگر، مدتی قفل میشوید',
      pinRule: 'PIN باید ۴ تا ۲۰ حرف/رقم باشد و هر دو ورودی یکسان باشند.',
      pinMismatch: 'دو PIN یکسان نیستند.',
      badMnemonic: 'عبارت نامعتبر است (کلمات، ترتیب یا چکسام).',
      accountExists: 'حساب از قبل وجود دارد',
      vaultCorrupt: 'گاوصندوق احراز هویت خراب یا غیرقابلخواندن است. فایل اصلی نگهداری شد.',
      osUnavailable: 'انبار امن سیستم در دسترس نیست. از PIN استفاده کنید؛ عبارت یادسپار تنها راه بازیابی است.',
      authManaged: 'این عملیات توسط حساب عبارت یادسپار مدیریت میشود.',
      mnemonicTitle: 'عبارت یادسپار (۲۴ کلمه)',
      mnemonicHidden: 'عبارت پنهان است · برای نمایش کلیک کنید',
      mnemonicBody: 'همین حالا آن را با دست بنویسید — دو نسخه در دو جای مختلف. اسکرینشات نگیرید، کپی نکنید و روی رایانه یا ابر ذخیره نکنید. عبارت تنها مدرک شماست؛ هیچ بازیابیای وجود ندارد!',
      mnemonicReminderBody: 'بار قبل «یادآوری بعداً» را انتخاب کردید. اکنون آن را بنویسید: دو نسخه روی کاغذ در دو جای مختلف. اسکرینشات نگیرید، کپی نکنید و روی رایانه یا ابر ذخیره نکنید. عبارت تنها مدرک شماست؛ هیچ بازیابیای وجود ندارد!',
      pinyinFriendly: 'عبارت به پینیین',
      pinyinGroupTwo: 'کلمات',
      pinyinGroupFour: 'اصطلاحات',
      later: 'یادآوری بعداً',
      saved: 'نوشتم',
      laterConfirmTitle: 'یادآوری بعداً',
      laterConfirmBody: 'نوشتن عبارت را تأیید نکردید. در اجرای بعدی ابتدا صفحه تأیید نمایش داده میشود؛ ورود خودکار در دسترس نخواهد بود و باید PIN تعیین کنید. ادامه میدهید؟',
      laterConfirmOk: 'یادآوری بعداً',
      confirmBody: 'عبارت تنها مدرک شماست؛ هیچ بازیابیای وجود ندارد! عبارتی که همین حالا نمایش داده شد نابود میشود و دیگر دیده نخواهد شد. مطمئنید دو نسخه نوشته و در دو جای جدا گذاشتهاید؟',
      confirmOk: 'نوشتم',
      cancel: 'لغو',
      pinTitle: 'تعیین PIN',
      pinBody: 'PIN برای ورود روی این دستگاه است (۴ تا ۲۰ حرف/رقم، بدون نویسه ویژه).',
      pin1: 'PIN را وارد کنید',
      pin2: 'تکرار PIN',
      autoEnable: 'ورود خودکار (اتصال این دستگاه)',
      autoDisabledHint: 'ورود خودکار فقط پس از تأیید عبارت قابل فعالسازی است.',
      autoOnHint: 'تغییر سختافزار یا ارتقای سیستم میتواند PIN را باطل کند؛ عبارت یادسپار تنها راه بازیابی است!',
      autoOffHint: 'تغییر سختافزار یا ارتقای سیستم میتواند PIN را باطل کند؛ عبارت یادسپار تنها راه بازیابی است!',
      confirmCreate: 'پایان ثبتنام',
      confirmRecover: 'پایان بازیابی',
      autoLoginFail: 'تنظیم ورود خودکار ممکن نشد. بعداً دوباره تلاش کنید.',
      usernameTitle: 'نام خود را انتخاب کنید',
      usernameBody: 'این نام فقط روی این دستگاه ذخیره میشود و برنامه شما را با آن صدا میزند.',
      usernameLabel: 'نام',
      usernameRule: '۱ تا ۳۰ نویسه (حرف، رقم، فاصله و ایموجی)؛ نمیتواند خالی باشد.',
      usernameFinish: 'پایان',
      usernameSaveFail: 'ذخیره نام ممکن نشد. دوباره تلاش کنید.',
      viewTitle: 'نمایش عبارت',
      viewBody: 'مطمئن شوید کسی نگاه نمیکند. عبارت لو رفته حساب را تسخیر میکند؛ پس از بستن روی صفحه نمیماند.',
      saveMnemonic: 'ذخیره عبارت',
      saveLater: 'ذخیره بعداً',
      saveConfirm: 'نوشتم و تأیید میکنم',
      myTitle: 'حساب و عبارت یادسپار',
      myMnemonic: 'عبارت یادسپار',
      myConfirmed: 'ذخیرهشده',
      myUnconfirmed: 'تأییدنشده',
      myAuto: 'ورود خودکار در این دستگاه',
      myAutoHint: 'ورود خودکار به این دستگاه متصل است. ارتقای سیستم یا تغییر سختافزار میتواند آن را باطل کند؛ عبارت تنها راه بازیابی است.',
      myAutoNeedsMnemonic: 'ابتدا عبارت را تأیید کنید، سپس ورود خودکار را روشن کنید.',
      myAutoUnavailable: 'این نسخه از کلید ورود خودکار پشتیبانی نمیکند؛ از PIN استفاده کنید.',
      logout: 'خروج',
      logoutConfirm: 'با خروج به صفحه ورود بازمیگردید؛ دوباره PIN یا عبارت لازم است. خارج میشوید؟',
      myPinChange: 'تغییر PIN',
      myPinDisabled: 'تا زمانی که ورود خودکار روشن است، PIN قابل تغییر نیست.',
      myChangeOk: 'PIN تغییر کرد. با PIN جدید وارد شوید.',
      myChangeFail: 'تغییر PIN ناموفق بود.',
    },
  };
  /* R67_DICT_END */

  /**
   * 语言标签 → 语言包 id。必须覆盖 LOCALES / SUPPORTED_LOCALES 的全部 27 种，
   * 否则「点了没反应」：resolve 回 zh-CN 与当前 state.locale 相同，
   * handleAction('lang-pick') 里 `if (code !== state.locale)` 判否，直接 return。
   * 判定顺序与 packages/app-shell/src/i18n/locales.ts 的 jiexiYuyan() 保持一致。
   */
  function resolveLocale(code) {
    const raw = String(code || '').trim();
    const low = raw.toLowerCase().replace('_', '-');
    if (!low) return 'zh-CN';
    // 精确命中已支持的语言包 id（最常见路径，避免被前缀规则误判）
    const exact = LOCALES.find((it) => it[0].toLowerCase() === low);
    if (exact) return exact[0];
    if (low.startsWith('zh-tw') || low.startsWith('zh-hant') || low.startsWith('zh-hk') || low.startsWith('zh-mo')) return 'zh-TW';
    if (low.startsWith('zh')) return 'zh-CN';
    if (low.startsWith('ja')) return 'ja';
    if (low.startsWith('ko')) return 'ko';
    if (low.startsWith('ru')) return 'ru';
    if (low.startsWith('es')) return 'es';
    if (low.startsWith('fr')) return 'fr';
    if (low.startsWith('pt')) return 'pt';
    if (low.startsWith('eo')) return 'eo';
    if (low.startsWith('de')) return 'de';
    if (low.startsWith('it')) return 'it';
    if (low.startsWith('nl')) return 'nl';
    if (low.startsWith('pl')) return 'pl';
    if (low.startsWith('sv')) return 'sv';
    if (low.startsWith('cs') || low.startsWith('cz')) return 'cs';
    if (low.startsWith('hu')) return 'hu';
    if (low.startsWith('da')) return 'da';
    if (low.startsWith('nb') || low.startsWith('no') || low.startsWith('nn')) return 'nb';
    if (low.startsWith('tr')) return 'tr';
    if (low.startsWith('uk')) return 'uk';
    if (low.startsWith('id') || low.startsWith('in')) return 'id';
    if (low.startsWith('vi')) return 'vi';
    if (low.startsWith('th')) return 'th';
    if (low.startsWith('hi')) return 'hi';
    if (low.startsWith('ar')) return 'ar';
    if (low.startsWith('fa') || low.startsWith('per')) return 'fa';
    if (low.startsWith('en')) return 'en-US';
    return 'zh-CN';
  }

  function dict() {
    return DICTS[resolveLocale(state.locale)] || DICTS['en-US'] || DICTS['zh-CN'];
  }
  /**
   * 回退链：当前语言 → 英文 → 中文。
   * 不能让非中文语境直接掉到中文兜底（27 语言里只要缺一键就会串味），
   * 英文是这 97 键的安全中间层。
   */
  function t(key) {
    const d = dict();
    if (d && d[key] != null && String(d[key]).trim()) return d[key];
    const en = DICTS['en-US'];
    if (en && en[key] != null && String(en[key]).trim()) return en[key];
    return DICTS['zh-CN'][key] || key;
  }
  /**
   * 第 78 轮：新增文案统一走 tOr(key, fallback) —— 先查当前语言的内置字典，
   * 再查已加载的 i18n 语言包（主进程全量语言包 strings），最后才落到中文兜底。
   * 这样在用户补齐 i18n 键之前界面也不会露出 key 名。
   */
  function tOr(key, fallback) {
    const d = dict();
    if (d && d[key] != null && String(d[key]).trim()) return d[key];
    const p = state.pack;
    if (p && typeof p === 'object' && typeof p[key] === 'string' && p[key].trim()) return p[key];
    const zh = DICTS['zh-CN'][key];
    return zh != null && String(zh).trim() ? zh : fallback;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function wordsOf(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }
  function errorText(code, extra) {
    const map = {
      'bad-pin': t('badPin'),
      locked: t('locked'),
      'binding-invalid': t('autoLoginInvalid'),
      'bad-mnemonic': t('badMnemonic'),
      'pin-too-short': t('pinRule'),
      'pin-too-long': t('pinRule'),
      'pin-charset': t('pinRule'),
      'pin-mismatch': t('pinMismatch'),
      'account-exists': t('accountExists'),
      'vault-corrupt': t('vaultCorrupt'),
      'os-protection-unavailable': t('osUnavailable'),
      'os-protection-failed': t('osUnavailable'),
      'auto-login-failed': t('autoLoginFail'),
      'auto-login-requires-confirmed-mnemonic': t('autoDisabledHint'),
      'auto-login-enabled': t('myPinDisabled'),
      'auth-managed': t('authManaged'),
      'no-account': t('noAccount'),
      'pin-not-configured': t('badPin'),
      'auth-unavailable': t('fatal'),
      'bad-username': t('usernameRule'),
      'profile-write-failed': t('usernameSaveFail'),
      'no-pending-registration': t('error'),
      'no-pending-recovery': t('error'),
    };
    return map[code] || String(code || t('error'));
  }

  // ── first-run pixel scene ───────────────────────────────────────────────

  function beastSvg(kind, y, scale, delay, opts) {
    opts = opts || {};
    const ox = kind === 'ox';
    const dark = ox ? '#6f4a30' : '#3c4350';
    const mid = ox ? '#8a603f' : '#596173';
    const deep = ox ? '#4b3120' : '#262b35';
    const hoof = ox ? '#2c1d13' : '#171b22';
    const eye = ox ? '#ffcf6e' : '#cfe3ff';
    const head = ox
      ? `<rect x="56" y="-8" width="20" height="22" fill="${mid}"/>
         <rect x="70" y="-4" width="12" height="5" fill="#d8cbb0"/>
         <rect x="70" y="6" width="12" height="5" fill="#d8cbb0"/>
         <rect x="62" y="11" width="12" height="3" fill="${deep}"/>`
      : `<rect x="52" y="-14" width="14" height="24" fill="${mid}"/>
         <rect x="62" y="-18" width="24" height="14" fill="${mid}"/>
         <rect x="52" y="-20" width="9" height="20" fill="${deep}"/>
         <rect x="82" y="-14" width="4" height="5" fill="${deep}"/>
         <rect x="58" y="-24" width="5" height="8" fill="${deep}"/>`;
    const tail = ox
      ? `<g class="warmyAuthTail">
           <rect x="0" y="8" width="10" height="6" fill="${deep}"/>
           <rect x="0" y="16" width="7" height="10" fill="${deep}"/>
         </g>`
      : `<g class="warmyAuthTail">
           <rect x="-6" y="4" width="8" height="22" fill="${deep}"/>
           <rect x="-11" y="2" width="6" height="12" fill="${dark}"/>
         </g>`;
    return `<g class="warmyAuthRunner" style="animation-delay:${delay}">
      <g transform="translate(0 ${y}) scale(${scale})" opacity="${opts.opacity == null ? 1 : opts.opacity}">
        <rect x="-4" y="57" width="86" height="6" fill="#070503" opacity=".34"/>
        <g class="warmyAuthBob">
          ${tail}
          ${head}
          <rect x="8" y="2" width="62" height="32" fill="${dark}"/>
          <rect x="12" y="6" width="46" height="9" fill="${mid}"/>
          <rect x="8" y="29" width="48" height="5" fill="${deep}" opacity=".55"/>
          <g class="warmyAuthLegA">
            <rect x="18" y="34" width="8" height="18" fill="${deep}"/>
            <rect x="13" y="50" width="16" height="6" fill="${hoof}"/>
          </g>
          <g class="warmyAuthLegB">
            <rect x="46" y="34" width="8" height="18" fill="${deep}"/>
            <rect x="41" y="50" width="16" height="6" fill="${hoof}"/>
          </g>
          <rect x="64" y="14" width="5" height="5" fill="${eye}"/>
          <g class="warmyAuthDust">
            <rect x="-8" y="42" width="9" height="6" fill="#6b5a44"/>
            <rect x="-22" y="48" width="13" height="6" fill="#51422f"/>
            <rect x="-40" y="45" width="8" height="5" fill="#3d3225"/>
          </g>
          <g class="warmyAuthDust warmyAuthDustB">
            <rect x="6" y="51" width="11" height="5" fill="#5b4a35"/>
            <rect x="34" y="53" width="8" height="4" fill="#403326"/>
          </g>
        </g>
      </g>
    </g>`;
  }

  /** 亮色首启场景：晨曦、云、山、一匹站着的牛马。等用户在预览页选定后再替换。 */
  function firstRunSceneLight() {
    return `<div class="warmyAuthScene warmyAuthSceneLight" aria-hidden="true">
      <svg class="warmyAuthSceneSvg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <linearGradient id="warmyAuthSkyLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fdf4e8"/>
            <stop offset=".42" stop-color="#f8e6ea"/>
            <stop offset=".74" stop-color="#e4e9f8"/>
            <stop offset="1" stop-color="#d6e4f6"/>
          </linearGradient>
        </defs>
        <rect width="960" height="540" fill="url(#warmyAuthSkyLight)"/>
        <g fill="#e8c98f" opacity=".55">
          <circle cx="120" cy="70" r="2"/><circle cx="210" cy="110" r="1.5"/>
          <circle cx="300" cy="56" r="2"/><circle cx="470" cy="86" r="1.5"/>
          <circle cx="620" cy="48" r="2"/><circle cx="690" cy="120" r="1.5"/>
          <circle cx="860" cy="64" r="2"/><circle cx="900" cy="140" r="1.5"/>
        </g>
        <circle class="warmyAuthLightSun" cx="772" cy="110" r="54" fill="#ffe3a8"/>
        <circle cx="772" cy="110" r="40" fill="#fff2cf"/>
        <g class="warmyAuthCloudA" fill="#ffffff" opacity=".92">
          <ellipse cx="180" cy="150" rx="92" ry="24"/>
          <ellipse cx="240" cy="136" rx="62" ry="20"/>
          <ellipse cx="124" cy="138" rx="52" ry="18"/>
        </g>
        <g class="warmyAuthCloudB" fill="#ffffff" opacity=".8">
          <ellipse cx="760" cy="232" rx="110" ry="26"/>
          <ellipse cx="830" cy="218" rx="62" ry="20"/>
          <ellipse cx="690" cy="220" rx="58" ry="18"/>
        </g>
        <g class="warmyAuthCloudA" fill="#ffffff" opacity=".65" style="animation-delay:-6s">
          <ellipse cx="520" cy="300" rx="86" ry="20"/>
          <ellipse cx="570" cy="288" rx="48" ry="16"/>
        </g>
        <path d="M0 404 L92 330 L176 398 L268 318 L364 402 L462 342 L560 404 L662 350 L760 406 L858 360 L960 406 L960 540 L0 540 Z" fill="#cfd9e8"/>
        <path d="M0 446 L120 382 L242 444 L364 392 L486 446 L608 398 L730 448 L850 404 L960 448 L960 540 L0 540 Z" fill="#b9c8dc"/>
        <rect y="468" width="960" height="72" fill="#f2eadc"/>
        <path d="M0 468 Q120 456 240 468 T480 468 T720 468 T960 468 L960 486 L0 486 Z" fill="#e8dcc9" opacity=".8"/>
        <g class="warmyAuthLightHorse" transform="translate(430 378)">
          <ellipse cx="75" cy="86" rx="66" ry="6" fill="#d8c9b3" opacity=".5"/>
          <g class="warmyAuthBob">
            <image class="warmyAuthLightHorseImg" href="./icons/logo-tight.png" x="0" y="0" width="150" height="86"
                   preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated"/>
          </g>
        </g>
        <g fill="#8c9ab5" opacity=".6">
          <path d="M300 210 q6 -6 12 0 q-6 -2 -12 0"/>
          <path d="M334 196 q5 -5 10 0 q-5 -2 -10 0"/>
        </g>
      </svg>
    </div>`;
  }

  function firstRunScene() {
    const stars = [
      [46, 38, 2, .55], [90, 64, 3, .8], [142, 102, 2, .5], [180, 112, 2, .7],
      [238, 48, 3, .6], [300, 52, 4, .85], [356, 92, 2, .5], [420, 96, 3, .7],
      [480, 36, 2, .6], [540, 44, 3, .9], [596, 86, 2, .45], [650, 120, 3, .65],
      [706, 52, 2, .55], [760, 100, 3, .75], [866, 36, 2, .5], [900, 108, 3, .8],
      [252, 164, 2, .4], [372, 146, 2, .5], [484, 164, 3, .7], [604, 152, 2, .45],
      [720, 176, 2, .5], [936, 174, 2, .4], [34, 124, 2, .35], [832, 214, 2, .3],
    ];
    const starRects = stars.map(([x, y, s, o]) =>
      `<rect x="${x}" y="${y}" width="${s}" height="${s}" opacity="${o}"/>`).join('');
    return `<div class="warmyAuthScene" aria-hidden="true">
      <svg class="warmyAuthSceneSvg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <linearGradient id="warmyAuthSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#070b14"/>
            <stop offset=".55" stop-color="#101828"/>
            <stop offset="1" stop-color="#1b1410"/>
          </linearGradient>
        </defs>
        <rect width="960" height="540" fill="url(#warmyAuthSky)"/>
        <g class="warmyAuthStars" fill="#9fb0cd">${starRects}</g>
        <g class="warmyAuthMeteor" fill="#dbe7ff">
          <g transform="translate(618 84) rotate(19)">
            <rect x="0" y="0" width="40" height="3" opacity=".85"/>
            <rect x="40" y="0" width="15" height="3" opacity=".42"/>
            <rect x="55" y="0" width="8" height="3" opacity=".2"/>
          </g>
        </g>
        <g class="warmyAuthMeteor warmyAuthMeteorB" fill="#dbe7ff" style="animation-delay:-4.1s">
          <g transform="translate(386 52) rotate(14)">
            <rect x="0" y="0" width="26" height="2" opacity=".7"/>
            <rect x="26" y="0" width="10" height="2" opacity=".32"/>
          </g>
        </g>
        <g class="warmyAuthCloud warmyAuthCloudA" fill="#1a2231" opacity=".9">
          <rect x="72" y="146" width="82" height="12"/>
          <rect x="90" y="136" width="48" height="10"/>
          <rect x="112" y="126" width="22" height="10"/>
          <rect x="64" y="156" width="48" height="6" opacity=".55"/>
        </g>
        <g class="warmyAuthCloud warmyAuthCloudB" fill="#18202d" opacity=".8">
          <rect x="596" y="196" width="104" height="12"/>
          <rect x="620" y="186" width="58" height="10"/>
          <rect x="646" y="176" width="28" height="10"/>
          <rect x="586" y="206" width="54" height="6" opacity=".5"/>
        </g>
        <g class="warmyAuthMoon">
          <g fill="#ead7a7">
            <rect x="828" y="52" width="16" height="8"/>
            <rect x="820" y="60" width="32" height="8"/>
            <rect x="812" y="68" width="48" height="8"/>
            <rect x="812" y="76" width="48" height="8"/>
            <rect x="820" y="84" width="32" height="8"/>
            <rect x="828" y="92" width="16" height="8"/>
          </g>
          <rect x="812" y="68" width="4" height="16" fill="#f5e6c2" opacity=".6"/>
          <g fill="#c9b283">
            <rect x="828" y="60" width="8" height="8"/>
            <rect x="836" y="76" width="8" height="8"/>
            <rect x="824" y="88" width="8" height="7"/>
          </g>
        </g>
        <path d="M0 340 L58 312 L124 338 L196 300 L268 336 L344 306 L420 340 L500 312 L580 344 L660 308 L742 342 L824 314 L904 344 L960 322 L960 540 L0 540 Z" fill="#0c111a"/>
        <path d="M0 352 L74 300 L142 338 L224 286 L310 340 L402 302 L492 348 L590 292 L686 344 L780 304 L870 348 L960 316 L960 540 L0 540 Z" fill="#141a25"/>
        <path d="M0 386 L96 346 L190 382 L300 340 L420 384 L540 348 L660 388 L780 350 L900 388 L960 368 L960 540 L0 540 Z" fill="#10151e"/>
        <rect y="424" width="960" height="116" fill="#191511"/>
        <g class="warmyAuthGroundTiles" fill="#2a2119">
          <rect x="0" y="426" width="86" height="5"/><rect x="106" y="438" width="56" height="4"/>
          <rect x="184" y="428" width="96" height="5"/><rect x="302" y="446" width="70" height="4"/>
          <rect x="394" y="430" width="88" height="5"/><rect x="504" y="440" width="62" height="4"/>
          <rect x="588" y="428" width="98" height="5"/><rect x="708" y="446" width="66" height="4"/>
          <rect x="796" y="430" width="92" height="5"/><rect x="910" y="440" width="60" height="4"/>
          <rect x="982" y="428" width="86" height="5"/><rect x="1088" y="438" width="56" height="4"/>
          <rect x="40" y="418" width="4" height="7"/><rect x="47" y="414" width="3" height="10"/>
          <rect x="366" y="416" width="3" height="9"/><rect x="372" y="420" width="4" height="6"/>
          <rect x="702" y="418" width="3" height="8"/><rect x="708" y="414" width="4" height="10"/>
          <rect x="1046" y="418" width="4" height="7"/><rect x="1053" y="414" width="3" height="9"/>
        </g>
        <g class="warmyAuthGroundSpeed" fill="#3b2e20">
          <rect x="0" y="462" width="120" height="4"/><rect x="154" y="474" width="74" height="3"/>
          <rect x="252" y="462" width="120" height="4"/><rect x="406" y="476" width="74" height="3"/>
          <rect x="504" y="462" width="120" height="4"/><rect x="658" y="474" width="74" height="3"/>
          <rect x="756" y="462" width="120" height="4"/><rect x="910" y="476" width="74" height="3"/>
          <rect x="1008" y="462" width="120" height="4"/><rect x="1162" y="474" width="74" height="3"/>
        </g>
        <g fill="#e8a15d">
          <rect class="warmyAuthEmber" x="220" y="420" width="3" height="3"/>
          <rect class="warmyAuthEmber" x="520" y="400" width="2" height="2" style="animation-delay:-1.2s"/>
          <rect class="warmyAuthEmber" x="824" y="428" width="3" height="3" style="animation-delay:-2.1s"/>
        </g>
        <g class="warmyAuthCommander" transform="translate(154 318)">
          <rect x="-20" y="104" width="86" height="8" fill="#080604" opacity=".5"/>
          <g class="warmyAuthCape" fill="#4d2b28">
            <rect x="-14" y="40" width="18" height="44"/>
            <rect x="-20" y="52" width="10" height="30" fill="#3c211f"/>
          </g>
          <rect x="6" y="80" width="11" height="28" fill="#2c3442"/>
          <rect x="30" y="80" width="11" height="28" fill="#2c3442"/>
          <rect x="2" y="100" width="19" height="7" fill="#171b22"/>
          <rect x="27" y="100" width="19" height="7" fill="#171b22"/>
          <rect x="2" y="40" width="44" height="46" fill="#7a5134"/>
          <rect x="10" y="46" width="28" height="8" fill="#a87654"/>
          <rect x="2" y="66" width="44" height="6" fill="#4d2b28"/>
          <rect x="20" y="66" width="8" height="6" fill="#d8a24a"/>
          <rect x="12" y="14" width="24" height="24" fill="#e8c39a"/>
          <rect x="10" y="8" width="28" height="8" fill="#2c3442"/>
          <rect x="7" y="14" width="34" height="4" fill="#202632"/>
          <rect x="18" y="24" width="4" height="4" fill="#2a2119"/>
          <rect x="27" y="30" width="6" height="2" fill="#b9815f"/>
          <g class="warmyAuthCommandArm">
            <rect x="42" y="44" width="30" height="8" fill="#e8c39a"/>
            <rect x="66" y="18" width="6" height="36" fill="#6b4a2e"/>
            <g class="warmyAuthBanner">
              <path d="M72 14 L124 14 L108 31 L124 48 L72 48 Z" fill="#b34b3f"/>
              <path d="M77 20 L116 20 L103 31 L116 42 L77 42 Z" fill="#d97757"/>
              <rect x="92" y="25" width="18" height="12" fill="#f4ddbd"/>
              <rect x="87" y="21" width="5" height="9" fill="#f4ddbd"/>
              <rect x="110" y="21" width="5" height="9" fill="#f4ddbd"/>
              <rect x="97" y="30" width="2" height="2" fill="#7d2f2f"/>
              <rect x="104" y="30" width="2" height="2" fill="#7d2f2f"/>
              <rect x="96" y="35" width="10" height="2" fill="#7d2f2f"/>
            </g>
          </g>
          <g class="warmyAuthShout" fill="#e2b28c">
            <rect x="46" y="20" width="10" height="4"/>
            <rect x="57" y="13" width="8" height="3"/>
            <rect x="43" y="29" width="7" height="3"/>
          </g>
          <g class="warmyAuthOrderMarks" fill="#e2b28c">
            <rect x="126" y="28" width="14" height="5"/>
            <rect x="146" y="42" width="10" height="4"/>
            <rect x="132" y="56" width="8" height="4"/>
          </g>
        </g>
        ${beastSvg('ox', 388, 0.66, '-0.45s', { opacity: .55 })}
        ${beastSvg('horse', 380, 0.8, '-2.15s', { opacity: .8 })}
        ${beastSvg('horse', 374, 0.9, '-1.25s')}
        ${beastSvg('ox', 372, 0.94, '-2.85s')}
        ${beastSvg('horse', 370, 0.98, '-0.95s')}
        ${beastSvg('ox', 365, 1.06, '-1.8s')}
        <g class="warmyAuthLogoMascot">
          <g transform="translate(660 338)">
            <rect x="12" y="82" width="130" height="7" fill="#070503" opacity=".38"/>
            <g class="warmyAuthBob">
              <image href="./icons/logo-tight.png" x="0" y="0" width="150" height="86" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated"/>
              <g class="warmyAuthDust" fill="#6b5a44">
                <rect x="-6" y="78" width="14" height="6"/>
                <rect x="-24" y="84" width="12" height="5"/>
              </g>
              <g class="warmyAuthDust warmyAuthDustB" fill="#5b4a35">
                <rect x="132" y="84" width="12" height="5"/>
                <rect x="148" y="80" width="8" height="4"/>
              </g>
            </g>
          </g>
        </g>
        <g class="warmyAuthDustCloud" fill="#4a3d2e">
          <rect x="80" y="486" width="40" height="8"/>
          <rect x="140" y="494" width="26" height="6"/>
          <rect x="196" y="484" width="34" height="7"/>
        </g>
        <g class="warmyAuthDustCloud warmyAuthDustCloudB" fill="#3d3226" style="animation-delay:-1.7s">
          <rect x="600" y="490" width="46" height="7"/>
          <rect x="668" y="498" width="28" height="6"/>
          <rect x="724" y="488" width="38" height="8"/>
        </g>
      </svg>
    </div>`;
  }

  /**
   * **首启关闭确认里的牛马跑过**（产品要求）：
   * 每个 logo 用内联 SVG（腿 / 尾 / 头各自成组），腿的摆动周期由行进速度推导，
   * 尾巴周期跟随步频，头只偶尔微动（随机时长 + 随机相位，不是固定动画）。
   * 每只的速度、尺寸、直线/斜线/曲线路径、出现间隔全部随机；从左进、从右出。
   */
  const QUIT_HORSE_SVG = `<svg viewBox="0 0 140 100" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
    <ellipse cx="72" cy="86" rx="50" ry="4" fill="#5a3e28" opacity=".14"/>
    <g class="qLeg qLegBackFar">
      <rect x="40" y="50" width="10" height="30" fill="#8B5A2B"/>
      <rect x="40" y="75" width="10" height="5" fill="#1A1A1A"/>
    </g>
    <g class="qLeg qLegBackNear">
      <rect x="20" y="50" width="10" height="15" fill="#8B5A2B"/>
      <rect x="10" y="65" width="10" height="15" fill="#8B5A2B"/>
      <rect x="10" y="75" width="10" height="5" fill="#1A1A1A"/>
    </g>
    <g class="qLeg qLegFrontFar">
      <rect x="70" y="50" width="10" height="30" fill="#8B5A2B"/>
      <rect x="70" y="75" width="10" height="5" fill="#1A1A1A"/>
    </g>
    <g class="qLeg qLegFrontNear">
      <rect x="90" y="50" width="10" height="15" fill="#8B5A2B"/>
      <rect x="100" y="65" width="10" height="15" fill="#8B5A2B"/>
      <rect x="100" y="75" width="10" height="5" fill="#1A1A1A"/>
    </g>
    <g class="qBodyBob">
      <g class="qTail">
        <rect x="10" y="30" width="10" height="10" fill="#3E2723"/>
        <rect x="0" y="40" width="10" height="10" fill="#3E2723"/>
        <rect x="0" y="50" width="10" height="10" fill="#3E2723"/>
      </g>
      <rect x="20" y="20" width="80" height="30" fill="#A0522D"/>
      <g class="qHead">
        <rect x="90" y="0" width="10" height="10" fill="#3E2723"/>
        <rect x="100" y="0" width="10" height="10" fill="#3E2723"/>
        <rect x="100" y="10" width="10" height="10" fill="#3E2723"/>
        <rect x="110" y="10" width="10" height="10" fill="#8B5A2B"/>
        <rect x="110" y="20" width="10" height="10" fill="#A0522D"/>
        <rect x="120" y="20" width="10" height="10" fill="#A0522D"/>
        <rect x="110" y="30" width="10" height="10" fill="#A0522D"/>
        <rect x="120" y="30" width="10" height="10" fill="#A0522D"/>
        <rect x="120" y="40" width="10" height="10" fill="#C19A6B"/>
        <rect x="130" y="40" width="10" height="10" fill="#C19A6B"/>
        <rect x="100" y="20" width="10" height="10" fill="#8B5A2B"/>
        <rect x="100" y="30" width="10" height="10" fill="#8B5A2B"/>
      </g>
    </g>
  </svg>`;
  const QUIT_HORSE_MAX = 6;
  let quitHorseTimer = 0;
  let quitHorseGen = 0;
  let quitHorseN = 0;
  const tiaoZheng = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function quitHorseNode() {
    const el = document.createElement('div');
    el.className = 'warmyAuthQuitRunner';
    el.dataset.qiId = String(++quitHorseN);
    el.innerHTML = QUIT_HORSE_SVG;
    return el;
  }
  function spawnQuitHorse(track, gen, startAt) {
    if (!track || gen !== quitHorseGen) return;
    if (track.querySelectorAll('.warmyAuthQuitRunner').length >= QUIT_HORSE_MAX) return;
    const rect = track.getBoundingClientRect();
    const W = rect.width || 480;
    const H = rect.height || 150;
    const pao = Math.random() < 0.4;
    const size = pao ? 54 + Math.random() * 34 : 44 + Math.random() * 26;
    const gao = size * (100 / 140);
    const el = quitHorseNode();
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = gao.toFixed(1) + 'px';
    /**
     * 步频跟速度走：跑得越快，腿的周期越短；尾巴周期是步频的两倍。
     * 这些值写在元素上，CSS 的腿/尾/头动画直接读。
     */
    const kuai = pao ? 2100 + Math.random() * 1700 : 4300 + Math.random() * 2600;
    const bu = Math.round(kuai * (pao ? 0.07 + Math.random() * 0.015 : 0.095 + Math.random() * 0.02));
    el.style.setProperty('--step', bu + 'ms');
    el.style.setProperty('--swing', (pao ? 19 + Math.random() * 5 : 10 + Math.random() * 5).toFixed(1) + 'deg');
    el.style.setProperty('--bob', (pao ? -2 : -1) + 'px');
    el.style.setProperty('--headDur', Math.round(1300 + Math.random() * 2100) + 'ms');
    el.style.setProperty('--headDelay', '-' + Math.round(Math.random() * 2600) + 'ms');
    const y0 = tiaoZheng(3 + Math.random() * Math.max(1, H - gao - 8), 0, Math.max(0, H - gao - 2));
    /** 从最左侧外面进场、从最右侧外面离场（轨道本身无背景，不靠底色区分边界） */
    const x0 = -size - 60;
    const x1 = W + 60;
    const zhong = Math.random();
    let frames;
    if (zhong < 0.28) {
      frames = [{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y0}px)` }];
    } else if (zhong < 0.68) {
      /** 斜线：坡度明显加大，但终点仍夹在轨道内，避免整只跑出卡片 */
      const y1 = tiaoZheng(y0 + (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 45), 0, Math.max(0, H - gao - 2));
      frames = [{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y1}px)` }];
    } else {
      /** 曲线：控制点拉到更远，弧线更明显；仍保留一部分平移（28%） */
      const fang = Math.random() < 0.5 ? -1 : 1;
      const cy = tiaoZheng(y0 + fang * (45 + Math.random() * 55), 0, Math.max(0, H - gao - 2));
      const y1 = tiaoZheng(y0 + fang * (10 + Math.random() * 40), 0, Math.max(0, H - gao - 2));
      frames = [0, 0.16, 0.33, 0.5, 0.67, 0.84, 1].map((t) => ({
        transform: `translate(${(x0 + (x1 - x0) * t).toFixed(1)}px, ${((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1).toFixed(1)}px)`,
      }));
    }
    track.appendChild(el);
    let anim = null;
    try { anim = el.animate(frames, { duration: kuai, easing: 'linear', fill: 'both' }); } catch { /* noop */ }
    if (anim) {
      if (startAt > 0) { try { anim.currentTime = kuai * startAt; } catch { /* noop */ } }
      anim.onfinish = () => { try { el.remove(); } catch { /* noop */ } };
    } else {
      el.style.transform = `translate(${x0}px, ${y0}px)`;
      setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, kuai);
    }
  }
  function stopQuitHorses(track) {
    quitHorseGen++;
    if (quitHorseTimer) { clearTimeout(quitHorseTimer); quitHorseTimer = 0; }
    if (!track) return;
    track.querySelectorAll('.warmyAuthQuitRunner').forEach((el) => {
      try { el.getAnimations().forEach((a) => a.cancel()); } catch { /* noop */ }
      el.remove();
    });
    track.innerHTML = '';
  }
  function startQuitHorses(track) {
    if (!track) return;
    stopQuitHorses(track);
    const gen = quitHorseGen;
    let jian = false;
    try { jian = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { /* noop */ }
    if (jian) {
      for (let i = 0; i < 3; i++) {
        const el = quitHorseNode();
        el.classList.add('is-static');
        const size = 48 + i * 10;
        el.style.width = size + 'px';
        el.style.height = (size * (100 / 140)).toFixed(1) + 'px';
        el.style.left = (8 + i * 30) + '%';
        el.style.top = (14 + (i % 2) * 22) + 'px';
        track.appendChild(el);
      }
      return;
    }
    // 打开时画面上已经“在跑”：三只均匀分布在轨道里，之后从左侧随机补。
    spawnQuitHorse(track, gen, 0.2);
    spawnQuitHorse(track, gen, 0.45);
    spawnQuitHorse(track, gen, 0.7);
    const loop = () => {
      if (gen !== quitHorseGen) return;
      quitHorseTimer = setTimeout(() => {
        if (gen !== quitHorseGen) return;
        spawnQuitHorse(track, gen, 0);
        loop();
      }, 360 + Math.random() * 820);
    };
    loop();
  }

  // ── overlay shell ───────────────────────────────────────────────────────

  function ensureOverlay() {
    let root = $('warmyAuthGate');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'warmyAuthGate';
    root.className = 'warmyAuthGate';
    root.innerHTML = '<div class="warmyAuthScene warmyAuthSceneEmbed" aria-hidden="true">'
      + '<iframe src="./firstrun-scenes/index.html?embed=1&scenes=' + BEN_CI_CHANG_JING + '&rotate=0" tabindex="-1" scrolling="no"></iframe>'
      + '</div><div class="warmyAuthCard" id="warmyAuthCard"></div>'
      + '<div class="warmyAuthCloseHot" aria-hidden="false"><button type="button" class="warmyAuthCloseX" id="warmyAuthCloseX" title="' + escapeHtml(t('quitApp')) + '" aria-label="' + escapeHtml(t('quitApp')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>'
      /* 首启关闭二次确认：牛马 logo 从左往右跑过；选项「返回界面 / 关闭程序」 */
      + '<div class="warmyAuthQuitMask" id="warmyAuthQuitMask">'
      + '<div class="warmyAuthQuitCard" role="dialog" aria-modal="true" aria-label="' + escapeHtml(t('quitApp')) + '">'
      + '<div class="warmyAuthQuitHorses" id="warmyAuthQuitTrack" aria-hidden="true"></div>'
      + '<div class="warmyAuthQuitActs">'
      + '<button type="button" class="warmyAuthQuitBtn" id="warmyAuthQuitBack">' + escapeHtml(t('quitBack')) + '</button>'
      + '<button type="button" class="warmyAuthQuitBtn danger" id="warmyAuthQuitNow">' + escapeHtml(t('quitApp')) + '</button>'
      + '</div></div></div>';
    document.body.appendChild(root);
    const quitMask = root.querySelector('#warmyAuthQuitMask');
    const quitTrack = root.querySelector('#warmyAuthQuitTrack');
    const quitBack = root.querySelector('#warmyAuthQuitBack');
    const quitNow = root.querySelector('#warmyAuthQuitNow');
    const closeQuitConfirm = () => {
      stopQuitHorses(quitTrack);
      quitMask?.classList.remove('on');
      try { root.querySelector('#warmyAuthCloseX')?.focus(); } catch { /* noop */ }
    };
    root.querySelector('#warmyAuthCloseX')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 首启右上角关闭：先二次确认；只有确认后才真的退出程序。
      if (quitMask) {
        if (quitMask.classList.contains('on')) return;
        quitMask.classList.add('on');
        try { quitBack?.focus(); } catch { /* noop */ }
        // 等遮罩真正显示、拿到轨道尺寸后再开始跑（否则 getBoundingClientRect 全是 0）。
        requestAnimationFrame(() => { if (quitMask.classList.contains('on')) startQuitHorses(quitTrack); });
      }
    });
    quitBack?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); closeQuitConfirm(); });
    quitNow?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      stopQuitHorses(quitTrack);
      void window.warmy.appQuit?.('first-run-close').catch(() => null);
    });
    quitMask?.addEventListener('click', (ev) => {
      if (ev.target === quitMask) { ev.preventDefault(); closeQuitConfirm(); }
    });
    quitMask?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeQuitConfirm(); }
    });
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeyDown);
    return root;
  }
  function showOverlay() {
    const root = ensureOverlay();
    root.classList.remove('warmyAuthHidden');
    state.overlayHidden = false;
    // 新装首启：按屏幕约束窗口；已有账号（退出后回登录）不重新缩窗。
    if (!state.windowFitted && state.auth && state.auth.hasAccount !== true) {
      state.windowFitted = true;
      void window.warmy.shouQiChuangKouShiPei?.().catch(() => null);
    }
  }
  function hideOverlay() {
    const root = $('warmyAuthGate');
    if (root) {
      stopQuitHorses(root.querySelector('#warmyAuthQuitTrack'));
      root.classList.add('warmyAuthHidden');
    }
    try { const p = window.warmy?.authScreenProtect?.(false); if (p && p.catch) p.catch(() => null); } catch { /* noop */ }
    state.overlayHidden = true;
    if (state.windowFitted) {
      state.windowFitted = false;
      void window.warmy.shouQiChuangKouWanCheng?.().catch(() => null);
    }
  }
  /** 关闭后把卡片 DOM 也清空：明文助记词不留在隐藏节点里。 */
  function clearCard() {
    const card = $('warmyAuthCard');
    if (card) card.innerHTML = '';
  }
  function stopTermsClock() {
    if (state.termsTimer) {
      clearInterval(state.termsTimer);
      state.termsTimer = null;
    }
  }
  function setStep(step) {
    if (state.step === 'terms' && step !== 'terms') stopTermsClock();
    if (step === 'mnemonic-register' || step === 'mnemonic-reminder') state.mnemonicHidden = false;
    state.step = step;
    state.error = '';
    render();
  }

  async function call(method, ...args) {
    try {
      if (!window.warmy || typeof window.warmy[method] !== 'function') {
        return { ok: false, error: 'auth-unavailable' };
      }
      return await window.warmy[method](...args);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /** 第 78 轮：语言 / 条款 / 登录三屏共用同一牛马背景（一直播到进入软件）。 */
  function stepHasScene(step) {
    return step !== 'done' && step !== 'loading' && step !== 'fatal';
  }

  /** 第 78 轮：内嵌登录按钮的宽度随语言变化（Se connecter / Iniciar sesión 更长），
   *  按按钮实际宽度留出输入框右侧内边距，保证按钮文字不被截断、也不压住输入内容。 */
  function fitPinInline() {
    const input = $('warmyAuthPin');
    const go = document.querySelector('.warmyAuthPinGo');
    if (!input || !go) return;
    const w = Math.ceil(go.getBoundingClientRect().width);
    if (w > 0) input.style.paddingRight = Math.max(96, w + 18) + 'px';
  }

  function render() {
    showOverlay();
    const root = $('warmyAuthGate');
    const card = $('warmyAuthCard');
    if (!root || !card) return;
    /**
     * 敏感屏（助记词/PIN/恢复）请求系统级截屏保护：
     * Windows/macOS 会让常规截图/录屏/共享看不到窗口内容；Linux 可能不支持（如实降级，不假装）。
     */
    try {
      const minGan = ['mnemonic-register', 'mnemonic-reminder', 'recover', 'viewer', 'login', 'pin-setup'].includes(state.step);
      const p = window.warmy?.authScreenProtect?.(minGan);
      if (p && p.catch) p.catch(() => null);
    } catch { /* 截屏保护失败不影响登录 */ }
    const scene = stepHasScene(state.step);
    root.classList.toggle('warmyAuthGateFirstRun', scene);
    let cls = 'warmyAuthCard';
    if (state.step === 'language') cls += ' warmyAuthCardScene';
    else if (scene) cls += ' warmyAuthCardScene warmyAuthCardOnScene' + (state.step === 'login' ? ' warmyAuthCardCompact' : '');
    card.className = cls;
    card.innerHTML = renderStep();
    // 背景 iframe 常驻（不随步骤重建，避免每次切页都从头播放）；进入软件后隐藏。
    const sceneEl = root.querySelector(':scope > .warmyAuthSceneEmbed');
    if (sceneEl) sceneEl.hidden = !scene;
    if (state.step === 'login') {
      fitPinInline();
      setTimeout(fitPinInline, 30);
      setTimeout(() => { try { $('warmyAuthPin')?.focus(); } catch { /* noop */ } }, 30);
    } else if (state.step === 'recover') {
      setTimeout(() => { try { document.querySelector('[data-recovery-index="0"]')?.focus(); } catch { /* noop */ } }, 30);
    } else if (state.step === 'pin-setup') {
      refreshPinForm();
    } else if (state.step === 'terms') {
      const box = $('warmyAuthTermsBody');
      if (box) {
        box.addEventListener('scroll', syncTermsGate, { passive: true });
        if (state.termsScrolled) box.scrollTop = box.scrollHeight;
      }
      startTermsClock();
      syncTermsGate();
    } else if (state.step === 'username') {
      syncUsernameButton();
      if (state.usernameFocusPending) {
        state.usernameFocusPending = false;
        setTimeout(() => {
          const el = $('warmyAuthUsername');
          if (!el) return;
          try { el.focus(); el.select(); } catch { /* noop */ }
        }, 30);
      }
    }
  }

  function header(title, sub) {
    return `<div class="warmyAuthBrand"><div class="warmyAuthLogo">牛马</div><div><div class="warmyAuthTitle">${escapeHtml(title)}</div>${sub ? `<div class="warmyAuthSub">${escapeHtml(sub)}</div>` : ''}</div></div>`;
  }
  function plainHeader(title, sub) {
    return `<div class="warmyAuthPlainHead"><div class="warmyAuthTitle">${escapeHtml(title)}</div>${sub ? `<div class="warmyAuthSub">${escapeHtml(sub)}</div>` : ''}</div>`;
  }
  function errorBox() {
    if (!state.error) return '';
    return `<div class="warmyAuthError" role="alert">${escapeHtml(state.error)}</div>`;
  }

  function renderStep() {
    if (state.step === 'loading') {
      // 首启在拿到 authState 之前不显示任何说明文字，避免抢在语言页前面。
      return `<div class="warmyAuthSpin"></div>`;
    }
    if (state.step === 'fatal') {
      return header('WArmy', t('fatal')) + `<div class="warmyAuthError">${escapeHtml(state.fatal || '')}</div>
        <div class="warmyAuthActions"><button class="warmyAuthBtn" data-auth-action="retry-boot">${escapeHtml(t('start'))}</button></div>`;
    }
    if (state.step === 'language') return renderLanguage();
    if (state.step === 'terms') return renderTerms();
    if (state.step === 'login') return renderLogin();
    if (state.step === 'mnemonic-register' || state.step === 'mnemonic-reminder') return renderMnemonic();
    if (state.step === 'recover') return renderRecover();
    if (state.step === 'pin-setup') return renderPinSetup();
    if (state.step === 'username') return renderUsername();
    if (state.step === 'viewer') return renderViewer();
    return header('WArmy', t('loading'));
  }

  /**
   * 第 78 轮：语言不再用下拉框。全部语言平铺成三列，点一下即选中
   * （立刻换文案 + 落盘），下方「开始」进入条款页。
   */
  function renderLanguage() {
    const cur = resolveLocale(state.locale);
    const opts = LOCALES.map(([code, full]) => {
      const selected = code === cur;
      const ming = LOCALE_SHORT[code] || code;
      /* R147 项8：短名/截断时全名仍可达 —— title 与 aria-label 都带完整母语名 */
      const quan = String(full || ming);
      return `<button type="button" class="warmyAuthLangTile${selected ? ' is-on' : ''}" role="radio"
        aria-checked="${selected}" data-auth-action="lang-pick" data-locale="${escapeHtml(code)}"
        title="${escapeHtml(quan)}" aria-label="${escapeHtml(quan)}" data-full="${escapeHtml(quan)}">
        <span class="warmyAuthLangTileName">${escapeHtml(ming)}</span>
      </button>`;
    }).join('');
    return `<div class="warmyAuthFirstCard warmyAuthLangCard">
        <div class="warmyAuthLangGrip" aria-hidden="true"></div>
        <div class="warmyAuthLangGrid" id="warmyAuthLang" role="radiogroup" aria-label="Language">${opts}</div>
        <div class="warmyAuthLangFoot">
          <button class="warmyAuthBtn warmyAuthBtnPrimary warmyAuthStartBtn" id="warmyAuthStart" data-auth-action="language-start">${escapeHtml(t('start'))}</button>
        </div>
        <input type="hidden" id="warmyAuthLocale" value="${escapeHtml(cur)}"/>
      </div>`;
  }

  function renderTerms() {
    const full = state.pack && typeof state.pack === 'object' ? state.pack['privacy.body'] : '';
    const body = full || t('termsFallback');
    const ready = state.termsScrolled && state.termsBottomAt > 0 && Date.now() - state.termsBottomAt >= 3000;
    return `${plainHeader(t('termsTitle'))}
      <div id="warmyAuthTermsBody" class="warmyAuthTerms" tabindex="0">${escapeHtml(body).replace(/\n/g, '<br/>')}</div>
      ${errorBox()}
      <div class="warmyAuthActions">
        <button class="warmyAuthBtn" data-auth-action="terms-decline">${escapeHtml(t('termsDecline'))}</button>
        <button class="warmyAuthBtn warmyAuthBtnPrimary" id="warmyAuthTermsContinue" data-auth-action="terms-continue"
                ${ready ? '' : 'disabled'}>${escapeHtml(t('termsContinue'))}</button>
      </div>`;
  }

  function startTermsClock() {
    if (state.termsTimer) return;
    state.termsTimer = setInterval(() => {
      if (state.step !== 'terms') { stopTermsClock(); return; }
      syncTermsGate();
    }, 200);
  }

  function syncTermsGate() {
    if (state.step !== 'terms') return;
    const box = $('warmyAuthTermsBody');
    if (!box) return;
    const atBottom = box.scrollHeight <= box.clientHeight + 4
      || box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    if (atBottom) {
      state.termsScrolled = true;
      if (!state.termsBottomAt) state.termsBottomAt = Date.now();
    }
    const waited = state.termsBottomAt > 0 && Date.now() - state.termsBottomAt >= 3000;
    const ready = state.termsScrolled && waited;
    const btn = $('warmyAuthTermsContinue');
    if (btn) btn.disabled = !ready;
  }

  // 进入条款页 = 新的计时起点；render 不会重置它（重新渲染保留进度）。
  function enterTerms() {
    stopTermsClock();
    state.termsOpenedAt = Date.now();
    state.termsBottomAt = 0;
    state.termsScrolled = false;
    setStep('terms');
  }

  function renderLogin() {
    const a = state.auth || {};
    const locked = Number(a.lockUntil || 0) > Date.now();
    if (state.lockTimer) { clearTimeout(state.lockTimer); state.lockTimer = null; }
    if (locked) {
      state.lockTimer = setTimeout(async () => {
        if (state.step !== 'login') return;
        const fresh = await call('authState');
        if (fresh && fresh.ok) state.auth = fresh;
        render();
      }, Math.max(250, Number(a.lockUntil) - Date.now() + 50));
    }
    const pinEnabled = !!a.pinConfigured;
    // 第 78 轮：PIN 输入框右侧内嵌「登录」按钮（视觉上包在输入框里），整页更小。
    // 同时保留返回首启语言页的入口；背景仍是同一段牛马动画。
    return `<button type="button" class="warmyAuthBackChip" data-auth-action="login-lang-back" title="${escapeHtml(tOr('backToLanguage', '返回语言选择'))}" aria-label="${escapeHtml(tOr('backToLanguage', '返回语言选择'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <label class="warmyAuthLabel" for="warmyAuthPin">${escapeHtml(t('pinLogin'))}</label>
      <div class="warmyAuthPinRow">
        <input id="warmyAuthPin" class="warmyAuthInput warmyAuthPinInline" type="password" maxlength="20" autocomplete="current-password"
               placeholder="${escapeHtml(t('pinPlaceholder'))}" ${!pinEnabled || locked ? 'disabled' : ''}/>
        <button class="warmyAuthBtn warmyAuthBtnPrimary warmyAuthPinGo" data-auth-action="login-pin" ${!pinEnabled || locked || state.busy ? 'disabled' : ''}>${escapeHtml(t('login'))}</button>
      </div>
      ${!pinEnabled ? `<div class="warmyAuthHint">${escapeHtml(t('noAccount'))}</div>` : ''}
      ${locked ? `<div class="warmyAuthWarn">${escapeHtml(t('locked'))}</div>` : ''}
      ${pinEnabled && a.remainingAttempts != null && !locked && a.remainingAttempts < 5 ? `<div class="warmyAuthLockHint">${escapeHtml(t('lockHint').replace('{n}', String(a.remainingAttempts)))}</div>` : ''}
      ${errorBox()}
      <div class="warmyAuthActions warmyAuthActionsBetween">
        <button class="warmyAuthBtn" data-auth-action="recover-open">${escapeHtml(t('recover'))}</button>
        <button class="warmyAuthBtn" data-auth-action="register-open">${escapeHtml(t('register'))}</button>
      </div>`;
  }

  function mnemonicSource() {
    return state.reg || state.reminder;
  }

  /**
   * 中文友好型不再把相邻 BIP-39 词的音节硬拼；主进程为每个词序返回一个
   * 真实的两字词/四字成语（码本见 auth-friend-*.mjs）。这里只负责展示。
   */
  function friendlyItems(source) {
    const words = Array.isArray(source && source.friendlyWords) && source.friendlyWords.length === 24 ? source.friendlyWords : null;
    const idioms = Array.isArray(source && source.friendlyIdioms) && source.friendlyIdioms.length === 24 ? source.friendlyIdioms : null;
    if (state.pinyinGroup === 4 && idioms) return idioms;
    return words || null;
  }

  /**
   * 第 78 轮 项 6：成语模式只显示 12 格 —— 第 k 格覆盖 BIP-39 的第 (2k+1, 2k+2) 个词。
   * 配对码本 P[k] = I[2k]（I 是主进程按词序生成的 24 个成语）：每个下标仍然只对应
   * 一个固定成语，顺序不变、不重排、不丢词；关掉中文友好型拿到的仍是同一份 24 词。
   */
  function pairIdiomItems(items) {
    const out = [];
    for (let k = 0; k < items.length; k += 2) {
      const a = items[k] || {};
      const b = items[k + 1] || null;
      out.push({
        w: a.w,
        p: a.p || '',
        w2: b ? b.w : '',
        p2: b ? b.p || '' : '',
        cover: [k + 1, b ? k + 2 : k + 1],
      });
    }
    return out;
  }

  function mnemonicMarkup(source, english) {
    const friendly = friendlyItems(source);
    const useFriendly = state.pinyinPref && !!friendly;
    const isIdiom = state.pinyinGroup === 4;
    const items = useFriendly
      ? (isIdiom ? pairIdiomItems(friendly) : friendly)
        .map((it, i) => ({
          ...it,
          /** 英文 BIP-39 词才是助记词本体；中文码字/拼音只是辅助 */
          en: isIdiom ? [english[i * 2], english[i * 2 + 1]].filter(Boolean).join(' ') : english[i],
        }))
      : english.map((w) => ({ w, p: '', en: w }));
    const cls = useFriendly ? ` is-pinyin is-pinyin-${isIdiom ? 4 : 2}` : '';
    return `<div class="warmyAuthMnemonic${cls}">${items
      .map((it, i) => {
        const cover = it.cover || [i + 1];
        const pair = it.w2 ? `${it.w}|${it.w2}` : '';
        /**
         * 第 97 轮项 1：勾选助记拼音时，**拼音才是助记词本体**（主题色，第二行）；
         * 中文辅助上移与序号并排；英文 BIP-39 词不再重复显示（用户明确说"显示 2 遍助记词"）。
         * 未勾选时仍是英文 BIP-39 词当本体。
         */
        return `<span class="warmyAuthWord${useFriendly ? ' warmyAuthWordFriendly' : ''}"
            data-cover="${cover.join(',')}"${pair ? ` data-pair="${escapeHtml(pair)}"` : ''}>
        <b class="warmyAuthWordIndex">${cover.length > 1 ? `${cover[0]}-${cover[1]}` : cover[0]}</b>
        ${useFriendly
          ? `<span class="warmyAuthWordText">${escapeHtml(it.w)}</span>
        <span class="warmyAuthWordPinyin">${escapeHtml(it.p)}</span>`
          : `<span class="warmyAuthWordEn">${escapeHtml(it.en || '')}</span>`}
      </span>`;
      })
      .join('')}</div>`;
  }

  function pinyinGroupControls() {
    if (!state.pinyinPref) return '';
    const on = state.pinyinGroup === 4 ? 4 : 2;
    return `<div class="warmyAuthPinyinToggle" role="switch" aria-checked="${on === 4}" aria-label="词组 / 成语">
      <button type="button" class="warmyAuthPinyinSwitch${on === 2 ? ' is-on' : ''}" data-auth-action="pinyin-group" data-group="2" aria-pressed="${on === 2}">${escapeHtml(t('pinyinGroupTwo'))}</button>
      <button type="button" class="warmyAuthPinyinSwitch${on === 4 ? ' is-on' : ''}" data-auth-action="pinyin-group" data-group="4" aria-pressed="${on === 4}">${escapeHtml(t('pinyinGroupFour'))}</button>
    </div>`;
  }

  function resetPinyinDisplay() {
    state.pinyinPref = resolveLocale(state.locale) === 'zh-CN';
    state.pinyinGroup = 2;
  }

  function renderMnemonic() {
    const source = mnemonicSource();
    if (!source || !source.mnemonic) {
      return `<div class="warmyAuthError">${escapeHtml(t('vaultCorrupt'))}</div>`;
    }
    if (state.mnemonicHidden) {
      return `${plainHeader(t('mnemonicTitle'))}
        <div class="warmyAuthMnemonicHidden">
          <div class="warmyAuthHint">${escapeHtml(t('mnemonicHidden'))}</div>
          <button type="button" class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="mnemonic-reveal">${escapeHtml(t('viewTitle'))}</button>
        </div>`;
    }
    const english = wordsOf(source.mnemonic);
    const reminder = state.step === 'mnemonic-reminder';
    const canBack = state.step === 'mnemonic-register';
    return `${mnemonicMarkup(source, english)}
      <label class="warmyAuthCheck"><input type="checkbox" data-auth-action="toggle-pinyin" ${state.pinyinPref ? 'checked' : ''}/> <span>${escapeHtml(t('pinyinFriendly'))}</span></label>
      ${pinyinGroupControls()}
      <div class="warmyAuthWarn">${escapeHtml(reminder ? t('mnemonicReminderBody') : t('mnemonicBody'))}</div>
      ${errorBox()}
      <div class="warmyAuthActions">
        ${canBack ? `<button class="warmyAuthBtn" data-auth-action="login-back">${escapeHtml(t('back'))}</button>` : ''}
        <button class="warmyAuthBtn" data-auth-action="mnemonic-later">${escapeHtml(t('later'))}</button>
        <button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="mnemonic-confirm">${escapeHtml(t('saved'))}</button>
      </div>`;
  }

  function renderRecover() {
    const a = state.auth || {};
    const mnemonicLocked = !!a.mnemonicLocked;
    const cells = Array.isArray(state.recoveryCells) && state.recoveryCells.length === 24
      ? state.recoveryCells
      : Array(24).fill('');
    const idiom = state.recoveryIdiom === true;
    const label = (i) => idiom ? `${i * 2 + 1}-${i * 2 + 2}` : String(i + 1);
    const grid = idiom
      ? Array.from({ length: 12 }, (_, k) => `
        <label class="warmyAuthWord warmyAuthRecoveryCell warmyAuthRecoveryPair">
          <b class="warmyAuthWordIndex">${k * 2 + 1}-${k * 2 + 2}</b>
          <input class="warmyAuthRecoveryInput" data-recovery-index="${k * 2}" value="${escapeHtml(cells[k * 2])}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('recoverTitle'))} ${k * 2 + 1}" placeholder="${escapeHtml(t('pinyinGroupFour'))} ${k * 2 + 1}"/>
          <input class="warmyAuthRecoveryInput" data-recovery-index="${k * 2 + 1}" value="${escapeHtml(cells[k * 2 + 1])}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('recoverTitle'))} ${k * 2 + 2}" placeholder="${escapeHtml(t('pinyinGroupFour'))} ${k * 2 + 2}"/>
        </label>`).join('')
      : cells.map((v, i) => `
        <label class="warmyAuthWord warmyAuthRecoveryCell">
          <b class="warmyAuthWordIndex">${label(i)}</b>
          <input class="warmyAuthRecoveryInput" data-recovery-index="${i}" value="${escapeHtml(v)}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('recoverTitle'))} ${i + 1}"/>
        </label>`).join('');
    return plainHeader(t('recoverTitle')) + `
      <div class="warmyAuthPinyinToggle" style="margin:0 0 8px">
        <button type="button" class="warmyAuthPinyinSwitch ${idiom ? '' : 'is-on'}" data-auth-action="recover-group" data-group="2" aria-pressed="${!idiom}">${escapeHtml(t('pinyinGroupTwo'))}</button>
        <button type="button" class="warmyAuthPinyinSwitch ${idiom ? 'is-on' : ''}" data-auth-action="recover-group" data-group="4" aria-pressed="${idiom}">${escapeHtml(t('pinyinGroupFour'))}</button>
      </div>
      <div class="warmyAuthMnemonic warmyAuthRecoveryGrid${idiom ? ' is-idiom-12' : ''}">${grid}</div>
      <div class="warmyAuthHint">${escapeHtml(t('recoverHint'))}</div>
      ${mnemonicLocked ? `<div class="warmyAuthWarn">${escapeHtml(t('locked'))}</div>` : ''}
      ${!mnemonicLocked && a.mnemonicRemainingAttempts != null && a.mnemonicRemainingAttempts < 5 ? `<div class="warmyAuthLockHint">${escapeHtml(t('lockHint').replace('{n}', String(a.mnemonicRemainingAttempts)))}</div>` : ''}
      ${mnemonicLocked ? '' : errorBox()}
      <div class="warmyAuthActions">
        <button class="warmyAuthBtn" data-auth-action="recover-back">${escapeHtml(t('back'))}</button>
        <button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="recover-verify" ${state.busy || mnemonicLocked ? 'disabled' : ''}>${escapeHtml(t('verify'))}</button>
      </div>`;
  }

  function renderPinSetup() {
    const canAuto = state.mnemonicConfirmed === true;
    const autoOn = canAuto && state.pinAuto;
    const recovery = !!state.rec;
    // 这一屏不渲染「牛马」文字品牌块（普通标题即可）。
    return plainHeader(t('pinTitle'), t('pinBody')) + `
      <label class="warmyAuthCheck ${canAuto ? '' : 'warmyAuthDisabled'}">
        <input type="checkbox" id="warmyAuthAuto" ${autoOn ? 'checked' : ''} ${canAuto ? '' : 'disabled'}/> <span>${escapeHtml(t('autoEnable'))}</span>
      </label>
      ${canAuto ? '' : `<div class="warmyAuthHint">${escapeHtml(t('autoDisabledHint'))}</div>`}
      <div id="warmyAuthPinFields">
        <label class="warmyAuthLabel" for="warmyAuthPin1">${escapeHtml(t('pin1'))}</label>
        <input id="warmyAuthPin1" class="warmyAuthInput" type="password" maxlength="20" autocomplete="new-password"/>
        <label class="warmyAuthLabel" for="warmyAuthPin2">${escapeHtml(t('pin2'))}</label>
        <input id="warmyAuthPin2" class="warmyAuthInput" type="password" maxlength="20" autocomplete="new-password"/>
      </div>
      <div class="warmyAuthHint" id="warmyAuthPinRule">${escapeHtml(t('pinRule'))}</div>
      <div class="warmyAuthWarn" id="warmyAuthModeHint">${escapeHtml(t('autoOffHint'))}</div>
      ${errorBox()}
      <div class="warmyAuthActions">
        <button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="pin-submit" ${state.busy ? 'disabled' : ''}>${escapeHtml(recovery ? t('confirmRecover') : t('confirmCreate'))}</button>
      </div>`;
  }

  function renderUsername() {
    const valid = usernameValid(state.username);
    return plainHeader(t('usernameTitle')) + `
      <input id="warmyAuthUsername" class="warmyAuthInput warmyAuthUsernameInput" type="text"
             value="${escapeHtml(state.username)}" aria-label="${escapeHtml(t('usernameTitle'))}"
             autocomplete="nickname" spellcheck="false"/>
      <div class="warmyAuthHint">${escapeHtml(t('usernameRule'))}</div>
      ${errorBox()}
      <div class="warmyAuthActions">
        <button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="username-finish" ${valid && !state.busy ? '' : 'disabled'}>${escapeHtml(t('usernameFinish'))}</button>
      </div>`;
  }

  function renderViewer() {
    const source = state.viewer;
    if (!source || !source.mnemonic) return plainHeader(t('viewTitle'), t('vaultCorrupt'));
    if (state.mnemonicHidden) {
      return `${plainHeader(t('viewTitle'))}
        <div class="warmyAuthMnemonicHidden">
          <div class="warmyAuthHint">${escapeHtml(t('mnemonicHidden'))}</div>
          <button type="button" class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="viewer-reveal">${escapeHtml(t('viewTitle'))}</button>
        </div>`;
    }
    const english = wordsOf(source.mnemonic);
    const needConfirm = !!(state.auth && !state.auth.mnemonicConfirmed);
    return plainHeader(t('viewTitle')) + `
      ${mnemonicMarkup(source, english)}
      <label class="warmyAuthCheck"><input type="checkbox" data-auth-action="viewer-pinyin" ${state.pinyinPref ? 'checked' : ''}/> <span>${escapeHtml(t('pinyinFriendly'))}</span></label>
      ${pinyinGroupControls()}
      <div class="warmyAuthWarn">${escapeHtml(t('viewBody'))}</div>
      ${errorBox()}
      <div class="warmyAuthActions">
        ${needConfirm ? `<button class="warmyAuthBtn" data-auth-action="viewer-later">${escapeHtml(t('saveLater'))}</button>
          <button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="viewer-confirm">${escapeHtml(t('saveConfirm'))}</button>`
        : `<button class="warmyAuthBtn warmyAuthBtnPrimary" data-auth-action="viewer-close">${escapeHtml(t('close'))}</button>`}
      </div>`;
  }

  // ── username helpers ────────────────────────────────────────────────────

  function defaultUsername() {
    return DEFAULT_USERNAME[resolveLocale(state.locale)] || DEFAULT_USERNAME['zh-CN'];
  }

  function graphemeCount(value) {
    const text = String(value == null ? '' : value);
    try {
      const seg = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
      return Array.from(seg.segment(text)).length;
    } catch {
      return Array.from(text).length;
    }
  }

  function usernameValid(value) {
    const raw = String(value == null ? '' : value);
    const trimmed = raw.trim();
    if (!trimmed) return false;
    // Cc 控制字符；允许 ZWJ（U+200D）与 Emoji ZWJ 序列。
    if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(trimmed)) return false;
    const count = graphemeCount(trimmed);
    return count >= 1 && count <= 30;
  }

  function syncUsernameButton() {
    const btn = document.querySelector('[data-auth-action="username-finish"]');
    if (!btn) return;
    btn.disabled = !usernameValid(state.username) || state.busy;
  }

  function enterUsernameStep() {
    state.username = defaultUsername();
    state.usernameFocusPending = true;
    state.error = '';
    setStep('username');
  }

  function openPinSetup() {
    state.pinAuto = false;
    state.error = '';
    setStep('pin-setup');
  }

  // ── terms clock ─────────────────────────────────────────────────────────

  function onInput(e) {
    const target = e.target;
    if (!target) return;
    const ri = target.getAttribute ? target.getAttribute('data-recovery-index') : null;
    if (ri !== null && ri !== undefined) {
      const i = Number(ri);
      if (Number.isInteger(i) && i >= 0 && i < 24) {
        if (!Array.isArray(state.recoveryCells) || state.recoveryCells.length !== 24) state.recoveryCells = Array(24).fill('');
        state.recoveryCells[i] = String(target.value || '');
      }
      return;
    }
    if (target.id === 'warmyAuthPin1' || target.id === 'warmyAuthPin2') {
      refreshPinForm();
      return;
    }
    if (target.id === 'warmyAuthUsername') {
      state.username = target.value;
      syncUsernameButton();
    }
  }

  function onChange(e) {
    const target = e.target;
    if (!target || !target.getAttribute) return;
    if (target.id === 'warmyAuthAuto') {
      state.pinAuto = !!target.checked;
      refreshPinForm();
      return;
    }
    const action = target.getAttribute('data-auth-action');
    if (action === 'toggle-pinyin' || action === 'viewer-pinyin') {
      state.pinyinPref = !!target.checked;
      if (action === 'viewer-pinyin') {
        void call('authSetPinyin', state.pinyinPref).then((r) => {
          if (r && r.ok && state.auth) state.auth.pinyin = state.pinyinPref;
        });
      }
      render();
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter' || !e.target) return;
    if (state.step === 'login' && e.target.id === 'warmyAuthPin') {
      e.preventDefault();
      handleAction('login-pin');
      return;
    }
    if (state.step === 'username' && e.target.id === 'warmyAuthUsername' && usernameValid(state.username)) {
      e.preventDefault();
      handleAction('username-finish');
    }
  }

  // 只在普通按钮上 preventDefault；复选框交给浏览器自己切换（拼音勾选项曾因此点不动）。
  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-auth-action]') : null;
    if (!el) return;
    const action = el.getAttribute('data-auth-action');
    if (action === 'toggle-pinyin' || action === 'viewer-pinyin') return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
    e.preventDefault();
    handleAction(action, el);
  }

  function refreshPinForm() {
    const auto = $('warmyAuthAuto');
    const p1 = $('warmyAuthPin1');
    const p2 = $('warmyAuthPin2');
    const submit = document.querySelector('[data-auth-action="pin-submit"]');
    const modeHint = $('warmyAuthModeHint');
    if (!p1 || !p2 || !submit) return;
    const autoOn = !!(auto && auto.checked);
    state.pinAuto = autoOn;
    p1.disabled = autoOn;
    p2.disabled = autoOn;
    if (autoOn) {
      p1.value = '';
      p2.value = '';
      submit.disabled = !!state.busy;
      if (modeHint) modeHint.textContent = t('autoOffHint');
      return;
    }
    if (modeHint) modeHint.textContent = t('autoOffHint');
    const ok = /^[A-Za-z0-9]{4,20}$/.test(p1.value) && p1.value === p2.value;
    submit.disabled = !ok || !!state.busy;
  }

  async function applyLocale(code) {
    state.locale = resolveLocale(code);
    // 立即更新本页文案（平铺选项 + 开始按钮）与文档语言，不等落盘/语言包。
    try {
      document.documentElement.lang = state.locale;
      document.documentElement.dir = RTL_LOCALES.some((c) => resolveLocale(state.locale) === c || state.locale === c) ? 'rtl' : 'ltr';
    } catch { /* noop */ }
    render();
    try { void window.__warmyLoadI18n?.(state.locale); } catch { /* noop */ }
    await call('settingsSave', { yuYan: state.locale });
    await loadPack(state.locale);
  }

  function enterLanguage() {
    state.error = '';
    state.busy = false;
    setStep('language');
  }

  async function enterAuth() {
    const fresh = await call('authState');
    if (fresh && fresh.ok) state.auth = fresh;
    if (fresh && fresh.bypass === true) { finishAuth(); return; }
    /** 第 104 轮：一次性令牌已在主进程恢复会话（数据仓库已解锁）⇒ 直接进入。 */
    if (fresh && fresh.unlocked === true && fresh.hasAccount === true) { finishAuth(); return; }
    if (!state.auth || !state.auth.hasAccount) { showLogin(); return; }
    /**
     * 第 67 轮 项 4：勾了「自动登录」且本机绑定仍然有效 ⇒ **启动直接进入**，
     * 不再要求再点一次按钮。绑定失效/安全存储不可用时才回落到 PIN/助记词登录页。
     */
    if (state.auth.autoLogin && state.auth.autoLoginAvailable) {
      state.busy = true;
      const r = await call('authLoginAuto');
      state.busy = false;
      if (r && r.ok) { await afterLogin(r); return; }
      state.error = errorText((r && r.error) || 'auto-login-failed');
    }
    showLogin();
  }

  function showLogin() {
    state.busy = false;
    state.reg = null;
    state.rec = null;
    state.reminder = null;
    state.error = '';
    setStep('login');
  }

  async function handleAction(action, el) {
    if (state.busy && !['viewer-close', 'viewer-later', 'viewer-reveal', 'mnemonic-reveal'].includes(action)) return;
    if (action === 'retry-boot') {
      location.reload();
      return;
    }
    if (action === 'pinyin-group') {
      state.pinyinGroup = Number(el && el.getAttribute ? el.getAttribute('data-group') : 2) === 4 ? 4 : 2;
      render();
      return;
    }
    if (action === 'lang-pick') {
      const code = resolveLocale(el && el.getAttribute ? el.getAttribute('data-locale') : state.locale);
      if (code !== state.locale) await applyLocale(code);
      return;
    }
    if (action === 'login-lang-back') {
      // 第 78 轮：登录页保留返回首启语言页；回到语言页后仍从「开始」重新走条款。
      enterLanguage();
      return;
    }
    if (action === 'language-start') {
      state.busy = true;
      const sel = $('warmyAuthLocale');
      const code = resolveLocale(sel ? sel.value : state.locale);
      state.locale = code;
      await call('settingsSave', { yuYan: code });
      await call('setupComplete', { yuYan: code });
      try { await window.__warmyLoadI18n?.(code); } catch { /* noop */ }
      await loadPack(code);
      state.setupDone = true;
      state.busy = false;
      // 点击开始后一定先到条款页；未同意前不会进入登录。
      enterTerms();
      return;
    }
    if (action === 'terms-continue') {
      const ready = state.termsScrolled && state.termsBottomAt > 0 && Date.now() - state.termsBottomAt >= 3000;
      if (!ready) {
        state.error = t('termsRequired');
        render();
        return;
      }
      state.busy = true;
      const r = await call('privacyConsentSet', true);
      state.busy = false;
      if (r && r.ok === false) {
        state.error = errorText(r.error);
        render();
        return;
      }
      state.consented = true;
      stopTermsClock();
      await enterAuth();
      return;
    }
    if (action === 'terms-decline') {
      await call('privacyConsentSet', false);
      await call('appQuit', 'terms-disagree');
      return;
    }
    if (action === 'login-back') {
      await call('authRegisterCancel');
      state.reg = null;
      state.rec = null;
      state.reminder = null;
      showLogin();
      return;
    }
    if (action === 'recover-back') {
      await call('authRegisterCancel');
      state.reg = null;
      state.rec = null;
      state.recoveryCells = [];
      showLogin();
      return;
    }
    if (action === 'register-open') {
      if (state.auth && state.auth.hasAccount) {
        const ok = await askConfirm('', t('existingAccountWarn'), t('registerBegin'), false);
        if (!ok) return;
      }
      state.busy = true;
      const r = await call('authRegisterBegin', { force: !!(state.auth && state.auth.hasAccount) });
      state.busy = false;
      if (!r.ok) {
        state.error = errorText(r.error);
        render();
        return;
      }
      state.reg = {
        mnemonic: r.mnemonic,
        pinyin: r.pinyin,
        friendlyWords: Array.isArray(r.friendlyWords) ? r.friendlyWords : null,
        friendlyIdioms: Array.isArray(r.friendlyIdioms) ? r.friendlyIdioms : null,
      };
      state.rec = null;
      state.reminder = null;
      state.mnemonicConfirmed = false;
      resetPinyinDisplay();
      setStep('mnemonic-register');
      return;
    }
    if (action === 'login-pin') {
      const pin = $('warmyAuthPin')?.value || '';
      if (!pin) {
        state.error = t('pinRule');
        render();
        return;
      }
      state.busy = true;
      const r = await call('authLoginPin', pin);
      state.busy = false;
      if (!r.ok) {
        if (r.state) state.auth = r.state;
        state.error = errorText(r.error);
        render();
        return;
      }
      await afterLogin(r);
      return;
    }
    if (action === 'login-auto') {
      state.busy = true;
      const r = await call('authLoginAuto');
      state.busy = false;
      if (!r.ok) {
        if (r.state) state.auth = r.state;
        state.error = errorText(r.error);
        render();
        return;
      }
      await afterLogin(r);
      return;
    }
    if (action === 'recover-open') {
      state.error = '';
      state.recoveryCells = Array(24).fill('');
      state.recoveryIdiom = false;
      setStep('recover');
      return;
    }
    if (action === 'recover-group') {
      state.recoveryIdiom = String(el && el.getAttribute ? el.getAttribute('data-group') : '2') === '4';
      render();
      return;
    }
    if (action === 'recover-verify') {
      const fromDom = [...document.querySelectorAll('[data-recovery-index]')]
        .sort((a, b) => Number(a.getAttribute('data-recovery-index')) - Number(b.getAttribute('data-recovery-index')))
        .map((el) => String(el.value || '').trim());
      const cells = fromDom.length === 24 ? fromDom : (Array.isArray(state.recoveryCells) ? state.recoveryCells.map((x) => String(x || '').trim()) : []);
      if (cells.length !== 24 || cells.some((x) => !x)) {
        state.error = t('badMnemonic');
        render();
        return;
      }
      const phrase = cells.join('\n');
      state.busy = true;
      const r = await call('authRecoverBegin', phrase);
      state.busy = false;
      if (!r.ok) {
        if (r.state) state.auth = r.state;
        state.error = errorText(r.error);
        render();
        return;
      }
      state.rec = { pinyin: r.pinyin, friendlyWords: r.friendlyWords, friendlyIdioms: r.friendlyIdioms };
      state.reg = null;
      state.mnemonicConfirmed = true;
      state.pinyinPref = false;
      openPinSetup();
      return;
    }
    if (action === 'mnemonic-reveal') {
      state.mnemonicHidden = false;
      render();
      return;
    }
    if (action === 'mnemonic-later' || action === 'mnemonic-confirm') {
      const confirm = action === 'mnemonic-confirm';
      // 确认弹层没有标题（用户要求），只显示正文与按钮。
      const ok = confirm
        ? await askConfirm('', t('confirmBody'), t('confirmOk'), true, t('back'))
        : await askConfirm(t('laterConfirmTitle'), t('laterConfirmBody'), t('laterConfirmOk'), false);
      if (!ok) return;
      if (state.step === 'mnemonic-register') {
        state.mnemonicConfirmed = confirm;
        // Drop the plaintext phrase from the renderer as soon as the choice is made.
        if (state.reg) { state.reg.mnemonic = ''; state.reg.pinyin = ''; }
        openPinSetup();
        return;
      }
      if (state.step === 'mnemonic-reminder') {
        state.busy = true;
        const r = await call('authConfirmMnemonic', confirm ? 'confirm' : 'later');
        state.busy = false;
        if (!r.ok) {
          state.error = errorText(r.error);
          render();
          return;
        }
        if (r.state) state.auth = r.state;
        state.reminder = null;
        finishAuth();
      }
      return;
    }
    if (action === 'pin-submit') {
      const autoOn = !!$('warmyAuthAuto')?.checked;
      const pin = $('warmyAuthPin1')?.value || '';
      const confirmPin = $('warmyAuthPin2')?.value || '';
      if (!autoOn) {
        if (!/^[A-Za-z0-9]{4,20}$/.test(pin)) {
          state.error = t('pinRule');
          render();
          return;
        }
        if (pin !== confirmPin) {
          state.error = t('pinMismatch');
          render();
          return;
        }
      }
      state.busy = true;
      const r = state.rec
        ? await call('authRecoverCommit', { pinyin: state.pinyinPref, autoLogin: autoOn, pin, confirmPin })
        : await call('authRegisterCommit', {
          mnemonicConfirmed: state.mnemonicConfirmed,
          pinyin: state.pinyinPref,
          autoLogin: autoOn,
          pin,
          confirmPin,
        });
      state.busy = false;
      if (!r.ok) {
        state.error = errorText(r.error);
        render();
        return;
      }
      if (r.state) state.auth = r.state;
      state.reg = null;
      state.rec = null;
      state.reminder = null;
      enterUsernameStep();
      return;
    }
    if (action === 'username-finish') {
      await submitUsername();
      return;
    }
    if (action === 'viewer-reveal') {
      state.mnemonicHidden = false;
      render();
      return;
    }
    if (action === 'viewer-later' || action === 'viewer-close') {
      closeViewer();
      return;
    }
    if (action === 'viewer-confirm') {
      state.busy = true;
      const r = await call('authConfirmMnemonic', 'confirm');
      state.busy = false;
      if (!r.ok) {
        state.error = errorText(r.error);
        render();
        return;
      }
      if (r.state) state.auth = r.state;
      else if (state.auth) state.auth.mnemonicConfirmed = true;
      if (state.myAutoBlocked === 'auto-login-requires-confirmed-mnemonic') state.myAutoBlocked = '';
      closeViewer();
      return;
    }
  }

  async function submitUsername() {
    const username = String(state.username || '').trim();
    if (!usernameValid(username)) {
      state.error = t('usernameRule');
      state.usernameFocusPending = true;
      render();
      return;
    }
    state.busy = true;
    syncUsernameButton();
    let r = await call('authSetUsername', { username });
    // 主线尚未接 IPC 时回退到现有 profile 保存桥，保证首启流程可用。
    if (!r || !r.ok) {
      const unavailable = !r || r.error === 'auth-unavailable' || r.error === 'not-a-function';
      if (!unavailable) {
        state.busy = false;
        state.error = errorText(r.error);
        state.usernameFocusPending = true;
        render();
        return;
      }
      r = await call('profileBaoCun', { username });
      if (!r || !r.ok) {
        r = await call('profileSave', { username });
      }
      if (!r || !r.ok) {
        state.busy = false;
        state.error = t('usernameSaveFail');
        state.usernameFocusPending = true;
        render();
        return;
      }
    }
    state.busy = false;
    if (r.state) state.auth = r.state;
    finishAuth();
  }

  async function afterLogin(r) {
    if (r.state) state.auth = r.state;
    if (!state.auth) state.auth = await call('authState');
    if (state.auth && !state.auth.mnemonicConfirmed) {
      let mnemonic = r.mnemonic || '';
      let pinyin = r.pinyin || '';
      let friendlyWords = Array.isArray(r.friendlyWords) ? r.friendlyWords : null;
      let friendlyIdioms = Array.isArray(r.friendlyIdioms) ? r.friendlyIdioms : null;
      if (!mnemonic || !friendlyWords || !friendlyIdioms) {
        const v = await call('authViewMnemonic');
        if (v.ok) {
          mnemonic = v.mnemonic || mnemonic;
          pinyin = v.pinyin || pinyin;
          friendlyWords = Array.isArray(v.friendlyWords) ? v.friendlyWords : friendlyWords;
          friendlyIdioms = Array.isArray(v.friendlyIdioms) ? v.friendlyIdioms : friendlyIdioms;
        }
      }
      if (mnemonic) {
        state.reminder = { mnemonic, pinyin, friendlyWords, friendlyIdioms };
        state.pinyinPref = !!state.auth.pinyin;
        setStep('mnemonic-reminder');
        return;
      }
    }
    finishAuth();
  }

  function finishAuth() {
    stopTermsClock();
    state.step = 'done';
    state.bootDone = true;
    state.busy = false;
    state.error = '';
    state.reg = null;
    state.reminder = null;
    state.viewer = null;
    state.username = '';
    hideOverlay();
    clearCard();
    document.body.setAttribute('data-warmy-auth', 'ready');
    try { window.dispatchEvent(new CustomEvent('warmy-auth-ready')); } catch { /* noop */ }
    const resolve = state.resolveBoot;
    state.resolveBoot = null;
    if (resolve) resolve(true);
  }

  async function loadPack(locale) {
    const wanted = resolveLocale(locale);
    try {
      if (resolveLocale(state.locale) === wanted) state.pack = null;
      if (window.warmy && typeof window.warmy.i18n === 'function') {
        const pack = await window.warmy.i18n(locale);
        // 关键修复：warmy:i18n 返回 { strings }，旧代码取 pack.t 导致条款一直是短文案。
        if (pack && typeof pack === 'object') {
          const strings = (pack.strings && Object.keys(pack.strings).length ? pack.strings : pack.t);
          // 连续切换语言时，慢返回的旧请求不能覆盖当前语言。
          if (strings && typeof strings === 'object' && resolveLocale(state.locale) === wanted) {
            state.pack = strings;
          }
        }
      }
    } catch { /* keep dictionary fallback */ }
  }

  async function hasConsent() {
    try {
      const r = await window.warmy.settingsGet?.();
      return !!(r && r.settings && r.settings.privacyConsent);
    } catch {
      return false;
    }
  }

  async function boot() {
    if (state.bootPromise) return state.bootPromise;
    state.bootPromise = new Promise((resolve) => { state.resolveBoot = resolve; });
    ensureOverlay();
    showOverlay();
    state.step = 'loading';
    render();
    const st = await (async () => {
      /** 第 104 轮：数据仓库解包在主进程启动流程里，可能比渲染层晚一点就绪。 */
      let x = await call('authState');
      for (let i = 0; i < 300 && (!x || x.error === 'auth-unavailable'); i++) {
        await new Promise((r) => setTimeout(r, 100));
        x = await call('authState');
      }
      return x;
    })();
    if (!st || st.ok === false) {
      state.fatal = st && st.error ? errorText(st.error) : t('fatal');
      state.step = 'fatal';
      render();
      return state.bootPromise;
    }
    state.auth = st;
    /** 自动化门禁专用旁路（仅当主进程环境变量明确为 1；正常用户启动永远不设） */
    if (st && st.bypass === true) { finishAuth(); return state.bootPromise; }
    let setup = null;
    let settings = null;
    try { setup = await window.warmy.setupState?.(); } catch { /* noop */ }
    try { settings = await window.warmy.settingsGet?.(); } catch { /* noop */ }
    state.locale = resolveLocale(
      (settings && settings.settings && settings.settings.yuYan)
      || (setup && setup.yuYan)
      || navigator.language
      || 'zh-CN',
    );
    await loadPack(state.locale);
    /** 有账号但设置被封存时，settingsGet 读不到；账号本身证明此前已同意过条款，除非有撤销标记。 */
    state.consented = !!(settings && settings.settings && settings.settings.privacyConsent)
      || !!(st.hasAccount && setup && setup.privacyRevoked !== true);
    state.setupDone = !!(setup && setup.done === true) || !!st.hasAccount;
    // 首启（无账号且 setup 未完成）：第一屏只有语言下拉 + 开始。
    if (!st.hasAccount && !state.setupDone) {
      enterLanguage();
      return state.bootPromise;
    }
    // 首次启动尚未同意条款时不得先进登录。
    if (!state.consented) {
      enterTerms();
      return state.bootPromise;
    }
    await enterAuth();
    return state.bootPromise;
  }

  // ── My page card ────────────────────────────────────────────────────────

  let decoratePending = false;
  function scheduleDecorate() {
    if (decoratePending) return;
    decoratePending = true;
    setTimeout(() => {
      decoratePending = false;
      void decorateMyPage();
    }, 30);
  }

  async function decorateMyPage() {
    if (state.step !== 'done') return;
    const page = $('pageTi');
    const ding = page && page.querySelector('.woDing');
    let card = $('warmyAuthMyCard');
    // 主线重排「我的」页时可能预先放好挂载点 / 移除 .woDing：两种都能工作。
    if (!card && !ding) return;
    // 旧凭证块不再显示（账号卡只保留账号/助记词操作）。
    const cred = $('woidVal');
    const credField = cred && cred.closest ? cred.closest('.field') : null;
    if (credField) credField.style.display = 'none';
    for (const id of ['anNiuWoCredLunHuan', 'anNiuWoCredSwitch']) {
      const el = $(id);
      if (el) el.style.display = 'none';
    }
    if (!state.auth || !state.auth.hasAccount || state.auth.bypass) return;
    if (!card) {
      card = document.createElement('div');
      card.id = 'warmyAuthMyCard';
      card.className = 'sheZhiKa warmyAuthMyCard';
      ding.insertAdjacentElement('afterend', card);
    }
    if (card.dataset.r67Bound !== '1') {
      card.addEventListener('click', onMyCardClick);
      card.addEventListener('change', onMyCardChange);
      card.dataset.r67Bound = '1';
    }
    const fresh = await call('authState');
    if (fresh && fresh.ok) state.auth = fresh;
    const a = state.auth || {};
    const bridgeOk = !!(window.warmy && typeof window.warmy.authSetAutoLogin === 'function');
    const pinActionLabel = a.pinConfigured ? t('myPinChange') : t('pinTitle');
    const sep = /^zh/i.test(resolveLocale(state.locale)) ? '：' : ': ';
    const canAuto = bridgeOk && (!!a.autoLogin || (!state.myAutoBlocked && !!a.mnemonicConfirmed));
    const autoHint = !bridgeOk
      ? t('myAutoUnavailable')
      : (state.myAutoBlocked
        ? errorText(state.myAutoBlocked)
        : (a.autoLogin ? t('myAutoHint') : (!a.mnemonicConfirmed ? t('myAutoNeedsMnemonic') : t('myAutoHint'))));
    const sig = [state.locale, a.mnemonicConfirmed, a.autoLogin, a.pinConfigured, bridgeOk, state.myError, state.myAutoBlocked].join('|');
    if (!card.innerHTML.trim()) card.dataset.r67sig = '';
    if (card.dataset.r67sig === sig) return;
    card.dataset.r67sig = sig;
    card.innerHTML = `
      <div class="warmyAuthMyMnemonicLine">
        <span class="warmyAuthMyKey">${escapeHtml(t('myMnemonic'))}${escapeHtml(sep)}</span>
        ${a.mnemonicConfirmed
          ? `<span class="warmyAuthMyValue">${escapeHtml(t('myConfirmed'))}</span>`
          : `<button class="warmyAuthBtn warmyAuthMyView" data-my-action="save-mnemonic">${escapeHtml(t('viewTitle'))}</button>`}
      </div>
      <label class="warmyAuthMyAuto ${canAuto ? '' : 'warmyAuthDisabled'}" title="${escapeHtml(autoHint)}">
        <input type="checkbox" id="warmyMyAuto" data-my-action="auto-login" ${a.autoLogin ? 'checked' : ''} ${canAuto ? '' : 'disabled'}/>
        <span>${escapeHtml(t('myAuto'))}</span>
      </label>
      ${state.myError ? `<div class="warmyAuthError">${escapeHtml(state.myError)}</div>` : ''}
      <div class="warmyAuthMyButtons">
        <button class="warmyAuthBtn" data-my-action="change-pin" ${a.autoLogin ? 'disabled' : ''}
                title="${escapeHtml(a.autoLogin ? t('myPinDisabled') : '')}">${escapeHtml(pinActionLabel)}</button>
        <button class="warmyAuthBtn warmyAuthBtnDanger" data-my-action="logout">${escapeHtml(t('logout'))}</button>
      </div>`;
  }

  function onMyCardChange(e) {
    const target = e.target;
    if (!target || target.id !== 'warmyMyAuto') return;
    const want = !!target.checked;
    if (!want) {
      /**
       * R78 #9：取消自动登录前必须先设置 PIN。取消/关闭 PIN 弹窗 ⇒ 不生效，
       * 自动登录保持勾选（重新渲染把复选框恢复）。
       */
      void (async () => {
        const ok = await openChangePinModal({ afterPin: 'disable-auto' });
        if (!ok) {
          const box = $('warmyMyAuto');
          if (box) box.checked = true;
          const card = $('warmyAuthMyCard');
          if (card) card.dataset.r67sig = '';
          void decorateMyPage();
          return;
        }
        await toggleMyAuto(false);
      })();
      return;
    }
    /**
     * 第 78 轮 项 1：勾选「自动登录」先二次确认。取消 ⇒ 保持未勾选，
     * 不改认证库、不写绑定（重新渲染账号卡把勾选框恢复成未选）。
     */
    void (async () => {
      const ok = await askConfirm(
        tOr('myAutoConfirmTitle', '开启本机自动登录'),
        tOr('myAutoConfirmBody', '开启后本机会自动登录，不再每次输入 PIN。更改设备的硬件或系统升级都可能导致失效，助记词是唯一的恢复方法。确定开启吗？'),
        tOr('autoEnable', '自动登录（绑定本机）'),
        false,
      );
      if (!ok) {
        const box = $('warmyMyAuto');
        if (box) box.checked = false;
        const card = $('warmyAuthMyCard');
        if (card) card.dataset.r67sig = '';
        void decorateMyPage();
        return;
      }
      await toggleMyAuto(true);
    })();
  }

  async function toggleMyAuto(want) {
    state.myError = '';
    const card = $('warmyAuthMyCard');
    if (card) card.dataset.r67sig = '';
    const r = await call('authSetAutoLogin', want);
    if (!r || !r.ok) {
      state.myError = errorText(r && r.error);
      if (r && ['os-protection-unavailable', 'auto-login-failed', 'auto-login-requires-confirmed-mnemonic'].includes(r.error)) {
        state.myAutoBlocked = r.error;
      }
      if (card) card.dataset.r67sig = '';
      void decorateMyPage();
      return;
    }
    state.myAutoBlocked = '';
    if (r.state) state.auth = r.state;
    if (card) card.dataset.r67sig = '';
    void decorateMyPage();
  }

  function onMyCardClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-my-action]') : null;
    if (!el) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
    const action = el.getAttribute('data-my-action');
    if (action === 'save-mnemonic') {
      void openMnemonic();
      return;
    }
    if (action === 'logout') {
      void (async () => {
        const ok = await askConfirm(t('logout'), t('logoutConfirm'), t('logout'), false);
        if (!ok) return;
        await doLogout();
      })();
      return;
    }
    if (action === 'change-pin') {
      openChangePinModal();
    }
  }

  function openChangePinModal(opts = {}) {
    return new Promise((resolve) => {
    const pinLabel = state.auth && state.auth.pinConfigured ? t('myPinChange') : t('pinTitle');
    const modal = document.createElement('div');
    modal.className = 'warmyAuthModal';
    modal.innerHTML = `
      <div class="warmyAuthModalCard" role="dialog" aria-modal="true">
        <div class="warmyAuthTitle">${escapeHtml(pinLabel)}</div>
        <div class="warmyAuthModalBody">${escapeHtml(t('pinBody'))}</div>
        <input id="warmyChangePin1" class="warmyAuthInput" type="password" maxlength="20" autocomplete="new-password" placeholder="${escapeHtml(t('pin1'))}"/>
        <input id="warmyChangePin2" class="warmyAuthInput" type="password" maxlength="20" autocomplete="new-password" placeholder="${escapeHtml(t('pin2'))}"/>
        <div class="warmyAuthError" id="warmyChangePinError" style="display:none"></div>
        <div class="warmyAuthActions">
          <button class="warmyAuthBtn" data-modal="cancel">${escapeHtml(t('cancel'))}</button>
          <button class="warmyAuthBtn warmyAuthBtnPrimary" data-modal="ok">${escapeHtml(pinLabel)}</button>
        </div>
      </div>`;
    const close = (ok) => { modal.remove(); resolve(!!ok); };
    modal.addEventListener('click', async (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('[data-modal]') : null;
      if (!b) return;
      if (b.getAttribute('data-modal') === 'cancel') { close(false); return; }
      const p1 = $('warmyChangePin1');
      const p2 = $('warmyChangePin2');
      const errEl = $('warmyChangePinError');
      const pin = p1 ? p1.value : '';
      const confirmPin = p2 ? p2.value : '';
      const fail = (msg) => {
        if (errEl) { errEl.style.display = ''; errEl.textContent = msg; }
      };
      if (!/^[A-Za-z0-9]{4,20}$/.test(pin)) { fail(t('pinRule')); return; }
      if (pin !== confirmPin) { fail(t('pinMismatch')); return; }
      b.disabled = true;
      const r = await call('authChangePin', { pin, confirmPin, ...(opts.afterPin === 'disable-auto' ? { disableAutoLogin: true } : {}) });
      if (!r.ok) {
        b.disabled = false;
        fail(errorText(r.error));
        return;
      }
      close(true);
      if (opts.afterPin) return;
      try { alert(t('myChangeOk')); } catch { /* noop */ }
      location.reload();
    });
    document.body.appendChild(modal);
    setTimeout(() => { try { $('warmyChangePin1')?.focus(); } catch { /* noop */ } }, 30);
    });
  }

  // ── confirmation / viewer / logout ──────────────────────────────────────

  function askConfirm(title, body, okText, danger, cancelText) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'warmyAuthModal';
      modal.innerHTML = `
        <div class="warmyAuthModalCard" role="dialog" aria-modal="true">
          ${title ? `<div class="warmyAuthTitle">${escapeHtml(title)}</div>` : ''}
          <div class="warmyAuthModalBody">${escapeHtml(body)}</div>
          <div class="warmyAuthActions">
            <button class="warmyAuthBtn" data-modal="cancel">${escapeHtml(cancelText || t('cancel'))}</button>
            <button class="warmyAuthBtn ${danger ? 'warmyAuthBtnDanger' : 'warmyAuthBtnPrimary'}" data-modal="ok">${escapeHtml(okText)}</button>
          </div>
        </div>`;
      const close = (answer) => {
        modal.remove();
        resolve(answer);
      };
      modal.addEventListener('click', (ev) => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-modal]') : null;
        if (!b) return;
        close(b.getAttribute('data-modal') === 'ok');
      });
      document.body.appendChild(modal);
      setTimeout(() => { try { modal.querySelector('[data-modal="ok"]')?.focus(); } catch { /* noop */ } }, 30);
    });
  }

  function closeViewer() {
    state.viewer = null;
    state.error = '';
    if (!state.bootDone) {
      state.step = 'login';
      render();
      return;
    }
    state.step = 'done';
    hideOverlay();
    clearCard();
    void decorateMyPage();
  }

  async function openMnemonic() {
    const fresh = await call('authState');
    if (fresh && fresh.ok) state.auth = fresh;
    if (!state.auth || !state.auth.hasAccount) {
      try { alert(t('noAccount')); } catch { /* noop */ }
      return;
    }
    const r = await call('authViewMnemonic');
    if (!r.ok) {
      try { alert(errorText(r.error)); } catch { /* noop */ }
      return;
    }
    state.viewer = {
      mnemonic: r.mnemonic,
      pinyin: r.pinyin,
      friendlyWords: Array.isArray(r.friendlyWords) ? r.friendlyWords : null,
      friendlyIdioms: Array.isArray(r.friendlyIdioms) ? r.friendlyIdioms : null,
    };
    state.pinyinPref = !!state.auth.pinyin;
    state.mnemonicHidden = false;
    state.step = 'viewer';
    state.error = '';
    showOverlay();
    render();
  }

  async function doLogout() {
    /**
     * 第 67 轮 项 4：**退出必须真的退出**。如果保留自动登录记录，reload 后 enterAuth 会立刻
     * 自动登录回来，用户看到的“退出”等于没做。退出时清掉本机自动登录绑定；
     * 用户下次登录后可在“我的”里重新勾选。
     */
    try { await call('authSetAutoLogin', false); } catch { /* 没接上就继续退出 */ }
    const r = await call('authLogout');
    if (!r || r.ok === false) {
      state.error = String((r && r.error) || 'logout-failed');
      render();
      return;
    }
    location.reload();
  }

  // Expose a tiny API for app.js / My page. No secrets are stored on window.
  window.__warmyAuthGate = {
    boot,
    logout: doLogout,
    openMnemonic,
    viewMnemonic: openMnemonic,
    decorateMyPage,
    state: () => state.auth,
  };

  // 引导已由 app.js 的「开始使用」清单接管（R98 删除旧 spotlight 漫游层）。
  // 登录页的内嵌按钮宽度随语言变化：窗口缩放/语言切换后要重新留出右侧空间
  // （原监听器与漫游层写在同一个块里，删除漫游层时必须保留这一条）。
  try {
    window.addEventListener('resize', () => {
      if (state.step === 'login') fitPinInline();
    });
  } catch { /* noop */ }

  // app.js renders the My page repeatedly; a light observer is enough because
  // the auth card is idempotent and only touches the credential block.
  try {
    const page = $('pageTi');
    if (page) new MutationObserver(scheduleDecorate).observe(page, { childList: true, subtree: true });
    setInterval(scheduleDecorate, 1500);
  } catch { /* noop */ }

  // 登录后用户可能在设置里改语言：让「我的页」账号卡跟着换，不打断认证流程。
  try {
    window.warmy?.onSettingsChanged?.((d) => {
      try {
        const keys = Array.isArray(d && d.keys) ? d.keys : [];
        if (keys.length && !keys.includes('yuYan')) return;
        void (async () => {
          try {
            if (state.step !== 'done') return;
            const r = await window.warmy.settingsGet?.();
            const yu = r && r.settings && r.settings.yuYan;
            if (!yu) return;
            const next = resolveLocale(yu);
            if (next === state.locale) return;
            state.locale = next;
            const card = $('warmyAuthMyCard');
            if (card) card.dataset.r67sig = '';
            void decorateMyPage();
          } catch { /* noop */ }
        })();
      } catch { /* noop */ }
    });
  } catch { /* noop */ }

  // ── 窗口失焦时隐藏助记词（防截图/防旁人瞥见） ─────────────────────────
  const hideMnemonicOnBlur = () => {
    if (!['mnemonic-register', 'mnemonic-reminder', 'viewer'].includes(state.step)) return;
    if (state.mnemonicHidden) return;
    state.mnemonicHidden = true;
    try { render(); } catch { /* 隐藏失败不影响登录 */ }
  };
  try { window.addEventListener('blur', hideMnemonicOnBlur); } catch { /* noop */ }
  try {
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideMnemonicOnBlur(); });
  } catch { /* noop */ }

  // Keep the gate visible even if app.js throws before calling boot().
  ensureOverlay();
  showOverlay();
  render();
})();
