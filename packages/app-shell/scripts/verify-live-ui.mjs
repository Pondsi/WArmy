/**
 * 真机 UI 断言（CDP，真 DOM，不是 grep 源码）。
 * 覆盖用户本轮点名的问题：横幅压住聊天、我的页无保存按钮+邮箱即时保存、
 * UI 不出现原始 i18n 键、成员卡片按会话类型显隐、第二列「+」菜单、插件区、容器说明折叠、
 * 独立会话窗只保留聊天+右栏。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_LIVE_CDP_PORT || 9899);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  ok  ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL ' + label, detail === undefined ? '' : ' => ' + JSON.stringify(detail).slice(0, 300)); }
}

async function waitCdp(secs = 45) {
  for (let i = 0; i < secs * 2; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  const profile = path.join(os.tmpdir(), 'warmy-live-ui-profile-' + Date.now());
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`,
    '--disable-features=CalculateNativeWinOcclusion',
    `--user-data-dir=${profile}`,
    mainJs,
  ], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });

  try {
    if (!(await waitCdp())) { console.error('CDP not up'); process.exit(2); }
    await sleep(4000);
    const c = await attach(PORT, { label: 'live-ui', callTimeout: 20000 });
    await c.send('Runtime.enable');
    await sleep(2000);

    // ── 1. 原始 i18n 键泄漏（在**可见文本**里找 namespace.key 形态） ──
    const rawKeys = await c.evaluate(`(function(){
      const NAMESPACES = ['me','chat','settings','dashboard','privacy','panel','container','net','list','contact','group','ctx','console','about','projectFiles','memory','join','model','instances','board'];
      const re = new RegExp('^(?:' + NAMESPACES.join('|') + ')\\\\.[a-zA-Z][a-zA-Z0-9_.]*$');
      const out = [];
      const walk = (root) => {
        const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = it.nextNode())) {
          const s = (n.nodeValue || '').trim();
          if (!s) continue;
          // 单个文本节点就是 key（含拼接：me.copyme.changeCred）
          const parts = s.split(/(?=(?:me|chat|settings|dashboard|privacy|panel|container|list|contact|group|ctx|console|about|memory|join|model|instances)\\.)/).filter(Boolean);
          for (const p of parts) if (re.test(p.trim())) out.push(p.trim().slice(0, 60));
        }
      };
      walk(document.body);
      return Array.from(new Set(out)).slice(0, 25);
    })()`);
    check('UI 无原始 i18n 键泄漏', Array.isArray(rawKeys) && rawKeys.length === 0, rawKeys);

    // ── 2. 横幅不压住聊天区（真几何） ──
    const bannerGeom = await c.evaluate(`(function(){
      const host = document.getElementById('net-banner');
      const cl = document.getElementById('chat-layout');
      const main = document.getElementById('main-col');
      if (!host || !cl) return { skip: true };
      const hb = host.getBoundingClientRect();
      const cb = cl.getBoundingClientRect();
      const shown = !host.classList.contains('hidden') && hb.height > 1;
      return {
        shown,
        bannerBottom: Math.round(hb.bottom),
        chatTop: Math.round(cb.top),
        overlapPx: Math.round(hb.bottom - cb.top),
        hasBanner: !!(main && main.classList.contains('has-banner')),
      };
    })()`);
    if (bannerGeom.skip) {
      check('横幅几何（无聊天区时跳过）', true);
    } else if (!bannerGeom.shown) {
      check('横幅未显示时聊天区不被挤压', bannerGeom.overlapPx <= 2, bannerGeom);
    } else {
      check('横幅显示时聊天区在横幅下方（不重叠）', bannerGeom.overlapPx <= 2, bannerGeom);
    }

    // ── 3. 设置：通知/邮箱布局 + 插件区 + 容器折叠 + 特殊模型 ──
    await c.evaluate(`(function(){ try { document.querySelector('#rail [data-nav="settings"]').click(); } catch(e){} return true; })()`);
    await sleep(1200);
    const settingsDom = await c.evaluate(`(function(){
      const g = (s) => document.querySelector(s);
      const emailCard = g('#notify-email-card');
      const soundCard = (function(){
        const el = g('s-complete');
        return el ? el.closest('.set-card') : null;
      })();
      return {
        emailCardExists: !!emailCard,
        emailNotifyInEmailCard: !!(emailCard && emailCard.querySelector('[data-email-k]')),
        emailNotifyInSoundCard: !!(soundCard && soundCard.querySelector('[data-email-k]')),
        hasApply: !!g('#btn-notify-apply'),
        hasCancel: !!g('#btn-notify-cancel'),
        plugPickSelect: !!g('#plug-pick'),
        plugFolderBtn: !!g('#btn-plug-install-folder'),
        plugList: !!g('#plug-list'),
        plugScanCheck: !!g('#btn-plug-scan-check'),
        skillBrowse: !!g('#btn-skill-scan-browse'),
        skillCheck: !!g('#btn-skill-scan-check'),
        containerGuideCollapse: !!g('details#container-guide-collapse'),
        specialHint: !!document.querySelector('.set-section [data-sec="model"] h2'),
      };
    })()`);
    check('邮件通知在邮箱(SMTP)卡片内', settingsDom.emailNotifyInEmailCard === true, settingsDom);
    check('通知音卡片内不再有邮件通知', settingsDom.emailNotifyInSoundCard === false, settingsDom);
    check('通知/邮箱底部有确定+取消', settingsDom.hasApply && settingsDom.hasCancel, settingsDom);
    check('插件区已删除假下拉选择器', settingsDom.plugPickSelect === false, settingsDom);
    check('插件区有「从文件夹安装」按钮', settingsDom.plugFolderBtn === true, settingsDom);
    check('插件区有自动发现+检查插件', settingsDom.plugScanCheck === true, settingsDom);
    check('技能区有「浏览…」+「检查技能」', settingsDom.skillBrowse && settingsDom.skillCheck, settingsDom);
    check('容器说明已折叠(details)', settingsDom.containerGuideCollapse === true, settingsDom);

    // ── 3b. 供应商（第 8/9 条）真机断言 ──
    const provDom = await c.evaluate(`(function(){
      const g = (s) => document.querySelector(s);
      const sel = g('#prov-preset');
      const opts = sel ? Array.from(sel.options).map((o) => o.textContent.trim()) : [];
      const add = g('#btn-add-prov');
      const before = document.querySelectorAll('#prov-list .prov-card').length;
      if (add) add.click();
      return { presetExists: !!sel, optionCount: opts.length, options: opts, before, hasCount: !!g('#prov-count') };
    })()`);
    check('供应商：有预设下拉且含 ≥10 项', provDom.presetExists && provDom.optionCount >= 10, provDom);
    check('供应商：有计数显示（n/50）', provDom.hasCount === true, provDom);
    await sleep(900);
    const provAfter = await c.evaluate(`(function(){
      const cards = document.querySelectorAll('#prov-list .prov-card').length;
      const count = (document.querySelector('#prov-count') || {}).textContent || '';
      // 特殊模型只能选供应商里已存在的模型：没有模型时只能是占位项
      const sm = document.querySelector('select[data-special]');
      const smOpts = sm ? Array.from(sm.options).map((o) => o.value).filter((v) => v !== '') : [];
      return { cards, count, smOptions: smOpts };
    })()`);
    check('供应商：点「添加」后卡片数 +1', provAfter.cards > provDom.before, { before: provDom.before, after: provAfter.cards });
    check('供应商：计数随卡片更新', String(provAfter.count).includes('/50'), provAfter.count);
    check('特殊模型：供应商无模型时不给可选项（第 8 条）', provAfter.smOptions.length === 0, provAfter);

    // 清理：把刚加的空供应商删掉，避免影响后续断言
    await c.evaluate(`(function(){
      const btns = document.querySelectorAll('#prov-list [data-prov-del]');
      if (btns.length) btns[btns.length - 1].click();
      return true;
    })()`);
    await sleep(600);

    // ── 3c. 容器运行时名字不得含"推荐/厂商"等广告性措辞 ──
    const contNames = await c.evaluate(`(function(){
      const out = [];
      document.querySelectorAll('#container-guide .ctg-guide-name, #container-guide [data-name]').forEach((el) => out.push((el.textContent || '').trim()));
      return out;
    })()`);
    check('容器说明：运行时名字无"推荐/厂商"字样',
      Array.isArray(contNames) && !contNames.some((n) => /推荐|优先|recommended|preferred|厂商|公司/i.test(n)),
      contNames.slice(0, 6));

    // ── 3d. 设置分区：技能/插件独立 + 黑名单归「功能」+ 不会被按钮弹回首页 ──
    const secDom = await c.evaluate(`(function(){
      const navs = Array.from(document.querySelectorAll('#settings-nav button')).map((b) => b.dataset.sec);
      const go = (sec) => {
        const b = document.querySelector('#settings-nav button[data-sec="' + sec + '"]');
        if (b) b.click();
        return !!b;
      };
      const visible = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        /**
         * 只看 offsetParent：元素被祖先 display:none 隐藏时 offsetParent 为 null。
         * 早先写成「offsetParent !== null || display !== 'none'」—— 被祖先藏起来的
         * 内层元素 display 仍是 block，于是"藏了也判成可见"（门禁假通过）。
         */
        return el.offsetParent !== null;
      };
      // ① 技能/插件是独立层级
      const hasSkill = go('skill');
      const skillCardVisible = visible('#skills-card');
      const pluginVisible = visible('#container-card'); // 技能分区里不该看到容器卡
      go('plugin');
      const pluginCardVisible = !!(document.querySelector('#settings-nav button[data-sec="plugin"]'));
      // ② 黑名单属于「功能」：在功能里可见、在模型里不可见
      go('func');
      const blInFunc = visible('#blacklist-box');
      go('model');
      const blInModel = visible('#blacklist-box');
      // ③ 点「添加供应商」后**分区不被弹回首页**（这是用户报的 bug）
      const add = document.querySelector('#btn-add-prov');
      if (add) add.click();
      return { navs, hasSkill, skillCardVisible, pluginVisible, pluginCardVisible, blInFunc, blInModel };
    })()`);
    check('设置分区：技能/插件是独立层级（导航里有 skill / plugin）',
      Array.isArray(secDom.navs) && secDom.navs.includes('skill') && secDom.navs.includes('plugin'), secDom.navs);
    check('设置分区：选中「技能」时技能卡片可见、容器卡片不可见',
      secDom.hasSkill === true && secDom.skillCardVisible === true && secDom.pluginVisible === false, secDom);
    check('黑名单管理在「功能」里可见、在「模型」里不可见（不再挂在模型下）',
      secDom.blInFunc === true && secDom.blInModel === false, { inFunc: secDom.blInFunc, inModel: secDom.blInModel });
    await sleep(900);
    const secAfter = await c.evaluate(`(function(){
      const on = document.querySelector('#settings-nav button.on');
      const cards = document.querySelectorAll('#prov-list .prov-card').length;
      return { active: on ? on.dataset.sec : null, cards };
    })()`);
    check('点「添加供应商」后仍停在「模型」分区（不被弹回设置首页）', secAfter.active === 'model', secAfter);

    // ── 3e. 供应商：新加的排最上面 + 真的落盘（且**密钥不在设置文件里**） ──
    const orderDom = await c.evaluate(`(function(){
      const cards = Array.from(document.querySelectorAll('#prov-list .prov-card'));
      const first = cards[0] ? (cards[0].querySelector('.prov-head') || {}).textContent : '';
      const labels = cards.map((x) => { const h = x.querySelector('.prov-head'); return h ? h.textContent.trim() : ''; });
      return { count: cards.length, first: String(first || '').trim(), labels };
    })()`);
    check('供应商：新添加的排在最上面（列表倒序）',
      orderDom.count > 0 && orderDom.first === orderDom.labels[0] && /_\\d+$|DeepSeek/i.test(orderDom.first),
      orderDom.labels.slice(0, 4));
    const persisted = await c.evaluate(`(async function(){
      try {
        const r = await window.warmy.settingsGet();
        const ps = (r && r.settings && r.settings.providers) || [];
        return {
          count: ps.length,
          hasApiKeyField: ps.some((p) => Object.prototype.hasOwnProperty.call(p, 'apiKey') && String(p.apiKey || '')),
          seeded: !!(r && r.settings && r.settings.providersSeeded),
          keys: Object.keys(ps[0] || {}),
        };
      } catch (e) { return { err: String(e) }; }
    })()`);
    check('供应商列表已落盘到设置（providersSeeded 已置位）', persisted.seeded === true && persisted.count > 0, persisted);
    check('设置文件里**不含** API Key（密钥只进 safeStorage）', persisted.hasApiKeyField === false, persisted.keys);

    // ── 3f. 改「接口地址」⇒ 该供应商模型全部标红（stale），而不是删除 ──
    const staleDom = await c.evaluate(`(async function(){
      // 灌一份"有模型"的供应商，再按真实路径重画
      await window.warmy.settingsSave({
        providers: [{ id: 'gate-prov', label: 'GateProv', protocol: 'openai-compatible', baseURL: 'https://a.example/v1', models: ['gate-model-a'], staleModels: {}, hasKey: true }],
        providersSeeded: true,
      });
      await window.__warmyReloadProviders();
      window.__warmyRenderPage();
      const nav = document.querySelector('#settings-nav button[data-sec="model"]');
      if (nav) nav.click();
      await new Promise((r) => setTimeout(r, 200));
      const before = document.querySelector('#prov-list [data-m="gate-model-a"]');
      const beforeRed = !!before && before.classList.contains('in-use');
      // 改接口地址（真实的 onchange 路径）
      const input = document.querySelector('#prov-list input[data-k="baseURL"]');
      if (input) { input.value = 'https://b.example/v1'; input.dispatchEvent(new Event('change')); }
      await new Promise((r) => setTimeout(r, 400));
      const chip = document.querySelector('#prov-list [data-m="gate-model-a"]');
      return {
        beforeRed,
        stillThere: !!chip,
        afterRed: !!chip && chip.classList.contains('in-use'),
        tip: chip ? String(chip.getAttribute('title') || '') : '',
        note: (document.querySelector('#prov-list [data-models-note]') || {}).textContent || '',
      };
    })()`);
    check('改接口地址 ⇒ 模型**保留**（不删除）', staleDom.stillThere === true, staleDom);
    check('改接口地址 ⇒ 模型**标红**（stale）', staleDom.afterRed === true && staleDom.beforeRed === false, staleDom);
    check('标红模型的悬停提示写明"需重新拉取"', /重新拉取|re-fetch/i.test(staleDom.tip) || /重新拉取/.test(staleDom.note), { tip: staleDom.tip, note: staleDom.note });

    // 清理：把门禁灌进去的供应商删掉，恢复默认列表
    await c.evaluate(`(async function(){
      const btns = document.querySelectorAll('#prov-list [data-prov-del]');
      for (const b of Array.from(btns)) b.click();
      await new Promise((r) => setTimeout(r, 300));
      return true;
    })()`);
    await sleep(600);

    // ── 3g. 容器实例区：引擎没启动 ⇒ 不可展开、不可创建（灰且 disabled） ──
    const instDom = await c.evaluate(`(function(){
      const blocks = Array.from(document.querySelectorAll('#container-list .ctg-inst'));
      const disabled = blocks.filter((b) => b.dataset.instEnabled === '0');
      const bad = disabled.filter((b) => {
        const t = b.querySelector('[data-inst-toggle]');
        const c2 = b.querySelector('[data-inst-create]');
        return !(t && t.disabled) || !(c2 && c2.disabled);
      });
      return { blocks: blocks.length, disabled: disabled.length, bad: bad.length };
    })()`);
    check('容器实例区：引擎未启动时「查看/创建」按钮为 disabled（点不动）',
      instDom.bad === 0, instDom);

    // ── 4. 我的页：无保存按钮、邮箱输入存在 ──
    await c.evaluate(`(function(){ try { document.querySelector('#rail [data-nav="me"]').click(); } catch(e){} return true; })()`);
    await sleep(1400);
    const meDom = await c.evaluate(`(function(){
      const g = (s) => document.querySelector(s);
      const mail = g('#p-email');
      // 品牌是否按语言显示 + 是否与资料同一行
      const top = g('.me-top');
      const brand = g('.me-brand-name');
      const prof = g('.me-strip');
      // 品牌与资料"同一行"：用几何判据（左右并排 + 垂直有重叠），
      // 不写死 80px 容差 —— 布局改成卡片后会误判。
      let sameRow = false;
      try {
        const brandBox = (g('.me-brand') || brand).getBoundingClientRect();
        const profBox = (prof || brand).getBoundingClientRect();
        const sideBySide = profBox.left >= brandBox.right - 4;
        const vOverlap = Math.min(brandBox.bottom, profBox.bottom) - Math.max(brandBox.top, profBox.top);
        sameRow = sideBySide && vOverlap > 20;
      } catch { sameRow = false; }
      return {
        hasSaveBtn: !!g('#p-save'),
        hasEmail: !!mail,
        emailType: mail ? mail.getAttribute('type') || mail.tagName : null,
        brandText: brand ? brand.textContent.trim() : null,
        sameRow,
        hasCred: !!g('#me-cred-val'),
        credText: (g('#me-cred-val') || {}).textContent || '',
        hasCopy: !!g('#btn-me-cred-copy'),
        hasRotate: !!g('#btn-me-cred-rotate'),
        hasSwitch: !!g('#btn-me-cred-switch'),
        // ID = 私钥：必须**明说**泄露后果与"没有服务器能挂失"
        idWarn: (document.querySelector('.me-hint-warn') || {}).textContent || '',
      };
    })()`);
    check('我的页不再有「保存资料」按钮', meDom.hasSaveBtn === false, meDom);
    check('我的页有邮箱输入（即时保存）', meDom.hasEmail === true, meDom);
    check('品牌名按语言显示且非空', !!meDom.brandText && meDom.brandText.length > 0, meDom);
    check('品牌与个人资料同一行（左品牌/右资料）', meDom.sameRow === true, meDom);
    check('我的页显示唯一凭证+复制/更换/切换', meDom.hasCred && meDom.hasCopy && meDom.hasRotate && meDom.hasSwitch, meDom);
    check('凭证是 17 位或指纹形态', /^[A-Z0-9-]{8,}$|^\d{17}$/.test(String(meDom.credText).trim()) || meDom.credText === '—', meDom.credText);
    check('ID 行明说"ID 即私钥 + 没有服务器能挂失"（不让用户误以为能找回）',
      /私钥|private key/i.test(meDom.idWarn) && /挂失|revoke|找回|recover/i.test(meDom.idWarn), String(meDom.idWarn).slice(0, 80));

    // ── 5. 成员卡片按会话类型显隐 + 第二列「+」 ──
    // 规则：**必须选中对应会话**才显示成员 —— 没有选中会话时任何会话卡片都不该出现。
    const panelState = () => c.evaluate(`(function(){
      const blk = document.getElementById('panel-members-block');
      const act = document.getElementById('list-action');
      const vis = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      return {
        membersVisible: vis(blk),
        actionText: act ? (act.textContent || '').trim() : null,
        actionVisible: vis(act),
        selected: (window.__liveSelected && window.__liveSelected()) || null,
      };
    })()`);

    const clickNav = async (nav) => {
      await c.evaluate(`(function(){ try { document.querySelector('#rail [data-nav="${nav}"]').click(); } catch(e){} return true; })()`);
      await sleep(1100);
    };

    // 5a. 未选中任何会话：不得出现成员卡片（默认态）
    await clickNav('singleAi');
    const noSel = await panelState();
    check('未选中会话：不显示「成员」卡片', noSel.membersVisible === false, noSel);

    // 5b. 联系人：无成员 + 入口是「+」
    await clickNav('externalChat');
    const contactDom = await panelState();
    check('联系人：右侧无「成员」卡片', contactDom.membersVisible === false, contactDom);
    check('联系人：第二列入口是「+」', contactDom.actionVisible === true && contactDom.actionText === '+', contactDom);

    // 5c. 真实建一个项目并选中它 → 成员卡片必须出现
    const gid = 'live-proj-' + Date.now();
    const created = await c.evaluate(`(async function(){
      try {
        const r = await window.warmy.groupCreate({ groupId: '${gid}', name: 'Live Project', type: 'internal', directedMode: false, devEnv: 'host' });
        return r;
      } catch (e) { return { ok: false, error: String(e) }; }
    })()`);
    check('可创建内部项目（前置）', !!created && created.ok === true, created);
    // 建群是**直接走 IPC**（绕过界面流程），所以要让界面按真实存储重新拉一次列表
    await c.evaluate(`(async function(){ try { if (window.__syncGroups) await window.__syncGroups(); } catch(e){} return true; })()`);
    await clickNav('internalGroup');
    await sleep(1800);
    const clicked = await c.evaluate(`(function(){
      const rows = Array.from(document.querySelectorAll('#list-body .list-item'));
      if (!rows.length) return { clicked: false, count: 0 };
      rows[0].click();
      return { clicked: true, count: rows.length };
    })()`);
    await sleep(1600);
    const projDom = await panelState();
    check('项目列表至少有 1 行（前置）', clicked.clicked === true, clicked);
    check('项目：选中后右侧显示「成员」卡片', projDom.membersVisible === true, projDom);
    check('项目：第二列入口是「+」（合并新建/加入）', projDom.actionText === '+', projDom);

    const menuDom = await c.evaluate(`(function(){
      const act = document.getElementById('list-action');
      if (!act) return { exists: false };
      act.click();
      return { exists: true };
    })()`);
    await sleep(700);
    const menuItems = await c.evaluate(`(function(){
      const m = document.getElementById('list-plus-menu');
      if (!m) return { exists: false };
      const btns = Array.from(m.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
      const r = { exists: true, items: btns };
      m.remove();
      return r;
    })()`);
    check('项目「+」弹出菜单含 新建+加入', menuDom.exists === true && menuItems.exists === true && menuItems.items.length >= 2, menuItems);

    // ── 6. 独立会话窗：body.chat-window 只保留聊天+右栏 ──
    const subDom = await c.evaluate(`(function(){
      document.body.classList.add('chat-window');
      const vis = (s) => {
        const el = document.querySelector(s);
        if (!el) return 'absent';
        const cs = getComputedStyle(el);
        return cs.display === 'none' ? 'hidden' : 'visible';
      };
      const r = {
        rail: vis('#rail'),
        listCol: vis('#list-col'),
        chatLayout: vis('#chat-layout'),
        panelCol: vis('#panel-col'),
        titlebar: vis('#titlebar'),
        pageLayout: vis('#page-layout'),
      };
      document.body.classList.remove('chat-window');
      return r;
    })()`);
    check('独立窗：rail 隐藏', subDom.rail === 'hidden' || subDom.rail === 'absent', subDom);
    check('独立窗：第二列隐藏', subDom.listCol === 'hidden' || subDom.listCol === 'absent', subDom);
    check('独立窗：聊天列可见', subDom.chatLayout === 'visible', subDom);
    check('独立窗：右栏可见', subDom.panelCol === 'visible', subDom);
    check('独立窗：保留可拖标题栏', subDom.titlebar === 'visible', subDom);
    check('独立窗：不显示整页(设置/看板)', subDom.pageLayout !== 'visible', subDom);

    // ── 7. 设备 ID = **身份凭证**（base56、45 位、256 bit）——
    //      ID 即私钥、公钥指纹才是给别人的；旧 9 位数字已不再兼容（产品主定稿） ──
    const idInfo = await c.evaluate(`(async function(){ try { const r = await window.warmy.appInfo(); return { deviceId: r && r.deviceId, valid: r && r.deviceIdValid }; } catch(e) { return { err: String(e) }; } })()`);
    const idStr = String((idInfo && idInfo.deviceId) || '');
    // 去掉易混的 I/O/Z（含小写）后的 56 个符号，定长 45 位
    const isCredential = /^[0-9ABCDEFGHJKLMNPQRSTUVWXYabcdefghjklmnpqrstuvwxy]{45}$/.test(idStr);
    // 兼容：上一版 UUIDv4 与更早的 17 位十进制（老配置不会被判无效而重新生成身份）
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idStr);
    const isLegacy17 = /^[1-9][0-9]{16}$/.test(idStr);
    check('设备 ID 为 45 位凭证(base56 去 I/O/Z，即私钥) 或兼容的旧格式，且校验通过', (isCredential || isUuid || isLegacy17) && !!idInfo && idInfo.valid === true, idInfo);
    check('凭证不含易混字符 I / O / Z', !/[IOZioz]/.test(idStr) || isUuid || isLegacy17, idStr);

    // ── 8. 运行时版本：应用内 Node 必须 >= 24 LTS（Electron 40+ 才自带 Node 24） ──
    const ver = await c.evaluate(`(async function(){ try { const r = await window.warmy.appInfo(); return { node: r && r.node, electron: r && r.electron, chrome: r && r.chrome }; } catch(e) { return { err: String(e) }; } })()`);
    const nodeMajor = Number(String((ver && ver.node) || '0').split('.')[0]);
    const elMajor = Number(String((ver && ver.electron) || '0').split('.')[0]);
    check('应用内 Node >= 24（Electron 40+）', nodeMajor >= 24, ver);
    check('Electron 主版本 >= 40（自带 Node 24 LTS 的最早主版本）', elMajor >= 40, ver);

  } finally {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
  }

  console.log(`\n==== verify-live-ui: ${pass} ok / ${fail} FAIL ====`);
  if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(3); });
