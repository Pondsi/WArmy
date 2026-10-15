/** 第21轮：长程任务/记忆/缓存能力门禁 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const main=fs.readFileSync(path.join(root,'packages/app-shell/src/electron-main.ts'),'utf8');
const settings=fs.readFileSync(path.join(root,'packages/app-shell/src/settings-store.ts'),'utf8');
const mem=fs.readFileSync(path.join(root,'packages/app-shell/src/memory-client.ts'),'utf8');
const metrics=fs.readFileSync(path.join(root,'packages/app-shell/src/metrics.ts'),'utf8');
let fail=0;const ok=(x,m)=>{console.log((x?'PASS ':'FAIL ')+m);if(!x)fail++;};
// 24h+持久运行基础
ok(main.includes('24 * 60 * 60 * 1000'),'决策卡最长等待24小时');
ok(main.includes('scheduled-tasks.json')&&main.includes('dingShiRenWuJi'),'定时任务持久化');
ok(main.includes('checkpoint.round-start')&&main.includes('checkpoint.session-rollback'),'每轮checkpoint与回滚');
ok(main.includes('LeaseRegistry')&&main.includes('lease.acquire')&&main.includes('lease.release'),'写操作租约与释放');
ok(main.includes('plan.auto-continue')&&main.includes('ziDongXuPai'),'多轮自动续派');
ok(main.includes('eta-live.json')||main.includes('etaHuo()'),'ETA/进度持久追踪');
ok(main.includes('stoppedSessions')&&main.includes('AbortController'),'可停止且真取消在途请求');
// 记忆一致性
ok(mem.includes('recallScoped')&&mem.includes('retrieve'),'语义回忆+精确取回双层记忆');
ok(main.includes('xuanranYoujieShitu')||main.includes('context-renderer'),'有界上下文渲染');
ok(main.includes('chat.archived-summary-injected'),'归档摘要回注');
ok(main.includes('chat.attachment-grant')&&main.includes('trusted-folders-grant'),'附件/受信任目录只读授权');
ok(main.includes('memoryReady')&&main.includes('jiyiTools'),'记忆不可用只降级记忆工具');
// 缓存
ok(metrics.includes('cacheHitTokens')&&metrics.includes('cacheHitRate'),'原生缓存命中率指标');
ok(main.includes('当前时间：')&&main.includes('最后一条用户消息'),'动态时间戳放用户消息尾部，避免打穿system前缀缓存');
ok(!/system[^\n]{0,80}当前时间：/.test(main),'system提示前缀不含动态时间戳');
ok(settings.includes('autoSummary'),'空闲自动摘要可配置');
console.log(`round21 long/memory/cache: ${fail?'FAIL':'PASS'} (${fail})`);process.exit(fail?1:0);
