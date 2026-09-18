const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let h = fs.readFileSync(base + 'index.html', 'utf8');

console.log('appJs has SMTP:', j.includes('// SMTP'));
console.log('html about idx:', h.indexOf('settings.about'));
console.log('html about context:', JSON.stringify(h.slice(h.indexOf('settings.about') - 80, h.indexOf('settings.about') + 60)));

// 归档列表
if (!h.includes('archived-box')) {
  const aboutAnchor = "        <div class=\"set-section set-card\">\n          <h2>${t('settings.about')}</h2>";
  if (h.includes(aboutAnchor)) {
    h = h.replace(
      aboutAnchor,
      "        <div class=\"set-section set-card\">\n          <h2>${t('ctx.archive')}</h2>\n          <div id=\"archived-box\" class=\"muted\">—</div>\n        </div>\n" + aboutAnchor
    );
    console.log('archived HTML added');
  } else {
    console.log('WARN: about anchor not found in html');
  }
}

if (!j.includes('refreshArchived')) {
  const smtpAnchor = '      // SMTP';
  if (j.includes(smtpAnchor)) {
    j = j.replace(
      smtpAnchor,
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

${smtpAnchor}`
    );
    console.log('archived JS added');
  } else {
    console.log('WARN: SMTP anchor not found in js');
  }
}

// KB 详情
if (!j.includes('kbDetail(q)')) {
  const old = "        $('kb-out').innerHTML =\n          '<div><b>' + t('knowledge.title') + '</b></div>' +\n          '<div>' + escapeHtml(ents || '—') + '</div>' +\n          '<div>' + escapeHtml(evs || '—') + '</div>';";
  if (j.includes(old)) {
    j = j.replace(old, `        const det = await window.warmy.kbDetail(q).catch(() => null);
        $('kb-out').innerHTML =
          '<div><b>' + t('knowledge.title') + '</b></div>' +
          '<div>' + escapeHtml(ents || '—') + '</div>' +
          '<div>' + escapeHtml(evs || '—') + '</div>' +
          (det?.entities?.length
            ? '<div style="margin-top:6px">' + det.entities.slice(0,3).map((e) => escapeHtml(e.name) + ' [' + e.kind + ']').join(', ') + '</div>'
            : '');`);
    console.log('kb detail JS added');
  } else {
    console.log('WARN: kb-out anchor not found');
  }
}

// 成本刷新
if (!j.includes('refreshCost')) {
  const mAnchor = '  async function refreshMetrics() {';
  if (j.includes(mAnchor)) {
    j = j.replace(mAnchor, `  async function refreshCost() {
    const box = $('cost-box');
    if (!box) return;
    const c = await window.warmy.costSummary().catch(() => null);
    if (c?.ok) {
      box.textContent = '¥' + c.estCostCny + ' · ' + c.promptTokens + ' in / ' + c.completionTokens + ' out · cache ' + ((c.cacheHitRate||0)*100).toFixed(1) + '%';
    }
  }
  setInterval(refreshCost, 8000);

${mAnchor}`);
    console.log('cost refresh JS added');
  } else {
    console.log('WARN: refreshMetrics anchor not found');
  }
}

fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'index.html', h);
console.log('final check:');
console.log('  refreshArchived:', j.includes('refreshArchived'));
console.log('  kbDetail:', j.includes('kbDetail'));
console.log('  cost-box js:', j.includes('cost-box'));
console.log('  archived-box html:', h.includes('archived-box'));
console.log('  cost-box html:', h.includes('cost-box'));
