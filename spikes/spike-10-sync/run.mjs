/**
 * Spike 10: 跨设备同步 — 本机双节点
 * DoD：消息互通；远程 incognito 零痕迹；值班权仅创建者节点
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(os.tmpdir(), `ccarmy-spike10-${Date.now()}`);
const dirA = path.join(root, 'nodeA');
const dirB = path.join(root, 'nodeB');
const bus = path.join(root, 'bus');
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });
fs.mkdirSync(bus, { recursive: true });

function startNode(name, dataDir, eligibleDuty) {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'node.mjs'), '--name', name, '--data', dataDir, '--bus', bus, '--duty', String(eligibleDuty)],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  );
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  const pending = new Map();
  let seq = 0;
  child.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m);
  });
  return {
    name,
    child,
    call(msg, timeoutMs = 5000) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${name} timeout ${msg.type}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(t);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(t);
            reject(e);
          },
        });
        child.send({ ...msg, id });
      });
    },
    async stop() {
      try {
        await this.call({ type: 'shutdown' }, 2000);
      } catch {
        child.kill();
      }
    },
  };
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

const A = startNode('A-creator', dirA, true);
const B = startNode('B-remote', dirB, false);

await A.call({ type: 'hello' });
await B.call({ type: 'hello' });

// 1) A → bus → B
const send1 = await A.call({ type: 'publish', to: 'B-remote', text: 'from-A-to-B', groupId: 'g1' });
const pull1 = await B.call({ type: 'pull' });
const abOk = pull1.messages?.some((m) => m.text === 'from-A-to-B');

// 2) B → bus → A
const send2 = await B.call({ type: 'publish', to: 'A-creator', text: 'from-B-to-A', groupId: 'g1' });
const pull2 = await A.call({ type: 'pull' });
const baOk = pull2.messages?.some((m) => m.text === 'from-B-to-A');

// 3) incognito 零痕迹
const before = countFiles(dirB);
const incog = await B.call({ type: 'incognito_exec', task: '蒸馏结论' });
const after = countFiles(dirB);
const zeroTrace = after === before && incog.wroteDisk === false;

// 4) B 不可成为值班者
const duty = await B.call({ type: 'become_duty' });
const dutyRejected = duty.allowed === false;

const report = {
  abOk: !!abOk,
  baOk: !!baOk,
  incognito: { distilled: incog.distilled, before, after, zeroTrace },
  dutyOnBRejected: dutyRejected,
  passDoD: !!(abOk && baOk && zeroTrace && dutyRejected),
};

console.log(JSON.stringify(report, null, 2));
await A.stop();
await B.stop();
fs.rmSync(root, { recursive: true, force: true });
process.exit(report.passDoD ? 0 : 1);
