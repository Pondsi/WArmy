/**
 * Electron preload — 白名单 API
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warmy', {
  hardware: () => ipcRenderer.invoke('warmy:yingJian'),
  listInstances: () => ipcRenderer.invoke('warmy:lieBiaoShiLiJi'),
  spawnInstance: (cfg) => ipcRenderer.invoke('warmy:paiShengShiLi', cfg),
  stopInstance: (id) => ipcRenderer.invoke('warmy:tingZhiShiLi', id),
  securityMode: () => ipcRenderer.invoke('warmy:anQuanMoShi'),
  setSecurityMode: (mode) => ipcRenderer.invoke('warmy:sheZhiAnQuanMoShi', mode),
  memoryRecall: (q) => ipcRenderer.invoke('warmy:jiYiHuiSuo', q),
  memoryAppend: (ti) => ipcRenderer.invoke('warmy:jiYiZhuiJia', ti),
  memoryRetrieve: (payload) => ipcRenderer.invoke('warmy:jiYiJianSuo', payload),
  memoryStatus: () => ipcRenderer.invoke('warmy:jiYiZhuangTai'),
  memoryRebuild: () => ipcRenderer.invoke('warmy:jiYiChongJian'),
  i18n: (yuYan) => ipcRenderer.invoke('warmy:i18n', yuYan),
  localeInfo: () => ipcRenderer.invoke('warmy:yuYanXinXi'),
  setThemeSource: (s) => ipcRenderer.invoke('warmy:sheZhiZhuTiLaiYuan', s),
  themeInfo: () => ipcRenderer.invoke('warmy:zhuTiXinXi'),
  listModels: (cfg) => ipcRenderer.invoke('warmy:lieBiaoMoXingJi', cfg),
  pickSound: () => ipcRenderer.invoke('warmy:xuanZeSound'),
  checkUpdate: () => ipcRenderer.invoke('warmy:jianChaGengXin'),
  pickFile: () => ipcRenderer.invoke('warmy:xuanZeWenJian'),
  groupCreate: (cfg) => ipcRenderer.invoke('warmy:qunChuangJian', cfg),
  groupList: () => ipcRenderer.invoke('warmy:qunLieBiao'),
  updateSourceGet: () => ipcRenderer.invoke('warmy:gengXinLaiYuanQu'),
  updateSourceSet: (payload) => ipcRenderer.invoke('warmy:gengXinLaiYuanSheZhi', payload),
  groupMessage: (xiaoXi) => ipcRenderer.invoke('warmy:qunXiaoXi', xiaoXi),
  groupJoinInstance: (groupId, instanceId) => ipcRenderer.invoke('warmy:qunJiaRuShiLi', groupId, instanceId),
  boardTasks: (groupId) => ipcRenderer.invoke('warmy:kanbanRenwuJi', groupId),
  boardEvents: () => ipcRenderer.invoke('warmy:kanbanShiJianJi'),
  boardAggregate: () => ipcRenderer.invoke('warmy:kanbanJuHe'),
  setProvider: (cfg) => ipcRenderer.invoke('warmy:sheZhiGongYingShang', cfg),
  getProvider: () => ipcRenderer.invoke('warmy:quGongYingShang'),
  // 凭证：ID 就是私钥；更换凭证会**同时**换身份（保证"ID = 私钥"不被打破）
  credentialRotate: () => ipcRenderer.invoke('warmy:pingZhengLunHuan'),
  // 供应商密钥只进安全存储（safeStorage）；界面永远读不回明文
  providerKeySet: (payload) => ipcRenderer.invoke('warmy:gongYingShangMiYaoSheZhi', payload),
  providerKeyHas: (payload) => ipcRenderer.invoke('warmy:gongYingShangMiYaoHas', payload),
  providerKeyClear: (payload) => ipcRenderer.invoke('warmy:gongYingShangMiYaoQingChu', payload),
  chatSend: (xiaoXi) => ipcRenderer.invoke('warmy:liaoTianFaSong', xiaoXi),
  checkpointCreate: (phase) => ipcRenderer.invoke('warmy:checkpointChuangJian', phase),
  checkpointList: () => ipcRenderer.invoke('warmy:checkpointLieBiao'),
  checkpointRollback: (id) => ipcRenderer.invoke('warmy:checkpointHuiGun', id),
  knowledgeQuery: (q) => ipcRenderer.invoke('warmy:zhiShiQuery', q),
  knowledgeAddEvent: (Shi) => ipcRenderer.invoke('warmy:zhiShiTianJiaShiJian', Shi),
  setInsertMode: (sessionId, mode) => ipcRenderer.invoke('warmy:sheZhiInsertMoShi', sessionId, mode),
  getInsertMode: (sessionId) => ipcRenderer.invoke('warmy:quInsertMoShi', sessionId),
  metricsSummary: () => ipcRenderer.invoke('warmy:zhiBiaoJiZhaiYao'),
  metricsTurns: () => ipcRenderer.invoke('warmy:zhiBiaoJiLunCi'),
  metricsTools: () => ipcRenderer.invoke('warmy:zhiBiaoJiGongJu'),
  chatLog: (payload) => ipcRenderer.invoke('warmy:liaoTianRiZhi', payload),
  // 会话消息正文：多窗口共用同一份（主进程日志 = 唯一事实来源）
  chatMessages: (payload) => ipcRenderer.invoke('warmy:liaoTianXiaoXiJi', payload),
  /** 把消息补写进主进程日志（唯一事实来源）——两处视图才真的是同一套数据 */
  chatLogAppend: (payload) => ipcRenderer.invoke('warmy:liaoTianRiZhiZhuiJia', payload),
  chatLogRestore: () => ipcRenderer.invoke('warmy:liaoTianRiZhiHuiFu'),
  settingsGet: () => ipcRenderer.invoke('warmy:peiZhiQu'),
  settingsSave: (partial) => ipcRenderer.invoke('warmy:peiZhiBaoCun', partial),
  // ADR 004：执行环境探测（只探测，不安装不下载不提权）与启停（只接受预定义 id + 'start'|'stop'）
  containerProbe: (opts) => ipcRenderer.invoke('warmy:rongQiTanCe', opts),
  containerAction: (payload) => ipcRenderer.invoke('warmy:rongQiDongZuo', payload),
  // 容器实例（具体容器/发行版）：列出来、起停单个、以及打开容器产品自己的界面
  containerInstances: (payload) => ipcRenderer.invoke('warmy:rongQiShiLiJi', payload),
  containerInstanceAction: (payload) => ipcRenderer.invoke('warmy:rongQiShiLiDongZuo', payload),
  containerAppOpen: (payload) => ipcRenderer.invoke('warmy:rongQiYingYongDaKai', payload),
  // 容器内 shell（P4，= 控制台本体）：只接受 { runtimeId, action, sessionId, data }；
  // action 是**枚举**（daKai/write/close/status），**不接受任何命令字符串**。
  containerShell: (payload) => ipcRenderer.invoke('warmy:rongQiKongZhiTai', payload),
  // 项目可用性状态（容器开发项目+容器没起 ⇒ 不可用；被创建者停用 ⇒ 不可用；
  // 两者都等同"创建者下线"、**历史仍可读**）。渲染层的**唯一**事实来源，不自己推一套。
  projectState: (payload) => ipcRenderer.invoke('warmy:xiangMuTai', payload),
  // 右键菜单：启用/停用项目（只接受 { sessionId }；只有创建者能调用，容器没起时启用会被拒并给引导）
  projectEnable: (payload) => ipcRenderer.invoke('warmy:xiangMuQiYong', payload),
  projectDisable: (payload) => ipcRenderer.invoke('warmy:xiangMuTingYong', payload),
  // 右键菜单：切换容器（只接受 { sessionId, runtimeId }；runtimeId 必须是已探测到的预定义 id）
  projectSetContainer: (payload) => ipcRenderer.invoke('warmy:xiangMuSheZhiRongQi', payload),
  // 右侧三块面板的真实数据：最近改动文件 / 其他文件 / 生成的产品
  projectFiles: (payload) => ipcRenderer.invoke('warmy:xiangMuWenJianJi', payload),
  // 项目环境状态（当前容器 / 固化能力 / 上次固化时间）与「固化当前环境」
  // 固化能力**按运行时区分**（Docker/Podman 可 commit；WSL 没有 commit）；不能固化就如实拒绝。
  projectEnvStatus: (payload) => ipcRenderer.invoke('warmy:xiangMuHuanJingZhuangTai', payload),
  projectEnvSolidify: (payload) => ipcRenderer.invoke('warmy:xiangMuHuanJingGuHua', payload),
  // ADR 004 第十六批：
  //  · projectEnvRollback  = 回滚到固化点（真的从固化镜像起一个容器）
  //  · projectExec         = 把项目的命令送进容器（只接受**固定命令枚举**，没有命令字符串）
  //  · projectLedger       = 工具文件访问台账（**项目级、成员可见**）
  //  · projectSetDirectory = 把项目目录记进项目记录（目录由主进程弹窗选）
  //  · projectFsGuard      = 宿主目录加锁/撤销/状态（最小侵入、可一键撤销）
  projectEnvRollback: (payload) => ipcRenderer.invoke('warmy:xiangMuHuanJingHuiGun', payload),
  projectExec: (payload) => ipcRenderer.invoke('warmy:xiangMuZhiXing', payload),
  projectLedger: (payload) => ipcRenderer.invoke('warmy:xiangMuZhangBen', payload),
  projectSetDirectory: (payload) => ipcRenderer.invoke('warmy:xiangMuSheZhiMuLu', payload),
  projectFsGuard: (payload) => ipcRenderer.invoke('warmy:xiangMuWenJianXiTongShouWei', payload),
  // 「运行」产物：入口路径**由主进程自己解析**（渲染层只给 sessionId），且必须可在本机运行
  productRun: (payload) => ipcRenderer.invoke('warmy:chanPinYunXing', payload),
  // 待执行队列持久化（渲染层 state.queues）+ Router 队列只读快照
  uiQueuesGet: () => ipcRenderer.invoke('warmy:uiDuiLieJiQu'),
  uiQueuesSet: (queues) => ipcRenderer.invoke('warmy:uiDuiLieJiSheZhi', { queues }),
  routerQueuesGet: () => ipcRenderer.invoke('warmy:luYouQiDuiLieJiQu'),
  profileGet: () => ipcRenderer.invoke('warmy:profileQu'),
  appInfo: () => ipcRenderer.invoke('warmy:yingYongXinXi'),
  skillsList: () => ipcRenderer.invoke('warmy:jinengJiLieBiao'),
  skillsRemove: (id) => ipcRenderer.invoke('warmy:jinengJiYiChu', id),
  skillsImport: () => ipcRenderer.invoke('warmy:jinengJiDaoRu'),
  pickDirectory: () => ipcRenderer.invoke('warmy:xuanZeMuLu'),
  scanMachine: (kind) => ipcRenderer.invoke('warmy:saoMiaoJiQi', kind),
  privacyConsentSet: (consent) => ipcRenderer.invoke('warmy:yinSiTongYiSheZhi', consent),
  appQuit: (reason) => ipcRenderer.invoke('warmy:yingYongTuiChu', reason),
  identityCredential: () => ipcRenderer.invoke('warmy:shenFenPingZheng'),
  credentialInfo: () => ipcRenderer.invoke('warmy:pingZhengXinXi'),
  credentialRestore: (credential) => ipcRenderer.invoke('warmy:pingZhengHuiFu', credential),
  identityBackupImport: (payload) => ipcRenderer.invoke('warmy:shenFenBeiFenDaoRu', payload),
  pluginsScanDirsGet: () => ipcRenderer.invoke('warmy:chaJianJiSaoMiaoMuLuJiQu'),
  pluginsScanDirsSet: (dirs) => ipcRenderer.invoke('warmy:chaJianJiSaoMiaoMuLuJiSheZhi', dirs),
  pluginsScan: () => ipcRenderer.invoke('warmy:chaJianJiSaoMiao'),
  assistList: (sessionId) => ipcRenderer.invoke('warmy:assistLieBiao', sessionId),
  assistUpsert: (payload) => ipcRenderer.invoke('warmy:assistGengXinHuoChaRu', payload),
  skillsPaths: () => ipcRenderer.invoke('warmy:jinengJiLuJingJi'),
  // Skill auto-discovery directories ride the EXISTING settings channel.
  skillsScanDirsGet: () => ipcRenderer.invoke('warmy:jinengJiSaoMiaoMuLuJiQu'),
  skillsScanDirsSet: (dirs) => ipcRenderer.invoke('warmy:jinengJiSaoMiaoMuLuJiSheZhi', dirs),
  skillsSetEnabled: (payload) => ipcRenderer.invoke('warmy:jinengJiSheZhiEnabled', payload),
  projectMemoryGet: (payload) => ipcRenderer.invoke('warmy:xiangMuJiYiQu', payload),
  projectMemorySet: (payload) => ipcRenderer.invoke('warmy:xiangMuJiYiSheZhi', payload),
  aiQuestionOpen: (payload) => ipcRenderer.invoke('warmy:aiWenTiDaKai', payload),
  aiQuestionList: (groupId) => ipcRenderer.invoke('warmy:aiWenTiLieBiao', groupId),
  aiQuestionAnswer: (payload) => ipcRenderer.invoke('warmy:aiWenTiAnswer', payload),
  trayTooltip: (text) => ipcRenderer.invoke('warmy:tuoPanTiShi', text),
  profileSave: (p) => ipcRenderer.invoke('warmy:profileBaoCun', p),
  // 身份层（ADR 003）：指纹 / 代次 / 名片 / 换证 / 备份导出
  identityInfo: () => ipcRenderer.invoke('warmy:shenFenXinXi'),
  identityRotate: (payload) => ipcRenderer.invoke('warmy:shenFenLunHuan', payload),
  identityBackupExport: (payload) => ipcRenderer.invoke('warmy:shenFenBeiFenDaoChu', payload),
  identityVerifyRotation: (payload) => ipcRenderer.invoke('warmy:shenFenYanZhengLunHuan', payload),
  identitySetPassphrase: (payload) => ipcRenderer.invoke('warmy:shenFenSheZhiMiMaKouLing', payload),
  // 本机留存的名片历史（换证横幅展示"旧联系方式"用；不从换证声明读）
  identityCardHistory: () => ipcRenderer.invoke('warmy:shenFenKaLiShi'),
  // 接收方侧：对端名片 + 7 天冻结期（本机各自判定）
  identityPeerContact: (zhiWen) => ipcRenderer.invoke('warmy:shenFenDuiDuanLianXi', zhiWen),
  identityPeerCard: (payload) => ipcRenderer.invoke('warmy:shenFenDuiDuanKa', payload),
  identityPeerRotation: (payload) => ipcRenderer.invoke('warmy:shenFenDuiDuanLunHuan', payload),
  identityPeerConfirm: (zhiWen) => ipcRenderer.invoke('warmy:shenFenDuiDuanQueRen', zhiWen),
  // 身份变更横幅（附六）：本机换证 + 对端换证；ack 必须审计成功才算数
  identityChanges: (payload) => ipcRenderer.invoke('warmy:shenFenBianGengJi', payload),
  identityChangeAcknowledge: (payload) => ipcRenderer.invoke('warmy:shenFenBianGengQueRen', payload),
  // 本机已知的**全部**对端名片状态（「有谁换了证」）
  identityPeers: () => ipcRenderer.invoke('warmy:shenFenDuiDuanJi'),
  // 成员证书 + 吊销列表（ADR §附八.8）：签发 / 换证重签 / 吊销 / 收证书 / 同步吊销列表 / 名册判定
  membershipList: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeLieBiao', payload),
  membershipAuthorize: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeShouQuan', payload),
  membershipIssue: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeQianFa', payload),
  membershipRotate: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeLunHuan', payload),
  membershipRevoke: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeCheXiao', payload),
  membershipReceiveCert: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeJieShouZhengShu', payload),
  membershipSyncRevocation: (payload) => ipcRenderer.invoke('warmy:chengYuanMingCeTongBuCheXiao', payload),
  profileSetPassword: (pw) => ipcRenderer.invoke('warmy:profileSheZhiPassword', pw),
  profileLogin: (pw) => ipcRenderer.invoke('warmy:profileLogin', pw),
  saveVoice: (data) => ipcRenderer.invoke('warmy:baoCunYuYin', data),
  nodesList: () => ipcRenderer.invoke('warmy:jieDianJiLieBiao'),
  nodesPair: (nodeId, ming) => ipcRenderer.invoke('warmy:jieDianJiPeiDui', nodeId, ming),
  nodesRevoke: (nodeId) => ipcRenderer.invoke('warmy:jieDianJiCheXiao', nodeId),
  inviteCreate: (groupId) => ipcRenderer.invoke('warmy:yaoQingChuangJian', groupId),
  syncPublish: (env) => ipcRenderer.invoke('warmy:tongBuFaBu', env),
  syncPull: (nodeId) => ipcRenderer.invoke('warmy:tongBuLaQu', nodeId),
  dshAvailable: () => ipcRenderer.invoke('warmy:dshKeYong'),
  dshStatus: () => ipcRenderer.invoke('warmy:dshZhuangTai'),
  dshInstall: () => ipcRenderer.invoke('warmy:dshAnZhuang'),
  // 兼容：旧英文频道名
  // (handlers also accept warmy:group-create via alias table)
  spawnDshInstance: (cfg) => ipcRenderer.invoke('warmy:paiShengdshShiLi', cfg),
  emailQueue: (mail) => ipcRenderer.invoke('warmy:youJianDuiLie', mail),
  emailList: () => ipcRenderer.invoke('warmy:youJianLieBiao'),
  smtpVerify: (cfg) => ipcRenderer.invoke('warmy:smtpYanZheng', cfg),
  smtpList: () => ipcRenderer.invoke('warmy:smtpLieBiao'),
  smtpAdd: (leiJi) => ipcRenderer.invoke('warmy:smtpTianJia', leiJi),
  smtpRemove: (id) => ipcRenderer.invoke('warmy:smtpYiChu', id),
  smtpUpdate: (id, patch) => ipcRenderer.invoke('warmy:smtpGengXin', id, patch),
  lanStart: (port) => ipcRenderer.invoke('warmy:neiWangQiDong', port),
  lanStop: () => ipcRenderer.invoke('warmy:neiWangTingZhi'),
  lanSend: (xiaoXi) => ipcRenderer.invoke('warmy:neiWangFaSong', xiaoXi),
  lanInbox: () => ipcRenderer.invoke('warmy:neiWangShouXiang'),
  lanStatus: () => ipcRenderer.invoke('warmy:neiWangZhuangTai'),
  lanDualSmoke: (opts) => ipcRenderer.invoke('warmy:neiWangShuangJiMaoYan', opts),
  webgpuProbe: () => ipcRenderer.invoke('warmy:webgpuTanCe'),
  meshStart: (port) => ipcRenderer.invoke('warmy:wangZhuangQiDong', port),
  meshStop: () => ipcRenderer.invoke('warmy:wangZhuangTingZhi'),
  peersList: () => ipcRenderer.invoke('warmy:duiDuanJiLieBiao'),
  peersAdd: (p) => ipcRenderer.invoke('warmy:duiDuanJiTianJia', p),
  peersRemove: (id) => ipcRenderer.invoke('warmy:duiDuanJiYiChu', id),
  meshBroadcast: (payload, groupId) => ipcRenderer.invoke('warmy:wangZhuangGuangBo', payload, groupId),
  meshInbox: () => ipcRenderer.invoke('warmy:wangZhuangShouXiang'),
  meshStatus: () => ipcRenderer.invoke('warmy:wangZhuangZhuangTai'),
  // 组网状态 / 探测（R8/R9/R11）：真实现 = 本机地址、TCP 连通性、DNS、出站探测、活会话表；
  // 入站可达性本机无法验证（inboundVerified 恒 false），拿不到就如实降级，不假装检测通过。
  netStatus: () => ipcRenderer.invoke('warmy:wangLuoZhuangTai'),
  netProbe: (payload) => ipcRenderer.invoke('warmy:wangLuoTanCe', payload),
  netLocalAddress: () => ipcRenderer.invoke('warmy:wangLuoBenJiDiZhi'),
  netMembersPresence: (payload) => ipcRenderer.invoke('warmy:wangLuoChengYuanJiZaiChang', payload),
  // R13：**实测**的候选端口（只读；只探测，不绑定、不改配置）——带 status，不只是端口数组
  netPortCandidates: (payload) => ipcRenderer.invoke('warmy:wangLuoDuanKouHouXuanJi', payload),
  meshEnable: (payload) => ipcRenderer.invoke('warmy:wangLuoWangZhuangQiYong', payload),
  meshDisable: () => ipcRenderer.invoke('warmy:wangLuoWangZhuangTingYong'),
  netMeshAnnounce: (reason) => ipcRenderer.invoke('warmy:wangLuoWangZhuangGuangBo', reason),
  // 本体协作层：ref / 路径门禁 + 租约（写操作前 acquire、写完 release）
  repoGuardCheckRef: (payload) => ipcRenderer.invoke('warmy:cangKuShouWeiJianChaYinYong', payload),
  repoGuardCheckPaths: (payload) => ipcRenderer.invoke('warmy:cangKuShouWeiJianChaLuJingJi', payload),
  repoGuardPreReceive: (payload) => ipcRenderer.invoke('warmy:cangKuShouWeiYuXianJieShou', payload),
  repoGuardInstallHooks: (payload) => ipcRenderer.invoke('warmy:cangKuShouWeiAnZhuangGouZiJi', payload),
  repoGuardStatus: () => ipcRenderer.invoke('warmy:cangKuShouWeiZhuangTai'),
  leaseAcquire: (payload) => ipcRenderer.invoke('warmy:zuYueHuoQu', payload),
  leaseRelease: (payload) => ipcRenderer.invoke('warmy:zuYueShiFang', payload),
  leaseList: () => ipcRenderer.invoke('warmy:zuYueLieBiao'),
  leaseCheck: (payload) => ipcRenderer.invoke('warmy:zuYueJianCha', payload),
  winMinimize: () => ipcRenderer.invoke('warmy:winZuiXiaoHua'),
  winMaximize: () => ipcRenderer.invoke('warmy:winZuiDaHua'),
  winClose: () => ipcRenderer.invoke('warmy:winGuanBi'),
  winReload: () => ipcRenderer.invoke('warmy:winChongXinJiaZai'),
  groupOrchestrate: (xiaoXi) => ipcRenderer.invoke('warmy:qunXieTiao', xiaoXi),
  requestApproval: (Qiu) => ipcRenderer.invoke('warmy:qingQiuPiZhun', Qiu),
  approvalRespond: (id, allowed, scope) => ipcRenderer.invoke('warmy:piZhunHuiYing', id, allowed, scope),
  onApprovalRequest: (cb) => ipcRenderer.on('warmy:piZhunQingQiu', (_e, d) => cb(d)),
  /**
   * 跨窗口同步：主窗口与独立会话窗是同一份数据的两个视图。
   *  · chatUpdated：某个会话的日志被追加过 → 正在看它的窗口重新拉一次；
   *  · settingsChanged：设置被另一个窗口改过 → 重新应用（主题/语言/供应商等）。
   * 都返回一个取消订阅函数，避免窗口内重复注册。
   */
  onChatUpdated: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('warmy:liaoTianUpdated', h);
    return () => ipcRenderer.removeListener('warmy:liaoTianUpdated', h);
  },
  onSettingsChanged: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('warmy:peiZhiChanged', h);
    return () => ipcRenderer.removeListener('warmy:peiZhiChanged', h);
  },
  /**
   * **实体级状态变了**（群定向开关 / 项目启用停用 / 项目属性）。
   * 同一个会话在"主界面"和"独立窗口"两处显示 —— 两边都要按同一份事实重画。
   */
  onEntityUpdated: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('warmy:shiTiUpdated', h);
    return () => ipcRenderer.removeListener('warmy:shiTiUpdated', h);
  },
  // T194 控制台：主进程**推送**真实事件（工具调用开始/结束、组网事件、错误）。
  // 只推结构化事实（cat/code/data），文案与打码都在渲染层 —— preload 不做业务判断。
  // 返回退订函数，便于重复注册时干净解绑。
  onConsoleEvent: (cb) => {
    const handler = (_e, d) => { try { cb(d); } catch { /* 渲染层自己的异常不该带崩 IPC 通道 */ } };
    ipcRenderer.on('warmy:kongZhiTaiShiJian', handler);
    return () => { try { ipcRenderer.removeListener('warmy:kongZhiTaiShiJian', handler); } catch { /* noop */ } };
  },
  checkpointAuto: (phase, logSeq) => ipcRenderer.invoke('warmy:checkpointZiDong', phase, logSeq),
  costSummary: () => ipcRenderer.invoke('warmy:chengBenZhaiYao'),
  executorsStatus: () => ipcRenderer.invoke('warmy:zhiXingQiJiZhuangTai'),
  executorsRunBrief: (payload) => ipcRenderer.invoke('warmy:zhiXingQiJiYunXingJianYao', payload),
  stateSave: (s) => ipcRenderer.invoke('warmy:taiBaoCun', s),
  stateLoad: () => ipcRenderer.invoke('warmy:taiJiaZai'),
  asrTranscribe: (p) => ipcRenderer.invoke('warmy:asrZhuanXie', p),
  openChatWindow: (payload) => ipcRenderer.invoke('warmy:daKaiLiaoTianChuangKou', payload),
  registerHotkey: (accel) => ipcRenderer.invoke('warmy:zhuCeKuaiJieJian', accel),
  trayInit: () => ipcRenderer.invoke('warmy:tuoPanChuShi'),
  exportSession: (payload) => ipcRenderer.invoke('warmy:daoChuHuiHua', payload),
  autoUpdateCheck: () => ipcRenderer.invoke('warmy:ziDongGengXinJianCha'),
  auditLog: (limit) => ipcRenderer.invoke('warmy:shenJiRiZhi', limit),
  auditClear: () => ipcRenderer.invoke('warmy:shenJiQingChu'),
  secureKeySave: (payload) => ipcRenderer.invoke('warmy:anQuanMiYaoBaoCun', payload),
  secureKeyLoad: (id) => ipcRenderer.invoke('warmy:anQuanMiYaoJiaZai', id),
  archiveExternal: (payload) => ipcRenderer.invoke('warmy:guiDangWaiBu', payload),
  archiveList: (groupId) => ipcRenderer.invoke('warmy:guiDangLieBiao', groupId),
  sessionSummary: (payload) => ipcRenderer.invoke('warmy:huiHuaZhaiYao', payload),
  cleanupRun: (opts) => ipcRenderer.invoke('warmy:qingLiYunXing', opts),
  roleModelsSet: (roles) => ipcRenderer.invoke('warmy:jueSeMoXingJiSheZhi', roles),
  roleModelsGet: () => ipcRenderer.invoke('warmy:jueSeMoXingJiQu'),
  groupDissolve: (groupId) => ipcRenderer.invoke('warmy:qunJieSan', groupId),
  exportAllowlist: () => ipcRenderer.invoke('warmy:daoChuYunXuMingDan'),
  importOpenclaw: () => ipcRenderer.invoke('warmy:daoRuopenclaw'),
  specialModelsSet: (cfg) => ipcRenderer.invoke('warmy:teShuMoXingJiSheZhi', cfg),
  specialModelsGet: () => ipcRenderer.invoke('warmy:teShuMoXingJiQu'),
  asrOllama: (payload) => ipcRenderer.invoke('warmy:asrollama', payload),
  joinRequest: (payload) => ipcRenderer.invoke('warmy:jiaRuQingQiu', payload),
  joinPending: () => ipcRenderer.invoke('warmy:jiaRuPending'),
  joinRespond: (payload) => ipcRenderer.invoke('warmy:jiaRuHuiYing', payload),
  blacklistList: () => ipcRenderer.invoke('warmy:heiMingDanLieBiao'),
  blacklistRemove: (id) => ipcRenderer.invoke('warmy:heiMingDanYiChu', id),
  groupMembers: (groupId) => ipcRenderer.invoke('warmy:qunChengYuanJi', groupId),
  groupInvite: (payload) => ipcRenderer.invoke('warmy:qunYaoQing', payload),
  groupKick: (payload) => ipcRenderer.invoke('warmy:qunTi', payload),
  groupSetAdmin: (payload) => ipcRenderer.invoke('warmy:qunSheZhiGuanLiYuan', payload),
  groupDirected: (payload) => ipcRenderer.invoke('warmy:qunDingXiang', payload),
  boardSession: (groupId) => ipcRenderer.invoke('warmy:kanbanHuiHua', groupId),
  ccrToolOutput: (payload) => ipcRenderer.invoke('warmy:ccrGongJuShuChu', payload),
  kbDetail: (q) => ipcRenderer.invoke('warmy:zhiShiKuXiangQing', q),
  lastError: () => ipcRenderer.invoke('warmy:zuiHouCuoWu'),
  clearError: () => ipcRenderer.invoke('warmy:qingChuCuoWu'),
  setupState: () => ipcRenderer.invoke('warmy:chuShiSheZhiTai'),
  setupComplete: (payload) => ipcRenderer.invoke('warmy:chuShiSheZhiWanCheng', payload),
  searchMessages: (q) => ipcRenderer.invoke('warmy:souSuoXiaoXiJi', q),
  pluginInstall: (pkg) => ipcRenderer.invoke('warmy:chaJianAnZhuang', pkg),
  pluginUninstall: (pkg) => ipcRenderer.invoke('warmy:chaJianXieZai', pkg),
  archivedList: () => ipcRenderer.invoke('warmy:yiGuiDangLieBiao'),
  archivedAdd: (payload) => ipcRenderer.invoke('warmy:yiGuiDangTianJia', payload),
  archivedRestore: (id) => ipcRenderer.invoke('warmy:yiGuiDangHuiFu', id),
  autoUpdateDownload: () => ipcRenderer.invoke('warmy:ziDongGengXinXiaZai'),
  getChatQuery: () => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } },
  executorRun: (renwu) => ipcRenderer.invoke('warmy:zhiXingQiYunXing', renwu),
  executorBatch: (RenwuJi) => ipcRenderer.invoke('warmy:zhiXingQiPiLiang', RenwuJi),
  assetsRetrieve: (opts) => ipcRenderer.invoke('warmy:ziChanJiJianSuo', opts),
  assetsRegister: (a) => ipcRenderer.invoke('warmy:ziChanJiZhuCe', a),
  assetsFeedback: (id, good) => ipcRenderer.invoke('warmy:ziChanJiFeedback', id, good),
  assetsSweep: () => ipcRenderer.invoke('warmy:ziChanJiSweep'),
  kbFromChat: (payload) => ipcRenderer.invoke('warmy:zhiShiKuCongLiaoTian', payload),
  kbDelete: (payload) => ipcRenderer.invoke('warmy:zhiShiKuShanChu', payload),
  saveText: (payload) => ipcRenderer.invoke('warmy:baoCunWenBen', payload),
  // NOTE: warmy:diagnostics (卡顿自检) removed — feature retired.
  winAlwaysOnTop: (qiYong) => ipcRenderer.invoke('warmy:winZongShiQiYongDing', qiYong),
  platformInfo: () => ipcRenderer.invoke('warmy:pingTai'),
});
