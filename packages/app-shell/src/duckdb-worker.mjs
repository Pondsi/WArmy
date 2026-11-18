/**
 * R259：DuckDB 子进程 worker。native（@duckdb/node-api）只活在本子进程，主/渲染进程零 .node。
 * stdin 每行一个 {id, sql}；stdout 每行一个 {id, ok, columns, rows, error}。只读查询由主进程闸把关。
 */
import readline from 'node:readline';
let DuckDBInstance = null;
try { ({ DuckDBInstance } = await import('@duckdb/node-api')); } catch { DuckDBInstance = null; }
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let id = 0;
  const hui = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  try {
    const q = JSON.parse(line); id = q.id || 0;
    if (!DuckDBInstance) return hui({ id, ok: false, error: 'duckdb-not-installed' });
    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    const res = await conn.run(String(q.sql || ''));
    const columns = res.columnNames();
    const rows = (await res.getRows()).slice(0, 200);
    hui({ id, ok: true, columns, rows });
    try { conn.closeSync(); inst.closeSync(); } catch { /* noop */ }
  } catch (e) { hui({ id, ok: false, error: String((e && e.message) || e).slice(0, 400) }); }
});
rl.on('close', () => process.exit(0));
process.stdout.write(JSON.stringify({ id: 0, ok: true, ready: true, duckdb: !!DuckDBInstance }) + '\n');