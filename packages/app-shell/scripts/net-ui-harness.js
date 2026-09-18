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
    sessions: CFG.sessions || 0,
    calls: [],
  };
  window.__netTest = net;
  net.setSamples = function (arr) { net.samples = arr.slice(); net.sampleIdx = 0; };
  net.setState = function (p) { for (var k in p) net[k] = p[k]; };

  var rec = function (name, payload) { net.calls.push({ name: name, payload: payload || null, ts: Date.now() }); };
  net.callsOf = function (name) { return net.calls.filter(function (c) { return c.name === name; }); };
  net.reset = function () { net.calls = []; };

  window.__ccarmyNetStub = {
    // 组网层标注的异地实例（真实实现里等价于实例记录上的 instance.remote）
    get remoteInstanceIds() { return (net.remoteInstanceIds || []).slice(); },
    netLocalAddress: async function () {
      rec('netLocalAddress');
      // 真实 localAddressInfo() 也带 ipv6（附八.9 的"IPv6 单列一档"）
      var out = { ok: true, localIp: net.localIp, publicIp: net.publicIp, behindNat: net.behindNat, port: 7788 };
      if (net.ipv6) out.ipv6 = net.ipv6;
      return out;
    },
    netProbe: async function () { rec('netProbe'); return Object.assign({ ok: true }, net.probe); },
    netStatus: async function () {
      var s = net.samples.length ? net.samples[net.sampleIdx++ % net.samples.length] : null;
      net.lastSample = s;
      var out = { ok: true, meshEnabled: net.meshEnabled, link: s === null ? {} : { reachable: s, lastError: s ? '' : 'probe-timeout' } };
      // 与真实 MeshStatusResult 同形状：可达性提示 / 本机 IPv6 事实 / 活会话数
      if (net.reachability) out.reachability = net.reachability;
      if (net.ipv6) out.ipv6 = net.ipv6;
      out.sessions = net.sessions || 0;
      return out;
    },
    netMembersPresence: async function (p) {
      return { ok: true, groupId: p && p.groupId, meshEnabled: net.meshEnabled, members: (net.members[(p && p.groupId) || ''] || []) };
    },
    meshEnable: async function (payload) { rec('meshEnable', payload); net.meshEnabled = true; LSS('mesh', true); return { ok: true }; },
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

  window.__ccarmyIdentityStub = {
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

  /* ── 成员表覆盖（预览桩的 groupMembers 只返回演示群成员）──
     bridge.js 会把 window.ccarmy 整个赋值，所以这里用访问器接住那次赋值再包装。 */
  var real = null;
  Object.defineProperty(window, 'ccarmy', {
    configurable: true,
    get: function () { return real; },
    set: function (v) {
      real = v;
      try {
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
