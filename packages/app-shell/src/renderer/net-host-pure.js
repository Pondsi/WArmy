/* net-host-pure.js — 主机地址 / 主机服务商的纯函数（无 DOM、无 IPC）。
 *
 * 为什么单独一个文件：`app.js` 是一个 2 万多行的经典脚本，无法在 Node 里直接 require。
 * 这里只放可被 `verify-r63-net.mjs` 逐条对表解析规则，界面侧通过 `window.WarmyNetHost`
 * 使用同一份实现 —— 测试与产品不各写一套。
 *
 * 解析口径（与 WHATWG URL 的 host 语法一致）：
 *   · IPv6 必须加方括号才能带端口：`[::1]:59599`；
 *   · 不带方括号的 IPv6 只当作**没有端口**，使用默认端口（避免 `::1:59599` 的歧义）；
 *   · `host:port` 只按**最后一个**冒号切（域名/IPv4 场景只有一个冒号）；
 *   · 端口必须是 1–65535 的十进制整数；缺省端口 = 59599；
 *   · 域名只接受 ASCII 字母/数字/连字符（不做 IDN 自动转 punycode）。
 */
(function (root, factory) {
  var api = factory();
  if (root) root.WarmyNetHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var DEFAULT_NET_PORT = 59599;
  var HOSTS_MAX = 10;
  var PROVIDERS_MAX = 1000;
  var PROVIDER_VISIBLE_ROWS = 7;
  var HOST_DETECT_MIN_MS = 1300;

  function parsePort(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d{1,5}$/.test(s)) return null;
    var n = Number(s);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  }

  function isValidIPv4(s) {
    var parts = String(s || '').split('.');
    if (parts.length !== 4) return false;
    for (var i = 0; i < 4; i++) {
      var p = parts[i];
      if (!/^\d{1,3}$/.test(p)) return false;
      if (p.length > 1 && p.charAt(0) === '0') return false;
      var n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    }
    return true;
  }

  /** 完整 IPv6 校验（支持 `::` 压缩与末尾 IPv4，如 `::ffff:192.0.2.1`）。 */
  function isValidIPv6(input) {
    var s = String(input || '');
    if (!s || s.indexOf('%') !== -1) return false;
    if (!/^[0-9a-fA-F:.]+$/.test(s)) return false;
    if (s.indexOf(':::') !== -1) return false;

    if (s.indexOf('.') !== -1) {
      var lastColon = s.lastIndexOf(':');
      if (lastColon < 0) return false;
      var v4 = s.slice(lastColon + 1);
      if (!isValidIPv4(v4)) return false;
      s = s.slice(0, lastColon + 1) + '0:0';
    }

    var halves = s.split('::');
    if (halves.length > 2) return false;
    var left = halves[0] ? halves[0].split(':') : [];
    var right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    var all = left.concat(right);
    for (var i = 0; i < all.length; i++) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(all[i])) return false;
    }
    if (halves.length === 2) return all.length <= 7;
    return all.length === 8;
  }

  function isValidDomain(s) {
    var name = String(s || '');
    if (!name || name.length > 253) return false;
    if (name.toLowerCase() === 'localhost') return true;
    if (name.charAt(name.length - 1) === '.') return false;
    var labels = name.split('.');
    if (labels.length < 2) return false;
    var allNumeric = true;
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i];
      if (!lab || lab.length > 63) return false;
      if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(lab)) return false;
      if (!/^\d+$/.test(lab)) allNumeric = false;
    }
    // 全是数字标签的“域名”只会是写错的 IPv4，按非法处理，避免 999.1.1.1 混进来。
    return !allNumeric;
  }

  function classifyHost(host) {
    var h = String(host || '');
    if (isValidIPv4(h)) return 'ipv4';
    if (isValidIPv6(h)) return 'ipv6';
    if (isValidDomain(h)) return 'domain';
    return '';
  }

  /**
   * 解析一条主机地址。返回：
   *   { ok:true, host, port, hadPort, family, canonical }
   *   { ok:false, code:'empty'|'invalid-host'|'invalid-port'|'invalid-ipv6'|'invalid' }
   */
  function parseHostEntry(raw, defaultPort) {
    var def = parsePort(defaultPort == null ? DEFAULT_NET_PORT : defaultPort) || DEFAULT_NET_PORT;
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, code: 'empty' };
    if (/\s/.test(s) || s.indexOf('://') !== -1 || s.indexOf('/') !== -1) {
      return { ok: false, code: 'invalid-host' };
    }

    var host = '';
    var port = def;
    var hadPort = false;

    if (s.charAt(0) === '[') {
      var m = /^\[([^\]]+)\](?::([^:]*))?$/.exec(s);
      if (!m) return { ok: false, code: 'invalid-ipv6' };
      host = m[1];
      if (!isValidIPv6(host)) return { ok: false, code: 'invalid-ipv6' };
      if (m[2] !== undefined) {
        hadPort = true;
        port = parsePort(m[2]);
        if (!port) return { ok: false, code: 'invalid-port' };
      }
    } else {
      var colonCount = (s.match(/:/g) || []).length;
      if (colonCount === 0) {
        host = s;
      } else if (colonCount === 1) {
        var idx = s.lastIndexOf(':');
        host = s.slice(0, idx);
        var ps = s.slice(idx + 1);
        if (!/^\d{1,5}$/.test(ps)) return { ok: false, code: 'invalid-port' };
        port = parsePort(ps);
        hadPort = true;
        if (!port) return { ok: false, code: 'invalid-port' };
      } else {
        // 多个冒号且没有方括号：只可能是裸 IPv6；端口必须用方括号写法。
        host = s;
        if (!isValidIPv6(host)) return { ok: false, code: 'invalid-ipv6' };
      }
    }

    host = host.trim();
    if (!host) return { ok: false, code: 'invalid-host' };
    var family = classifyHost(host);
    if (!family) return { ok: false, code: 'invalid-host' };

    var normalized = family === 'domain' ? host.toLowerCase() : (family === 'ipv6' ? host.toLowerCase() : host);
    var canonical = family === 'ipv6'
      ? '[' + normalized + ']:' + port
      : normalized + ':' + port;

    return {
      ok: true,
      host: normalized,
      port: port,
      hadPort: hadPort,
      family: family,
      canonical: canonical,
      display: canonical,
    };
  }

  function hostKey(parsed) {
    return parsed && parsed.ok ? parsed.family + '|' + parsed.canonical.toLowerCase() : '';
  }

  /** 从已有列表里解析出 key 集合（非法条目忽略）。 */
  function hostKeySet(list, defaultPort) {
    var set = Object.create(null);
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
      var p = parseHostEntry(arr[i], defaultPort);
      if (p.ok) set[hostKey(p)] = true;
    }
    return set;
  }

  /**
   * 添加一条主机地址。返回 {ok, code, hosts, entry}，**不修改输入数组**。
   * code: added | duplicate | full | empty | invalid-host | invalid-port | invalid-ipv6
   */
  function addHost(list, raw, defaultPort, max) {
    var cap = Number(max) > 0 ? Number(max) : HOSTS_MAX;
    var cur = Array.isArray(list) ? list.slice(0, cap) : [];
    var p = parseHostEntry(raw, defaultPort);
    if (!p.ok) return { ok: false, code: p.code, hosts: cur, entry: null };
    var set = hostKeySet(cur, defaultPort);
    if (set[hostKey(p)]) return { ok: false, code: 'duplicate', hosts: cur, entry: p };
    if (cur.length >= cap) return { ok: false, code: 'full', hosts: cur, entry: p };
    var next = cur.concat([p.canonical]);
    return { ok: true, code: 'added', hosts: next, entry: p };
  }

  /** 读回旧配置：合法条目规范化去重，非法条目原样保留（让用户能在界面上删掉/修正）。 */
  function normalizeStoredHosts(list, defaultPort, max) {
    var cap = Number(max) > 0 ? Number(max) : HOSTS_MAX;
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < arr.length && out.length < cap; i++) {
      var raw = String(arr[i] == null ? '' : arr[i]).trim();
      if (!raw) continue;
      var p = parseHostEntry(raw, defaultPort);
      var v = p.ok ? p.canonical : raw;
      var key = p.ok ? hostKey(p) : 'raw|' + raw.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(v);
    }
    return out;
  }

  /** 渲染用：每条带 valid / code / display / family / port。 */
  function hostListModel(list, defaultPort, max) {
    var cap = Number(max) > 0 ? Number(max) : HOSTS_MAX;
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    for (var i = 0; i < arr.length && out.length < cap; i++) {
      var raw = String(arr[i] == null ? '' : arr[i]).trim();
      if (!raw) continue;
      var p = parseHostEntry(raw, defaultPort);
      out.push({
        raw: raw,
        valid: p.ok,
        code: p.ok ? '' : p.code,
        display: p.ok ? p.canonical : raw,
        family: p.ok ? p.family : '',
        port: p.ok ? p.port : null,
        hadPort: p.ok ? p.hadPort : false,
      });
    }
    return out;
  }

  function removeAt(list, index) {
    var arr = Array.isArray(list) ? list.slice() : [];
    var i = Number(index);
    if (Number.isInteger(i) && i >= 0 && i < arr.length) arr.splice(i, 1);
    return arr;
  }

  /* ── 地址性质（只做分类，不声称“已验证可达”） ── */

  function isPrivateIPv4(s) {
    if (!isValidIPv4(s)) return false;
    var p = s.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }

  function isPrivateAddress(s) {
    var v = String(s || '').trim();
    if (isValidIPv4(v)) return isPrivateIPv4(v);
    if (!isValidIPv6(v)) return false;
    var h = v.toLowerCase();
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h)) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
    return false;
  }

  function isUsablePublicIp(s) {
    var v = String(s || '').trim();
    if (!v) return false;
    var fam = classifyHost(v);
    if (fam !== 'ipv4' && fam !== 'ipv6') return false;
    return !isPrivateAddress(v);
  }

  /**
   * 把检测事实映射成「是否公网 / 可直连程度」。**不把“地址是公网”说成“已验证可连入”**：
   * probe.inboundVerified === true 才返回 direct；否则 direct-unverified。
   */
  function classifyHostReachability(f) {
    var facts = f && typeof f === 'object' ? f : {};
    var local = String(facts.localIp || '').trim();
    var pub = String(facts.publicIp || '').trim();
    var probe = facts.probe && typeof facts.probe === 'object' ? facts.probe : null;
    var behindNat = facts.behindNat === true;

    var isPublic = 'unknown';
    var publicUsable = isUsablePublicIp(pub);
    if (publicUsable) isPublic = 'yes';
    else if (pub) isPublic = 'no';
    else if (local) isPublic = isPrivateAddress(local) ? 'no' : (classifyHost(local) ? 'yes' : 'unknown');

    var reach = 'unknown';
    if (probe) {
      if (probe.lanOnly === true) reach = 'lan';
      else if (probe.isPublic === true && probe.outboundOk === true) {
        reach = probe.inboundVerified === true ? 'direct' : 'direct-unverified';
      } else if (probe.outboundOk === false) {
        reach = 'unknown';
      }
    }
    if (reach === 'unknown') {
      if (!pub && local && isPrivateAddress(local)) reach = 'lan';
      else if (publicUsable && !behindNat) reach = 'direct-unverified';
    }

    return {
      isPublic: isPublic,
      reach: reach,
      behindNat: behindNat,
      publicUsable: publicUsable,
      verifiedInbound: !!(probe && probe.inboundVerified === true),
      at: Number(facts.at) || 0,
    };
  }

  /* ── 主机服务商 ── */

  function makeId(prefix) {
    var p = String(prefix || 'np');
    try {
      var c = root && root.crypto;
      if (c && typeof c.randomUUID === 'function') return p + '-' + c.randomUUID();
    } catch (e) { /* noop */ }
    return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function validateProviderName(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return { ok: false, code: 'empty-name' };
    if (s.length > 80) return { ok: false, code: 'name-too-long' };
    if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, code: 'name-control' };
    return { ok: true, name: s };
  }

  function providerAddressKey(address, defaultPort) {
    var p = parseHostEntry(address, defaultPort);
    return p.ok ? p.canonical.toLowerCase() : '';
  }

  function findProviderByAddress(list, address, defaultPort, exceptId) {
    var key = providerAddressKey(address, defaultPort);
    if (!key) return null;
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
      var rec = arr[i] || {};
      if (exceptId && String(rec.id || '') === String(exceptId)) continue;
      if (providerAddressKey(rec.address, defaultPort) === key) return rec;
    }
    return null;
  }

  function normalizeProviderRecord(rec, defaultPort) {
    var r = rec && typeof rec === 'object' ? rec : {};
    var id = String(r.id || '').trim() || makeId('np');
    var name = String(r.name == null ? (r.biaoQian == null ? '' : r.biaoQian) : r.name).trim();
    var address = String(r.address == null ? '' : r.address).trim();
    var p = parseHostEntry(address, defaultPort);
    var hasCredential = r.hasCredential === true;
    var credentialState = hasCredential ? 'stored' : 'none';
    if (r.credentialState === 'pending') credentialState = 'pending';
    return {
      id: id,
      name: name,
      address: p.ok ? p.canonical : address,
      hasCredential: hasCredential,
      credentialState: credentialState,
      invalidAddress: !p.ok,
    };
  }

  /**
   * 新增/更新服务商。返回 {ok, code, providers, record}，不修改输入数组。
   * code: added | updated | full | duplicate | empty-name | name-too-long | invalid-address
   */
  function upsertProvider(list, input, defaultPort, max) {
    var cap = Number(max) > 0 ? Number(max) : PROVIDERS_MAX;
    var cur = Array.isArray(list) ? list.slice(0, cap) : [];
    var f = input && typeof input === 'object' ? input : {};
    var nameCheck = validateProviderName(f.name);
    if (!nameCheck.ok) return { ok: false, code: nameCheck.code, providers: cur, record: null };
    var p = parseHostEntry(f.address, defaultPort);
    if (!p.ok) return { ok: false, code: 'invalid-address', providers: cur, record: null, parseCode: p.code };
    var editId = f.id ? String(f.id) : '';
    var dup = findProviderByAddress(cur, p.canonical, defaultPort, editId);
    if (dup) return { ok: false, code: 'duplicate', providers: cur, record: null };

    if (editId) {
      var found = -1;
      for (var i = 0; i < cur.length; i++) if (String(cur[i] && cur[i].id) === editId) { found = i; break; }
      if (found >= 0) {
        var prev = normalizeProviderRecord(cur[found], defaultPort);
        var updated = {
          id: editId,
          name: nameCheck.name,
          address: p.canonical,
          hasCredential: f.hasCredential === true ? true : prev.hasCredential,
          credentialState: f.credentialState || prev.credentialState,
          invalidAddress: false,
        };
        var next = cur.slice();
        next[found] = updated;
        return { ok: true, code: 'updated', providers: next, record: updated };
      }
    }

    if (cur.length >= cap) return { ok: false, code: 'full', providers: cur, record: null };
    var record = {
      id: makeId('np'),
      name: nameCheck.name,
      address: p.canonical,
      hasCredential: f.hasCredential === true,
      credentialState: f.hasCredential === true ? 'stored' : (f.credentialState === 'pending' ? 'pending' : 'none'),
      invalidAddress: false,
    };
    return { ok: true, code: 'added', providers: cur.concat([record]), record: record };
  }

  return {
    DEFAULT_NET_PORT: DEFAULT_NET_PORT,
    HOSTS_MAX: HOSTS_MAX,
    PROVIDERS_MAX: PROVIDERS_MAX,
    PROVIDER_VISIBLE_ROWS: PROVIDER_VISIBLE_ROWS,
    HOST_DETECT_MIN_MS: HOST_DETECT_MIN_MS,
    parsePort: parsePort,
    isValidIPv4: isValidIPv4,
    isValidIPv6: isValidIPv6,
    isValidDomain: isValidDomain,
    classifyHost: classifyHost,
    parseHostEntry: parseHostEntry,
    hostKey: hostKey,
    addHost: addHost,
    normalizeStoredHosts: normalizeStoredHosts,
    hostListModel: hostListModel,
    removeAt: removeAt,
    isPrivateAddress: isPrivateAddress,
    isUsablePublicIp: isUsablePublicIp,
    classifyHostReachability: classifyHostReachability,
    validateProviderName: validateProviderName,
    providerAddressKey: providerAddressKey,
    findProviderByAddress: findProviderByAddress,
    normalizeProviderRecord: normalizeProviderRecord,
    upsertProvider: upsertProvider,
    makeId: makeId,
  };
});
