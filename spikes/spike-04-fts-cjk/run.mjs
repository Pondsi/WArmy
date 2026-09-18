/**
 * Spike 4: FTS5 单字索引 + 中文短语/边界查询
 * DoD: 2字词命中率 100%；覆盖 1字/2字/3字/英文标识符/路径/错误码
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = path.join(os.tmpdir(), `warmy-spike4-${Date.now()}.db`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

/** CJK/字母数字字符间插空格，保留已空白分隔 */
function spaceChars(s) {
  return Array.from(s)
    .map((ch) => (/\s/.test(ch) ? ' ' : ch))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 查询侧：把用户查询转成 FTS5 短语 */
function toPhrase(q) {
  return `"${spaceChars(q)}"`;
}

db.exec(`
  CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT, kind TEXT);
  CREATE VIRTUAL TABLE docs_fts USING fts5(body, tokenize='unicode61', content='docs', content_rowid='id');
`);

const samples = [
  { id: 1, body: '无限牛马是项目代号', kind: 'cjk' },
  { id: 2, body: '项目进度正常推进', kind: 'cjk' },
  { id: 3, body: '进度报告已归档', kind: 'cjk' },
  { id: 4, body: '测试中文分词能力', kind: 'cjk' },
  { id: 5, body: 'error code EPIPE on socket', kind: 'ascii' },
  { id: 6, body: 'path C:\\Users\\p\\WArmy\\package.json', kind: 'ascii' },
  { id: 7, body: 'better-sqlite3 version 13.0.3', kind: 'ascii' },
  { id: 8, body: '值班者状态机与队列编排', kind: 'cjk' },
  { id: 9, body: '马尔可夫毯上下文包', kind: 'cjk' },
  { id: 10, body: '牛马协作平台正式版', kind: 'cjk' },
  { id: 11, body: '一次失败的重试 retryOnce', kind: 'mixed' },
  { id: 12, body: '短语查询与召回验证', kind: 'cjk' },
  { id: 13, body: '状态卡片不超过两千 token', kind: 'cjk' },
  { id: 14, body: 'IPC_DEAD classified error', kind: 'ascii' },
  { id: 15, body: '无边界条件的空结果', kind: 'cjk' },
];

const insertDoc = db.prepare('INSERT INTO docs (id, body, kind) VALUES (?, ?, ?)');
const insertFts = db.prepare(
  'INSERT INTO docs_fts (rowid, body) VALUES (?, ?)'
);
const tx = db.transaction(() => {
  for (const s of samples) {
    insertDoc.run(s.id, s.body, s.kind);
    // 索引侧同样插空格，保证与查询侧同构
    insertFts.run(s.id, spaceChars(s.body));
  }
});
tx();

function search(q) {
  const rows = db
    .prepare(
      `SELECT d.id, d.body FROM docs_fts f
       JOIN docs d ON d.id = f.rowid
       WHERE docs_fts MATCH ?
       ORDER BY rank
       LIMIT 20`
    )
    .all(toPhrase(q));
  return rows.map((r) => r.id);
}

const cases = [
  // 1字词（应命中所有含该字的文档）
  { q: '马', expectIds: [1, 9, 10], label: '1字-马' },
  { q: '项', expectIds: [1, 2], label: '1字-项' },
  // 2字词（DoD：100%）
  { q: '牛马', expectIds: [1, 10], label: '2字-牛马' },
  { q: '项目', expectIds: [1, 2], label: '2字-项目' },
  { q: '进度', expectIds: [2, 3], label: '2字-进度' },
  { q: '短语', expectIds: [12], label: '2字-短语' },
  { q: '查询', expectIds: [12], label: '2字-查询' },
  { q: '状态', expectIds: [8, 13], label: '2字-状态' },
  { q: '失败', expectIds: [11], label: '2字-失败' },
  // 3字词
  { q: '状态机', expectIds: [8], label: '3字-状态机' },
  { q: '马尔可夫', expectIds: [9], label: '4字-马尔可夫' },
  { q: '中文分词', expectIds: [4], label: '4字-中文分词' },
  // 短语（多词连续）
  { q: '无限牛马', expectIds: [1], label: '短语-无限牛马' },
  { q: '项目进度', expectIds: [2], label: '短语-项目进度' },
  { q: '进度正常', expectIds: [2], label: '短语-进度正常' },
  { q: '牛马协作', expectIds: [10], label: '短语-牛马协作' },
  // 不应命中
  { q: '进度项目', expectIds: [], label: '反序-不应命中' },
  { q: '牛项目', expectIds: [], label: '跳字-不应命中' },
  { q: '不存在的词', expectIds: [], label: '无中生有' },
  // 英文标识符 / 路径 / 错误码
  { q: 'EPIPE', expectIds: [5], label: 'ascii-EPIPE' },
  { q: 'retryOnce', expectIds: [11], label: 'ascii-retryOnce' },
  { q: 'IPC_DEAD', expectIds: [14], label: 'ascii-IPC_DEAD' },
  { q: 'better-sqlite3', expectIds: [7], label: 'ascii-hyphen-pkg' },
  { q: 'package.json', expectIds: [6], label: 'ascii-path-leaf' },
  { q: 'WArmy', expectIds: [6], label: 'ascii-path-seg' },
];

let passCount = 0;
let failCount = 0;
const failures = [];

for (const c of cases) {
  const got = search(c.q).sort((a, b) => a - b);
  const expect = [...c.expectIds].sort((a, b) => a - b);
  const ok =
    got.length === expect.length && got.every((v, i) => v === expect[i]);
  if (ok) passCount++;
  else {
    failCount++;
    failures.push({ label: c.label, q: c.q, expect, got });
  }
}

// 额外：2字词命中率统计
const twoChar = cases.filter((c) => Array.from(c.q).length === 2);
const twoPass = twoChar.filter((c) => {
  const got = search(c.q).sort((a, b) => a - b);
  const expect = [...c.expectIds].sort((a, b) => a - b);
  return got.length === expect.length && got.every((v, i) => v === expect[i]);
}).length;

const report = {
  total: cases.length,
  pass: passCount,
  fail: failCount,
  twoChar: { pass: twoPass, total: twoChar.length, rate: twoChar.length ? twoPass / twoChar.length : 1 },
  failures,
  passDoD: failCount === 0 && twoPass === twoChar.length,
};

console.log(JSON.stringify(report, null, 2));

// ── 落盘原始证据（P0 复核：判定必须有原始输出支撑）──
const evidence = {
  spike: 'spike-04-fts-cjk',
  title: 'FTS5 单字索引 + 中文短语/边界查询',
  dod: '2 字词命中率 100%',
  ranAt: new Date().toISOString(),
  command: 'node spikes/spike-04-fts-cjk/run.mjs',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  dataset: { docs: samples.length, tokenizer: 'unicode61', indexStrategy: '双侧字符间插空格 + FTS5 短语 MATCH' },
  caseResults: cases.map((c) => {
    const got = search(c.q).sort((a, b) => a - b);
    const expect = [...c.expectIds].sort((a, b) => a - b);
    return { label: c.label, q: c.q, expect, got, pass: got.length === expect.length && got.every((v, i) => v === expect[i]) };
  }),
  report,
  exitCode: report.passDoD ? 0 : 1,
};
fs.writeFileSync(path.join(import.meta.dirname, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(`原始结果已写入 ${path.join(import.meta.dirname, 'result.json')}`);

db.close();
fs.rmSync(dbPath, { force: true });
process.exit(report.passDoD ? 0 : 1);
