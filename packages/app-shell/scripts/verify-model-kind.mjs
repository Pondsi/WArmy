/** 快速自检：模型 kind 识别（真表 + 合成逻辑） */
import { moXingNengLi, caiZhongLei } from '../../providers/dist/mo-xing-neng-li.js';

const cases = [
  ['mimo-v2.5-asr', 'asr'],
  ['mimo-v2.5-tts', 'tts'],
  ['mimo-v2.5-tts-voiceclone', 'tts'],
  ['mimo-v2.6-pro', 'chat'],
  ['whisper-1', 'asr'],
  ['gpt-4o-mini-tts', 'tts'],
  ['text-embedding-3-small', 'embedding'],
  ['deepseek-chat', 'chat'],
  ['qwen2.5-vl-7b', 'chat'],
];
let fail = 0;
for (const [id, want] of cases) {
  // 端点回 unknown 不该盖掉表/名字
  const n = moXingNengLi(id, { kind: 'unknown', vision: 'unknown' });
  const c = caiZhongLei(id);
  const got = n.kind;
  const ok = got === want || (want === 'chat' && (got === 'chat' || got === 'unknown'));
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', id, 'kind=', got, 'cai=', c, 'want=', want);
}
// 专用 kind 不被端点 chat 盖掉
const n2 = moXingNengLi('mimo-v2.5-asr', { kind: 'chat' });
console.log(n2.kind === 'asr' ? 'PASS' : 'FAIL', 'endpoint-chat cannot override asr', n2.kind);
if (n2.kind !== 'asr') fail++;
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
