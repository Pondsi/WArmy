/**
 * R287 P3-4：JSONL 兜底写唯一 owner（自 electron-main 迁出，行为保持）。
 * 记忆服务不可用时聊天正文直写 fast-memory.jsonl（唯一事实源不能因服务挂了而丢）；
 * 行形状与记忆服务 append 完全一致（契约 XiaoxiJilu）；seq 取已有最大 +1（空文件从 1 起）；
 * 恢复后记忆服务按 JSONL 冷启动重建 ⇒ 同一份真相。构造无副作用；目录/审计/时钟窄注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { XiaoxiJilu } from '@warmy/contracts';

export interface JsonlDouDiYiLai {
  /** userData 目录 */
  shuJuMuLu: () => string;
  shenJi: (op: string, detail: unknown) => void;
  shiZhong?: () => number;
}

export function chuangJianJsonlDouDi(yiLai: JsonlDouDiYiLai) {
  const shiZhong = yiLai.shiZhong || (() => Date.now());
  function daBaoXieRuJsonl(key: string, role: string, ti: string): void {
    try {
      const dir = path.join(yiLai.shuJuMuLu(), 'memory');
      const p = path.join(dir, 'fast-memory.jsonl');
      fs.mkdirSync(dir, { recursive: true });
      // seq 取「已有最大 seq + 1」，与记忆服务同一条单调序列（空文件从 1 起）
      let seq = 1;
      try {
        const yuan = fs.readFileSync(p, 'utf8');
        for (const line of yuan.split('\n')) {
          if (!line.trim()) continue;
          try { const d = JSON.parse(line); const s = Number(d && d.seq); if (Number.isFinite(s) && s >= seq) seq = s + 1; } catch { /* 坏行跳过 */ }
        }
      } catch { /* 文件还没有 */ }
      const ts = shiZhong();
      const id = (String(role).toLowerCase() === 'assistant' ? 'a-' : 'u-') + 'fb-' + ts.toString(36);
      /** 兜底直写的这一行必须与记忆服务写的同形（契约 XiaoxiJilu），否则重启重建会读出两种格式 */
      const jiaoSe = String(role).toLowerCase();
      const jiLu: XiaoxiJilu = {
        id, sessionId: key, kind: 'message',
        role: jiaoSe === 'assistant' ? 'assistant' : jiaoSe === 'system' ? 'system' : 'user',
        ti: String(ti || ''), groupId: key, entityType: 'chat', seq, ts,
      };
      const hang = JSON.stringify(jiLu) + '\n';
      fs.appendFileSync(p, hang, 'utf8');
      yiLai.shenJi('chat.jsonl-fallback', { sessionId: key, role, chars: String(ti || '').length, seq });
    } catch { /* 兜底也写不进去时不打断对话 */ }
  }
  return { daBaoXieRuJsonl };
}
