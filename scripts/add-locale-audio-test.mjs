/**
 * 一次性：音频测试相关文案（本轮重排）。
 *   · audioTest.mic / audioTest.sound：改值（键不变 ⇒ 键集合仍一致）
 *   · audioTest.micCountdown / audioTest.playRecording：**新增**（必须十个语言包都补）
 * 幂等。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'packages/app-shell/src/i18n';
const ZH = { mic: '测试麦克风', sound: '测试播放器', micCountdown: '倒计时 {s} 秒…', playRecording: '播放录音' };
const EN = { mic: 'Test microphone', sound: 'Test player', micCountdown: 'Countdown {s}s…', playRecording: 'Play recording' };

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];
for (const loc of LOCALES) {
  const f = path.join(DIR, `${loc}.json`);
  const pack = JSON.parse(fs.readFileSync(f, 'utf8'));
  const src = (loc === 'zh-CN' || loc === 'zh-TW') ? ZH : EN;
  let n = 0;
  if (pack['audioTest.mic'] !== src.mic) { pack['audioTest.mic'] = src.mic; n++; }
  if (pack['audioTest.sound'] !== src.sound) { pack['audioTest.sound'] = src.sound; n++; }
  for (const k of ['audioTest.micCountdown', 'audioTest.playRecording']) {
    const short = k.split('.')[1];
    if (pack[k] !== src[short]) { pack[k] = src[short]; n++; }
  }
  if (!n) { console.log(`skip ${loc}`); continue; }
  fs.writeFileSync(f, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(`patched ${loc} (${n})`);
}
