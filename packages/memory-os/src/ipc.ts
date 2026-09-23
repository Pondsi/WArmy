/**
 * memory-os IPC 子进程入口
 * 用法：node dist/ipc.js  （由 InstanceManager / app-shell spawn）
 */
import path from 'node:path';
import os from 'node:os';
import { qishiJiyiCangFuwuIpc } from './index.js';

const CangLu =
  process.env.WARMY_MEMORY_DIR || process.env.CCA_ARMY_MEMORY_DIR ||
  path.join(os.homedir(), '.warmy', 'memory');

qishiJiyiCangFuwuIpc(CangLu);
