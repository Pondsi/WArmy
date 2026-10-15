import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.js';
let s = fs.readFileSync(p, 'utf8');

// 供应商卡片加协议选择框
const oldS = `          '<div class="field"><label>' + escapeHtml(t('settings.baseUrl')) + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"' +`;
const newS = `          '<div class="field"><label>' + escapeHtml(tOr('settings.protocol', '协议')) + '</label>' +
          '<select data-k="protocol" title="' + escapeHtml(tOr('settings.protocolHint', 'openai兼容 / openai / anthropic')) + '">' +
          ['openai-compatible', 'openai', 'anthropic'].map((x) =>
            '<option value="' + x + '"' + ((pr.protocol || 'openai-compatible') === x ? ' selected' : '') + '>' +
            (x === 'openai-compatible' ? escapeHtml(tOr('settings.protoCompat', 'openai兼容')) : x) + '</option>').join('') +
          '</select></div>' +
          '<div class="field"><label>' + escapeHtml(t('settings.baseUrl')) + '</label><input data-k="baseURL" value="' + escapeHtml(pr.baseURL) + '"' +`;

const n = s.split(oldS).length - 1;
console.log('proto hits', n);
if (n !== 1) process.exit(1);
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('protocol select added');
