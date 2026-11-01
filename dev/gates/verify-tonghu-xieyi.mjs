/**
 * verify-tonghu-xieyi —— 第 51 轮：牛马互通协议 v1（信封/幂等/印象开关/边界）
 * 用**真函数**跑真值表，并检查派发路径真的把它用上了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/niuma-tonghu.js')).href).catch(() => null);

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

if (!mod) {
  console.log('  FAIL 取不到 niuma-tonghu 编译产物');
  console.log('\n==== verify-tonghu-xieyi: 0 ok / 1 FAIL ====');
  process.exit(1);
}
const { zaoXinFeng, yanZheng, shouXin, xinZhuangTai, jiaoHuanRenZhiYinXiang } = mod;

// 1. 信封形状
const m1 = zaoXinFeng({
  from: { role: 'duty', id: 'niuma-1' }, to: { role: 'exec', id: 'niuma-3' },
  intent: 'delegate', taskId: 't-42', seq: 1,
  cognition: { goal: '把报告写完', blockers: [], facts_ref: ['bb-1'] },
  text: '先写摘要',
});
need(m1.v === 'warmy.chat/1' && !!m1.message_id && m1.idem_key === 't-42#1', '信封带版本/消息号/幂等键');
need(yanZheng(m1).ok === true, '合规信封通过校验');
need(m1.payload?.impression === null, '默认不传印象（impression_ok=false）');
need(Array.isArray(m1.refs?.blackboard) && m1.refs.blackboard.includes('bb-1'), '事实用黑板指针（不复制正文）');

// 2. 边界
need(yanZheng({ ...m1, v: 'x/9' }).ok === false, '版本不对 ⇒ 拒绝');
need(yanZheng({ ...m1, intent: 'nope' }).ok === false, '非法 intent ⇒ 拒绝');
need(yanZheng({ ...m1, payload: { ...m1.payload, text: 'A'.repeat(900) } }).ok === false, '超长 ⇒ 拒绝');
const mNoImp = { ...m1, payload: { ...m1.payload, impression: { text: 'x' } }, capabilities: { impression_ok: false } };
need(yanZheng(mNoImp).ok === false, '未同意却带印象 ⇒ 拒绝');

// 3. 幂等 / TTL
const z = xinZhuangTai(60);
const a1 = shouXin(z, m1);
const a2 = shouXin(z, m1);
need(a1.ok === true && a2.chongFu === true, '同一 idem_key 只处理一次（重复回缓存）');
const z2 = xinZhuangTai(0);
const a3 = shouXin(z2, m1);
need(a3.ok === false && a3.cuo === 'ttl-expired', 'TTL 过期 ⇒ ABORTED');

// 4. 认知↔印象交换
const j1 = jiaoHuanRenZhiYinXiang({ woDeRenZhi: '我是设计师', duiFangTongYi: false, duiFangYinXiang: '喜欢先讨论' });
need(j1.geiDuiFangDeRenZhi === '' && j1.woDeDaoDeYinXiang === '', '对方不同意 ⇒ 不交换任何印象');
const j2 = jiaoHuanRenZhiYinXiang({ woDeRenZhi: '我是设计师', duiFangTongYi: true, duiFangYinXiang: '喜欢先讨论' });
need(j2.geiDuiFangDeRenZhi === '我是设计师' && j2.woDeDaoDeYinXiang === '喜欢先讨论', '双方同意 ⇒ 认知↔印象交换');

// 5. 派发路径接线
const em = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
need(/zaoXinFeng\(\{[\s\S]{0,200}intent: 'delegate'/.test(em), '派发子代理时构造协议信封');
need(/chat\.tonghu-dispatch/.test(em), '派发进审计（可追溯）');
need(/【互通协议 v1】/.test(em), '子代理提示里有协议头');

console.log(`\n==== verify-tonghu-xieyi: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
