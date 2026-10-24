/**
 * verify-r59-wangluo.mjs（fast 档）—— 第 59 轮：多服务器网络配置 + 扇出 + 中转服务器管理面。
 *
 * 用户口径：局域网/有公网 IP 可用自己的网关；两者都没有 ⇒ 必须至少一个服务器；可同时连多个服务器；
 * 按会话（联系人/群聊/项目）多选；发送时发给该会话的所有网络；服务器用凭据授权。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const U = (f) => pathToFileURL(path.join(ROOT, f)).href;
const W = await import(U('packages/app-shell/dist/wangLuo-peiZhi.js'));
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const PRE = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/preload.cjs'), 'utf8');
const { fwRead, fwExists } = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/scripts/fwarmy-loc.mjs')).href);
const SRV = fwRead('server.mjs');
const CTL = fwExists('ctl.mjs');

let okN = 0, failN = 0;
const jian = (l, p, d) => { if (p) { okN++; console.log('  ok  ' + l); } else { failN++; console.log('  FAIL ' + l + (d ? ' ← ' + String(d).slice(0, 140) : '')); } };

const S1 = { id: 's1', name: '家里', url: 'https://relay.example.com', credential: 'c1' };
const S2 = { id: 's2', name: '公司', url: 'http://10.0.0.2:8787', credential: 'c2' };

jian('合法服务器通过校验', W.jianChaFuWu(S1).ok === true && W.jianChaFuWu(S2).ok === true);
jian('地址不合法/非 http(s) 被拒', W.jianChaFuWu({ name: 'x', url: 'ftp://a', credential: 'c' }).ok === false
  && W.jianChaFuWu({ name: 'x', url: 'not-a-url', credential: 'c' }).ok === false);
jian('没有名称或凭据被拒（服务器要确认你有权使用）',
  W.jianChaFuWu({ name: '', url: 'https://a', credential: 'c' }).ok === false
  && W.jianChaFuWu({ name: 'x', url: 'https://a', credential: '' }).ok === false);
jian('重名/重地址被拒（多服务器要分得清）',
  W.jianChaFuWu(S1, [S1]).ok === false && W.jianChaFuWu({ ...S1, name: '另一个' }, [S1]).ok === false);

jian('会话绑定去重并剔除已删除的服务器',
  JSON.stringify(W.youXiaoBangDing(['s1', 's1', 's2', 'gone'], [S1, S2])) === JSON.stringify(['s1', 's2']));
jian('局域网 ⇒ 可以不配服务器', W.wangLuoGouYong({ bang: [], servers: [], juYuWang: true, gongWangWangGuan: false }).ok === true);
jian('有公网 IP/网关 ⇒ 也可以不配服务器', W.wangLuoGouYong({ bang: [], servers: [], juYuWang: false, gongWangWangGuan: true }).ok === true);
jian('两者都没有且没选服务器 ⇒ 明确拒绝并说明原因',
  W.wangLuoGouYong({ bang: [], servers: [S1], juYuWang: false, gongWangWangGuan: false }).ok === false
  && /必须至少选择一个服务器/.test(W.wangLuoGouYong({ bang: [], servers: [S1], juYuWang: false, gongWangWangGuan: false }).reason));
jian('两者都没有但选了服务器 ⇒ 允许', W.wangLuoGouYong({ bang: ['s1'], servers: [S1], juYuWang: false, gongWangWangGuan: false }).ok === true);

const calls = [];
const fan = await W.touDiDaoSuoYou([S1, S2], ['s1', 's2'], async (s) => { calls.push(s.id); return s.id === 's2' ? { ok: false, error: 'down' } : { ok: true }; });
jian('扇出：同一条消息发给会话配置的**所有**服务器（去重）', calls.sort().join(',') === 's1,s2');
jian('任意一个成功 ⇒ 整体送达；失败的那台原因保留', fan.ok === true && fan.results.find((r) => r.serverId === 's2').error === 'down');
const fan2 = await W.touDiDaoSuoYou([S1, S2], ['s1', 's2'], async () => ({ ok: false, offline: true }));
jian('全部失败 ⇒ 整体未送达，逐台结果可显示/重试', fan2.ok === false && fan2.results.every((r) => r.ok === false && r.offline === true));
const fan3 = await W.touDiDaoSuoYou([S1, S2], ['s1', 's2'], async (s) => { if (s.id === 's1') throw new Error('boom'); return { ok: true }; });
jian('单台抛异常不拖垮其它台（多网络存在的意义）', fan3.ok === true && fan3.results.find((r) => r.serverId === 's1').ok === false);

jian('主进程有网络配置/会话绑定的持久化 IPC（tmp+rename）',
  /chuliIpc\('warmy:netDu'/.test(MAIN) && /chuliIpc\('warmy:netShe'/.test(MAIN)
  && /chuliIpc\('warmy:netBangDingDu'/.test(MAIN) && /chuliIpc\('warmy:netBangDingShe'/.test(MAIN)
  && /const p = wangLuoLu\(\); const t = p \+ '\.tmp';/.test(MAIN));
jian('preload 暴露了这四个入口（渲染层能读写）',
  /netDu: \(\) => ipcRenderer\.invoke\('warmy:netDu'\)/.test(PRE) && /netShe: \(p\) => ipcRenderer\.invoke\('warmy:netShe', p\)/.test(PRE)
  && /netBangDingDu:/.test(PRE) && /netBangDingShe:/.test(PRE));

jian('服务器：凭据（有名称、只回明文一次）+ 哈希存储 + 本机免登录边界',
  /api\/admin\/credentials/.test(SRV) && /sha\(token\)/.test(SRV) && /isAdminRequest/.test(SRV) && !/x-admin-key/.test(SRV));
jian('服务器：一键查公网 IP / 一键关闭 / 接客开关', /api\/admin\/public-ip/.test(SRV) && /api\/admin\/shutdown/.test(SRV) && /accepting/.test(SRV));
jian('服务器：流量控制（每分钟请求、每日字节、单信封、队列上限）',
  /ratePerMin/.test(SRV) && /dailyBytes/.test(SRV) && /maxEnvelope/.test(SRV) && /queuePerUser: 50/.test(SRV));
jian('服务器：业务统计（按凭据）', /perCredential/.test(SRV) && /bytesIn/.test(SRV));
jian('有一键启停控制台 ctl.mjs', CTL === true);

console.log(`==== verify-r59-wangluo: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
