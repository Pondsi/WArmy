const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');

// 归档列表
if (!j.includes('archived-box')) {
  h = h.replace(
    "        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>",
    "        <div class=\"set-section set-card\">\n          <h2>${t('ctx.archive')}</h2>\n          <div id=\"archived-box\" class=\"muted\">—</div>\n        </div>\n        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>"
  );
  j = j.replace(
    "      // SMTP",
    `      async function refreshArchived() {
        const box = $('archived-box');
        if (!box) return;
        const r = await window.warmy.archivedList().catch(() => null);
        const items = r?.items || [];
        box.innerHTML = items.length
          ? items.map((a) => '<div>' + escapeHtml(a.name) + ' · ' + a.kind + '</div>').join('')
          : '—';
      }
      refreshArchived();

      // SMTP`
  );
  console.log('archived UI added');
}

// KB 详情展开
if (!j.includes('kbDetail(q)')) {
  j = j.replace(
    "        $('kb-out').innerHTML =\n          '<div><b>' + t('knowledge.title') + '</b></div>' +\n          '<div>' + escapeHtml(ents || '—') + '</div>' +\n          '<div>' + escapeHtml(evs || '—') + '</div>';",
    `        const det = await window.warmy.kbDetail(q).catch(() => null);
        $('kb-out').innerHTML =
          '<div><b>' + t('knowledge.title') + '</b></div>' +
          '<div>' + escapeHtml(ents || '—') + '</div>' +
          '<div>' + escapeHtml(evs || '—') + '</div>' +
          (det?.entities?.length
            ? '<div style="margin-top:6px">' + det.entities.slice(0,3).map((e) => escapeHtml(e.name) + ' [' + e.kind + ']').join(', ') + '</div>'
            : '');`
  );
  console.log('kb detail wired');
}

// 成本独立卡片
if (!h.includes('cost-box')) {
  h = h.replace(
    "          <div class=\"panel-block\">\n            <h3 data-i18n=\"metrics.title\"></h3>",
    "          <div class=\"panel-block\">\n            <h3 data-i18n=\"cost.title\"></h3>\n            <div id=\"cost-box\" class=\"muted\">—</div>\n          </div>\n          <div class=\"panel-block\">\n            <h3 data-i18n=\"metrics.title\"></h3>"
  );
  console.log('cost box added');
}

// 成本刷新
if (!j.includes('cost-box')) {
  j = j.replace(
    "  async function refreshMetrics() {",
    `  async function refreshCost() {
    const box = $('cost-box');
    if (!box) return;
    const c = await window.warmy.costSummary().catch(() => null);
    if (c?.ok) {
      box.textContent = '¥' + c.estCostCny + ' · ' + c.promptTokens + ' in / ' + c.completionTokens + ' out · cache ' + ((c.cacheHitRate||0)*100).toFixed(1) + '%';
    }
  }
  setInterval(refreshCost, 8000);

  async function refreshMetrics() {`
  );
  console.log('cost refresh wired');
}

fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'index.html', h);
console.log('done');
