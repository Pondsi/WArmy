/**
 * P2 记忆层实测：fts_tri（trigram）+ 向量（bge-small-zh ONNX int8 WASM）+ retrieve 三级回退
 *
 * 全部输出写进同目录 result.json（原始数据，不加工）。
 *
 * 用法：node spikes/p2-memory/run.mjs
 *   env:
 *     P2_LARGE_N=2000    大语料规模（0 = 跳过）
 *     P2_SKIP_VECTOR=1   跳过向量相关用例（无模型时）
 *     P2_KEEP=1          保留临时目录（排查用）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {CORPUS, QUERIES, EXPECTED_HITS, SEMANTIC_PAIRS, VECTOR_ONLY_QUERIES, NOISE_QUERIES} from './corpus.mjs';
import {MEM_PKG, MODEL_DIR, REPO_ROOT, P2_DIR, startChild, tmpDir, median} from './lib/service.mjs';
import {makeLegacyDb, hashFile} from './make-legacy-db.mjs';

const DIST = path.join(MEM_PKG, 'dist', 'index.js');
const LARGE_N = Number(process.env.P2_LARGE_N ?? 2000);
const SKIP_VECTOR = process.env.P2_SKIP_VECTOR === '1';
const KEEP = process.env.P2_KEEP === '1';

const result = {
  generatedAt: new Date().toISOString(),
  host: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repo: REPO_ROOT,
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
  },
  checks: [],
  sections: {},
  failures: [],
  summary: {},
};

const tmpDirs = [];
const check = (name, cond, detail) => {
  const rec = { name, ok: !!cond, detail: detail ?? null };
  result.checks.push(rec);
  if (!cond) result.failures.push({ name, detail });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail !== undefined && detail !== null ? ' :: ' + JSON.stringify(detail).slice(0, 200) : ''}`);
  return !!cond;
};
const newTmp = (tag) => {
  const d = tmpDir(tag);
  tmpDirs.push(d);
  return d;
};

const mem = await import(pathToFileURL(DIST).href);
const { MemoryService, spaceChars, toPhrase, toTriPhrase, yuXianXiangSiDu, yuXianInt8, quantizeToInt8, congInt8FanLiangHua, packInt8, unpackInt8, rrfFusionRanked, BertWordPieceFenCiQi } = mem;
console.log('memory-os exports:', Object.keys(mem).sort().join(','));

/** 子进程要显式给出模型路径（cwd 在 tmp，找不到仓库内资产） */
const MODEL_ENV = {
  CCA_ONNX_MODEL: path.join(MODEL_DIR, 'model_quantized.onnx'),
  CCA_ONNX_TOKENIZER: path.join(MODEL_DIR, 'tokenizer.json'),
};

const t0All = Date.now();

// ─────────────────────────────────────────────────────────────
// 0. 环境
// ─────────────────────────────────────────────────────────────
{
  const dataDir = newTmp('env');
  const svc = new MemoryService({ dataDir });
  const sqliteVersion = svc.rawQuery('SELECT sqlite_version() AS v')[0].v;
  const compile = svc.rawQuery('PRAGMA compile_options').map((r) => r.compile_options);
  const stats0 = svc.stats();
  result.sections.env = {
    sqliteVersion,
    fts5: compile.filter((c) => /FTS5|FTS4/.test(c)),
    schemaVersion: stats0.schemaVersion,
    ftsTriPresent: stats0.ftsTriPresent,
    tables: svc.rawQuery("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"),
    coldStart: svc.coldStart,
    vector: { ...stats0.vector, modelCandidates: stats0.vector.modelCandidates },
    modelFiles: fs.existsSync(MODEL_DIR) ? fs.readdirSync(MODEL_DIR).map((f) => ({ f, bytes: fs.statSync(path.join(MODEL_DIR, f)).size })) : null,
  };
  check('空库建立时 fts_tri 即存在', stats0.ftsTriPresent === true, stats0.ftsTriPresent);
  check('sqlite >= 3.34（trigram tokenizer 可用）', Number(sqliteVersion.split('.').slice(0, 2).join('.')) >= 3.34, sqliteVersion);
  svc.close();
}

// ─────────────────────────────────────────────────────────────
// 1. tokenizer（配套 tokenizer.json 驱动）
// ─────────────────────────────────────────────────────────────
{
  const tokPath = path.join(MODEL_DIR, 'tokenizer.json');
  const tokenizer = new BertWordPieceFenCiQi(JSON.parse(fs.readFileSync(tokPath, 'utf8')));
  const samples = [
    '无限牛马多智能体群聊桌面应用',
    'packages/memory-os/src/index.ts',
    'E_MEMORY_CORRUPT',
    'CCA_ARMY_MEMORY_DIR=/tmp/mem',
    'Hello 世界，World!',
    '记忆层采用双层设计',
  ];
  const rows = samples.map((s) => {
    const enc = tokenizer.encode(s, { maxLength: 256 });
    return {
      input: s,
      tokens: enc.tokens,
      ids: enc.ids,
      tokenCount: enc.ids.length,
      decoded: tokenizer.decode(enc.ids),
      hasUnk: enc.ids.includes(tokenizer.unkId),
    };
  });
  result.sections.tokenizer = {
    config: tokenizer.config,
    specialIds: { pad: tokenizer.padId, unk: tokenizer.unkId, cls: tokenizer.clsId, sep: tokenizer.sepId, mask: tokenizer.maskId },
    samples: rows,
    cjkIsolation: tokenizer.tokenize('无限牛马'),
    punctuationIsolation: tokenizer.tokenize('a,b. c-d'),
    vocabHasCJK: ['无', '限', '牛', '马', '群', '聊'].map((c) => ({ c, id: tokenizer.vocab.get(c) ?? null })),
    whitespaceHandling: tokenizer.tokenize('  a   b  '),
  };
  check('tokenizer 词表 21128（配套 bge-small-zh）', tokenizer.config.vocabSize === 21128, tokenizer.config.vocabSize);
  check('特殊 token id 正确', tokenizer.clsId === 101 && tokenizer.sepId === 102 && tokenizer.unkId === 100, result.sections.tokenizer.specialIds);
  check('CJK 逐字切分', tokenizer.tokenize('无限牛马').join('|') === '无|限|牛|马', tokenizer.tokenize('无限牛马'));
  check('标点独立成词', tokenizer.tokenize('a,b. c-d').join('|') === 'a|,|b|.|c|-|d', tokenizer.tokenize('a,b. c-d'));
  check('ASCII 路径整段走词表（无 UNK）', rows[1].hasUnk === false, rows[1].tokens);
  check('照实不转小写（tokenizer.json lowercase=false）', tokenizer.config.lowercasing === false, tokenizer.config.lowercasing);
}

// ─────────────────────────────────────────────────────────────
// 2. 进程内：三路召回 + 作用域预过滤 + retrieve 三级回退
// ─────────────────────────────────────────────────────────────
const dataDirMain = newTmp('main');
let seqMap = {};
{
  const svc = new MemoryService({ dataDir: dataDirMain });
  for (const r of CORPUS) svc.append({ ...r, kind: r.entityType === 'archive' ? 'board' : 'message' }, 'duty');
  for (const r of svc.tail(100)) seqMap[r.id] = r.seq;

  const stats = svc.stats();
  check('fts_tri 索引全部记录', stats.ftsTriDocs === CORPUS.length, { ftsTriDocs: stats.ftsTriDocs, records: stats.records });
  check('fts_uni 索引全部记录', stats.ftsUniDocs === CORPUS.length, { ftsUniDocs: stats.ftsUniDocs });

  let writerErr = null;
  try {
    svc.append({ id: 'x', sessionId: 's1', kind: 'message', body: 'nope' }, 'executor');
  } catch (e) {
    writerErr = e.message;
  }
  check('executor 不能写 message 记录（不变量 #6）', !!writerErr, writerErr);
  let qErr = null;
  try {
    svc.append({ id: 'q', sessionId: 's1', kind: 'queue', body: 'q' }, 'duty');
  } catch (e) {
    qErr = e.message;
  }
  check('queue 只能 router 写（不变量 #6）', !!qErr, qErr);

  // ── 2.1 逐通道原始命中集（直接 SQL，绕开融合）
  const channelProbe = [];
  for (const { q, kind, expect } of QUERIES) {
    const cp = Array.from(q).length;
    const probe = { query: q, kind, expect, len: cp };
    try {
      probe.uni = svc
        .rawQuery('SELECT r.id FROM fts_uni f JOIN records r ON r.seq=f.rowid WHERE fts_uni MATCH ? ORDER BY rank LIMIT 20', toPhrase(q))
        .map((r) => r.id);
    } catch (e) {
      probe.uni = 'ERR ' + e.message;
    }
    if (cp >= 3) {
      try {
        probe.tri = svc
          .rawQuery('SELECT r.id FROM fts_tri f JOIN records r ON r.seq=f.rowid WHERE fts_tri MATCH ? ORDER BY rank LIMIT 20', toTriPhrase(q))
          .map((r) => r.id);
      } catch (e) {
        probe.tri = 'ERR ' + e.message;
      }
    } else {
      probe.tri = null;
      probe.triSkipped = 'query<3chars (fts5 trigram 限制)';
    }
    probe.like = svc.rawQuery('SELECT id FROM records WHERE body LIKE ? ORDER BY seq DESC LIMIT 20', `%${q}%`).map((r) => r.id);
    channelProbe.push(probe);
  }
  result.sections.channels = channelProbe;

  const missing = [];
  for (const [q, ids] of Object.entries(EXPECTED_HITS)) {
    const p = channelProbe.find((x) => x.query === q);
    if (!p) {
      missing.push({ q, why: 'no-probe' });
      continue;
    }
    for (const id of ids) {
      const ok = (Array.isArray(p.uni) && p.uni.includes(id)) || (Array.isArray(p.tri) && p.tri.includes(id)) || p.like.includes(id);
      if (!ok) missing.push({ q, id });
    }
  }
  check('预期命中集全部被至少一路召回', missing.length === 0, missing);
  const neg = channelProbe.find((p) => p.query === 'zzz_not_present_zzz');
  check('不存在的串三路皆空', neg.uni.length === 0 && neg.tri.length === 0 && neg.like.length === 0, neg);
  const uniOnlyMissTriHit = channelProbe.filter((p) => Array.isArray(p.tri) && p.tri.length && Array.isArray(p.uni) && p.uni.length === 0);
  const triOnlyMissUniHit = channelProbe.filter((p) => Array.isArray(p.tri) && p.tri.length === 0 && Array.isArray(p.uni) && p.uni.length > 0);
  result.sections.channelDelta = {
    triHitsUniMisses: uniOnlyMissTriHit.map((p) => p.query),
    uniHitsTriMisses: triOnlyMissUniHit.map((p) => p.query),
    note: 'fts_uni 用"字符间插空格 + 短语"实现子串匹配，覆盖率与 trigram 高度重叠；差异在选择性/速度与 LIKE 加速（见 latency 段）',
  };

  // ── 2.2 RRF 融合（异步全通道）
  await svc.waitVectorReady();
  const vecStatus = svc.vectorStatus();
  result.sections.vectorStatus = { ...vecStatus, modelCandidates: vecStatus.modelCandidates };
  if (!SKIP_VECTOR) {
    check('向量通路就绪（WASM，无 .node）', vecStatus.ready === true, { ready: vecStatus.ready, backend: vecStatus.backend, reason: vecStatus.reason, dim: vecStatus.dim });
    check('向量维度 512', vecStatus.dim === 512, vecStatus.dim);
    check('后端为 wasm（不变量 #4：零原生模块）', String(vecStatus.backend).startsWith('wasm'), vecStatus.backend);
    check('tokenizer 与模型配套（词表 21128）', vecStatus.tokenizer?.vocabSize === 21128, vecStatus.tokenizer?.vocabSize);
  }

  const fusedRows = [];
  for (const { q, kind } of QUERIES) {
    const detail = await svc.recallDetailed({ query: q, limit: 5 });
    fusedRows.push({
      query: q,
      kind,
      cards: detail.cards.map((c) => ({
        recordId: c.recordId,
        source: c.source,
        sources: c.sources,
        ranks: c.ranks,
        cosine: c.cosine,
        rrfScore: Number(c.rrfScore.toFixed(6)),
        anchor: c.anchor,
      })),
      channels: detail.channels,
      candidates: detail.candidates,
      timings: detail.timings,
      scopeStats: detail.scopeStats,
    });
  }
  result.sections.fused = fusedRows;

  const pick = (q) => fusedRows.find((r) => r.query === q);
  const semQ = pick('值班安排');
  check(
    '语义查询「值班安排」由向量通道命中 m-010（词法候选 0）',
    !!semQ && semQ.cards.some((c) => c.recordId === 'm-010' && (c.sources || []).includes('vector')),
    { candidates: semQ?.candidates, cards: semQ?.cards.map((c) => [c.recordId, c.sources]) }
  );
  check('ASCII 路径查询命中 m-003 且 fts_tri 参与融合', !!pick('src/index.ts') && pick('src/index.ts').cards.some((c) => c.recordId === 'm-003' && (c.sources || []).includes('fts_tri')), pick('src/index.ts')?.cards.map((c) => [c.recordId, c.sources]));
  check('错误码 E_WRITER_DENIED 命中 m-007', !!pick('E_WRITER_DENIED') && pick('E_WRITER_DENIED').cards.some((c) => c.recordId === 'm-007'), pick('E_WRITER_DENIED')?.cards.map((c) => c.recordId));
  check('环境变量查询命中 m-013', !!pick('CCA_ARMY_MEMORY_DIR') && pick('CCA_ARMY_MEMORY_DIR').cards.some((c) => c.recordId === 'm-013'), pick('CCA_ARMY_MEMORY_DIR')?.cards.map((c) => c.recordId));
  check('1 字 CJK 查询可召回', pick('牛').cards.length >= 1, pick('牛').cards.map((c) => [c.recordId, c.source]));
  check('2 字 CJK 查询命中 m-001', pick('牛马').cards.some((c) => c.recordId === 'm-001'), pick('牛马').cards.map((c) => c.recordId));
  check('3 字 CJK 查询命中状态机记录', pick('状态机').cards.some((c) => ['m-001', 'm-010'].includes(c.recordId)), pick('状态机').cards.map((c) => c.recordId));
  check('长 CJK 子串查询命中 m-008/m-014', pick('智能体群聊桌面应用').cards.some((c) => ['m-008', 'm-014'].includes(c.recordId)), pick('智能体群聊桌面应用').cards.map((c) => c.recordId));
  check('完全不存在串返回空（向量通道有 minCosine 地板）', pick('zzz_not_present_zzz').cards.length === 0, { cards: pick('zzz_not_present_zzz').cards, channels: pick('zzz_not_present_zzz').channels });

  // 向量专属查询（词法 0 候选）+ 噪声查询（必须被余弦地板挡住）
  const vectorOnly = [];
  for (const { q, expect } of VECTOR_ONLY_QUERIES) {
    const d = await svc.recallDetailed({ query: q, limit: 5 });
    vectorOnly.push({
      query: q,
      expect,
      lexicalCandidates: { uni: d.candidates.uni, tri: d.candidates.tri },
      cards: d.cards.map((c) => ({ id: c.recordId, sources: c.sources, cosine: c.cosine })),
      timings: d.timings,
      channels: d.channels,
    });
  }
  result.sections.vectorOnlyQueries = vectorOnly;
  for (const v of vectorOnly) {
    check(`向量专属查询「${v.query}」命中 ${v.expect}`, v.cards.some((c) => c.id === v.expect && (c.sources || []).includes('vector')), { cards: v.cards, lexical: v.lexicalCandidates });
  }
  const noise = [];
  for (const q of NOISE_QUERIES) {
    const d = await svc.recallDetailed({ query: q, limit: 5 });
    const vc = d.channels.find((c) => c.channel === 'vector');
    noise.push({ query: q, cards: d.cards.map((c) => c.recordId), timings: d.timings, vectorChannel: vc });
  }
  result.sections.noiseQueries = noise;
  check(
    '噪声查询不返回向量噪声（minCosine 地板生效）',
    noise.every((n) => n.cards.length === 0),
    noise.map((n) => [n.query, n.cards, n.vectorChannel?.skipped])
  );

  // ── 2.3 作用域预过滤先于余弦（不变量 #9）
  const vecRowsTotal = svc.stats().vecRows;
  const scoped = await svc.recallDetailed({ query: '值班安排', limit: 5, scope: { sessionId: 's1' } });
  const scopedVec = scoped.channels.find((c) => c.channel === 'vector');
  const s1VecRows = svc.rawQuery('SELECT COUNT(*) AS n FROM vec_index v JOIN records r ON r.seq=v.seq WHERE r.session_id=?', 's1')[0].n;
  const s1 = svc.rawQuery('SELECT COUNT(*) AS n FROM records WHERE session_id=?', 's1')[0].n;
  const s2 = svc.rawQuery('SELECT COUNT(*) AS n FROM records WHERE session_id=?', 's2')[0].n;
  // 同一条语义命中（m-010 属于 s1）在 s2 作用域下必须消失
  const scopedOther = await svc.recallDetailed({ query: '值班安排', limit: 5, scope: { sessionId: 's2' } });
  // 词法上两个作用域都命中的查询（SQLite 同时出现在 m-002/s1 与 m-008/s2）
  const lexS1 = await svc.recallDetailed({ query: 'SQLite', limit: 10, scope: { sessionId: 's1' } });
  const lexB = await svc.recallDetailed({ query: 'SQLite', limit: 10, scope: { groupId: 'group-B' } });
  const lexAll = await svc.recallDetailed({ query: 'SQLite', limit: 10 });
  result.sections.scopePrefilter = {
    s1Records: s1,
    s2Records: s2,
    predicate: scoped.scopeStats.predicate,
    vecRowsTotal,
    s1VecRows,
    cosinesComputed: scoped.timings.cosines,
    s1TopCard: scoped.cards.map((c) => c.recordId),
    s2TopCard: scopedOther.cards.map((c) => c.recordId),
    lexicalNoScope: lexAll.cards.map((c) => c.recordId),
    lexicalScopeS1: lexS1.cards.map((c) => c.recordId),
    lexicalScopeGroupB: lexB.cards.map((c) => c.recordId),
  };
  check('作用域过滤：授权 s1 / 拒绝 s2', scoped.scopeStats.authorizedRecords === s1 && scoped.scopeStats.deniedRecords === s2, scoped.scopeStats);
  check('余弦只在授权集合上计算（#9）', scoped.timings.cosines === s1VecRows && scoped.timings.cosines < vecRowsTotal, { cosines: scoped.timings.cosines, s1VecRows, vecRowsTotal });
  check('s1 作用域：语义查询命中 m-010（s1 记录）', scoped.cards.some((c) => c.recordId === 'm-010'), scoped.cards.map((c) => c.recordId));
  check('s2 作用域：同一查询不再返回 m-010（预过滤挡在余弦之前）', !scopedOther.cards.some((c) => c.recordId === 'm-010') && scopedOther.timings.cosines === s2, { cards: scopedOther.cards.map((c) => c.recordId), timings: scopedOther.timings });
  check('词法查询无作用域时跨 s1/s2 命中', lexAll.cards.some((c) => ['m-002', 'm-008'].includes(c.recordId)), lexAll.cards.map((c) => c.recordId));
  check('s1 作用域下只返回 s1 记录', lexS1.cards.length > 0 && lexS1.cards.every((c) => ['m-001', 'm-002', 'm-003', 'm-004', 'm-009', 'm-010', 'm-012', 'm-014'].includes(c.recordId)), lexS1.cards.map((c) => c.recordId));
  check('group-B 作用域下只返回 group-B 记录', lexB.cards.length > 0 && lexB.cards.every((c) => ['m-005', 'm-006', 'm-007', 'm-008', 'm-011', 'm-013'].includes(c.recordId)), lexB.cards.map((c) => c.recordId));
  check('向量通道在作用域下仍有命中', !!scopedVec && scopedVec.used === true, scopedVec);
  const entityScoped = await svc.recallDetailed({ query: 'SQLite', limit: 50, scope: { entityType: 'archive' } });
  result.sections.scopePrefilter.entityScoped = { scopeStats: entityScoped.scopeStats, ids: entityScoped.cards.map((c) => c.recordId) };
  check('entityType 作用域生效', entityScoped.scopeStats.authorizedRecords === s2, entityScoped.scopeStats);

  // ── 2.3b 并发作用域（async recall 的 await 期间不能被另一个作用域覆盖）
  const concurrent = await Promise.all([
    svc.recallDetailed({ query: 'SQLite', limit: 20, scope: { sessionId: 's1' } }),
    svc.recallDetailed({ query: 'SQLite', limit: 20, scope: { groupId: 'group-B' } }),
    svc.recallDetailed({ query: 'SQLite', limit: 20, scope: { sessionId: 's2' } }),
    svc.recallDetailed({ query: '值班安排', limit: 20, scope: { sessionId: 's1' } }),
    svc.recallDetailed({ query: '值班安排', limit: 20, scope: { sessionId: 's2' } }),
    svc.recallDetailed({ query: '记忆', limit: 20 }),
  ]);
  const S1 = ['m-001', 'm-002', 'm-003', 'm-004', 'm-009', 'm-010', 'm-012', 'm-014'];
  const S2 = ['m-005', 'm-006', 'm-007', 'm-008', 'm-011', 'm-013'];
  const concurrentRows = concurrent.map((d) => ({ scope: d.scopeStats.predicate, table: d.scopeStats.table, ids: d.cards.map((c) => c.recordId), cosines: d.timings.cosines }));
  result.sections.scopeConcurrent = concurrentRows;
  check(
    '并发 recall：各作用域互不串味（临时表按谓词取键）',
    concurrentRows[0].ids.every((id) => S1.includes(id)) &&
      concurrentRows[0].ids.includes('m-002') &&
      concurrentRows[1].ids.length > 0 &&
      concurrentRows[1].ids.every((id) => S2.includes(id)) &&
      concurrentRows[2].ids.every((id) => S2.includes(id)) &&
      concurrentRows[2].ids.includes('m-008') &&
      concurrentRows[3].ids.every((id) => S1.includes(id)) &&
      concurrentRows[3].ids.includes('m-010') &&
      concurrentRows[4].ids.every((id) => S2.includes(id)) &&
      !concurrentRows[4].ids.includes('m-010'),
    concurrentRows
  );
  check('并发 recall：临时表名随作用域不同而不同', new Set(concurrentRows.slice(0, 3).map((r) => r.table)).size === 3, concurrentRows.slice(0, 3).map((r) => r.table));

  // ── 2.4 retrieve 三级回退
  const jsonlPath = path.join(dataDirMain, 'fast-memory.jsonl');
  const lineStarts = [0];
  {
    const buf = fs.readFileSync(jsonlPath);
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a && i + 1 < buf.length) lineStarts.push(i + 1);
  }
  const retrieveCases = [
    ['exact:sqlite:id', { recordId: 'm-003' }, {}],
    ['exact:sqlite:seq', { seq: seqMap['m-005'] }, {}],
    ['exact:jsonl:offset', { file: 'fast-memory.jsonl', byteOffset: lineStarts[seqMap['m-006'] - 1] + 3 }, {}],
    ['nearby:seq±5', { seq: 15 }, {}],
    ['nearby:seq-out-of-window', { seq: 999, recordId: 'zzz-absent' }, {}],
    ['nearby:id-trim-#', { recordId: 'm-003#7' }, {}],
    ['nearby:id-trim--v2', { recordId: 'm-012-v2' }, {}],
    ['nearby:offset-nearest', { file: 'fast-memory.jsonl', byteOffset: lineStarts[1] - 1 }, {}],
    ['fuzzy:fts', { recordId: '牛马' }, { fallback: 'fuzzy' }],
    ['fuzzy:newest', { recordId: 'zzz-unknown' }, { fallback: 'fuzzy' }],
    ['exact-only:miss', { seq: 999 }, { fallback: 'exact' }],
    ['nearby-only:miss', { seq: 999 }, { fallback: 'nearby' }],
    ['nearby-only:seq', { seq: 15 }, { fallback: 'nearby' }],
    ['nearby-only:id', { seq: 999, recordId: 'm-003' }, { fallback: 'nearby' }],
    ['empty-anchor', {}, {}],
  ];
  const retrieveRows = [];
  for (const [name, anchor, opts] of retrieveCases) {
    const out = svc.retrieve(anchor, opts);
    retrieveRows.push({
      name,
      input: anchor,
      opts,
      hitLevel: out?.hitLevel ?? null,
      via: out?.via ?? null,
      seq: out?.seq ?? null,
      recordId: out?.recordId ?? null,
      rawHead: out ? String(out.raw).slice(0, 60) : null,
      note: out?.note ?? null,
    });
  }
  result.sections.retrieve = retrieveRows;
  const byName = Object.fromEntries(retrieveRows.map((r) => [r.name, r]));
  check('retrieve exact sqlite:id', byName['exact:sqlite:id'].hitLevel === 'exact' && byName['exact:sqlite:id'].via === 'sqlite:id', byName['exact:sqlite:id']);
  check('retrieve exact sqlite:seq', byName['exact:sqlite:seq'].hitLevel === 'exact' && byName['exact:sqlite:seq'].via === 'sqlite:seq', byName['exact:sqlite:seq']);
  check('retrieve exact jsonl:offset（证据锚点 byteOffset）', byName['exact:jsonl:offset'].hitLevel === 'exact' && byName['exact:jsonl:offset'].via === 'jsonl:offset', byName['exact:jsonl:offset']);
  check('retrieve nearby seq±5（seq=15 → 14）', byName['nearby:seq±5'].hitLevel === 'nearby' && byName['nearby:seq±5'].via === 'sqlite:seq±5', byName['nearby:seq±5']);
  check('retrieve nearby seq 超出窗口即降级', byName['nearby:seq-out-of-window'].hitLevel === 'fuzzy', byName['nearby:seq-out-of-window']);
  check('retrieve nearby id-trim (#7)', byName['nearby:id-trim-#'].hitLevel === 'nearby', byName['nearby:id-trim-#']);
  check('retrieve nearby id-trim (-v2)', byName['nearby:id-trim--v2'].hitLevel === 'nearby', byName['nearby:id-trim--v2']);
  check('retrieve nearby offset-nearest', byName['nearby:offset-nearest'].hitLevel === 'nearby', byName['nearby:offset-nearest']);
  check('retrieve fuzzy 经 FTS', byName['fuzzy:fts'].hitLevel === 'fuzzy' && String(byName['fuzzy:fts'].via).startsWith('fts:'), byName['fuzzy:fts']);
  check('retrieve fuzzy 兜底最新一条', byName['fuzzy:newest'].hitLevel === 'fuzzy' && byName['fuzzy:newest'].via === 'sqlite:newest', byName['fuzzy:newest']);
  check('fallback=exact 不降级', byName['exact-only:miss'].hitLevel === null, byName['exact-only:miss']);
  check('fallback=nearby 且超窗 → 不降级', byName['nearby-only:miss'].hitLevel === null, byName['nearby-only:miss']);
  check('fallback=nearby 命中 nearby（seq）', byName['nearby-only:seq'].hitLevel === 'nearby', byName['nearby-only:seq']);
  check('recordId 存在时 exact 优先于 seq（id 优先）', byName['nearby-only:id'].hitLevel === 'exact' && byName['nearby-only:id'].via === 'sqlite:id', byName['nearby-only:id']);

  // ── 2.5 JSONL 是唯一事实来源
  svc.rawExec("DELETE FROM records WHERE id='m-003'");
  const beforeRebuild = svc.retrieve({ recordId: 'm-003' });
  const recallAfterDelete = svc.recall('src/index.ts', 5).map((c) => c.recordId);
  const rebuilt = svc.rebuildProjection();
  const afterRebuild = svc.retrieve({ recordId: 'm-003' });
  const recallAfterRebuild = svc.recall('src/index.ts', 5).map((c) => c.recordId);
  const statsAfter = svc.stats();
  result.sections.sourceOfTruth = {
    deletedFromProjection_retrieve: { hitLevel: beforeRebuild?.hitLevel, via: beforeRebuild?.via },
    deletedFromProjection_recall: recallAfterDelete,
    rebuildCount: rebuilt,
    afterRebuild_retrieve: { hitLevel: afterRebuild?.hitLevel, via: afterRebuild?.via },
    afterRebuild_recall: recallAfterRebuild,
    statsAfter: { records: statsAfter.records, ftsUniDocs: statsAfter.ftsUniDocs, ftsTriDocs: statsAfter.ftsTriDocs, vecRows: statsAfter.vecRows },
  };
  check('投影删行后 retrieve 回 JSONL（exact/jsonl:id）', beforeRebuild?.hitLevel === 'exact' && beforeRebuild?.via === 'jsonl:id', beforeRebuild);
  check('投影删行后 recall 不再返回该行', !recallAfterDelete.includes('m-003'), recallAfterDelete);
  check('rebuildProjection 从 JSONL 全量重建', rebuilt === CORPUS.length && statsAfter.ftsTriDocs === CORPUS.length, { rebuilt, ...result.sections.sourceOfTruth.statsAfter });
  check('重建后 recall 恢复', recallAfterRebuild.includes('m-003'), recallAfterRebuild);
  check('重建后向量行清空（待被动水合）', statsAfter.vecRows === 0, statsAfter.vecRows);
  const rehydrate = await svc.hydrateVectors(64);
  check('被动水合重建向量', rehydrate.embedded > 0 && svc.stats().vecRows > 0, rehydrate);

  // ── 2.6 向量语义能力 + int8 数学
  const vecOnly = await svc.recallDetailed({ query: '子进程之间怎么通信', limit: 5 });
  result.sections.vectorOnly = {
    query: '子进程之间怎么通信',
    lexical: { uni: vecOnly.candidates.uni, tri: vecOnly.candidates.tri },
    cards: vecOnly.cards.map((c) => ({ id: c.recordId, sources: c.sources, cosine: c.cosine })),
  };
  check('纯语义查询（词法 0 命中）经向量召回 m-011', vecOnly.cards.some((c) => c.recordId === 'm-011'), vecOnly.cards.map((c) => [c.recordId, c.sources]));

  const a = await svc.embedText('无限牛马多智能体群聊桌面应用');
  const b = await svc.embedText('无限牛马多智能体群聊桌面应用');
  const c = await svc.embedText('今年冬天第一场雪下的很大');
  if (a && b && c) {
    const qa = quantizeToInt8(a);
    const qb = quantizeToInt8(b);
    const qc = quantizeToInt8(c);
    const blob = packInt8(qa.data);
    const back = unpackInt8(blob);
    const f32same = yuXianXiangSiDu(congInt8FanLiangHua(qa.data, qa.scale), congInt8FanLiangHua(qb.data, qb.scale));
    const i8same = yuXianInt8(back, qa.scale, qb.data, qb.scale);
    const f32diff = yuXianXiangSiDu(a, c);
    const i8diff = yuXianInt8(qa.data, qa.scale, qc.data, qc.scale);
    result.sections.vectorMath = {
      dim: a.length,
      normOfEmbedding: Number(Math.hypot(...a).toFixed(6)),
      sameTextFloatCos: Number(f32same.toFixed(6)),
      sameTextInt8Cos: Number(i8same.toFixed(6)),
      int8vsFloat32MaxAbsDiff: Number(Math.max(Math.abs(f32same - i8same), Math.abs(f32diff - i8diff)).toExponential(3)),
      unrelatedFloatCos: Number(f32diff.toFixed(6)),
      unrelatedInt8Cos: Number(i8diff.toFixed(6)),
      blobBytes: blob.length,
      float32Bytes: a.length * 4,
      embedMsLast: svc.vectorStatus().lastEmbedMs,
      embedMsAvg: svc.vectorStatus().embeds ? Number((svc.vectorStatus().embedTotalMs / svc.vectorStatus().embeds).toFixed(3)) : null,
      embeds: svc.vectorStatus().embeds,
    };
    check('同一文本嵌入一致（cos≈1）', Math.abs(f32same - 1) < 1e-3, f32same);
    check('int8 与 float32 余弦误差 < 1e-2', Math.abs(f32same - i8same) < 1e-2, Math.abs(f32same - i8same));
    check('BLOB = 512 字节（int8，float32 要 2048）', blob.length === 512, blob.length);
    check('无关文本余弦明显更低', f32same - f32diff > 0.1, { same: f32same, unrelated: f32diff });
  }

  const pairs = [];
  for (const p of SEMANTIC_PAIRS) {
    const va = await svc.embedText(p.a);
    const vb = await svc.embedText(p.b);
    if (!va || !vb) break;
    pairs.push({ ...p, cosine: Number(yuXianXiangSiDu(va, vb).toFixed(4)) });
  }
  result.sections.semanticPairs = pairs;
  const para = pairs.filter((p) => p.label.startsWith('paraphrase'));
  const unrel = pairs.filter((p) => p.label === 'unrelated');
  if (para.length && unrel.length) {
    check(
      '改写对余弦 > 无关对余弦（嵌入语义有效）',
      Math.min(...para.map((p) => p.cosine)) > Math.max(...unrel.map((p) => p.cosine)),
      { minParaphrase: Math.min(...para.map((p) => p.cosine)), maxUnrelated: Math.max(...unrel.map((p) => p.cosine)) }
    );
  }

  // ── 2.7 向后兼容 / 契约形状（verify-all 的 `memory fts recall` 走的就是旧签名）
  const oldSig = svc.recall('牛马');
  const oldSigLimit = svc.recall('牛马', 3);
  const oldSigShape = oldSig.map((c) => ({ seq: c.seq, recordId: c.recordId, snippet: c.snippet, score: c.score, source: c.source }));
  const contractCardFields = ['anchor', 'snippet', 'score', 'source'];
  const contractAnchorFields = ['file', 'seq', 'recordId'];
  const contractOk = oldSig.every(
    (c) =>
      contractCardFields.every((f) => c[f] !== undefined) &&
      contractAnchorFields.every((f) => c.anchor[f] !== undefined) &&
      ['fts_uni', 'fts_tri', 'vector', 'fused'].includes(c.source)
  );
  const retOut = svc.retrieve({ recordId: 'm-001' });
  const retContractOk = ['raw', 'hitLevel', 'anchor'].every((f) => retOut[f] !== undefined) && contractAnchorFields.every((f) => retOut.anchor[f] !== undefined);
  result.sections.backCompat = {
    oldSignature: { call: "recall('牛马')", cards: oldSigShape.length, shape: oldSigShape[0] ?? null },
    oldSignatureWithLimit: { call: "recall('牛马', 3)", cards: oldSigLimit.length },
    contractRecallCard: { required: contractCardFields, anchor: contractAnchorFields, conforms: contractOk },
    contractRetrieveResult: { required: ['raw', 'hitLevel', 'anchor'], conforms: retContractOk, sample: retOut && { hitLevel: retOut.hitLevel, via: retOut.via, anchor: retOut.anchor } },
  };
  check('recall(query, limit) 旧签名仍可用且字段不变', oldSig.length >= 1 && oldSigShape[0].seq > 0 && oldSigShape[0].recordId === 'm-001' && oldSigShape[0].source !== undefined, oldSigShape[0]);
  check('recall 卡片满足 contracts.RecallCard 形状', contractOk, result.sections.backCompat.contractRecallCard);
  check('retrieve 结果满足 contracts.RetrieveResult 形状', retContractOk, result.sections.backCompat.contractRetrieveResult);

  // ── 2.8 RRF 融合本身（纯函数，独立验证）
  {
    const a = { source: 'fts_uni', ids: ['1', '2', '3'] };
    const b = { source: 'fts_tri', ids: ['2', '1', '9'] };
    const c = { source: 'vector', ids: ['3', '2', '8'] };
    const fused = rrfFusionRanked([a, b, c], 60);
    result.sections.rrf = { input: { fts_uni: a.ids, fts_tri: b.ids, vector: c.ids }, fused: fused.map((f) => ({ id: f.id, rrfScore: Number(f.rrfScore.toFixed(5)), sources: f.sources, ranks: f.ranks })) };
    check('RRF：多通道共现的 id 排在最前', fused[0].id === '2' && fused[0].sources.length === 3, fused[0]);
    check('RRF：单通道 id 得分低于多通道', fused.find((f) => f.id === '9').rrfScore < fused[0].rrfScore, { nine: fused.find((f) => f.id === '9').rrfScore, top: fused[0].rrfScore });
  }

  svc.close();
}

// ─────────────────────────────────────────────────────────────
// 3. 选择性 / 延迟：fts_uni vs fts_tri（大语料）
// ─────────────────────────────────────────────────────────────
if (LARGE_N > 0) {
  const dataDir = newTmp('large');
  const svc = new MemoryService({ dataDir, vector: { enabled: false } });
  const ZH = ['无限牛马', '值班者状态机', '记忆服务', '群聊桌面应用', '投影重建', '三元索引', '权限过滤', '证据锚点', '压缩网关', '检查点回退'];
  const ASCII_TOKEN = ['packages/memory-os/src/index.ts', 'E_MEMORY_CORRUPT', 'E_WRITER_DENIED', 'CCA_ARMY_MEMORY_DIR', 'spikes/p2-memory/run.mjs', 'better-sqlite3', 'fts5vocab', 'struct.pack', 'GroupChatRouter', 'KnowledgeArchiver'];
  const NOISE = ['the quick brown fox', 'lorem ipsum dolor sit amet', '无关的长文本填充内容用于稀释索引', 'bash: command not found', 'error TS2304: Cannot find name', 'WAL checkpoint complete'];
  let seed = 20260917;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tBuild0 = Date.now();
  for (let i = 0; i < LARGE_N; i++) {
    const body = `${i}. ${pick(ZH)} ${pick(NOISE)} ${pick(ASCII_TOKEN)} ${pick(ZH)} ${pick(NOISE)}`;
    svc.append({ id: `L${i}`, sessionId: `s${i % 7}`, kind: 'message', body }, 'duty');
  }
  const buildMs = Date.now() - tBuild0;
  const st = svc.stats();

  const vocabStats = {};
  for (const fts of ['fts_uni', 'fts_tri']) {
    svc.rawExec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${fts}_v USING fts5vocab(${fts}, 'row')`);
    const distinct = svc.rawQuery(`SELECT COUNT(*) AS n FROM ${fts}_v`)[0].n;
    const postings = svc.rawQuery(`SELECT SUM(cnt) AS n FROM ${fts}_v`)[0].n;
    const avgDocLen = svc.rawQuery(`SELECT AVG(cnt) AS n FROM (SELECT doc, SUM(cnt) AS cnt FROM ${fts}_v GROUP BY doc)`)[0].n;
    vocabStats[fts] = { distinctTerms: distinct, totalPostings: postings, avgOccurrencesPerDoc: Number(avgDocLen.toFixed(1)), docsIndexed: st[fts === 'fts_uni' ? 'ftsUniDocs' : 'ftsTriDocs'] };
    svc.rawExec(`DROP TABLE ${fts}_v`);
  }

  const bench = (fn, reps = 7) => {
    fn();
    const samples = [];
    for (let i = 0; i < reps; i++) {
      const t = process.hrtime.bigint();
      fn();
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    samples.sort((x, y) => x - y);
    return { medianMs: Number(median(samples).toFixed(3)), minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples[samples.length - 1].toFixed(3)), reps };
  };

  const benchQueries = ['packages/memory-os/src/index.ts', 'E_MEMORY_CORRUPT', 'CCA_ARMY_MEMORY_DIR', '多智能体群聊桌面应用', '值班者状态机在指定成员忙碌时', '记忆服务作为长驻子进程'];
  const latency = [];
  for (const q of benchQueries) {
    const uni = bench(() => svc.rawQuery('SELECT r.id FROM fts_uni f JOIN records r ON r.seq=f.rowid WHERE fts_uni MATCH ? ORDER BY rank LIMIT 20', toPhrase(q)));
    const tri = q.length >= 3 ? bench(() => svc.rawQuery('SELECT r.id FROM fts_tri f JOIN records r ON r.seq=f.rowid WHERE fts_tri MATCH ? ORDER BY rank LIMIT 20', toTriPhrase(q))) : null;
    const hits = svc.rawQuery('SELECT r.id FROM fts_uni f JOIN records r ON r.seq=f.rowid WHERE fts_uni MATCH ?', toPhrase(q)).length;
    latency.push({ query: q, len: Array.from(q).length, hits, uni, tri, speedupTriVsUni: tri ? Number((uni.medianMs / (tri.medianMs || 1e-6)).toFixed(2)) : null });
  }

  const likePlan = {
    fts_tri: svc.rawQuery("EXPLAIN QUERY PLAN SELECT rowid FROM fts_tri WHERE body LIKE '%memory-os%'"),
    fts_uni: svc.rawQuery("EXPLAIN QUERY PLAN SELECT rowid FROM fts_uni WHERE body LIKE '%memory-os%'"),
    records_fullscan: svc.rawQuery("EXPLAIN QUERY PLAN SELECT rowid FROM records WHERE body LIKE '%memory-os%'"),
  };
  const likeBench = {
    triIndexed: bench(() => svc.rawQuery("SELECT rowid FROM fts_tri WHERE body LIKE '%memory-os%'", []).length),
    recordsFullScan: bench(() => svc.rawQuery("SELECT rowid FROM records WHERE body LIKE '%memory-os%'", []).length),
  };

  result.sections.latency = {
    corpusRecords: LARGE_N,
    buildMs,
    jsonlBytes: st.jsonlBytes,
    indexed: { ftsUniDocs: st.ftsUniDocs, ftsTriDocs: st.ftsTriDocs },
    vocabStats,
    queryLatency: latency,
    likePlan: Object.fromEntries(Object.entries(likePlan).map(([k, v]) => [k, v.map((r) => r.detail)])),
    likeBench,
    likeSpeedup: Number((likeBench.recordsFullScan.medianMs / (likeBench.triIndexed.medianMs || 1e-6)).toFixed(2)),
  };
  check(`${LARGE_N} 条语料下 fts_tri 索引齐全`, st.ftsTriDocs === LARGE_N, { ftsTriDocs: st.ftsTriDocs, records: st.records });
  check('fts_tri 的 distinct term 数远多于 fts_uni（选择性更高）', vocabStats.fts_tri.distinctTerms > vocabStats.fts_uni.distinctTerms, vocabStats);
  const faster = latency.filter((l) => l.tri && l.tri.medianMs < l.uni.medianMs).length;
  result.sections.latency.triFasterCount = `${faster}/${latency.length}`;
  check('LIKE 走 trigram 索引（EXPLAIN 显示 INDEX 0:L0）', String(likePlan.fts_tri[0].detail).includes('L0'), likePlan.fts_tri[0].detail);
  check('LIKE 在 fts_uni 上退化为全扫（无索引）', !String(likePlan.fts_uni[0].detail).includes('L0'), likePlan.fts_uni[0].detail);
  // 用 min-of-N 而不是中位数比较：这两组真实值只差约 20%（~0.23ms vs ~0.29ms），
  // 7 次取样取中位数在机器有负载时会反转 —— 实测 7 轮全量验证里有 3 轮首发失败（43%），
  // 是这套门禁自身的偶发，不是被测对象的问题。
  // 「LIKE 是否真的走 trigram 索引」的确定性证据在上一行的 EXPLAIN 断言（INDEX 0:L0），
  // 这里只验证速度不劣化，故给 5% 噪声容差。
  const likeNotSlower = likeBench.triIndexed.minMs <= likeBench.recordsFullScan.minMs * 1.05;
  check('fts_tri 的 LIKE 不慢于 records 全表扫（min-of-N，容 5% 噪声）', likeNotSlower, likeBench);

  // 向量扫描吞吐（授权集合内）
  if (!SKIP_VECTOR) {
    const svc2 = new MemoryService({ dataDir, vector: { enabled: true } });
    await svc2.waitVectorReady();
    const h = await svc2.hydrateVectors(256);
    const d = await svc2.recallDetailed({ query: '记忆服务与投影重建', limit: 5, hydrate: false });
    result.sections.vectorScanLarge = {
      hydrated: h,
      vecRows: svc2.stats().vecRows,
      timings: d.timings,
      msPerCosine: d.timings.cosines ? Number((d.timings.vecMs / d.timings.cosines).toFixed(4)) : null,
      cards: d.cards.map((c) => ({ id: c.recordId, sources: c.sources, cosine: c.cosine })),
    };
    check('大语料上向量扫描可测（cosines>0）', d.timings.cosines > 0, d.timings);
    svc2.close();
  }
  svc.close();
}

// ─────────────────────────────────────────────────────────────
// 4. 跨进程持久化（真落盘，不是内存）
// ─────────────────────────────────────────────────────────────
{
  const dataDir = newTmp('persist');
  const PERSIST_CORPUS = CORPUS.slice(0, 14);
  const section = { dataDir, dir: 'tmp', phases: {} };

  const A = startChild(dataDir, { env: MODEL_ENV });
  const readyMsg = await A.ready;
  section.readyA = readyMsg;
  for (const r of PERSIST_CORPUS) await A.call({ op: 'append', writer: 'duty', record: { ...r, kind: 'message' } });
  const tailA = await A.call({ op: 'tail', limit: 100 });
  section.phases.A_tail = tailA.records.length;
  const statsA = (await A.call({ op: 'stats' })).stats;
  section.phases.A_stats = { records: statsA.records, ftsUniDocs: statsA.ftsUniDocs, ftsTriDocs: statsA.ftsTriDocs, vecRows: statsA.vecRows, schemaVersion: statsA.schemaVersion, coldStart: statsA.coldStart };

  const recallCow = await A.call({ op: 'recall', query: '牛马' });
  section.phases.A_recall_牛马 = { cards: recallCow.cards.length, sources: recallCow.cards.map((c) => [c.recordId, c.sources]) };
  check('子进程 A：2 字 CJK 可召回', recallCow.cards.some((c) => c.recordId === 'm-001'), recallCow.cards.map((c) => c.recordId));

  const recallPath = await A.call({ op: 'recall', query: 'src/index.ts' });
  section.phases.A_recall_path = { cards: recallPath.cards.map((c) => [c.recordId, c.sources]), timings: recallPath.timings, candidates: recallPath.candidates };
  check('子进程 A：fts_tri 参与路径查询', recallPath.cards.some((c) => c.recordId === 'm-003' && (c.sources || []).includes('fts_tri')), recallPath.cards.map((c) => [c.recordId, c.sources]));

  const recallSem = await A.call({ op: 'recall', query: '值班安排' });
  const statsA2 = (await A.call({ op: 'stats' })).stats;
  section.phases.A_recall_semantic = { cards: recallSem.cards.map((c) => [c.recordId, c.sources, c.cosine]), timings: recallSem.timings };
  section.phases.A_stats2 = { vecRows: statsA2.vecRows, vector: { ready: statsA2.vector.ready, embeds: statsA2.vector.embeds, backend: statsA2.vector.backend } };
  check('子进程 A：语义查询经向量命中 m-010', recallSem.cards.some((c) => c.recordId === 'm-010'), recallSem.cards.map((c) => c.recordId));
  check('子进程 A：向量已写入 SQLite BLOB', statsA2.vecRows === PERSIST_CORPUS.length, statsA2.vecRows);
  const embedsA = statsA2.vector.embeds;
  await A.stop();

  // 重启：投影 + 向量应在磁盘上
  const B = startChild(dataDir, { env: MODEL_ENV });
  await B.ready;
  const statusB = (await B.call({ op: 'vector_status' })).vector;
  const statsB = (await B.call({ op: 'stats' })).stats;
  section.phases.B_before_query = { embeds: statusB.embeds, vecRows: statsB.vecRows, ftsTriDocs: statsB.ftsTriDocs, coldStart: statsB.coldStart };
  check('重启后向量 BLOB 仍在（未重新嵌入）', statusB.embeds === 0 && statsB.vecRows === PERSIST_CORPUS.length, { embeds: statusB.embeds, vecRows: statsB.vecRows });
  const recallB1 = await B.call({ op: 'recall', query: '牛马' });
  const recallB2 = await B.call({ op: 'recall', query: 'E_WRITER_DENIED' });
  const statsB2 = (await B.call({ op: 'stats' })).stats;
  section.phases.B_after_query = { embeds: statsB2.vector.embeds, vecRows: statsB2.vecRows, recall牛马: recallB1.cards.map((c) => [c.recordId, c.sources]), recall错误码: recallB2.cards.map((c) => [c.recordId, c.sources]) };
  check('重启后 fts_uni/fts_tri 可检索（真持久化）', recallB1.cards.some((c) => c.recordId === 'm-001') && recallB2.cards.some((c) => c.recordId === 'm-007'), section.phases.B_after_query);
  check('重启后 fts_tri 仍参与融合', recallB2.cards.some((c) => (c.sources || []).includes('fts_tri')), recallB2.cards.map((c) => c.sources));
  const recallB3 = await B.call({ op: 'recall', query: '值班安排' });
  section.phases.B_recall_semantic = { cards: recallB3.cards.map((c) => [c.recordId, c.sources, c.cosine]) };
  check('重启后向量通道可检索（未重新嵌入历史向量）', recallB3.cards.some((c) => c.recordId === 'm-010' && (c.sources || []).includes('vector')), recallB3.cards.map((c) => [c.recordId, c.sources]));
  await B.stop();

  // 删掉 DB：投影可丢弃，从 JSONL 重建（不变量 #5）
  const dbFiles = ['memory.db', 'memory.db-wal', 'memory.db-shm'];
  const before = dbFiles.map((f) => ({ f, exists: fs.existsSync(path.join(dataDir, f)) }));
  for (const f of dbFiles) fs.rmSync(path.join(dataDir, f), { force: true });
  section.deletedDbFiles = before;
  const C = startChild(dataDir, { env: MODEL_ENV });
  await C.ready;
  const statsC = (await C.call({ op: 'stats' })).stats;
  const recallC = await C.call({ op: 'recall', query: 'packages/memory-os/src/index.ts' });
  section.phases.C_after_dbdelete = { stats: { records: statsC.records, ftsUniDocs: statsC.ftsUniDocs, ftsTriDocs: statsC.ftsTriDocs, coldStart: statsC.coldStart }, cards: recallC.cards.map((c) => [c.recordId, c.sources]) };
  check('删掉 memory.db 后重启：投影从 JSONL 全量重建', statsC.coldStart?.rebuilt === true && statsC.records === PERSIST_CORPUS.length, statsC.coldStart);
  check('重建后 fts_tri 立即可用', statsC.ftsTriDocs === PERSIST_CORPUS.length && recallC.cards.some((c) => c.recordId === 'm-003'), { ftsTriDocs: statsC.ftsTriDocs, cards: recallC.cards.map((c) => c.recordId) });
  const retC = await C.call({ op: 'retrieve', anchor: { recordId: 'm-005' } });
  check('重建后 retrieve 可用', retC.result?.hitLevel === 'exact', retC.result && { hitLevel: retC.result.hitLevel, via: retC.result.via });
  await C.stop();
  section.embedsA = embedsA;
  result.sections.persistence = section;
}

// ─────────────────────────────────────────────────────────────
// 5. 旧库升级（只有 fts_uni 的库 → 加上 fts_tri / vec_index / 作用域列）
// ─────────────────────────────────────────────────────────────
{
  const dataDir = newTmp('legacy');
  const legacy = makeLegacyDb(dataDir);
  const before = { ...legacy, jsonlSha: hashFile(legacy.jsonlPath) };
  const svc = new MemoryService({ dataDir });
  const st = svc.stats();
  const after = { jsonlSha: hashFile(legacy.jsonlPath), tables: svc.rawQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name), columns: svc.rawQuery('PRAGMA table_info(records)').map((r) => r.name), metaKeys: svc.rawQuery('SELECT k FROM meta').map((r) => r.k) };
  const triHit = svc.rawQuery('SELECT r.id FROM fts_tri f JOIN records r ON r.seq=f.rowid WHERE fts_tri MATCH ?', toTriPhrase('E_MEMORY_CORRUPT')).map((r) => r.id);
  const triHitCjk = svc.rawQuery('SELECT r.id FROM fts_tri f JOIN records r ON r.seq=f.rowid WHERE fts_tri MATCH ?', toTriPhrase('多智能体群聊')).map((r) => r.id);
  const recallAfter = await svc.recallDetailed('memory-os', 5);
  result.sections.legacyUpgrade = {
    before: { tables: before.tables, hasFtsTri: before.hasFtsTri, hasVecIndex: before.hasVecIndex, recordsColumns: before.recordsColumns, metaKeys: before.metaKeys, jsonl: before.jsonlSha, recordCount: before.recordCount },
    after: { tables: after.tables, recordsColumns: after.columns, metaKeys: after.metaKeys, schemaVersion: st.schemaVersion, upgrade: st.upgrade, ftsTriDocs: st.ftsTriDocs, ftsUniDocs: st.ftsUniDocs, coldStart: svc.coldStart },
    jsonlUnchanged: JSON.stringify(before.jsonlSha) === JSON.stringify(after.jsonlSha),
    triQueryHits: { E_MEMORY_CORRUPT: triHit, 多智能体群聊: triHitCjk },
    recallHit: recallAfter.cards.map((c) => [c.recordId, c.sources]),
  };
  const L = result.sections.legacyUpgrade;
  check('升级前：无 fts_tri / 无 vec_index / 无 schema_version', L.before.hasFtsTri === false && L.before.hasVecIndex === false && !L.before.metaKeys.includes('schema_version'), L.before);
  check('升级后：fts_tri 建表并回填', L.after.ftsTriDocs === L.before.recordCount && L.after.upgrade.createdFtsTri === true, { ftsTriDocs: L.after.ftsTriDocs, upgrade: L.after.upgrade });
  check('升级后：schema_version 0/未设置 → 2', L.after.schemaVersion === 2 && (L.after.upgrade.schemaVersionBefore === 0 || L.after.upgrade.schemaVersionBefore === 1), L.after.upgrade);
  check('升级后：补齐作用域列 group_id/entity_type', L.after.upgrade.addedColumns.includes('records.group_id') && L.after.upgrade.addedColumns.includes('records.entity_type'), L.after.upgrade.addedColumns);
  check('升级后：fts_tri 查询命中（错误码 / 长 CJK 子串）', triHit.includes('legacy-2') && triHitCjk.includes('legacy-4'), L.triQueryHits);
  check('升级不改 JSONL（事实源只追加）', L.jsonlUnchanged, { before: L.before.jsonl, after: L.after });
  svc.close();

  // 升级后的库由子进程打开也能用（真升级路径，不是同进程幻觉）
  const child = startChild(dataDir, { env: MODEL_ENV });
  await child.ready;
  const cr = await child.call({ op: 'recall', query: 'packages/memory-os/src/index.ts' });
  const cs = (await child.call({ op: 'stats' })).stats;
  result.sections.legacyUpgrade.childAfterUpgrade = { cards: cr.cards.map((c) => [c.recordId, c.sources]), ftsTriDocs: cs.ftsTriDocs, schemaVersion: cs.schemaVersion, coldStart: cs.coldStart };
  check('子进程重新打开升级后的库：fts_tri 可用且不重复回填', cr.cards.some((c) => c.recordId === 'legacy-3') && cs.ftsTriDocs === 4, result.sections.legacyUpgrade.childAfterUpgrade);
  await child.stop();
}

// ─────────────────────────────────────────────────────────────
// 6. 收尾
// ─────────────────────────────────────────────────────────────
if (!KEEP) for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
result.summary = {
  totalMs: Date.now() - t0All,
  checks: result.checks.length,
  passed: result.checks.length - result.failures.length,
  failed: result.failures.length,
  largeCorpus: LARGE_N,
  qValueSkippedVector: SKIP_VECTOR,
  ftsTri: 'FTS5 native trigram tokenizer, 与 fts_uni 并存，三路 RRF 融合',
  vector: result.sections.vectorStatus?.ready ? `ready backend=${result.sections.vectorStatus.backend} dim=${result.sections.vectorStatus.dim}` : `unavailable: ${result.sections.vectorStatus?.reason}`,
  retrieve: 'exact → nearby → fuzzy，返回 hitLevel/via',
};
fs.writeFileSync(path.join(P2_DIR, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(result.summary, null, 2));
if (result.failures.length) {
  console.log('FAILURES:');
  for (const f of result.failures) console.log(' -', f.name, JSON.stringify(f.detail).slice(0, 300));
}
console.log(`\nresult.json -> ${path.join(P2_DIR, 'result.json')}`);
process.exit(result.failures.length ? 1 : 0);
