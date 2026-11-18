/**
 * R260 本地语音 ASR 引擎之二：Whisper（whisper.cpp，MIT）。
 *
 * 重要事实：Whisper **只做语音转文字（ASR）**，不做文字转语音（TTS）。
 * 选 Whisper 时，语音转文字走 whisper.cpp；文字转语音仍走 sherpa-onnx VITS（或云端）。
 * sherpa-onnx（Apache-2.0）则 ASR/TTS 都支持。两者许可均宽松、无 copyleft，与本项目 MIT+署名兼容。
 *
 * 零原生约定：whisper.cpp 是独立可执行子进程（不进主/渲染进程）。模型 ggml-base.bin 按需下载。
 * 状态/安装/删除镜像 bendi-yuyin 的 BenDiZhuangTai 形状，界面按所选引擎显示。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { BenDiZhuangTai, BenDiJinDu } from './bendi-yuyin.js';

const MO_XING = {
  ming: 'ggml-base.bin',
  luJing: 'ggerganov/whisper.cpp',
  wenJian: 'ggml-base.bin',
  keXian: 'MIT（OpenAI Whisper 模型权重；whisper.cpp MIT）',
  daYueMB: 142,
};
const MU_LU_JING_XI = [
  'https://hf-mirror.com/{luJing}/resolve/main/{wen}',
  'https://huggingface.co/{luJing}/resolve/main/{wen}',
];
/** whisper.cpp Windows 预编译二进制（GitHub releases，MIT）。 */
const ER_JIN_ZHI = {
  ming: 'whisper-bin-x64.zip',
  url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.2/whisper-bin-x64.zip',
  keXian: 'MIT（whisper.cpp）',
};

let gen0 = '';
let jinDuZuiHou: BenDiJinDu | null = null;
let anZhuangZhong = false;
let cuoWuZuiHou = '';
let onJinDu: ((d: BenDiJinDu) => void) | null = null;

export function chuShiHuaWhisper(gen: string, onJinDuCb?: (d: BenDiJinDu) => void): void {
  gen0 = gen;
  if (onJinDuCb) onJinDu = onJinDuCb;
}
function muLuGen(): string { return path.join(gen0, 'local-whisper'); }
function muLuMoXing(): string { return path.join(muLuGen(), 'models', MO_XING.ming); }
function muLuErJinZhi(): string { return path.join(muLuGen(), 'bin'); }
function erJinZhiLuJing(): string {
  const hou = ['whisper.exe', 'main.exe', 'bin/whisper.exe', 'bin/main.exe'];
  for (const h of hou) { const p = path.join(muLuErJinZhi(), h); if (fs.existsSync(p)) return p; }
  return '';
}
function buZaiAnZhuangBiaoJi(): string { return path.join(muLuGen(), 'do-not-install.flag'); }
function baoJinDu(jieduan: BenDiJinDu['jieduan'], wenjian: string, yiXia: number, zong: number): void {
  const d: BenDiJinDu = { jieduan, wenjian, yiXia, zong, baiFenBi: zong > 0 ? Math.round((yiXia / zong) * 100) : 0 };
  jinDuZuiHou = d;
  try { onJinDu?.(d); } catch { /* noop */ }
}

/** 状态：二进制 + 模型齐 ⇒ 已安装；缺 ⇒ 未安装（界面用主题色提示）。 */
export function whisperZhuangTai(qiYong: boolean): BenDiZhuangTai {
  const er = erJinZhiLuJing();
  const mo = fs.existsSync(muLuMoXing());
  const buZai = fs.existsSync(buZaiAnZhuangBiaoJi());
  const yiAn = !!er && mo;
  return {
    ok: true,
    zhuangTai: anZhuangZhong ? 'an_zhuang_zhong' : yiAn ? 'yi_an_zhuang' : 'wei_an_zhuang',
    qiYong: qiYong && yiAn,
    buZaiAnZhuang: buZai,
    ziDongGuan: '',
    muLu: muLuGen(),
    yunXing: { zai: !!er, luJing: er, keYiBao: !!er, banBen: 'whisper.cpp 1.7.2', ziDai: false },
    moXing: { shiBie: mo, heCheng: false },
    moXingMing: { shiBie: MO_XING.ming, heCheng: '（Whisper 不做合成，TTS 走 sherpa-onnx）' },
    daYueMB: MO_XING.daYueMB,
    yiXiaMB: jinDuZuiHou ? Math.round(jinDuZuiHou.yiXia / 1048576) : 0,
    cuoWu: cuoWuZuiHou,
    jinDu: jinDuZuiHou,
    keXian: MO_XING.keXian + '；' + ER_JIN_ZHI.keXian,
    youTar: false,
  };
}

async function xiaZai(url: string, dst: string, jieduan: BenDiJinDu['jieduan'], wenjian: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return { ok: false, error: 'download-http-' + res.status };
    const zong = Number(res.headers.get('content-length') || 0);
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let yiXia = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const b = Buffer.from(value); chunks.push(b); yiXia += b.length;
      baoJinDu(jieduan, wenjian, yiXia, zong || yiXia);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.concat(chunks));
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}

/** 安装：下载 ggml 模型（HF 镜像优先）+ whisper.cpp 二进制 zip。诚实报错；二进制解压需系统 tar/Expand-Archive。 */
export async function anZhuangWhisper(): Promise<{ ok: boolean; error?: string; zhuangTai?: BenDiZhuangTai }> {
  if (anZhuangZhong) return { ok: false, error: 'install-in-progress' };
  anZhuangZhong = true;
  cuoWuZuiHou = '';
  try {
    fs.mkdirSync(muLuGen(), { recursive: true });
    try { fs.rmSync(buZaiAnZhuangBiaoJi(), { force: true }); } catch { /* noop */ }
    // ① 模型
    if (!fs.existsSync(muLuMoXing())) {
      let moOk = false; let moErr = '';
      for (const muBan of MU_LU_JING_XI) {
        const url = muBan.replace('{luJing}', MO_XING.luJing).replace('{wen}', MO_XING.wenJian);
        const r = await xiaZai(url, muLuMoXing(), 'shiBie', MO_XING.wenJian);
        if (r.ok) { moOk = true; break; }
        moErr = r.error || '';
      }
      if (!moOk) { cuoWuZuiHou = 'model-download-failed: ' + moErr; return { ok: false, error: cuoWuZuiHou }; }
    }
    // ② 二进制（zip）
    if (!erJinZhiLuJing()) {
      const zip = path.join(muLuGen(), ER_JIN_ZHI.ming);
      const r = await xiaZai(ER_JIN_ZHI.url, zip, 'yunxing', ER_JIN_ZHI.ming);
      if (!r.ok) { cuoWuZuiHou = 'binary-download-failed: ' + r.error; return { ok: false, error: cuoWuZuiHou }; }
      const jie = await jieYaZip(zip, muLuErJinZhi());
      if (!jie.ok) { cuoWuZuiHou = 'binary-extract-failed: ' + jie.error; return { ok: false, error: cuoWuZuiHou }; }
      try { fs.rmSync(zip, { force: true }); } catch { /* noop */ }
    }
    baoJinDu('wancheng', '', 1, 1);
    return { ok: true, zhuangTai: whisperZhuangTai(true) };
  } catch (e) {
    cuoWuZuiHou = String((e as Error)?.message || e);
    return { ok: false, error: cuoWuZuiHou };
  } finally { anZhuangZhong = false; }
}

/** 解压 zip：Windows 用 Expand-Archive（PowerShell），跨平台兜底 tar。子进程，不阻塞主进程。 */
function jieYaZip(zip: string, dst: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    fs.mkdirSync(dst, { recursive: true });
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'powershell' : 'tar';
    const args = isWin
      ? ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dst.replace(/'/g, "''")}' -Force`]
      : ['-xf', zip, '-C', dst];
    try {
      const z = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; let done = false;
      const fin = (ok: boolean, e?: string) => { if (done) return; done = true; clearTimeout(t); resolve({ ok, error: e }); };
      const t = setTimeout(() => { try { z.kill(); } catch { /* noop */ } fin(false, 'extract-timeout'); }, 120000);
      z.stderr?.on('data', (d) => { err += d.toString(); });
      z.on('error', (e) => fin(false, String(e.message)));
      z.on('exit', (c) => fin(c === 0, c === 0 ? undefined : err.slice(0, 200)));
    } catch (e) { resolve({ ok: false, error: String((e as Error)?.message || e) }); }
  });
}

/** 删除：删模型+二进制+写「下次更新不再安装」标记。 */
export function shanChuWhisper(buZaiAnZhuang: boolean): { ok: boolean; error?: string } {
  try {
    fs.rmSync(muLuGen(), { recursive: true, force: true });
    if (buZaiAnZhuang) { fs.mkdirSync(muLuGen(), { recursive: true }); fs.writeFileSync(buZaiAnZhuangBiaoJi(), '1', 'utf8'); }
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}

/** 用 whisper.cpp 子进程把音频转文字（ASR）。返回转写文本；失败如实报。 */
export function whisperShiBie(yinPinLuJing: string, yuYan = 'zh'): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const er = erJinZhiLuJing();
    if (!er) { resolve({ ok: false, error: 'whisper-not-installed' }); return; }
    if (!fs.existsSync(muLuMoXing())) { resolve({ ok: false, error: 'whisper-model-missing' }); return; }
    try {
      const args = ['-m', muLuMoXing(), '-l', yuYan, '-nt', '-f', yinPinLuJing];
      const z = spawn(er, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = ''; let done = false;
      const fin = (r: { ok: boolean; text?: string; error?: string }) => { if (done) return; done = true; clearTimeout(t); resolve(r); };
      const t = setTimeout(() => { try { z.kill(); } catch { /* noop */ } fin({ ok: false, error: 'whisper-timeout' }); }, 120000);
      z.stdout?.on('data', (d) => { out += d.toString(); });
      z.stderr?.on('data', (d) => { err += d.toString(); });
      z.on('error', (e) => fin({ ok: false, error: String(e.message) }));
      z.on('exit', (c) => fin(c === 0 ? { ok: true, text: out.trim() } : { ok: false, error: (err || out).slice(0, 200) }));
    } catch (e) { resolve({ ok: false, error: String((e as Error)?.message || e) }); }
  });
}

/** 模型 sha256（安装后审计/校验用）。 */
export function whisperMoXingHaXi(): string {
  try { return crypto.createHash('sha256').update(fs.readFileSync(muLuMoXing())).digest('hex'); } catch { return ''; }
}