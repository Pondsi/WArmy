/**
 * 本地语音（sherpa-onnx）—— 第 27 轮 项 5。
 *
 * 2026-10-24：运行时和 ASR/TTS 两套模型安装齐全才允许启用。
 * 启用后 ASR/TTS 只用本地；失败如实报错，不降级云端，也不修改用户的启用选择。
 *
 * 三个动作对应界面上的三个控件：
 *   · 启用勾选        —— 装齐后才可开启；关闭后由调用方走配置的模型链；
 *   · 删除            —— 删掉运行环境 + 模型，并写「下次更新不再安装」标记（项 5 原话）；
 *   · 安装（删除后出现）—— 按本文件里的**清单**（我们仓库钉死的版本）补齐运行时与模型。
 *
 * 运行时来源优先级：已装好的 userData → 我们应用自带的 node_modules → 包仓库 tarball。
 * 模型来源钉死为 huggingface 镜像优先、官方兜底；许可随模型目录一起落盘（README/LICENSE）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/** 本模块编译成 ESM（package.json type=module）⇒ 不能直接用 __dirname */
const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** 界面与门禁都用这些状态名（不要另造） */
export type BenDiZhuangTaiMing = 'yi_an_zhuang' | 'wei_an_zhuang' | 'an_zhuang_zhong' | 'bu_ke_yong';

export interface BenDiJinDu {
  jieduan: 'yunxing' | 'shiBie' | 'heCheng' | 'wancheng';
  wenjian: string;
  yiXia: number;
  zong: number;
  baiFenBi: number;
}

export interface BenDiZhuangTai {
  ok: true;
  zhuangTai: BenDiZhuangTaiMing;
  qiYong: boolean;
  buZaiAnZhuang: boolean;
  /** 兼容旧界面，固定空串；失败不修改用户选择。 */
  ziDongGuan: string;
  muLu: string;
  yunXing: { zai: boolean; luJing: string; keYiBao: boolean; banBen: string; ziDai: boolean };
  moXing: { shiBie: boolean; heCheng: boolean };
  /** 钉死的模型名（界面/门禁都从这里读，别在别处再抄一份） */
  moXingMing: { shiBie: string; heCheng: string };
  daYueMB: number;
  yiXiaMB: number;
  cuoWu: string;
  jinDu: BenDiJinDu | null;
  /** 许可摘要（照实说，不替上游做承诺） */
  keXian: string;
  /** 本机 tar 能不能用（只有走包仓库下载时才需要） */
  youTar: boolean;
}

/** 钉死的运行时清单（升级版本时只改这里，界面上会如实显示） */
const YUN_XING_QING_DAN = {
  name: 'sherpa-onnx-node',
  version: '1.13.8',
  tarBao: 'sherpa-onnx-node-1.13.8.tgz',
  pingTai: 'sherpa-onnx-win-x64',
  pingTaiTarBao: 'sherpa-onnx-win-x64-1.13.8.tgz',
  caiGou: [
    'https://registry.npmmirror.com/',
    'https://registry.npmjs.org/',
  ],
};

interface MoXingQing {
  ming: string;
  luJing: string;
  wenJian: string[];
  keXian: string;
  daYueMB: number;
}

/**
 * ASR = paraformer-zh-small（82MB，中文+英文，实测 5.6s 音频 36ms 出字）；
 * TTS = vits-zh-ll（121MB + jieba 词典，5 个音色，实测 3.2s 音频 676ms 合成）。
 * 不选 vits-zh-hf-*：那一组上游没随模型给许可，不替它做商用承诺。
 */
const MO_XING: Record<'shiBie' | 'heCheng', MoXingQing> = {
  shiBie: {
    ming: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
    luJing: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09',
    wenJian: ['model.int8.onnx', 'tokens.txt', 'am.mvn', 'README.md'],
    keXian: 'Apache-2.0（sherpa-onnx / k2-fsa 转换包）',
    daYueMB: 79,
  },
  heCheng: {
    ming: 'sherpa-onnx-vits-zh-ll',
    luJing: 'csukuangfj/sherpa-onnx-vits-zh-ll',
    wenJian: [
      'model.onnx', 'tokens.txt', 'lexicon.txt', 'date.fst', 'number.fst', 'phone.fst', 'new_heteronym.fst',
      'dict/jieba.dict.utf8', 'dict/hmm_model.utf8', 'dict/idf.utf8', 'dict/stop_words.utf8', 'dict/user.dict.utf8', 'dict/README.md',
      'dict/pos_dict/char_state_tab.utf8', 'dict/pos_dict/prob_emit.utf8', 'dict/pos_dict/prob_start.utf8', 'dict/pos_dict/prob_trans.utf8',
    ],
    keXian: 'Apache-2.0（sherpa-onnx 转换包）；底模由社区训练（Plachtaa/VITS-fast-fine-tuning）',
    daYueMB: 122,
  },
};

const MU_LU_JING_XI = [
  'https://hf-mirror.com/{luJing}/resolve/main/{wen}',
  'https://huggingface.co/{luJing}/resolve/main/{wen}',
];

/** 模块级状态：安装进度、上一次失败原因、推理对象缓存 */
let gen0 = '';
let zhuangTaiWenJian = '';
let jinDuZuiHou: BenDiJinDu | null = null;
let anZhuangZhong = false;
let cuoWuZuiHou = '';
let shiBieQi: unknown = null;
let heChengQi: unknown = null;
let onJinDu: ((d: BenDiJinDu) => void) | null = null;

function danDian<T>(v: T | null | undefined): T | null { return v ?? null; }

function muLuGen(): string { return path.join(gen0, 'local-speech'); }
function muLuYunXing(): string { return path.join(muLuGen(), 'node_modules', YUN_XING_QING_DAN.name); }
function muLuMoXing(lei: 'shiBie' | 'heCheng'): string { return path.join(muLuGen(), 'models', MO_XING[lei].ming); }

interface JiZhuangTai { qiYong?: boolean; buZaiAnZhuang?: boolean; cuoWu?: string; ts?: number }
function duJi(): JiZhuangTai {
  try { return JSON.parse(fs.readFileSync(zhuangTaiWenJian, 'utf8')) as JiZhuangTai; } catch { return {}; }
}
/** 兼容旧状态接口；推理失败不再自动取消勾选。 */
export function benDiZiDongGuan(): string { return ''; }
function xieJi(p: JiZhuangTai): void {
  try {
    fs.mkdirSync(path.dirname(zhuangTaiWenJian), { recursive: true });
    fs.writeFileSync(zhuangTaiWenJian, JSON.stringify({ ...duJi(), ...p, ts: Date.now() }, null, 2), 'utf8');
  } catch { /* 状态写不进去只影响下次记住勾选，不影响本次 */ }
}

export function chuShiHuaBenDiYuYin(o: { userDataDir: string; onJinDu?: (d: BenDiJinDu) => void }): void {
  gen0 = String(o.userDataDir || '');
  zhuangTaiWenJian = path.join(gen0, 'ben-di-yu-yin.json');
  onJinDu = o.onJinDu ?? null;
}

function wenJianQing(ming: MoXingQing, lei: 'shiBie' | 'heCheng'): boolean {
  const gen = muLuMoXing(lei);
  return ming.wenJian.every((w) => {
    try {
      const st = fs.statSync(path.join(gen, w));
      return st.isFile() && st.size > 0;
    } catch { return false; }
  });
}

/**
 * 运行时放在哪：
 *   1) userData/local-speech/node_modules —— 「安装」从包仓库下载下来的；
 *   2) 应用自带的 node_modules —— **我们仓库/构建产物里就有**（pnpm 工作区下它是软链，
 *      所以不复制、直接从这里 require；复制会把平台包 sherpa-onnx-win-x64 的解析链弄断）。
 * 「删除」= 删掉 1 并写标记；带着标记时连 2 也不再用（项 5 原话：下次更新不再安装）。
 */
function yunXingGen(): { luJing: string; ziDai: boolean } {
  if (fs.existsSync(path.join(muLuYunXing(), 'package.json'))) return { luJing: muLuYunXing(), ziDai: false };
  const candidates = [
    path.resolve(thisDir, '..', 'node_modules', YUN_XING_QING_DAN.name),
    path.resolve(thisDir, '..', '..', 'node_modules', YUN_XING_QING_DAN.name),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'package.json'))) return { luJing: c, ziDai: true }; } catch { /* 继续找 */ }
  }
  return { luJing: '', ziDai: false };
}

function keYiBaoFrom(gen: string): boolean {
  if (!gen) return false;
  try {
    const r = createRequire(path.join(gen, 'package.json'))(YUN_XING_QING_DAN.name);
    return typeof r?.OfflineRecognizer === 'function' && typeof r?.OfflineTts === 'function';
  } catch { return false; }
}

async function taoBao(tarBao: string): Promise<{ ok: boolean; buf?: Buffer; error?: string }> {
  for (const qian of YUN_XING_QING_DAN.caiGou) {
    const u = qian + YUN_XING_QING_DAN.name + '/-/' + tarBao;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) { cuoWuZuiHou = 'http ' + r.status + ' ' + u; continue; }
      return { ok: true, buf: Buffer.from(await r.arrayBuffer()) };
    } catch (e) { cuoWuZuiHou = String((e as Error)?.message || e); }
  }
  return { ok: false, error: cuoWuZuiHou || 'registry-unreachable' };
}

function paoTar(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const c = spawn('tar', args, { windowsHide: true });
    let xie = '';
    c.stderr?.on('data', (b) => { xie += String(b); });
    c.on('error', (e) => resolve({ ok: false, error: 'tar 不可用：' + String((e as Error)?.message || e).slice(0, 120) }));
    c.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: ('tar exit ' + code + ' ' + xie).slice(0, 200) }));
  });
}

/** 把 tarball 解到 node_modules（npm 包内部根目录叫 package/） */
async function jieBao(tarBao: string, dirMing: string): Promise<{ ok: boolean; error?: string }> {
  const xia = await taoBao(tarBao);
  if (!xia.ok || !xia.buf) return { ok: false, error: xia.error || 'download-failed' };
  const tmp = path.join(muLuGen(), 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const wen = path.join(tmp, tarBao);
  fs.writeFileSync(wen, xia.buf);
  const jie = path.join(tmp, 'x-' + dirMing);
  fs.rmSync(jie, { recursive: true, force: true });
  fs.mkdirSync(jie, { recursive: true });
  const r = await paoTar(['-xzf', wen, '-C', jie]);
  if (!r.ok) return r;
  const muBiao = path.join(muLuGen(), 'node_modules', dirMing);
  fs.mkdirSync(path.dirname(muBiao), { recursive: true });
  fs.rmSync(muBiao, { recursive: true, force: true });
  fs.renameSync(path.join(jie, 'package'), muBiao);
  fs.rmSync(jie, { recursive: true, force: true });
  try { fs.rmSync(wen, { force: true }); } catch { /* noop */ }
  return { ok: true };
}

/** 上一次下载成功的镜像下标：后面的文件直接从它开始试。
 *  hf-mirror 挂掉时每个文件都要白等一次连接超时（实测 20 个文件 ≈ 多花 3 分钟），记住可用的那个就不再挨这一刀。 */
let xiaZaiJingXiang = 0;

async function xiaZaiMoXing(lei: 'shiBie' | 'heCheng'): Promise<{ ok: boolean; error?: string }> {
  const qing = MO_XING[lei];
  const gen = muLuMoXing(lei);
  fs.mkdirSync(gen, { recursive: true });
  for (const w of qing.wenJian) {
    const lu = path.join(gen, w);
    if (fs.existsSync(lu) && fs.statSync(lu).size > 0) continue;
    fs.mkdirSync(path.dirname(lu), { recursive: true });
    let cheng = false;
    const shou = MU_LU_JING_XI.map((m, k) => ({ m, jx: (k + xiaZaiJingXiang) % MU_LU_JING_XI.length }));
    for (const { m, jx } of shou) {
      const u = m.replace('{luJing}', qing.luJing).replace('{wen}', w);
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(300000) });
        if (!r.ok) { cuoWuZuiHou = 'http ' + r.status; continue; }
        const zong = Number(r.headers.get('content-length')) || 0;
        const tmp = lu + '.part';
        const fd = fs.openSync(tmp, 'w');
        let xia = 0;
        try {
          if (r.body && typeof (r.body as { getReader?: unknown }).getReader === 'function') {
            const du = (r.body as ReadableStream<Uint8Array>).getReader();
            for (;;) {
              const { done, value } = await du.read();
              if (done) break;
              fs.writeSync(fd, value);
              xia += value.byteLength;
              const d: BenDiJinDu = {
                jieduan: lei, wenjian: qing.ming + '/' + w, yiXia: xia, zong: zong || xia,
                baiFenBi: zong ? Math.min(99, Math.round((xia / zong) * 100)) : 0,
              };
              jinDuZuiHou = d;
              try { onJinDu?.(d); } catch { /* 广播失败不影响下载 */ }
            }
          } else {
            const buf = Buffer.from(await r.arrayBuffer());
            fs.writeSync(fd, buf);
            xia = buf.length;
          }
        } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, lu);
        cheng = true;
        xiaZaiJingXiang = jx;
        break;
      } catch (e) { cuoWuZuiHou = String((e as Error)?.message || e); }
    }
    if (!cheng) return { ok: false, error: '模型下载失败：' + qing.ming + '/' + w + '（' + (cuoWuZuiHou || 'unreachable') + '）' };
  }
  return { ok: true };
}

/** 已经落盘多少（界面显示「约 X MB / 共 Y MB」用） */
function yiXiaShaoMB(): number {
  let b = 0;
  for (const lei of ['shiBie', 'heCheng'] as const) {
    const gen = muLuMoXing(lei);
    for (const w of MO_XING[lei].wenJian) {
      try { b += fs.statSync(path.join(gen, w)).size; } catch { /* 缺就算 0 */ }
    }
  }
  return Math.round(b / 1048576);
}

export function zhuangTaiBenDiYuYin(): BenDiZhuangTai {
  const ji = duJi();
  const gen = yunXingGen();
  const keYiBao = !ji.buZaiAnZhuang && keYiBaoFrom(gen.luJing);
  const yunXingZai = !!gen.luJing && !ji.buZaiAnZhuang;
  const shiBieZai = wenJianQing(MO_XING.shiBie, 'shiBie');
  const heChengZai = wenJianQing(MO_XING.heCheng, 'heCheng');
  const yiQi = yunXingZai && keYiBao && shiBieZai && heChengZai;
  let zhuangTai: BenDiZhuangTaiMing = 'wei_an_zhuang';
  if (anZhuangZhong) zhuangTai = 'an_zhuang_zhong';
  else if (yiQi) zhuangTai = 'yi_an_zhuang';
  else if (gen.luJing && !keYiBao && !ji.buZaiAnZhuang) zhuangTai = 'bu_ke_yong';
  return {
    ok: true,
    zhuangTai,
    qiYong: !!ji.qiYong,
    ziDongGuan: '',
    buZaiAnZhuang: !!ji.buZaiAnZhuang,
    muLu: muLuGen(),
    yunXing: { zai: yunXingZai, luJing: gen.luJing, keYiBao, banBen: YUN_XING_QING_DAN.version, ziDai: gen.ziDai },
    moXing: { shiBie: shiBieZai, heCheng: heChengZai },
    moXingMing: { shiBie: MO_XING.shiBie.ming, heCheng: MO_XING.heCheng.ming },
    daYueMB: MO_XING.shiBie.daYueMB + MO_XING.heCheng.daYueMB,
    yiXiaMB: yiXiaShaoMB(),
    cuoWu: cuoWuZuiHou || String(ji.cuoWu || ''),
    jinDu: danDian(jinDuZuiHou),
    keXian: MO_XING.shiBie.keXian + ' / ' + MO_XING.heCheng.keXian,
    youTar: true,
  };
}

export async function anZhuangBenDiYuYin(): Promise<{ ok: boolean; error?: string; zhuangTai?: BenDiZhuangTai }> {
  if (anZhuangZhong) return { ok: false, error: 'install-in-progress（正在安装中，请等它结束）' };
  anZhuangZhong = true;
  cuoWuZuiHou = '';
  jinDuZuiHou = { jieduan: 'yunxing', wenjian: '', yiXia: 0, zong: 0, baiFenBi: 0 };
  try {
    fs.mkdirSync(muLuGen(), { recursive: true });
    /** 运行时：自带的能用就不下载（我们仓库/构建产物里已经钉了版本） */
    let gen = yunXingGen();
    if (!keYiBaoFrom(gen.luJing)) {
      for (const t of [YUN_XING_QING_DAN.tarBao, YUN_XING_QING_DAN.pingTaiTarBao]) {
        const dirMing = t === YUN_XING_QING_DAN.tarBao ? YUN_XING_QING_DAN.name : YUN_XING_QING_DAN.pingTai;
        const r = await jieBao(t, dirMing);
        if (!r.ok) return { ok: false, error: '运行环境安装失败：' + (r.error || '') };
      }
      gen = yunXingGen();
    }
    if (!keYiBaoFrom(gen.luJing)) return { ok: false, error: '运行环境装好了但本机加载不了（多半缺 VC++ 运行库）：' + gen.luJing };
    for (const lei of ['shiBie', 'heCheng'] as const) {
      const kai: BenDiJinDu = { jieduan: lei, wenjian: MO_XING[lei].ming, yiXia: 0, zong: MO_XING[lei].daYueMB * 1048576, baiFenBi: 0 };
      jinDuZuiHou = kai;
      try { onJinDu?.(kai); } catch { /* noop */ }
      const r = await xiaZaiMoXing(lei);
      if (!r.ok) { cuoWuZuiHou = r.error || ''; xieJi({ cuoWu: cuoWuZuiHou }); return { ok: false, error: r.error }; }
    }
    xieJi({ buZaiAnZhuang: false, cuoWu: '' });
    cuoWuZuiHou = '';
    anZhuangZhong = false;
    const st = zhuangTaiBenDiYuYin();
    return st.zhuangTai === 'yi_an_zhuang'
      ? { ok: true, zhuangTai: st }
      : { ok: false, error: 'bendi-yuyin-install-incomplete（运行时或模型未安装完整）', zhuangTai: st };
  } catch (e) {
    const x = String((e as Error)?.message || e);
    cuoWuZuiHou = x; xieJi({ cuoWu: x });
    return { ok: false, error: x };
  } finally {
    anZhuangZhong = false;
    jinDuZuiHou = { jieduan: 'wancheng', wenjian: '', yiXia: 0, zong: 0, baiFenBi: 100 };
    try { onJinDu?.(jinDuZuiHou); } catch { /* noop */ }
  }
}

export function shanChuBenDiYuYin(o?: { buZaiAnZhuang?: boolean }): { ok: boolean; error?: string } {
  try {
    shiBieQi = null; heChengQi = null;
    fs.rmSync(muLuGen(), { recursive: true, force: true });
    xieJi({ qiYong: false, buZaiAnZhuang: o?.buZaiAnZhuang !== false });
    cuoWuZuiHou = '';
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}

export function qiYongBenDiYuYin(kai: boolean): { ok: boolean; qiYong: boolean; error?: string } {
  const st = zhuangTaiBenDiYuYin();
  if (kai && st.zhuangTai !== 'yi_an_zhuang') {
    return { ok: false, qiYong: st.qiYong, error: 'bendi-yuyin-not-ready（请先安装完整的本地运行时、ASR 和 TTS 模型）' };
  }
  xieJi({ qiYong: !!kai });
  if (!kai) { shiBieQi = null; heChengQi = null; }
  const qiYong = !!duJi().qiYong;
  return qiYong === !!kai ? { ok: true, qiYong } : { ok: false, qiYong, error: 'bendi-yuyin-settings-write-failed' };
}

function huoYunXing(): Record<string, unknown> | null {
  const gen = yunXingGen();
  if (!gen.luJing) return null;
  try {
    const require2 = createRequire(path.join(gen.luJing, 'package.json'));
    return require2(YUN_XING_QING_DAN.name) as Record<string, unknown>;
  } catch { return null; }
}

/** 临时 wav：sherpa 的 readWave/writeWave 只认路径 */
function linShiWav(lei: string): { lu: string; qing: () => void } {
  const wen = path.join(muLuGen(), 'tmp', 'bendi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + lei + '.wav');
  fs.mkdirSync(path.dirname(wen), { recursive: true });
  return { lu: wen, qing: () => { try { fs.rmSync(wen, { force: true }); } catch { /* noop */ } } };
}

function benDiKeYongCuoWu(ziJian: boolean): string {
  const st = zhuangTaiBenDiYuYin();
  if (!ziJian && !st.qiYong) return 'bendi-yuyin-not-enabled';
  if (!st.yunXing.zai || !st.yunXing.keYiBao) return 'bendi-yuyin-runtime-missing';
  if (!st.moXing.shiBie) return 'bendi-yuyin-no-asr-model';
  if (!st.moXing.heCheng) return 'bendi-yuyin-no-tts-model';
  if (st.zhuangTai !== 'yi_an_zhuang') return 'bendi-yuyin-not-ready';
  return '';
}

export interface BenDiShiBieJieGuo { ok: boolean; text?: string; error?: string; moXing?: string }

/** 只吃 WAV。paraformer 仅中英自动识别，无 language 参数；显式非中英语种必须报限制。
 * ziJian 仅供本地自检，不写用户启用状态。附件/话筒在渲染层现有边界转码。 */
export async function benDiShiBie(buf: Buffer, geShi: string, yuYan?: string, ziJian = false): Promise<BenDiShiBieJieGuo> {
  const shiBai = (error: string): BenDiShiBieJieGuo => ({ ok: false, error });
  const cuo = benDiKeYongCuoWu(ziJian);
  if (cuo) return shiBai(cuo);
  if (yuYan && yuYan !== 'auto' && !/^(zh|en)(?:-|$)/i.test(yuYan)) {
    return shiBai('bendi-yuyin-language-unsupported（本地 paraformer 仅支持中文和英文自动识别，不支持指定语言 ' + yuYan + '）');
  }
  if (String(geShi || '').toLowerCase() !== 'wav') return shiBai('bendi-yuyin-format（本地识别只吃 wav，收到 ' + geShi + '；请先转为 WAV）');
  try {
    const x = huoYunXing();
    if (!x) return shiBai('bendi-yuyin-runtime-missing');
    if (!shiBieQi) {
      const Ctor = x.OfflineRecognizer as new (c: unknown) => unknown;
      shiBieQi = new Ctor({
        modelConfig: {
          paraformer: { model: path.join(muLuMoXing('shiBie'), 'model.int8.onnx') },
          tokens: path.join(muLuMoXing('shiBie'), 'tokens.txt'),
          numThreads: 2, provider: 'cpu', debug: false,
        },
      });
    }
    const rec = shiBieQi as { createStream: () => unknown; decode: (s: unknown) => void; getResult: (s: unknown) => { text?: string } };
    const w = linShiWav('in');
    try {
      fs.writeFileSync(w.lu, buf);
      /**
       * 第二个参数 = 「别让原生侧建 external ArrayBuffer」。Electron 的 V8/N-API **禁止**创建外部缓冲区，
       * 默认 `readWave(p)` 直接抛 `External buffers are not allowed` ⇒ **本机识别从来没成功过一次**，
       * 每次都走链兜底（这正是"语音转文字一直不对/毫无变化"的最底层原因，第 38 轮由端到端门禁抓到）。
       * 系统 node 24 下不会抛，所以只在真机 Electron 里复现 —— 别拿 node 自证。
       */
      const readWave = huoYunXing()?.readWave as ((p: string, waiBu?: boolean) => { samples: Float32Array; sampleRate: number }) | undefined;
      if (!readWave) return shiBai('bendi-yuyin-runtime-missing');
      const wave = readWave(w.lu, false);
      if (!wave || !wave.samples || !wave.samples.length) return shiBai('bendi-yuyin-empty-audio');
      const st = rec.createStream();
      (st as { acceptWaveform: (o: unknown) => void }).acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
      rec.decode(st);
      const jie = rec.getResult(st);
      const wen = String(jie?.text || '').trim();
      if (!wen) return shiBai('bendi-yuyin-empty-result');
      return { ok: true, text: wen, moXing: 'local/' + MO_XING.shiBie.ming };
    } finally { w.qing(); }
  } catch (e) {
    const x = String((e as Error)?.message || e).slice(0, 200);
    cuoWuZuiHou = x;
    return shiBai('bendi-yuyin-asr-failed：' + x);
  }
}

export interface BenDiHeChengJieGuo { ok: boolean; wav?: Buffer; error?: string; moXing?: string; yangShu?: number; sampleRate?: number }

/** 本地合成：返回 wav Buffer；ziJian 仅跳过启用检查，不修改用户选择。 */
export async function benDiHeCheng(text: string, sid = 0, speed = 1, ziJian = false): Promise<BenDiHeChengJieGuo> {
  const cuo = benDiKeYongCuoWu(ziJian);
  if (cuo) return { ok: false, error: cuo };
  const s = String(text || '').trim();
  if (!s) return { ok: false, error: 'empty-text' };
  try {
    const x = huoYunXing();
    if (!x) return { ok: false, error: 'bendi-yuyin-runtime-missing' };
    if (!heChengQi) {
      const Ctor = x.OfflineTts as new (c: unknown) => unknown;
      heChengQi = new Ctor({
        model: {
          vits: {
            model: path.join(muLuMoXing('heCheng'), 'model.onnx'),
            lexicon: path.join(muLuMoXing('heCheng'), 'lexicon.txt'),
            tokens: path.join(muLuMoXing('heCheng'), 'tokens.txt'),
            dictDir: path.join(muLuMoXing('heCheng'), 'dict'),
            noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1.0,
          },
          numThreads: 2, provider: 'cpu', debug: false,
        },
      });
    }
    const tts = heChengQi as {
      generate: (o: { text: string; sid: number; speed: number; enableExternalBuffer?: boolean }) => { samples: Float32Array; sampleRate: number };
      numSpeakers: number; sampleRate: number;
    };
    const zuo = Math.max(0, Math.min(Number(sid) || 0, Math.max(0, (Number(tts.numSpeakers) || 1) - 1)));
    // enableExternalBuffer:false —— 同 readWave，Electron 的 V8 禁止原生侧建外部缓冲区，默认调用必抛。
    const a = tts.generate({ text: s, sid: zuo, speed: Number(speed) > 0 ? Number(speed) : 1, enableExternalBuffer: false });
    if (!a || !a.samples || !a.samples.length) return { ok: false, error: 'bendi-yuyin-empty-audio' };
    const w = linShiWav('out');
    try {
      const writeWave = huoYunXing()?.writeWave as ((p: string, o: unknown) => void) | undefined;
      if (!writeWave) return { ok: false, error: 'bendi-yuyin-runtime-missing' };
      writeWave(w.lu, { samples: a.samples, sampleRate: a.sampleRate });
      return { ok: true, wav: fs.readFileSync(w.lu), moXing: 'local/' + MO_XING.heCheng.ming, yangShu: zuo, sampleRate: a.sampleRate };
    } finally { w.qing(); }
  } catch (e) {
    const x = String((e as Error)?.message || e).slice(0, 200);
    cuoWuZuiHou = x;
    return { ok: false, error: 'bendi-yuyin-tts-failed：' + x };
  }
}

/** 供门禁/界面引用：钉死的清单（别让别处再抄一份版本号） */
export const BEN_DI_QING_DAN = { yunXing: YUN_XING_QING_DAN, moXing: MO_XING };
