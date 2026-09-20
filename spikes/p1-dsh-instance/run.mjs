/**
 * P1 真 dsh：InstanceManager 拉起 dsh profile 包装进程
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {createP1Runtime} from '@warmy/app-shell';
import {findDshPackageDir, ensureDshProfile, writeDshInstanceEntry} from '@warmy/dsh-runtime';

const root = 'C:\\Users\\p\\AppData\\Local\\Temp\\warmy-dsh-p1';
fs.mkdirSync(root, { recursive: true });

const dshDir = findDshPackageDir([
  path.resolve('spike-05-plugins/node_modules/@deepseek-ai/dsh'),
  path.resolve('../../spikes/spike-05-plugins/node_modules/@deepseek-ai/dsh'),
]);
if (!dshDir) {
  console.log('SKIP: dsh package not found');
  process.exit(0);
}

const dshHome = path.join(root, 'dsh-home');
const profile = 'warmy';
const ensured = await ensureDshProfile({
  nodePath: process.execPath,
  dshPackageDir: dshDir,
  dshHome,
  profile,
});
console.log('profile', ensured);

const entry = path.join(root, 'instance-entry.mjs');
writeDshInstanceEntry(entry, {
  dshPackageDir: dshDir,
  dshHome,
  profile,
});

const { instances, teardown } = await createP1Runtime({
  instancesRoot: path.join(root, 'instances'),
});

const h = await instances.spawn({
  config: {
    id: 'dsh-1',
    name: 'dsh-worker',
    workspace: path.join(root, 'instances', 'dsh-1'),
    dutyEligible: true,
  },
  entryScript: entry,
});
console.log('spawned', h);

await new Promise((r) => setTimeout(r, 1500));
const still = instances.list();
console.log('still running', still);

await instances.stop('dsh-1');
await instances.stopAll();
console.log('teardown', teardown.size());
process.exit(teardown.size() === 0 ? 0 : 1);
