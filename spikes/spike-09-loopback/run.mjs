/**
 * Spike 9: 本地回环 — 主进程 spawn 子进程，完整生命周期，停止后进程树归零
 * DoD: 无死锁；停止后子进程退出
 */
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = import.meta.dirname;

async function main() {
  const child = spawn(process.execPath, ['-e', `
    process.on('message', (m) => {
      if (m === 'ping') process.send('pong');
      if (m === 'exit') process.exit(0);
    });
    process.send('ready');
  `], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  await once(child, 'message');
  const t0 = performance.now();
  child.send('ping');
  const [pong] = await once(child, 'message');
  const rtt = performance.now() - t0;

  child.send('exit');
  const [code] = await once(child, 'exit');

  const result = {
    ready: true,
    pong: pong === 'pong',
    rttMs: +rtt.toFixed(3),
    exitCode: code,
    pass: pong === 'pong' && code === 0,
  };
  console.log(JSON.stringify(result, null, 2));

  // ── 落盘原始证据（P0 复核：判定必须有原始输出支撑）──
  const evidence = {
    spike: 'spike-09-loopback',
    title: '本地回环：主进程 ↔ 子进程 IPC 生命周期',
    dod: '完整生命周期无死锁；停止后进程树归零',
    ranAt: new Date().toISOString(),
    command: 'node spikes/spike-09-loopback/run.mjs',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    scopeNote:
      '本脚本只验证 Node 子进程 IPC 回环与退出码；ADR 要求的「Electron 主进程 → 记忆子进程 → dsh 实例」三段链路未验证',
    result,
    exitCode: result.pass ? 0 : 1,
  };
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`原始结果已写入 ${path.join(__dirname, 'result.json')}`);

  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
