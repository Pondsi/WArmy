/** 回复增强的瞬时浏览器宿主：仅服务已验证的字节快照，不提供文件系统入口。 */
import http from 'node:http';
import crypto from 'node:crypto';

export interface A2uiKuaiZhao { html: Buffer; runtime: Buffer }
const MAX_ITEMS = 10, MAX_BYTES = 80 * 1024 * 1024, TTL_MS = 30 * 60000;
export function chuangJianA2uiLiuLanQi() {
  let server: http.Server | undefined;
  let port = 0, bytes = 0;
  let starting: Promise<void> | undefined;
  const items = new Map<string, { html: Buffer; runtime: Buffer; size: number; touched: number }>();
  const drop = (key: string) => {
    const item = items.get(key);
    if (item) bytes -= item.size;
    items.delete(key);
  };
  const expire = () => {
    const now = Date.now();
    for (const [key, item] of items) if (now - item.touched > TTL_MS) drop(key);
  };
  const timer = setInterval(expire, 60000); timer.unref();
  const start = async () => {
    if (server?.listening) return;
    if (starting) return starting;
    starting = new Promise<void>((resolve, reject) => {
      const s = http.createServer((req, res) => {
        expire();
        const origin = `http://127.0.0.1:${port}`;
        const rejectRequest = () => { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); };
        if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)
          || !['GET', 'HEAD'].includes(req.method || '')) { rejectRequest(); return; }
        const m = /^\/([a-f0-9]{48})\/(index\.html|a2ui-runtime\.js)$/.exec(req.url || '');
        const item = m && items.get(m[1]!);
        if (!m || !item) { rejectRequest(); return; }
        item.touched = Date.now();
        const html = m[2] === 'index.html', body = html ? item.html : item.runtime;
        res.writeHead(200, {
          'Content-Type': html ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8',
          'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
      s.requestTimeout = 10000; s.headersTimeout = 10000;
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address();
        if (!addr || typeof addr === 'string') { s.close(); reject(new Error('a2ui-browser-bind')); return; }
        server = s; port = addr.port; resolve();
      });
    });
    try { await starting; } finally { starting = undefined; }
  };
  async function faBu(snapshot: A2uiKuaiZhao): Promise<string> {
    const html = Buffer.from(snapshot.html), runtime = Buffer.from(snapshot.runtime);
    const size = html.length + runtime.length;
    if (!html.length || !runtime.length || size > MAX_BYTES) throw new Error('a2ui-browser-size');
    await start(); expire();
    while (items.size >= MAX_ITEMS || bytes + size > MAX_BYTES) {
      const oldest = [...items].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (!oldest) throw new Error('a2ui-browser-capacity');
      drop(oldest[0]);
    }
    const token = crypto.randomBytes(24).toString('hex');
    items.set(token, { html, runtime, size, touched: Date.now() }); bytes += size;
    return `http://127.0.0.1:${port}/${token}/index.html`;
  }
  function guanBi(): void {
    clearInterval(timer); items.clear(); bytes = 0;
    server?.closeAllConnections(); server?.close(); server = undefined;
  }
  return { faBu, guanBi };
}
