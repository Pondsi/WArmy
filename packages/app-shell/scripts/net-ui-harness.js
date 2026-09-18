/* harness.js — 由验证脚本通过 CDP Page.addScriptToEvaluateOnNewDocument 注入，
 * 在每个新文档里、且在 bridge.js / app.js 之前执行。
 *
 * 作用：模拟「组网层」与「身份层」的 IPC（这两块在另一条并行线上实现），
 * 让 UI 的判定逻辑（迟滞、合并、三态、换证横幅、冻结期）能被真实浏览器压出来。
 * 桩的状态用 localStorage 存，页面 reload（= 下次启动）后仍一致，
 * 这样才能验证「关闭后下次启动重现」与「冻结期跨启动」。
 *
 * 注意：这里只做测试替身，不改产品代码。
 */
(function () {
  var CFG = window.__HARNESS_CFG || {};
  try { if (!CFG || !Object.keys(CFG).length) CFG = JSON.parse(localStorage.getItem('netTestCfg') || '{}') || {}; } catch (e) { CFG = {}; }

  var LS = function (k, d) {
    try { var v = localStorage.getItem('idchgTest:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  var LSS = function (k, v) { try { localStorage.setItem('idchgTest:' + k, JSON.stringify(v)); } catch (e) {} };

  /* ── 组网层桩 ── */
  /* 每轮验收开始前清掉上一轮留下的桩状态（否则"上一轮结束时组网还开着"会污染本轮 R8-3）。
     必须在下面读取桩状态**之前**执行。 */
  if (CFG.resetStorage) {
    // 一轮验收只清一次（用 token 区分轮次）：否则 Page.reload()（= 下次启动）也会被清掉，
    // 而「下次启动重现」正是要验的场景。
    try {
      var tok = String(CFG.resetToken || 'once');
      if (localStorage.getItem('idchgTest:resetToken') !== tok) {
        localStorage.removeItem('idchgTest:mesh');
        localStorage.removeItem('idchgTest:acks');
        localStorage.removeItem('idchgTest:adopted');
        localStorage.removeItem('idchgTest:changes');
        // 预览桩的「设置落盘」（build-preview 的 bridge.js 用 localStorage 模拟 settings-store）。
        // 上一轮拖出来的右栏宽度/改过的快捷键不能带到下一轮，否则「默认值/大部分留空」的断言会被污染。
        localStorage.removeItem('warmyPreviewSettings');
        localStorage.setItem('idchgTest:resetToken', tok);
      }
    } catch (e) {}
  }

  var net = {
    meshEnabled: LS('mesh', !!CFG.meshEnabled),
    localIp: CFG.localIp || '192.168.1.50',
    publicIp: CFG.publicIp || '203.0.113.9',
    behindNat: !!CFG.behindNat,
    probe: CFG.probe || { isPublic: true, outboundOk: true, method: 'autonat' },
    samples: (CFG.samples || [false]).slice(),
    sampleIdx: 0,
    lastSample: null,
    members: CFG.members || {},
    remoteInstanceIds: CFG.remoteInstanceIds || [],
    /* 附八.9 / 附八.3：可达性（档位 / 中继）与本机 IPv6 事实。
       默认**不给**（= 主进程还没报），此时 UI 必须显示"无法判定/未知"，而不是假装在跑。
       真实主进程的 netStatus 里这两个字段是常有的（net-wiring 的 buildReachabilityHint）。 */
    reachability: CFG.reachability || null,
    ipv6: CFG.ipv6 || null,
    /* R13：端口绑定事实（{requestedPort,boundPort,errorCode?}）。
       默认**不给**（= 组网层没报），此时 UI 不该显示"实际端口"——不许拿默认值充数。 */
    bind: CFG.bind || null,
    /* R13：让 meshEnable 返回"**端口无法绑定**"（真主进程此时回 errorCode=port-bind-failed
       且**不改端口**）。用来验"界面明确告知 + 配置端口未被修改 + 绝不自动换端口"。 */
    bindFail: CFG.bindFail || null,
    /* R13：`warmy:net-port-candidates` 的**实测**报告（{recommended:[{port,status}],probed,...}）。
       默认不给 → UI 应当如实显示"没测到可用端口"，而不是拿静态列表充数。 */
    portCandidates: CFG.portCandidates || null,
    sessions: CFG.sessions || 0,
    calls: [],
  };
  window.__netTest = net;
  net.setSamples = function (arr) { net.samples = arr.slice(); net.sampleIdx = 0; };
  net.setState = function (p) { for (var k in p) net[k] = p[k]; };
  net.setProbeByHost = function (map) { net.probeByHost = map || null; };
  net.probeByHost = null;

  var rec = function (name, payload) { net.calls.push({ name: name, payload: payload || null, ts: Date.now() }); };
  net.callsOf = function (name) { return net.calls.filter(function (c) { return c.name === name; }); };
  net.reset = function () { net.calls = []; };

  window.__warmyNetStub = {
    // 组网层标注的异地实例（真实实现里等价于实例记录上的 instance.remote）
    get remoteInstanceIds() { return (net.remoteInstanceIds || []).slice(); },
    netLocalAddress: async function () {
      rec('netLocalAddress');
      // 真实 localAddressInfo() 也带 ipv6（附八.9 的"IPv6 单列一档"）
      var out = { ok: true, localIp: net.localIp, publicIp: net.publicIp, behindNat: net.behindNat, port: Number(CFG.netPort || 59599) };
      if (net.ipv6) out.ipv6 = net.ipv6;
      return out;
    },
    netProbe: async function (payload) {
      rec('netProbe', payload);
      var host = payload && (payload.ip || (payload.publicAddresses && payload.publicAddresses[0]) || '');
      var byHost = net.probeByHost || null;
      if (byHost && host && Object.prototype.hasOwnProperty.call(byHost, host)) {
        return Object.assign({ ok: true }, byHost[host]);
      }
      var base = net.probe || { isPublic: true, outboundOk: true, method: 'autonat' };
      return Object.assign({ ok: true }, base);
    },
    netStatus: async function () {
      var s = net.samples.length ? net.samples[net.sampleIdx++ % net.samples.length] : null;
      net.lastSample = s;
      var out = { ok: true, meshEnabled: net.meshEnabled, link: s === null ? { reachable: false, lastError: net.meshEnabled ? 'probe-timeout' : 'mesh-disabled', peers: [] } : { reachable: s, lastError: s ? '' : 'probe-timeout' } };
      // 与真实 MeshStatusResult 同形状：可达性提示 / 本机 IPv6 事实 / 活会话数
      if (net.reachability) out.reachability = net.reachability;
      if (net.ipv6) out.ipv6 = net.ipv6;
      /* mesh-disabled-local-facts：关闭组网也回本机事实，但**剥掉 connectivity 结论**
         （与 net-wiring 关闭分支一致：buildReachabilityHint 只报地址事实，不做现场探测结论） */
      if (!net.meshEnabled) {
        if (!out.ipv6) out.ipv6 = { hasGlobalUnicast: false, publicCandidate: null, ula: [], linkLocal: [], reason: 'harness-default' };
        var r = out.reachability;
        var hasConclusion = !!(r && typeof r === 'object' && (
          r.bothUndialable === true ||
          r.needsPublicRelayNotice === true ||
          (r.relay && (r.relay.bothUndialable === true || r.relay.needsPublicRelayNotice === true))
        ));
        if (!r || hasConclusion) {
          out.reachability = {
            ipv6: out.ipv6,
            naturalDialable: false,
            dialableKind: 'undetermined',
            dialableI18n: 'net.dialability.undetermined',
            suggestedRung: 'public-direct',
            needsPublicRelayNotice: false,
            i18n: { rung: 'net.rung.publicDirect' },
          };
        }
      }
      out.sessions = net.sessions || 0;
      /* R13：端口绑定事实（真实 MeshStatusResult.bind）。没配就不给字段。 */
      if (net.bind) out.bind = net.bind;
      return out;
    },
    netMembersPresence: async function (p) {
      return { ok: true, groupId: p && p.groupId, meshEnabled: net.meshEnabled, members: (net.members[(p && p.groupId) || ''] || []) };
    },
    /* R13：**实测**候选端口（真主进程会逐个真 bind 一次再回收）。
       桩只回预设的报告；没预设就回"没有可用端口"（不许静默拿静态表充建议）。 */
    netPortCandidates: async function (payload) {
      rec('netPortCandidates', payload);
      if (net.portCandidates) return net.portCandidates;
      return {
        ok: true,
        requestedPort: (payload && Number(payload.requestedPort)) || 0,
        recommended: [],
        probed: [],
        coverage: 'pool',
        timedOut: false,
        elapsedMs: 1,
        probedAt: Date.now(),
        host: '0.0.0.0',
      };
    },
    meshEnable: async function (payload) {
      rec('meshEnable', payload);
      /* R13：端口无法绑定 —— 真主进程的行为：返回失败 + 明确错误码 + 请求端口原样回报，
         **绝不**换端口、**绝不**写回设置。 */
      if (net.bindFail) {
        var p = Number(net.bindFail.requestedPort || (payload && payload.port) || 0);
        var errno = String(net.bindFail.error || 'EADDRINUSE');
        return {
          ok: false,
          errorCode: net.bindFail.errorCode || 'port-bind-failed',
          error: errno,
          requestedPort: p,
          bind: { requestedPort: p, boundPort: 0, errorCode: errno },
        };
      }
      net.meshEnabled = true;
      LSS('mesh', true);
      /* R13：如实回"实际绑上的端口"——没配 bind 就只回 ok（旧行为） */
      if (net.bind) {
        return {
          ok: true,
          port: net.bind.boundPort,
          requestedPort: net.bind.requestedPort,
          bind: net.bind,
        };
      }
      return { ok: true };
    },
    meshDisable: async function () { rec('meshDisable'); net.meshEnabled = false; LSS('mesh', false); return { ok: true }; },
  };

  /* ── 身份层桩 ── */
  var idc = {
    card: LS('card', CFG.card || { email: 'me@example.com', phone: '' }),
    changes: LS('changes', (CFG.changes || []).slice()),
    acks: LS('acks', {}),
    adopted: LS('adopted', {}),
    calls: [],
  };
  window.__idTest = idc;
  idc.setChanges = function (arr) { idc.changes = arr.slice(); LSS('changes', idc.changes); };
  idc.callsOf = function (name) { return idc.calls.filter(function (c) { return c.name === name; }); };
  idc.reset = function () { idc.calls = []; };
  idc.setState = function (p) { for (var k in p) idc[k] = p[k]; };

  window.__warmyIdentityStub = {
    identityInfo: async function () {
      return { ok: true, identity: { alias: '884024787', fingerprint: 'FP-ME', generation: 2, contactCard: idc.card }, contactI18n: null };
    },
    identityGet: async function () {
      return { ok: true, identity: { contactCard: idc.card }, card: idc.card, contactI18n: null };
    },
    identityChanges: async function () {
      return {
        ok: true,
        changes: idc.changes.map(function (c) {
          var ack = idc.acks[c.id] || c.ack || {};
          return Object.assign({}, c, { ack: ack, cardAdopted: !!idc.adopted[c.id] });
        }),
      };
    },
    identityChangeAcknowledge: async function (p) {
      idc.calls.push({ name: 'ack', changeId: p && p.changeId, level: p && p.level, ts: Date.now() });
      var ack = Object.assign({}, idc.acks[p.changeId] || {});
      if (p.level === 'verified') ack.verifiedAt = Date.now();
      if (p.level === 'dismiss') ack.dismissedAt = Date.now();
      idc.acks[p.changeId] = ack;
      LSS('acks', idc.acks);
      return { ok: true, auditId: 'audit-' + p.changeId + '-' + p.level };
    },
    identityContactAdopt: async function (p) {
      idc.calls.push({ name: 'adopt', changeId: p && p.changeId, ts: Date.now() });
      idc.adopted[p.changeId] = true;
      LSS('adopted', idc.adopted);
      return { ok: true };
    },
  };

  /* ── ADR 004 执行环境（容器）桩 ──
     预览桩只会说"没有主进程"，所以这里接住容器相关的两个 IPC，让 UI 逻辑能被真浏览器压出来。
     **默认不给探测结果**（没注入就如实回失败）—— 验收脚本会先把**真机**的探测报告
     注入 window.__ctgTest.report（脚本自己跑 dist/container-probe.js 得到），再点按钮。 */
  var ctg = {
    report: (CFG.container && CFG.container.report) || null,
    actionReport: (CFG.container && CFG.container.actionReport) || null,
    probeCalls: 0,
    lastProbeOpts: null,
    actions: [],
    probes: [],
    /* **容器内控制台**（= 控制台本体）的调用台账：验收脚本据此断言
       "未就绪时一条命令都没执行"、以及"参数形状只有 runtimeId + action 枚举"。 */
    shellCalls: [],
    /* 「启动项目 / 停止项目」的调用台账（只接受 { sessionId }） */
    projectCalls: [],
    /* 启停后把报告改成什么样（可选）：
       { start: <report>, stop: <report> } —— 让"running 行有停止按钮 / not-running 行有启动按钮"
       两个分支都能被真实点击压出来，而不是靠写死。 */
    afterAction: (CFG.container && CFG.container.afterAction) || null,
  };
  window.__ctgTest = ctg;
  ctg.setReport = function (r) { ctg.report = r; };
  ctg.setAfterAction = function (a) { ctg.afterAction = a; };
  ctg.callsOf = function (name) {
    if (name === 'probe') return ctg.probes.slice();
    if (name === 'shell') return ctg.shellCalls.slice();
    return ctg.actions.filter(function (a) { return a.action === name; });
  };
  ctg.reset = function () { ctg.actions = []; ctg.probes = []; ctg.shellCalls = []; ctg.projectCalls = []; };

  /* ── 项目可用性的**镜像实现**（测试替身）───────────────────────────────────
     真实现是主进程里的 container-probe.deriveProjectState（纯函数，由
     scripts/verify-container-probe.mjs 直接断言）。预览里没有主进程，所以这个桩按
     **同一套规则**推导，让渲染层的"不可用 / 只能看历史 / 右键启用停用"能被真浏览器压出来。
     规则只有三条，故意写得很小，避免与真实现分叉：
       · 本机开发 + 未被停用 ⇒ 可用（与容器无关，**不误伤**）；
       · 被创建者停用 ⇒ 不可用；
       · 容器开发 ⇒ 必须先选定运行时且它 ready，否则不可用。 */
  var pSettings = function () { return window.__previewSettings || {}; };
  var rowOf = function (runtimeId) {
    if (!ctg.report || !runtimeId) return null;
    var rows = ctg.report.runtimes || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id === runtimeId) return rows[i];
    return null;
  };
  ctg.devState = function (sessionId) {
    var s = pSettings();
    var dev = (s.containerDev || {})[sessionId];
    var disabled = !!((s.projectDisabled || {})[sessionId]);
    if (dev !== 'container') {
      if (!disabled) {
        return { devEnv: 'host', containerOnly: false, running: true, stopped: false, code: 'host-dev',
          hostEditingRefused: false, developmentAllowed: true, developmentWhere: 'host',
          testingAllowed: true, testingWhere: 'host-or-other-device', historyReadable: true,
          memberFace: null, restrictions: [], fix: 'ok' };
      }
      return { devEnv: 'host', containerOnly: false, running: false, stopped: true, code: 'disabled-by-owner',
        hostEditingRefused: false, developmentAllowed: false, developmentWhere: 'host',
        testingAllowed: true, testingWhere: 'host-or-other-device', historyReadable: true,
        memberFace: 'creator-offline', restrictions: ['development', 'collaboration', 'features'], fix: 'enable-project' };
    }
    var runtimeId = String(((s.containerProjectRuntime || {})[sessionId]) || '');
    var row = rowOf(runtimeId);
    var ready = !!(row && row.status === 'ready');
    var code = disabled ? 'disabled-by-owner' : (!runtimeId ? 'container-not-chosen' : ready ? 'ok' : 'container-not-ready');
    var stopped = code !== 'ok';
    var fix = disabled ? 'enable-project' : code === 'ok' ? 'ok' : code === 'container-not-chosen' ? 'choose-container' : 'start-container';
    return {
      devEnv: 'container', containerOnly: true, running: !stopped, stopped: stopped, code: code,
      hostEditingRefused: true, developmentAllowed: !stopped, developmentWhere: 'container',
      testingAllowed: true, testingWhere: 'host-or-other-device', historyReadable: true,
      memberFace: stopped ? 'creator-offline' : null,
      restrictions: stopped ? ['host-editing', 'development', 'collaboration', 'features'] : ['host-editing'],
      fix: fix,
    };
  };
  /* 与主进程 projectReasonKey **逐档对齐**（少一档就会让 UI 说错原因） */
  var reasonOf = function (code) {
    return code === 'disabled-by-owner' ? 'disabledByOwner'
      : code === 'container-not-installed' ? 'notInstalled'
        : code === 'container-not-chosen' ? 'notChosen'
          : (code === 'ok' || code === 'host-dev') ? 'ok' : 'containerDown';
  };
  /* 安全契约（与 container-probe 的 CONTAINER_SHELL_SECURITY 逐字段一致） */
  var SHELL_SEC = { typedBy: 'local-human-only', remoteInjectPaths: 0, autoRun: false, forwardsSecretEnv: false, argvFromUntrustedSource: false, hostFallback: false };
  /* 第十六批：**真执行面**的契约（与 container-probe 的 CONTAINER_EXEC_SECURITY 逐字段一致） */
  var EXEC_SEC = { argvFromUntrustedSource: false, remoteInjectPaths: 0, inheritsSecretEnv: false, hostFallback: false, fixedCommandsOnly: true };
  var SHELL_ACTIONS = ['open', 'write', 'close', 'status'];

  window.__warmyContainerStub = {
    containerProbe: async function (opts) {
      ctg.probeCalls++;
      ctg.probes.push(opts || null);
      ctg.lastProbeOpts = opts || null;
      var rep = ctg.report;
      if (!rep) return { ok: false, error: 'harness:no-container-report-injected' };
      return { ok: true, report: JSON.parse(JSON.stringify(rep)) };
    },
    containerAction: async function (payload) {
      var p = { id: (payload && payload.id) || '', action: (payload && payload.action) || '' };
      ctg.actions.push(p);
      var next = ctg.afterAction && ctg.afterAction[p.action];
      if (next) {
        ctg.report = JSON.parse(JSON.stringify(next));
        var row = (ctg.report.runtimes || []).filter(function (x) { return x.id === p.id; })[0];
        if (row) row.action = { kind: p.action, startedAt: Date.now(), pending: false, result: { kind: p.action, ok: true, code: 0, output: 'harness:' + p.action + ':ok', at: Date.now() } };
      }
      return { ok: true, accepted: true, id: p.id, action: p.action };
    },
    /* 项目可用性（真实现 = 主进程 warmy:project-state） */
    projectState: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      var st = ctg.devState(id);
      var s = pSettings();
      var rt = String(((s.containerProjectRuntime || {})[id]) || '');
      return {
        ok: true,
        state: Object.assign({}, st, { reasonKey: reasonOf(st.code), runtimeId: rt }),
        memberFaceKey: st.memberFace === 'creator-offline' ? 'group.memberOffline' : null,
        localIsCreator: ctg.localIsCreator === true,
        historyReadable: true,
        /* 第十六批：这条状态是"本机事实"还是"创建者信号"，以及项目目录 / 入站门控结论 */
        projectSource: ctg.projectSourceRemote === true ? 'creator-signal' : 'local',
        projectReportedAt: ctg.projectSourceRemote === true ? (ctg.projectReportedAt || Date.now()) : 0,
        projectDir: String(ctg.projectDir || ''),
        projectDirReason: ctg.projectDir ? 'creator-picked' : 'not-recorded',
        inboundGate: st.running
          ? { allow: true, queue: null, memberFaceKey: null, projectCode: st.code, projectRunning: true }
          : { allow: false, queue: 'creator-offline', memberFaceKey: 'group.memberOffline', projectCode: st.code, projectRunning: false },
      };
    },
    /* 启用项目：容器开发项目必须先有就绪容器（真实现同规则） */
    projectEnable: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.projectCalls.push({ op: 'enable', sessionId: id });
      if (ctg.localIsCreator === false) return { ok: false, code: 'not-creator' };
      var s = pSettings();
      var m = Object.assign({}, s.projectDisabled || {});
      if (m[id]) { delete m[id]; window.__previewSettings = Object.assign({}, s, { projectDisabled: m }); }
      var st = ctg.devState(id);
      if (!st.running) {
        return { ok: false, code: st.code === 'container-not-chosen' ? 'container-not-chosen' : 'container-not-ready',
          projectCode: st.code, reasonKey: reasonOf(st.code), fix: st.fix, needsContainer: true, state: st };
      }
      return { ok: true, running: true, enabledAt: Date.now(), state: st };
    },
    /* 停用项目：与容器无关 */
    projectDisable: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.projectCalls.push({ op: 'disable', sessionId: id });
      if (ctg.localIsCreator === false) return { ok: false, code: 'not-creator' };
      var s = pSettings();
      var m = Object.assign({}, s.projectDisabled || {});
      m[id] = Date.now();
      window.__previewSettings = Object.assign({}, s, { projectDisabled: m });
      var st = ctg.devState(id);
      return { ok: true, disabled: true, disabledAt: m[id], state: st, historyReadable: true };
    },
    /* 切换容器：只接受预定义运行时 id；项目正在运行时返回 restartRequired */
    projectSetContainer: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      var runtimeId = String((payload && payload.runtimeId) || '');
      ctg.projectCalls.push({ op: 'set-container', sessionId: id, runtimeId: runtimeId });
      if (ctg.localIsCreator === false) return { ok: false, code: 'not-creator' };
      var s = pSettings();
      if ((s.containerDev || {})[id] !== 'container') return { ok: false, code: 'not-container-project' };
      if (!rowOf(runtimeId)) return { ok: false, code: 'unknown-runtime' };
      var m = Object.assign({}, s.containerProjectRuntime || {});
      m[id] = runtimeId;
      window.__previewSettings = Object.assign({}, s, { containerProjectRuntime: m });
      var st = ctg.devState(id);
      return { ok: true, runtimeId: runtimeId, state: st, restartRequired: st.running };
    },
    /* 右栏三块的真实数据（预览里没有检查点/产物目录 ⇒ 如实空态 + 说明缺什么） */
    projectFiles: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.projectFilesCalls = (ctg.projectFilesCalls || 0) + 1;
      var fake = ctg.filesFacts || null;
      if (fake) return JSON.parse(JSON.stringify(fake));
      return {
        ok: true, sessionId: id,
        projectDir: null, projectDirReason: 'not-recorded',
        /* 成员侧形态由夹具决定（真实现里这是"属性来自创建者节点的信号"） */
        projectSource: ctg.projectSourceRemote === true ? 'creator-signal' : 'local',
        changed: [], other: [],
        /* 第十六批：工具文件访问台账现在**真的存在**（项目级、成员可见）—— 这份空态表示
           "这段时间没有任何工具动过文件"这个事实，而不再是"数据源缺失"。 */
        ledger: [],
        /* 如实说明还缺什么：项目目录没被记录过 ⇒ 缺一个解析根（台账那一项不再缺） */
        missingSources: ['project-directory-record'],
        product: {
          dir: 'C:/preview/products/' + (id || 'default'), dirExists: false, dirKind: 'planned',
          kind: 'none', entry: null, entryHostRunnable: false, entryReason: 'dir-planned', files: [],
        },
      };
    },
    /* 「运行」产物：参数只有 { sessionId }；入口由主进程解析（桩只按契约记账） */
    productRun: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.productRuns = ctg.productRuns || [];
      ctg.productRuns.push({ sessionId: id });
      var facts = ctg.filesFacts || null;
      var p = (facts && facts.product) || null;
      if (!p || !p.entry || p.kind !== 'program') return { ok: false, code: 'no-entry', executed: false };
      if (!p.entryHostRunnable) return { ok: false, code: p.entryReason || 'no-host-runtime', executed: false };
      return { ok: true, executed: true, pid: 4242, entry: p.entry };
    },
    /* 环境状态（真实现 = 主进程 warmy:project-env-status）：能力**按运行时区分**，系统模式不假定 Linux */
    projectEnvStatus: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      var s = pSettings();
      var runtimeId = String(((s.containerProjectRuntime || {})[id]) || '');
      var st = ctg.devState(id);
      /* 与 container-probe.envSolidifyCapability **逐档对齐** */
      var cap = runtimeId === 'docker' || runtimeId === 'podman'
        ? { kind: 'commit', programmatic: true, why: 'oci-commit' }
        : runtimeId === 'wsl'
          ? { kind: 'export-import', programmatic: false, why: 'wsl-no-commit' }
          : !runtimeId
            ? { kind: 'unsupported', programmatic: false, why: 'no-runtime-chosen' }
            : { kind: 'unsupported', programmatic: false, why: 'runtime-unknown' };
      var row = rowOf(runtimeId);
      var mode = 'unknown';
      if (row && /^daemon-reachable:/.test(String(row.detail || ''))) mode = String(row.detail).slice('daemon-reachable:'.length);
      ctg.envCalls = (ctg.envCalls || 0) + 1;
      var lastRef = String(ctg.solidifiedRef || '');
      return {
        ok: true, sessionId: id, devEnv: st.devEnv, runtimeId: runtimeId, engineMode: mode,
        solidify: { kind: cap.kind, programmatic: cap.programmatic, why: cap.why,
          lastImageRef: lastRef, lastSolidifiedAt: ctg.solidifiedAt || 0,
          history: lastRef ? [{ imageRef: lastRef, at: ctg.solidifiedAt || 0 }] : [],
          pruneCandidates: [],
          decision: { solidify: false, code: 'nothing-changed' }, keep: 3, coalesceMs: 45000,
          evidence: lastRef ? 'commit-succeeded' : 'none',
          security: { freezesWholeFilesystem: true, deletesUserFiles: false, forwardsSecretEnv: false, keep: 3, coalesceMs: 45000 } },
        container: { ref: 'warmy-' + id.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase().padEnd(12, '0'), exists: false, running: false, probeRaw: '' },
        containerRetained: true,
        layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false },
      };
    },
    /* 「固化当前环境」：不能固化就**如实拒绝**（绝不写假的"已固化"）；
       能固化时由 ctg.solidifyOk 决定这一次是不是真的成功（用于压"真成功"那一档）。 */
    projectEnvSolidify: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.solidifyCalls = (ctg.solidifyCalls || 0) + 1;
      ctg.solidifyArgs = payload || null;
      var s = pSettings();
      var runtimeId = String(((s.containerProjectRuntime || {})[id]) || '');
      if (runtimeId === 'wsl') return { ok: false, code: 'runtime-cannot-solidify', solidifyKind: 'export-import', why: 'wsl-no-commit', executed: false, evidence: 'refused' };
      if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, evidence: 'refused' };
      if (ctg.solidifyOk === true) {
        var at = Date.now();
        ctg.solidifiedAt = at;
        ctg.solidifiedRef = 'warmy-solid-' + id.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase().padEnd(12, '0') + ':' + at;
        return { ok: true, executed: true, evidence: 'commit-succeeded', imageRef: ctg.solidifiedRef, imageId: 'sha256:harness', ms: 10,
          solidifiedAt: at, containerRef: 'warmy-harness', history: [{ imageRef: ctg.solidifiedRef, at: at }], pruneCandidates: [],
          security: { freezesWholeFilesystem: true, deletesUserFiles: false, forwardsSecretEnv: false, keep: 3, coalesceMs: 45000 }, securityNotice: 'whole-filesystem-frozen' };
      }
      return { ok: false, code: 'no-image', executed: false, solidifyKind: 'commit', evidence: 'refused', decision: { solidify: false, code: 'nothing-changed' } };
    },
    /* **容器内控制台**（= 控制台本体）：参数形状只有 { runtimeId, action, sessionId, data }；
       action 是**枚举**；**不接受任何命令字符串**（白名单外的字段一律忽略）。
       未就绪时如实拒绝且 executed=false —— 也就是"一条命令都没执行"。 */
    containerShell: async function (payload) {
      var p = (payload && typeof payload === 'object') ? payload : {};
      var action = String(p.action || '');
      var rec = {
        action: action,
        runtimeId: String(p.runtimeId || ''),
        sessionId: String(p.sessionId || ''),
        dataLength: typeof p.data === 'string' ? p.data.length : 0,
        data: typeof p.data === 'string' ? p.data : null,
        /* 载荷里到底出现过哪些字段（用来证明"命令字符串"这种字段根本不被采纳） */
        keys: Object.keys(p).sort(),
        /* 这次**到底执行了没有**（未就绪 ⇒ 永远是 false）：验收脚本据此断言
           "本机没有可用容器 ⇒ 一条命令都没跑"，而不是看一个恒为 0 的变量。 */
        executed: false,
      };
      ctg.shellCalls.push(rec);
      var ret = function (resp) { rec.executed = resp && resp.executed === true; return resp; };
      if (SHELL_ACTIONS.indexOf(action) < 0) {
        rec.executed = false;
        return ret({ ok: false, code: 'bad-action', executed: false, security: SHELL_SEC });
      }
      var id = rec.sessionId;
      var s = pSettings();
      var dev = (s.containerDev || {})[id];
      // 「运行/测试在容器中」已作废删除 ⇒ 控制台只属于**容器开发**的项目
      if (dev !== 'container') return ret({ ok: false, code: 'not-enabled', reasonKey: 'notEnabled', executed: false, security: SHELL_SEC });
      var st = ctg.devState(id);
      if (st.stopped) {
        return ret({ ok: false, code: 'project-stopped', reasonKey: 'projectStopped', executed: false, projectCode: st.code, security: SHELL_SEC });
      }
      var runtimeId = rec.runtimeId || String(((s.containerProjectRuntime || {})[id]) || '');
      var row = rowOf(runtimeId);
      if (!row || row.status !== 'ready') {
        return ret({ ok: false, code: 'container-not-ready', reasonKey: 'notReady', needsInstall: true, executed: false, runtimeId: runtimeId, security: SHELL_SEC });
      }
      /**
       * 第十六批：引擎就绪 + 运行时在可执行白名单里 ⇒ **真的开了一条容器内的 shell**
       * （真实现是 `docker exec -i <项目容器> sh`；这里镜像返回同样的形状，见
       *  container-probe 的 runContainerExec / openContainerShellSession）。
       * 不在白名单里的运行时 ⇒ 仍然如实拒绝（`no-image`），不假装能开。
       */
      var EXECUTABLE = ['docker', 'podman', 'nerdctl', 'rancher-desktop'];
      if (EXECUTABLE.indexOf(runtimeId) < 0) {
        return ret({ ok: false, code: 'no-image', reasonKey: 'needsImage', executed: false, runtimeId: runtimeId, imageDecided: false, security: SHELL_SEC });
      }
      var containerRef = 'warmy-' + String(id).replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase().padEnd(12, '0');
      if (action === 'open') {
        ctg.shellOpened = (ctg.shellOpened || 0) + 1;
        return ret({ ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId: runtimeId, containerRef: containerRef,
          sessionId: id, insideContainer: true, containerCreated: true, security: SHELL_SEC, execSecurity: EXEC_SEC });
      }
      if (action === 'write') {
        ctg.shellWrites = ctg.shellWrites || [];
        ctg.shellWrites.push({ sessionId: id, data: rec.data });
        return ret({ ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId: runtimeId, containerRef: containerRef,
          output: 'harness-in-container-ok\n', security: SHELL_SEC, execSecurity: EXEC_SEC });
      }
      if (action === 'close') {
        return ret({ ok: true, code: 'ok', reasonKey: 'ok', executed: true, closed: true, runtimeId: runtimeId, containerRef: containerRef, security: SHELL_SEC, execSecurity: EXEC_SEC });
      }
      return ret({ ok: true, code: 'ok', reasonKey: 'ok', executed: false, runtimeId: runtimeId, containerRef: containerRef, security: SHELL_SEC, execSecurity: EXEC_SEC });
    },
    /* 第十六批：回滚到固化点（真实现真的从固化镜像起一个容器） */
    projectEnvRollback: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.rollbackCalls = (ctg.rollbackCalls || 0) + 1;
      ctg.rollbackArgs = payload || null;
      var s = pSettings();
      var runtimeId = String(((s.containerProjectRuntime || {})[id]) || '');
      var st = ctg.devState(id);
      if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, evidence: 'refused' };
      if (!st.running) return { ok: false, code: 'project-unavailable', executed: false, evidence: 'refused', projectCode: st.code };
      var have = ctg.solidifiedRef || '';
      if (!have) return { ok: false, code: 'no-solidified-point', executed: false, evidence: 'refused' };
      return { ok: true, executed: true, evidence: 'container-started', imageRef: have,
        containerRef: 'warmy-' + id.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase().padEnd(12, '0'),
        containerRunning: true, ms: 12, preSolidify: { ok: true, code: 'before-destroy' },
        layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false } };
    },
    /* 第十六批：把项目的命令送进容器（只接受**固定命令枚举**） */
    projectExec: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.execCalls = ctg.execCalls || [];
      ctg.execCalls.push({ sessionId: id, command: String((payload && payload.command) || '') });
      var st = ctg.devState(id);
      if (st.devEnv !== 'container' || st.stopped) {
        return { ok: false, code: 'project-unavailable', projectCode: st.code, executed: false, hostExecutionRefused: true };
      }
      return { ok: true, executed: true, insideContainer: true, command: String((payload && payload.command) || ''),
        containerRef: 'warmy-' + id.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase().padEnd(12, '0'),
        code: 0, output: 'harness:in-container', error: '', ms: 8, codeReason: null, security: EXEC_SEC };
    },
    /* 第十六批：项目级文件访问台账（成员可见） */
    projectLedger: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.ledgerCalls = (ctg.ledgerCalls || 0) + 1;
      return { ok: true, sessionId: id, entries: (ctg.ledgerEntries || []).slice(), projectDir: '', projectDirReason: 'not-recorded',
        projectSource: 'local', scope: 'project', entryLimit: 200 };
    },
    /* 第十六批：把项目目录记进项目记录（目录由主进程弹窗选 ⇒ 预览里注入固定值） */
    projectSetDirectory: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      ctg.dirCalls = (ctg.dirCalls || 0) + 1;
      if (ctg.dirCanceled === true) return { ok: false, canceled: true };
      var dir = String(ctg.dirValue || 'C:/preview/projects/' + id);
      ctg.projectDir = dir;
      return { ok: true, dir: dir, projectDirReason: 'creator-picked', projectSource: 'local' };
    },
    /* 第十六批：宿主目录加锁（最小侵入、可一键撤销）—— 预览里只镜像形状，**不真的动文件系统** */
    projectFsGuard: async function (payload) {
      var id = String((payload && payload.sessionId) || '');
      var action = String((payload && payload.action) || 'status');
      ctg.fsGuardCalls = ctg.fsGuardCalls || [];
      ctg.fsGuardCalls.push({ sessionId: id, action: action });
      var s = pSettings();
      var dev = (s.containerDev || {})[id];
      var dir = String(ctg.projectDir || '');
      var supported = ctg.fsGuardSupported !== false;
      if (ctg.fsGuardForcedCode) return { ok: false, code: ctg.fsGuardForcedCode, action: action, platformSupported: supported };
      var base = { ok: true, sessionId: id, action: action, dir: dir, dirReason: dir ? 'creator-picked' : 'not-recorded',
        sid: supported ? 'S-1-5-21-111-222-333-1001' : '', devEnv: dev === 'container' ? 'container' : 'host',
        record: ctg.fsGuardActive ? { dir: dir, sid: 'S-1-5-21-111-222-333-1001', appliedAt: Date.now() } : null,
        platformSupported: supported, security: { userInitiatedOnly: true, singleCommandRollback: true, ownerCanAlwaysUnlock: true, encrypts: false, autoApply: false } };
      if (!dir) return Object.assign(base, { ok: false, code: 'no-project-dir' });
      if (dev !== 'container') return Object.assign(base, { ok: false, code: 'not-container-project' });
      if (action === 'status') return Object.assign(base, { ok: true, guarded: ctg.fsGuardActive === true, denyEntries: ctg.fsGuardActive ? ['WARMY\\user:(DENY)(W)'] : [], recordMatchesFilesystem: ctg.fsGuardActive === true });
      if (action === 'apply') { ctg.fsGuardActive = true; return Object.assign(base, { ok: true, guarded: true, appliedAt: Date.now() }); }
      ctg.fsGuardActive = false;
      return Object.assign(base, { ok: true, guarded: false, liftedAt: Date.now() });
    },
  };

  /* ── 成员表覆盖（预览桩的 groupMembers 只返回演示群成员）──
     bridge.js 会把 window.warmy 整个赋值，所以这里用访问器接住那次赋值再包装。 */
  var real = null;
  Object.defineProperty(window, 'warmy', {
    configurable: true,
    get: function () { return real; },
    set: function (v) {
      real = v;
      try {
        /* ADR 004：容器 IPC 用桩替换（预览桩只会说"没有主进程"） */
        if (v && typeof v === 'object') {
          v.containerProbe = window.__warmyContainerStub.containerProbe;
          v.containerAction = window.__warmyContainerStub.containerAction;
          /* 容器内控制台（= 控制台本体）、项目状态与启停：同样用桩接住，
             否则渲染层会退化成"问不到主进程"。 */
          v.containerShell = window.__warmyContainerStub.containerShell;
          v.projectState = window.__warmyContainerStub.projectState;
          v.projectEnable = window.__warmyContainerStub.projectEnable;
          v.projectDisable = window.__warmyContainerStub.projectDisable;
          v.projectSetContainer = window.__warmyContainerStub.projectSetContainer;
          v.projectFiles = window.__warmyContainerStub.projectFiles;
          v.productRun = window.__warmyContainerStub.productRun;
          v.projectEnvStatus = window.__warmyContainerStub.projectEnvStatus;
          v.projectEnvSolidify = window.__warmyContainerStub.projectEnvSolidify;
          /* 第十六批：回滚到固化点 / 把命令送进容器 / 项目级台账 / 项目目录 / 宿主目录加锁 */
          v.projectEnvRollback = window.__warmyContainerStub.projectEnvRollback;
          v.projectExec = window.__warmyContainerStub.projectExec;
          v.projectLedger = window.__warmyContainerStub.projectLedger;
          v.projectSetDirectory = window.__warmyContainerStub.projectSetDirectory;
          v.projectFsGuard = window.__warmyContainerStub.projectFsGuard;
          /* localIsCreator（P3 只有创建者能启停）：默认不给 → UI 必须保守地当"不是创建者"。
             验收脚本可以覆盖它来压两个分支。 */
          if (CFG.groupMembersLocalIsCreator !== undefined && typeof v.groupMembers === 'function') {
            var origLM = v.groupMembers;
            v.groupMembers = async function (gid) {
              var r = await origLM(gid);
              return Object.assign({}, r, { localIsCreator: !!CFG.groupMembersLocalIsCreator });
            };
          }
        }
        // 预览桩的 groupList 直接返回数组、且字段是 { id }；真实 IPC 返回 { ok, groups:[{groupId}] }。
        // 这里补成真实契约，否则渲染层的 syncGroupsFromStore() 会因为形状不符而整段跳过（群列表为空）。
        if (v && typeof v.groupList === 'function') {
          var origList = v.groupList;
          v.groupList = async function () {
            var r = await origList();
            var arr = Array.isArray(r) ? r : (r && Array.isArray(r.groups) ? r.groups : []);
            return {
              ok: true,
              count: arr.length,
              groups: arr.map(function (g) {
                return Object.assign({}, g, {
                  groupId: g.groupId || g.id,
                  memberCount: (g.members || []).length,
                  active: true,
                });
              }),
            };
          };
        }
        // 预览桩的 stateLoad 不返回 chats，导致「联系人」列表在预览里恒为空
        // （build-preview.mjs 里定义了 demoChats 却没接进去）。按真实契约补一份。
        if (v && typeof v.stateLoad === 'function') {
          var origState = v.stateLoad;
          v.stateLoad = async function () {
            var r = await origState();
            if (r && r.state && !(Array.isArray(r.state.chats) && r.state.chats.length)) {
              r.state.chats = [
                { id: 'demo-1', kind: 'single', name: 'demo.agent', lastTs: Date.now() - 30000, lastPreview: '好的，已安排' },
                { id: 'c-2', kind: 'extdm', name: '张三', lastTs: Date.now() - 120000, lastPreview: '收到', notify: true },
              ];
            }
            return r;
          };
        }
        var hasOverride = !!((window.__HARNESS_CFG && window.__HARNESS_CFG.groupMembersOverride) || CFG.groupMembersOverride);
        if (v && hasOverride) {
          var orig = v.groupMembers;
          v.groupMembers = async function (gid) {
            // 每次调用都读一次（测试中途可以换成员表，不必 reload）
            var list = ((window.__HARNESS_CFG && window.__HARNESS_CFG.groupMembersOverride) || CFG.groupMembersOverride || []);
            var hit = list.filter(function (x) { return x.groupId === gid; })[0];
            if (!hit) return orig(gid);
            return { ok: true, groupId: gid, members: hit.members.map(function (n) { return { id: n, name: n, role: 'member', joinedAt: 1, source: 'invite' }; }) };
          };
        }
      } catch (e) {}
    },
  });

  /* 迟滞参数：默认不注入，测试自己按需写 window.__netTuning */
  if (CFG.tuning) window.__netTuning = CFG.tuning;
  if (CFG.idchgTuning) window.__idchgTuning = CFG.idchgTuning;
})();
