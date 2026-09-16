/**
 * 双机联测：本机 loopback + 可选对端
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const ascii = path.join(os.tmpdir(), 'ccarmy-lan-pkg');
fs.rmSync(ascii, { recursive: true, force: true });
fs.mkdirSync(path.join(ascii, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'packages/sync-protocol/package.json'), path.join(ascii, 'package.json'));
for (const f of fs.readdirSync(path.join(root, 'packages/sync-protocol/dist'))) {
  fs.copyFileSync(path.join(root, 'packages/sync-protocol/dist', f), path.join(ascii, 'dist', f));
}

const mod = await import(pathToFileURL(path.join(ascii, 'dist', 'lan.js')).href);
const r = await mod.dualMachineSmoke({
  localId: 'node-a',
  localPort: 7791,
  peerHost: process.env.PEER_HOST || '192.168.1.123',
  peerPort: Number(process.env.PEER_PORT || 7788),
});
console.log(JSON.stringify(r, null, 2));
if (!r.loopbackOk) process.exit(1);
process.exit(0);
