/**
 * 门禁：**给模型传数据前的格式验收**（media-format 纯函数）。
 *
 * 产品要求：拉取模型时知道它收什么格式、内置格式转换、每次发送前都做格式验收。
 * 这条门禁把「验收必须拦住不合规数据」这件事固化下来：
 *   · 认不出来的格式 ⇒ 拒绝（绝不发出去）
 *   · 只收 wav/mp3 的 ASR 收到 webm ⇒ 必须给出「转换或拒绝」的结论
 *   · 已合规 ⇒ 原样放行
 *
 * 用法：<node> verify-media-format.mjs
 */
import assert from 'node:assert/strict';
import {
  jianBieGeShi, geShiZhongLei, jieShouGeShi, zhuanHuanMuBiao, yanShouGeShi, biGuoMenJin,
} from '../../providers/dist/media-format.js';

let n = 0;
const ok = (t, fn) => { fn(); n++; console.log('ok  ', t); };

ok('识别格式：MIME / 扩展名 / dataURL', () => {
  assert.equal(jianBieGeShi('audio/webm'), 'webm');
  assert.equal(jianBieGeShi('.WAV'), 'wav');
  assert.equal(jianBieGeShi('data:audio/mpeg;base64,AAA'), 'mp3');
  assert.equal(jianBieGeShi('image/png'), 'png');
  assert.equal(jianBieGeShi('.JPG'), 'jpeg');
  assert.equal(jianBieGeShi('乱七八糟'), 'unknown');
});

ok('分类：音频/图片/视频', () => {
  assert.equal(geShiZhongLei('wav'), 'audio');
  assert.equal(geShiZhongLei('png'), 'image');
  assert.equal(geShiZhongLei('mp4'), 'video');
  assert.equal(geShiZhongLei('unknown'), 'unknown');
});

ok('ASR（MiMo 实测口径）只收 wav/mp3', () => {
  const jie = jieShouGeShi('audio', 'openai-compatible', 'asr');
  assert.deepEqual(jie, ['wav', 'mp3']);
});

ok('图片收 png/jpeg/webp/gif', () => {
  const jie = jieShouGeShi('image', 'openai-compatible', 'chat');
  assert.deepEqual(jie, ['png', 'jpeg', 'webp', 'gif']);
});

ok('转换目标：音频→wav（首选），图片→png', () => {
  assert.equal(zhuanHuanMuBiao('webm', ['wav', 'mp3']), 'wav');
  assert.equal(zhuanHuanMuBiao('ogg', ['mp3']), 'mp3');
  assert.equal(zhuanHuanMuBiao('gif', ['png', 'jpeg']), 'png');
  assert.equal(zhuanHuanMuBiao('bmp', ['jpeg']), 'jpeg');
});

ok('门禁：合规原样放行', () => {
  const jie = yanShouGeShi('audio/wav', ['wav', 'mp3']);
  assert.equal(jie.action, 'pass');
  assert.equal(jie.ok, true);
});

ok('门禁：webm 送给只收 wav/mp3 的 ASR ⇒ 必须 convert 或 reject（绝不 pass）', () => {
  const jie = yanShouGeShi('audio/webm', ['wav', 'mp3']);
  assert.equal(jie.action, 'convert');
  assert.equal(jie.to, 'wav');
  assert.equal(jie.action === 'pass', false);
});

ok('门禁：认不出的格式一律拒绝', () => {
  const jie = yanShouGeShi('完全不是格式', ['wav']);
  assert.equal(jie.action, 'reject');
  assert.equal(jie.ok, false);
});

ok('门禁：类别不匹配 ⇒ 拒绝（不许拿音频塞给看图）', () => {
  const jie = yanShouGeShi('audio/mp3', ['png', 'jpeg']);
  assert.equal(jie.action, 'reject');
  assert.match(String(jie.reason), /format-unsupported/);
});

ok('门禁入口 biGuoMenJin：拒绝时不允许发送', () => {
  const bad = biGuoMenJin('video/mp4', ['wav', 'mp3']);
  assert.equal(bad.fa, false);
  const good = biGuoMenJin('data:audio/wav;base64,AAA', ['wav', 'mp3']);
  assert.equal(good.fa, true);
});

ok('无清单 = 不设限（但仍要能识别）', () => {
  assert.equal(yanShouGeShi('wav', []).action, 'pass');
  assert.equal(yanShouGeShi('不认识', []).action, 'reject');
});

console.log(`==== verify-media-format: ${n} 全部通过 ====`);
process.exit(0);
