/**
 * memory-os IPC 子进程入口
 * 用法：node dist/ipc.js  （由 InstanceManager / app-shell spawn）
 */
import path from 'node:path';
import os from 'node:os';
import { startMemoryServiceIpc } from './index.js';

const dataDir =
  process.env.CCA_ARMY_MEMORY_DIR ||
  path.join(os.homedir(), '.warmy', 'memory');

startMemoryServiceIpc(dataDir);
