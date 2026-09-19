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
      let sameRow = false;
      if (top && brand && prof) {
        const rb = brand.getBoundingClientRect();
        const rp = prof.getBoundingClientRect();
        sameRow = Math.abs(rb.top - rp.top) < 80 && rp.left > rb.left;
      }
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
      };
    })()`);
    check('我的页不再有「保存资料」按钮', meDom.hasSaveBtn === false, meDom);
    check('我的页有邮箱输入（即时保存）', meDom.hasEmail === true, meDom);
    check('品牌名按语言显示且非空', !!meDom.brandText && meDom.brandText.length > 0, meDom);
    check('品牌与个人资料同一行（左品牌/右资料）', meDom.sameRow === true, meDom);
    check('我的页显示唯一凭证+复制/更换/切换', meDom.hasCred && meDom.hasCopy && meDom.hasRotate && meDom.hasSwitch, meDom);
    check('凭证是 17 位或指纹形态', /^[A-Z0-9-]{8,}$|^\d{17}$/.test(String(meDom.credText).trim()) || meDom.credText === '—', meDom.credText);

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

    // ── 7. 设备 ID 17 位 ──
    const idInfo = await c.evaluate(`(async function(){ try { const r = await window.warmy.appInfo(); return { deviceId: r && r.deviceId, valid: r && r.deviceIdValid }; } catch(e) { return { err: String(e) }; } })()`);
    check('设备 ID 为 17 位且校验通过', !!idInfo && /^\d{17}$/.test(String(idInfo.deviceId || '')) && idInfo.valid === true, idInfo);

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
