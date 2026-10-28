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

/**
 * 第 111 轮：SQLCipher 密钥只在子进程启动时从环境读一次，读完立刻从 env 删掉；
 * 不写命令行（进程列表看不到），也不落盘。
 */
const dbKeyHex = String(process.env.WARMY_MEMORY_DB_KEY_HEX || '').trim();
try { delete process.env.WARMY_MEMORY_DB_KEY_HEX; } catch { /* noop */ }
qishiJiyiCangFuwuIpc(CangLu, { ...(dbKeyHex ? { dbKeyHex } : {}) });
