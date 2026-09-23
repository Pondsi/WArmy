const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/';
let j = fs.readFileSync(base + 'renderer/yingYong.js', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let p = fs.readFileSync(base + 'preload.cjs', 'utf8');

// ── 项目/群聊界面加入选项 ──
if (!h.includes('anNiuJiaRuqr')) {
  h = h.replace(
    '              <shuRu id="chat-search"',
    '              <button id="anNiuJiaRuqr" class="anNiuXiao" data-i18n="join.scanQr" data-i18n-title="join.qrHint"></button>\n              <shuRu id="chat-search"'
  );
  console.log('join qr button added');
}

// QR 识别：用 jsQR 或内置解析（简化：提示用户粘贴链接）
if (!j.includes('anNiuJiaRuqr')) {
  j = j.replace(
    "  $('btn-chat-search')?.addEventListener('click'",
    `  // 加入项目/群聊：扫码或粘贴链接
  $('anNiuJiaRuqr')?.addEventListener('click', async () => {
    const root = $('duiHuaKuangGen');
    $('duiHuaKuangBiaoTi').textContent = t('join.biaoTi');
    $('duiHuaKuangTi').innerHTML =
      '<div class="jingYin" style="margin-bottom:8px">' + t('join.dropHint') + '</div>' +
      '<shuRu type="file" id="jiaRuqrWenJian" accept="image/*" style="margin-bottom:8px"/>' +
      '<div class="jingYin" style="margin-bottom:8px">' + t('join.scanHint') + '</div>' +
      '<shuRu id="jiaRuLinkShuRu" placeholder="' + t('join.pastePlaceholder') + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"/>' +
      '<div id="jiaRuqrXiaoXi" class="jingYin" style="margin-top:6px"></div>';
    const acts = $('duiHuaKuangDongZuoJi');
    acts.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'anNiuXiao';
    cancel.textContent = t('common.cancel');
    cancel.onclick = () => { root.classList.add('yinCang'); };
    const ok = document.createElement('button');
    ok.className = 'anNiuZhuYao';
    ok.textContent = t('join.apply');
    ok.onclick = async () => {
      const link = $('jiaRuLinkShuRu')?.value?.trim();
      if (!link) { $('jiaRuqrXiaoXi').textContent = t('join.qrFail'); return; }
      const r = await window.warmy.joinRequest({
        ming: state.profile.username || 'user',
        kind: 'human',
        target: state.selectedChat?.name || link,
        targetType: state.selectedChat?.kind === 'internal' ? 'project' : 'group',
      }).catch(() => null);
      $('jiaRuqrXiaoXi').textContent = r?.ok ? t('join.ok') : t('join.fail');
      setTimeout(() => root.classList.add('yinCang'), 800);
    };
    acts.append(cancel, ok);
    root.classList.remove('yinCang');
    // 文件选择后提示（完整二维码识别需 jsQR，这里提示粘贴链接）
    $('jiaRuqrWenJian')?.addEventListener('change', () => {
      $('jiaRuqrXiaoXi').textContent = t('join.scanHint');
    });
  });

  $('btn-chat-search')?.addEventListener('click'`
  );
  console.log('join QR modal wired');
}

// ── 设置分类：界面/通知/模型/功能 ──
if (!j.includes('settings.section.ui')) {
  // 语言+主题 → 界面
  j = j.replace(
    "        <h1>${t('nav.settings')}</h1>",
    "        <h1>${t('nav.settings')}</h1>\n        <div class=\"sheZhiSection\"><h2 style=\"color:var(--accent)\">${t('settings.section.ui')}</h2></div>"
  );
  // 提示音 → 通知
  j = j.replace(
    "        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.sound')}</h2>",
    "        <div class=\"sheZhiSection\"><h2 style=\"color:var(--accent)\">${t('settings.section.notify')}</h2></div>\n        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.soundName')}</h2>"
  );
  // 供应商 → 模型
  j = j.replace(
    "        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.providers')}</h2>",
    "        <div class=\"sheZhiSection\"><h2 style=\"color:var(--accent)\">${t('settings.section.model')}</h2></div>\n        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.providers')}</h2>"
  );
  // 插件 → 功能
  j = j.replace(
    "        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.chaJianJi')}</h2>",
    "        <div class=\"sheZhiSection\"><h2 style=\"color:var(--accent)\">${t('settings.section.func')}</h2></div>\n        <div class=\"sheZhiSection sheZhiKa\">\n          <h2>${t('settings.chaJianJi')}</h2>"
  );
  console.log('settings categorized');
}

// 删掉摘要模型字段（合并时已删）
j = j.replace(/<biaoQian>\$\{t\('settings\.summaryModel'\)\}<\/biaoQian>\s*<shuRu id="sm-summary"[^>]*\/>/, '');

fs.writeFileSync(base + 'renderer/yingYong.js', j);
fs.writeFileSync(base + 'renderer/index.html', h);
console.log('done');
