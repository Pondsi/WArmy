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
  // 第 67 轮 项 14：用户实测的分类模型与对话模型
  ['clef:latest', 'decision'],
  ['clef-flash:latest', 'decision'],
  ['orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K', 'chat'],
  ['orcarouter/Qwen3.8-27B-Uncensored:q4_K_M', 'chat'],
  ['orcarouter/Qwen3.8-27B-Uncensored:q5_K_M', 'chat'],
  ['orcarouter/Qwen3.8-27B-Uncensored:iq3_m', 'chat'],
  ['orcarouter/Qwen3.8-27B-Uncensored:iq4_xs', 'chat'],
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
// 第 67 轮 项 10：Ollama 明确判“加载不动”的 whisper 文本模型，必须 unknown（不进任何链）
const n3 = moXingNengLi('dimavz/whisper-tiny:latest', { kind: 'asr', buKeYong: 'unknown model architecture' });
console.log(n3.kind === 'unknown' && !!n3.buKeYong ? 'PASS' : 'FAIL', 'unusable whisper => unknown', n3.kind, n3.buKeYong);
if (n3.kind !== 'unknown' || !n3.buKeYong) fail++;
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
