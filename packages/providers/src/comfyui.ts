/**
 * ComfyUI 本地生成客户端（W11/第 122 轮追加）
 *
 * 只做三件事：健康检查、读取可用模型、跑**已实测**的两套工作流：
 *  · 文生图（SD1.5 系列 checkpoint）
 *  · 文/图生视频（SVD img2video：没有输入图时先生成一张）
 *
 * 口径：
 *  · 不猜模型名 —— 一律从 `/object_info` 读取真实列表再匹配；
 *  · 不把"提交成功"当"生成成功" —— 轮询 `/history` 并校验产物魔数；
 *  · 失败如实返回机器可读原因（server-down / no-checkpoint / timeout / aborted / bad-output）。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ComfyUiXuanXiang {
  baseUrl?: string;
  /** 单次请求超时（提交/查询/下载） */
  timeoutMs?: number;
  /** 生成总超时：图片默认 180s，视频默认 600s */
  imageTimeoutMs?: number;
  videoTimeoutMs?: number;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ShengChengJieGuo {
  ok: boolean;
  filePath?: string;
  bytes?: number;
  width?: number;
  height?: number;
  checkpoint?: string;
  pipeline?: 'txt2img' | 'img2video';
  error?: string;
}

const MO_REN_BASE = 'http://127.0.0.1:8188';

function anQuanWenJianMing(s: string): string {
  return String(s || 'out').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'out';
}

function duPngKuanGao(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

export class ComfyUiKeHu {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly imageTimeoutMs: number;
  private readonly videoTimeoutMs: number;
  private readonly pollMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ComfyUiXuanXiang = {}) {
    this.base = String(opts.baseUrl || MO_REN_BASE).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.imageTimeoutMs = opts.imageTimeoutMs ?? 180_000;
    this.videoTimeoutMs = opts.videoTimeoutMs ?? 600_000;
    this.pollMs = opts.pollMs ?? 1000;
    this.fetchImpl = opts.fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async json(pathname: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    const r = await this.fetchImpl(this.base + pathname, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const t = await r.text();
    if (!r.ok) throw new Error(`http-${r.status}:${t.slice(0, 200)}`);
    try {
      return JSON.parse(t);
    } catch {
      throw new Error('bad-json');
    }
  }

  async zhuangTai(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const j = (await this.json('/system_stats')) as { system?: { comfyui_version?: string } };
      return { ok: true, ...(j?.system?.comfyui_version ? { version: j.system.comfyui_version } : {}) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** 读真实可用 checkpoint（区分图像/视频/音频用途） */
  async lieCheckpoint(): Promise<{ all: string[]; image: string[]; svd: string[] }> {
    const oi = (await this.json('/object_info')) as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
    };
    const all = oi?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    const svd = all.filter((x) => /svd/i.test(x));
    const image = all.filter((x) => !/svd|ltx|hunyuan|ace[_-]?step|wan|audio/i.test(x));
    return { all, image, svd };
  }

  private async tiJiao(workflow: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const j = (await this.json('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    })) as { prompt_id?: string; error?: unknown; node_errors?: unknown };
    if (!j?.prompt_id) throw new Error('queue-rejected:' + JSON.stringify(j?.error || j?.node_errors || {}).slice(0, 300));
    return j;
  }

  private async dengDai(promptId: string, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    for (;;) {
      if (signal?.aborted) throw new Error('aborted');
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, this.pollMs));
      const h = (await this.json('/history/' + encodeURIComponent(promptId))) as Record<string, { status?: { status_str?: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
      const e = h?.[promptId];
      if (!e) continue;
      if (e.status?.status_str === 'error') throw new Error('execution-error');
      if (e.outputs && Object.keys(e.outputs).length) return e as Record<string, unknown>;
    }
  }

  private async xiaZai(imgs: Array<{ filename: string; subfolder?: string; type?: string }>, muBiaoMulu: string): Promise<{ filePath: string; bytes: number }> {
    const it = imgs[0];
    if (!it?.filename) throw new Error('no-output');
    const q = new URLSearchParams({ filename: it.filename, subfolder: it.subfolder || '', type: it.type || 'output' });
    const r = await this.fetchImpl(this.base + '/view?' + q.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error('download-' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('empty-output');
    fs.mkdirSync(muBiaoMulu, { recursive: true });
    const ext = path.extname(it.filename) || '.bin';
    const filePath = path.join(muBiaoMulu, `${Date.now().toString(36)}-${anQuanWenJianMing(path.basename(it.filename, ext))}${ext}`);
    fs.writeFileSync(filePath, buf);
    return { filePath, bytes: buf.length };
  }

  /** 文生图；muBiaoMulu 必填（由调用方决定写会话工作区） */
  async shengTu(p: {
    prompt: string;
    negative?: string;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    checkpoint?: string;
    muBiaoMulu: string;
    signal?: AbortSignal;
  }): Promise<ShengChengJieGuo> {
    try {
      const lie = await this.lieCheckpoint();
      const ck = p.checkpoint || lie.image.find((x) => /majicmix|sd1[._-]?5|sd15/i.test(x)) || lie.image[0];
      if (!ck) return { ok: false, error: 'no-image-checkpoint' };
      const w = Math.max(64, Math.min(2048, Number(p.width) || 512));
      const h = Math.max(64, Math.min(2048, Number(p.height) || 512));
      const steps = Math.max(1, Math.min(80, Number(p.steps) || 20));
      const wf = {
        '3': { class_type: 'KSampler', inputs: { seed: Number(p.seed) || 122, steps, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ck } },
        '5': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: String(p.prompt || 'a photo'), clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: String(p.negative || 'blurry, low quality'), clip: ['4', 1] } },
        '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
        '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'warmy_img', images: ['8', 0] } },
      };
      const q = await this.tiJiao(wf, this.timeoutMs);
      const e = await this.dengDai(String(q.prompt_id), this.imageTimeoutMs, p.signal);
      const imgs = (e as { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }).outputs?.['9']?.images || [];
      const got = await this.xiaZai(imgs, p.muBiaoMulu);
      const dim = duPngKuanGao(fs.readFileSync(got.filePath));
      return { ok: true, filePath: got.filePath, bytes: got.bytes, checkpoint: ck, pipeline: 'txt2img', ...(dim ? { width: dim.width, height: dim.height } : {}) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async shangChuanTu(pian: string): Promise<string> {
    const bytes = fs.readFileSync(pian);
    const fd = new FormData();
    fd.append('image', new Blob([bytes], { type: /\.png$/i.test(pian) ? 'image/png' : 'image/jpeg' }), anQuanWenJianMing(path.basename(pian)));
    fd.append('overwrite', 'true');
    const r = await this.fetchImpl(this.base + '/upload/image', { method: 'POST', body: fd, signal: AbortSignal.timeout(this.timeoutMs) });
    const j = (await r.json()) as { name?: string; subfolder?: string };
    if (!r.ok || !j?.name) throw new Error('upload-failed');
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  /** 图生视频（SVD）；没给 imagePath 就先生成一张图。 */
  async shengShiPin(p: {
    prompt: string;
    imagePath?: string;
    width?: number;
    height?: number;
    frames?: number;
    fps?: number;
    seed?: number;
    muBiaoMulu: string;
    signal?: AbortSignal;
  }): Promise<ShengChengJieGuo> {
    let shangChuan: string;
    let tuLu: string | null = null;
    try {
      if (p.imagePath && fs.existsSync(p.imagePath)) {
        shangChuan = await this.shangChuanTu(p.imagePath);
      } else {
        const tu = await this.shengTu({ prompt: p.prompt, muBiaoMulu: p.muBiaoMulu, width: p.width, height: p.height, signal: p.signal });
        if (!tu.ok || !tu.filePath) return { ok: false, error: 'image-stage-failed:' + (tu.error || 'unknown') };
        tuLu = tu.filePath;
        shangChuan = await this.shangChuanTu(tu.filePath);
      }
      const lie = await this.lieCheckpoint();
      const svd = lie.svd[0];
      if (!svd) return { ok: false, error: 'no-video-checkpoint' };
      const w = Math.max(64, Math.min(1280, Number(p.width) || 512));
      const h = Math.max(64, Math.min(1280, Number(p.height) || 512));
      const frames = Math.max(2, Math.min(25, Number(p.frames) || 14));
      const fps = Math.max(1, Math.min(30, Number(p.fps) || 6));
      const wf = {
        '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: svd } },
        '2': { class_type: 'LoadImage', inputs: { image: shangChuan } },
        '3': { class_type: 'SVD_img2vid_Conditioning', inputs: { clip_vision: ['1', 1], init_image: ['2', 0], vae: ['1', 2], width: w, height: h, video_frames: frames, motion_bucket_id: 127, fps, augmentation_level: 0 } },
        '4': { class_type: 'VideoLinearCFGGuidance', inputs: { model: ['1', 0], min_cfg: 1.0 } },
        '5': { class_type: 'KSampler', inputs: { seed: Number(p.seed) || 122, steps: 20, cfg: 2.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['3', 0], negative: ['3', 1], latent_image: ['3', 2] } },
        '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
        '7': { class_type: 'SaveWEBM', inputs: { images: ['6', 0], filename_prefix: 'warmy_vid', codec: 'vp9', fps, crf: 32 } },
      };
      const q = await this.tiJiao(wf, this.timeoutMs);
      const e = await this.dengDai(String(q.prompt_id), this.videoTimeoutMs, p.signal);
      const imgs = (e as { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }).outputs?.['7']?.images || [];
      const got = await this.xiaZai(imgs, p.muBiaoMulu);
      const head = fs.readFileSync(got.filePath).subarray(0, 4).toString('hex');
      if (head !== '1a45dfa3') return { ok: false, error: 'bad-output:not-webm', filePath: got.filePath };
      return { ok: true, filePath: got.filePath, bytes: got.bytes, checkpoint: svd, pipeline: 'img2video', width: w, height: h };
    } catch (e) {
      return { ok: false, error: (e as Error).message, ...(tuLu ? { filePath: tuLu } : {}) };
    }
  }
}
