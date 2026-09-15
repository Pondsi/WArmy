/** Spike 10 节点进程：文件总线 + incognito + 值班权边界 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const name = arg('name') || 'node';
const dataDir = arg('data') || process.cwd();
const busDir = arg('bus') || path.join(dataDir, 'bus');
const dutyEligible = arg('duty') === 'true';

fs.mkdirSync(busDir, { recursive: true });

process.on('message', (msg) => {
  const { id, type } = msg;
  try {
    if (type === 'hello') {
      process.send({ id, ok: true, name, pid: process.pid, dutyEligible });
      return;
    }
    if (type === 'publish') {
      const line =
        JSON.stringify({
          from: name,
          to: msg.to,
          groupId: msg.groupId,
          text: msg.text,
          ts: Date.now(),
        }) + '\n';
      fs.appendFileSync(path.join(busDir, 'messages.jsonl'), line);
      process.send({ id, ok: true });
      return;
    }
    if (type === 'pull') {
      const file = path.join(busDir, 'messages.jsonl');
      if (!fs.existsSync(file)) {
        process.send({ id, messages: [] });
        return;
      }
      const all = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const mine = all.filter((m) => m.to === name);
      process.send({ id, messages: mine });
      return;
    }
    if (type === 'incognito_exec') {
      process.send({ id, distilled: `incognito:${name}:OK`, wroteDisk: false });
      return;
    }
    if (type === 'become_duty') {
      process.send({ id, allowed: !!dutyEligible, reason: dutyEligible ? 'creator-node' : 'remote-node-cannot-be-duty' });
      return;
    }
    if (type === 'shutdown') {
      process.send({ id, ok: true });
      setTimeout(() => process.exit(0), 20);
      return;
    }
    process.send({ id, error: `unknown ${type}` });
  } catch (e) {
    process.send({ id, error: String(e.message || e) });
  }
});
