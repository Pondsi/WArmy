const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');

// 归档列表：加到 app.js 的设置模板里
if (!j.includes('archived-box')) {
  const about = "        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>";
  if (j.includes(about)) {
    j = j.replace(about, "        <div class=\"set-section set-card\">\n          <h2>${t('ctx.archive')}</h2>\n          <div id=\"archived-box\" class=\"muted\">—</div>\n        </div>\n" + about);
    console.log('archived section added to settings');
  } else {
    console.log('about anchor missing in app.js');
  }
}

// 归档刷新绑定
if (!j.includes('refreshArchived')) {
  const anchor = '      // SMTP 多账号（最多 10）';
  if (j.includes(anchor)) {
    j = j.replace(anchor, `      async function refreshArchived() {
        const box = $('archived-box');
        if (!box) return;
        const r = await window.warmy.archivedList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((a) => '<div>' + escapeHtml(a.name) + ' · ' + a.kind + '</div>').join('')
          : '—';
      }
      refreshArchived();

${anchor}`);
    console.log('archived binding added');
  } else {
    console.log('SMTP anchor missing');
  }
}

// KB 详情：当前是 textContent，改为带详情
const oldKb = "    $('kb-out').textContent =\n      (r?.entities || []).map((e) => e.name).join(', ') +\n      ' | ' +\n      (r?.events || []).map((e) => e.title).join(', ');";
if (j.includes(oldKb)) {
  j = j.replace(oldKb, `    const det = await window.warmy.kbDetail(q).catch(() => null);
    $('kb-out').innerHTML =
      '<div>' + escapeHtml((r?.entities || []).map((e) => e.name).join(', ') || '—') + '</div>' +
      '<div>' + escapeHtml((r?.events || []).map((e) => e.title).join(' | ') || '—') + '</div>' +
      (det?.entities?.length
        ? '<div style="margin-top:6px">' + det.entities.slice(0, 3).map((e) => escapeHtml(e.name) + ' [' + e.kind + ']').join(', ') + '</div>'
        : '');`);
  console.log('kb detail updated');
} else {
  console.log('kb anchor not found, checking...');
  const i = j.indexOf('kb-out');
  if (i >= 0) console.log('kb-out context:', JSON.stringify(j.slice(i - 80, i + 200)));
}

fs.writeFileSync(base + 'app.js', j);
console.log('final:', j.includes('refreshArchived'), j.includes('archived-box'), j.includes('kbDetail'));
