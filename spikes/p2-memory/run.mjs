/**
 * P2 memory-os 集成（规避中文路径 fork 编码问题：拷到 ASCII 临时目录）
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDist = path.resolve(__dirname, '../../packages/memory-os/dist');
const srcPkg = path.resolve(__dirname, '../../packages/memory-os/package.json');
const asciiRoot = path.join(os.tmpdir(), 'ccarmy-mem-pkg');
const dataDir = path.join(os.tmpdir(), `ccarmy-mem-${Date.now()}`);

fs.rmSync(asciiRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(asciiRoot, 'dist'), { recursive: true });
fs.copyFileSync(srcPkg, path.join(asciiRoot, 'package.json'));
for (const f of fs.readdirSync(srcDist)) {
  fs.copyFileSync(path.join(srcDist, f), path.join(asciiRoot, 'dist', f));
}
// 链接 better-sqlite3 解析：在 asciiRoot 写一个 loader 再 require 真实包
// 更简单：在 package.json 不改，把 node_modules 指向真实 memory-os
const realMem = path.resolve(__dirname, '../../packages/memory-os/node_modules');
if (fs.existsSync(realMem)) {
  fs.symlinkSync(realMem, path.join(asciiRoot, 'node_modules'), 'junction');
}

const ipcEntry = path.join(asciiRoot, 'dist', 'ipc.js');

function start() {
  const child = fork(ipcEntry, [], {
    execArgv: [],
    env: { ...process.env, CCA_ARMY_MEMORY_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let seq = 0;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  child.stderr?.on('data', (d) => console.error('[mem]', String(d).slice(0, 300)));
  child.on('message', (m) => {
    if (m?.type === 'ready') {
      readyResolve();
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m);
  });
  child.on('exit', (c) => readyReject?.(new Error('exit ' + c)));
  const call = (msg) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      child.send({ ...msg, id });
    });
  return { child, ready, call };
}

const fails = [];
const check = (n, c, d) => {
  if (!c) fails.push({ n, d });
  console.log(`${c ? 'OK' : 'FAIL'} ${n}`, d ?? '');
};

const a = start();
await a.ready;
check('ready', true);

await a.call({
  op: 'append',
  writer: 'duty',
  record: { id: 'r1', sessionId: 's1', kind: 'message', body: '无限牛马项目进度正常' },
});
await a.call({
  op: 'append',
  writer: 'duty',
  record: { id: 'r2', sessionId: 's1', kind: 'message', body: '值班者状态机与队列' },
});
await a.call({
  op: 'append',
  writer: 'router',
  record: { id: 'q1', sessionId: 's1', kind: 'queue', body: 'queue item' },
});

let writerErr = null;
try {
  await a.call({
    op: 'append',
    writer: 'executor',
    record: { id: 'x', sessionId: 's1', kind: 'message', body: 'nope' },
  });
} catch (e) {
  writerErr = e.message;
}
check('executor cannot write message', !!writerErr, writerErr);

const rec = await a.call({ op: 'recall', query: '牛马' });
check('recall 牛马', (rec.cards || []).length >= 1, rec.cards?.length);

const rec2 = await a.call({ op: 'recall', query: '状态机' });
check('recall 状态机', (rec2.cards || []).length >= 1, rec2.cards?.map((c) => c.snippet));

const ret = await a.call({ op: 'retrieve', anchor: { recordId: 'r1' } });
check('retrieve r1', ret.result?.raw?.includes('无限牛马'), ret.result);

const tail = await a.call({ op: 'tail', limit: 5 });
check('tail>=3', (tail.records || []).length >= 3, tail.records?.length);
check('jsonl exists', fs.existsSync(path.join(dataDir, 'fast-memory.jsonl')));

await a.call({ op: 'shutdown' });
await new Promise((r) => setTimeout(r, 150));

const b = start();
await b.ready;
const rec3 = await b.call({ op: 'recall', query: '牛马' });
check('persist after restart', (rec3.cards || []).length >= 1, rec3.cards?.length);
await b.call({ op: 'shutdown' });

fs.rmSync(dataDir, { recursive: true, force: true });

if (fails.length) {
  console.log('FAILURES', fails);
  process.exit(1);
}
console.log('MEMORY-OS PASS');
process.exit(0);
