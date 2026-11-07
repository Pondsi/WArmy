/**
 * R136+：远程控制（WArmy 互联）——与「同步」复用 SecureMesh 底座，但**独立设备列表与用途**。
 *
 * 产品口径（用户拍板）：
 *  · 远程控制需要 2 台设备都装无限牛马；SSH 是另一条通道（见 ssh-ops.ts）。
 *  · 远程控制有自己的设备列表（独立区块）：
 *      - 「我的设备」：同步设备列表里已配对的同账号设备，天然包含、不可删除、不可修改，只读展示；
 *      - 「其他设备」：可添加——① 其他装了无限牛马的设备（走 SecureMesh）；② 其他 SSH 通道设备（走 remote_ssh）。
 *  · 每个设备 2 个勾选项：① 可被该设备远程控制（默认不勾）；② 信任该设备（免本机同意直接受控）
 *      ——② 只有 ① 勾了才能勾。
 *  · 每个设备显示上次会话方向（我控制了对方 / 我被对方控制）+ 年月日时分。
 *  · 被控端三件套（强制）：强制亮屏 + 水印层（含「对方正在查看屏幕」状态）+ 不可隐藏可拖动停止按钮。
 *  · 停止按钮弹窗：「终止本次远程控制，始终拒绝该设备再次控制本机」——确认 = 断会话 + 永久拒绝。
 *  · 控制端随时退出会话、随时开关「查看对方屏幕」。
 */
import fs from 'node:fs';
import path from 'node:path';

export type RcLeiXing = 'my' | 'wamy' | 'ssh';

export interface RcDevice {
  /** 稳定 id */
  id: string;
  /** 显示名 */
  ming: string;
  /** my=我的设备（同步列表只读）；wamy=其他装了 WArmy 的设备；ssh=SSH 通道设备 */
  leixing: RcLeiXing;
  /** WArmy 设备的握手指纹 */
  zhiWen?: string;
  /** SSH 目标 id（对应 ssh-ops 注册表） */
  sshId?: string;
  /** 可被该设备远程控制（默认 false） */
  keBeiKong: boolean;
  /** 信任该设备（免同意直接受控；只有 keBeiKong 才允许勾） */
  xinRen: boolean;
  /** 上次会话方向：kong=我控制了对方；bei=我被对方控制 */
  lastFangXiang?: 'kong' | 'bei';
  /** 上次会话时间（ms） */
  lastShiJian?: number;
}

export interface RcSession {
  sid: string;
  /** 对方设备 id */
  duiFang: string;
  /** kong=我控制对方；bei=我被对方控制 */
  fangXiang: 'kong' | 'bei';
  kaiShi: number;
  jieShu?: number;
  /** 被控端视角：对方是否在看我的屏幕（水印上要显示） */
  pingMuChaKan: boolean;
}

interface RcZhuangTai {
  devices: RcDevice[];
  /** 被「停止按钮 · 始终拒绝」拉黑的设备 id（永久拒绝，直到用户手动移除） */
  jujue: string[];
  /** 活跃会话（程序重启后未结束的会话按已结束处理） */
  sessions: RcSession[];
}

const QIAN_ZUI = 'rc-';

export class YuanChengKongZhi {
  private readonly file: string;
  private state: RcZhuangTai;

  constructor(userData: string) {
    const dir = path.join(userData, 'remote-control');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'state.json');
    this.state = this.du();
    // 重启后残留的活跃会话一律视为已结束（无法续传），补时间戳落历史
    for (const s of this.state.sessions) {
      if (!s.jieShu) s.jieShu = Date.now();
    }
    this.cun();
  }

  private du(): RcZhuangTai {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<RcZhuangTai>;
      return {
        devices: Array.isArray(j.devices) ? j.devices : [],
        jujue: Array.isArray(j.jujue) ? j.jujue : [],
        sessions: Array.isArray(j.sessions) ? j.sessions : [],
      };
    } catch {
      return { devices: [], jujue: [], sessions: [] };
    }
  }

  private cun() {
    try {
      // 历史会话只留最近 50 条
      const done = this.state.sessions.filter((s) => s.jieShu);
      const active = this.state.sessions.filter((s) => !s.jieShu);
      const hist = done.sort((a, b) => (b.jieShu || 0) - (a.jieShu || 0)).slice(0, 50);
      this.state.sessions = [...active, ...hist];
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch { /* 写失败不阻断 */ }
  }

  // ── 设备列表 ──────────────────────────────────────────────────────────

  /** 全量列表（含 my 只读区） */
  lieBiao(): RcDevice[] {
    return [...this.state.devices];
  }

  /** 拒绝名单 */
  jujueLieBiao(): string[] {
    return [...this.state.jujue];
  }

  /**
   * 同步设备 → 「我的设备」区（只读镜像）。
   * 宿主每次渲染前调用：同账号已配对设备天然出现、不可删改；消失的自动移除镜像。
   */
  tongBuMySheBei(list: Array<{ id: string; ming: string; zhiWen?: string }>): void {
    const myIds = new Set(list.map((x) => x.id));
    // 移除不再存在的 my
    this.state.devices = this.state.devices.filter((d) => d.leixing !== 'my' || myIds.has(d.id));
    for (const x of list) {
      const hit = this.state.devices.find((d) => d.leixing === 'my' && d.id === x.id);
      if (hit) {
        hit.ming = x.ming || hit.ming;
        hit.zhiWen = x.zhiWen || hit.zhiWen;
      } else {
        this.state.devices.push({
          id: x.id, ming: x.ming || x.id, leixing: 'my', zhiWen: x.zhiWen,
          keBeiKong: false, xinRen: false,
        });
      }
    }
    this.cun();
  }

  /** 添加/更新「其他设备」（wamy / ssh）。my 区不可走这里。 */
  baoCunSheBei(input: { id?: string; ming: string; leixing: RcLeiXing; zhiWen?: string; sshId?: string }): { ok: boolean; error?: string; id?: string } {
    if (input.leixing === 'my') return { ok: false, error: 'my-readonly' };
    const ming = String(input.ming || '').trim().slice(0, 60);
    if (!ming) return { ok: false, error: 'name-required' };
    const zhiWen = input.zhiWen ? String(input.zhiWen).trim() : '';
    const sshId = input.sshId ? String(input.sshId).trim() : '';
    if (input.leixing === 'wamy' && !zhiWen) return { ok: false, error: 'fingerprint-required' };
    if (input.leixing === 'ssh' && !sshId) return { ok: false, error: 'ssh-id-required' };
    const id = String(input.id || '').trim() || QIAN_ZUI + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const hit = this.state.devices.find((d) => d.id === id);
    if (hit) {
      if (hit.leixing === 'my') return { ok: false, error: 'my-readonly' };
      hit.ming = ming;
      if (input.leixing === 'wamy') hit.zhiWen = zhiWen;
      if (input.leixing === 'ssh') hit.sshId = sshId;
    } else {
      this.state.devices.push({
        id, ming, leixing: input.leixing,
        ...(zhiWen ? { zhiWen } : {}), ...(sshId ? { sshId } : {}),
        keBeiKong: false, xinRen: false,
      });
    }
    this.cun();
    return { ok: true, id };
  }

  /** 删除「其他设备」。my 区拒绝删除。 */
  shanChuSheBei(id: string): boolean {
    const hit = this.state.devices.find((d) => d.id === id);
    if (!hit || hit.leixing === 'my') return false;
    this.state.devices = this.state.devices.filter((d) => d.id !== id);
    this.cun();
    return true;
  }

  /** 设置两个勾选（xinRen 只有 keBeiKong=true 才允许） */
  sheGouXuan(id: string, keBeiKong?: boolean, xinRen?: boolean): { ok: boolean; error?: string } {
    const hit = this.state.devices.find((d) => d.id === id);
    if (!hit) return { ok: false, error: 'not-found' };
    if (keBeiKong !== undefined) {
      hit.keBeiKong = !!keBeiKong;
      if (!hit.keBeiKong) hit.xinRen = false; // 关掉可被控制 = 一并关信任
    }
    if (xinRen !== undefined) {
      if (xinRen && !hit.keBeiKong) return { ok: false, error: 'need-ke-bei-kong' };
      hit.xinRen = !!xinRen;
    }
    this.cun();
    return { ok: true };
  }

  /** 按指纹找设备（含 my 镜像与 wamy） */
  anZhiWen(zhiWen: string): RcDevice | undefined {
    const z = String(zhiWen || '').toLowerCase();
    if (!z) return undefined;
    return this.state.devices.find((d) => d.zhiWen && d.zhiWen.toLowerCase() === z);
  }

  /** 接收方准入判定（incoming rc-exec / rc-screen-*） */
  zhunRu(zhiWen: string): { ok: boolean; reason?: string; device?: RcDevice; xinRen?: boolean } {
    const d = this.anZhiWen(zhiWen);
    if (!d) return { ok: false, reason: 'unknown-device' };
    if (this.state.jujue.includes(d.id)) return { ok: false, reason: 'permanently-rejected' };
    if (!d.keBeiKong) return { ok: false, reason: 'not-allowed' };
    return { ok: true, device: d, xinRen: d.xinRen };
  }

  // ── 拒绝名单（停止按钮 · 始终拒绝） ────────────────────────────────────

  /** 终止本次 + 始终拒绝该设备再次控制本机 */
  zhongZhiBingJuJue(deviceId: string): boolean {
    const hit = this.state.devices.find((d) => d.id === deviceId);
    if (hit) {
      hit.keBeiKong = false;
      hit.xinRen = false;
    }
    if (!this.state.jujue.includes(deviceId)) this.state.jujue.push(deviceId);
    // 结束该设备方向为 bei 的活跃会话
    for (const s of this.state.sessions) {
      if (!s.jieShu && s.duiFang === deviceId && s.fangXiang === 'bei') s.jieShu = Date.now();
    }
    this.cun();
    return true;
  }

  /** 用户手动解除永久拒绝（设置页用） */
  jieChuJuJue(deviceId: string): boolean {
    const before = this.state.jujue.length;
    this.state.jujue = this.state.jujue.filter((x) => x !== deviceId);
    this.cun();
    return this.state.jujue.length < before;
  }

  // ── 会话 ──────────────────────────────────────────────────────────────

  kaiHuiHua(duiFang: string, fangXiang: 'kong' | 'bei'): RcSession {
    // 同一对方同方向已有活跃会话 → 复用
    const old = this.state.sessions.find((s) => !s.jieShu && s.duiFang === duiFang && s.fangXiang === fangXiang);
    if (old) return old;
    const s: RcSession = {
      sid: QIAN_ZUI + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      duiFang, fangXiang, kaiShi: Date.now(), pingMuChaKan: false,
    };
    this.state.sessions.push(s);
    this.cun();
    return s;
  }

  jieShuHuiHua(sid: string): RcSession | undefined {
    const s = this.state.sessions.find((x) => x.sid === sid && !x.jieShu);
    if (!s) return undefined;
    s.jieShu = Date.now();
    s.pingMuChaKan = false;
    // 记录「上次方向/时间」到设备行
    const d = this.state.devices.find((x) => x.id === s.duiFang);
    if (d) {
      d.lastFangXiang = s.fangXiang;
      d.lastShiJian = s.jieShu;
    }
    this.cun();
    return s;
  }

  /** 活跃会话 */
  huoYueHuiHua(): RcSession[] {
    return this.state.sessions.filter((s) => !s.jieShu);
  }

  /** 被控端：标记对方是否在看我的屏幕（水印显示用） */
  shePingMuChaKan(sid: string, on: boolean): void {
    const s = this.state.sessions.find((x) => x.sid === sid);
    if (s) {
      s.pingMuChaKan = !!on;
      this.cun();
    }
  }

  /** 会话查询 */
  huiHua(sid: string): RcSession | undefined {
    return this.state.sessions.find((x) => x.sid === sid);
  }
}

/** 上次方向/时间的展示文案（年月日时分） */
export function shangCiWenAn(d: RcDevice, shiJianFen: (t: number) => string): string {
  if (!d.lastFangXiang || !d.lastShiJian) return '—';
  return (d.lastFangXiang === 'kong' ? '我控制了对方' : '我被对方控制') + ' · ' + shiJianFen(d.lastShiJian);
}
