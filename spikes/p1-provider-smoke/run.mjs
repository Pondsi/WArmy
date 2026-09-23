/**
 * Provider + P1 冒烟（对 dist 产物）
 */
import {chuangjianGongYing, congYuSheChuangJian, GONGYING_YUSHE, } from '@warmy/providers';
import {createP1Runtime, AnquanGuanliqi, MemorySecurityStore, suggestMaxInstances, } from '@warmy/app-shell';

const report = {};

report.presets = GONGYING_YUSHE.map((p) => ({ id: p.id, protocol: p.protocol }));
report.hasOpenAI = GONGYING_YUSHE.some((p) => p.protocol === 'openai-compatible');
report.hasAnthropic = GONGYING_YUSHE.some((p) => p.protocol === 'anthropic');
report.hasOllama = GONGYING_YUSHE.some((p) => p.protocol === 'ollama');

const ds = congYuSheChuangJian('deepseek', { apiKey: 'sk-test' });
const an = chuangjianGongYing('anthropic', { apiKey: 'sk-ant-test' });
const ol = chuangjianGongYing('ollama', {});
report.providers = {
  deepseek: { id: ds.id, protocol: ds.protocol, base: ds.baseURL },
  anthropic: { id: an.id, protocol: an.protocol, base: an.baseURL },
  ollama: { id: ol.id, protocol: ol.protocol, base: ol.baseURL },
};

try {
  report.ollamaPing = await ol.ping();
} catch (e) {
  report.ollamaPing = { ok: false, err: String(e) };
}

const sec = new AnquanGuanliqi(new MemorySecurityStore());
await sec.init();
await sec.setMode('normal');
const d1 = await sec.requestToolCall('tool:fs.read');
const d2 = await sec.requestBoundaryWrite(
  'C:\\Windows\\System32\\drivers\\etc\\hosts',
  'C:\\warmy-ws'
);
report.security = { mode: sec.getMode(), tool: d1, outsideWrite: d2 };

const root = 'C:\\Users\\p\\AppData\\Local\\Temp\\warmy-p1-test';
const { instances, teardown } = createP1Runtime({ instancesRoot: root });
report.hardware = instances.hardwareAdvice();
const h = await instances.spawn({
  config: {
    id: 'inst-1',
    ming: '测试实例',
    workspace: root + '\\inst-1',
    dutyEligible: true,
  },
});
report.spawned = { id: h.id, status: h.status, pid: h.pid, dutyEligible: h.dutyEligible };
await new Promise((r) => setTimeout(r, 250));
await instances.stop(h.id);
await instances.stopAll();
report.afterTeardown = { registered: teardown.size(), pass: teardown.size() === 0 };
report.suggest = suggestMaxInstances();

// 可选：DeepSeek 实网
if (process.env.DEEPSEEK_API_KEY) {
  const live = congYuSheChuangJian('deepseek', { apiKey: process.env.DEEPSEEK_API_KEY });
  try {
    const r = await live.chat({
      model: 'deepseek-chat',
      xiaoXiJi: [{ role: 'user', content: '只回：ok' }],
      maxTokens: 4,
    });
    report.deepseekLive = {
      ok: true,
      content: r.choices[0]?.message?.content,
      usage: r.usage,
      protocol: live.protocol,
    };
  } catch (e) {
    report.deepseekLive = { ok: false, err: String(e).slice(0, 200) };
  }
}

console.log(JSON.stringify(report, null, 2));
const ok =
  report.hasOpenAI && report.hasAnthropic && report.hasOllama && report.afterTeardown.pass === true;
process.exit(ok ? 0 : 1);
