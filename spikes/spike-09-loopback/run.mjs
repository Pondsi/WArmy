/**
 * Spike 9: 本地回环 — 主进程 spawn 子进程，完整生命周期，停止后进程树归零
 * DoD: 无死锁；停止后子进程退出
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';

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
  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
