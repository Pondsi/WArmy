/**
 * 社交平台接入向导：配置校验 / 端点推导 / 连通性诊断（#113 / #115）
 *
 * 边界（有意为之）：
 *  - 只做“接入前检查”，不实现各平台消息协议，不持有凭据、不落盘、不重试。
 *  - 只用 Node 内置模块；HTTP 通过注入的 fetchImpl 完成，默认 globalThis.fetch。
 *  - `duanDian()` 返回的 URL 可能含 token/corpsecret，只允许在内存里传给探测函数；
 *    任何要展示或落日志的地方必须用 `anQuanDuanDian()`。
 *  - `ceShiLianTong()` 的 steps / hint 绝不包含 secret/token 全文。
 */
import { lookup } from 'node:dns/promises';

export const SHE_JIAO_PING_TAI = ['feishu', 'dingtalk', 'wecom', 'telegram'] as const;
export type SheJiaoPingTai = (typeof SHE_JIAO_PING_TAI)[number];

export interface FeiShuPeiZhi {
  appId: string;
  appSecret: string;
  /** 默认 https://open.feishu.cn；Lark 国际版可传 https://open.larksuite.com */
  baseUrl?: string;
}

export interface DingTalkPeiZhi {
  clientId: string;
  clientSecret: string;
  /** 默认 https://api.dingtalk.com */
  baseUrl?: string;
}

export interface QiWeiPeiZhi {
  corpId: string;
  corpSecret: string;
  agentId: string | number;
  /** 默认 https://qyapi.weixin.qq.com */
  baseUrl?: string;
}

export interface TelegramPeiZhi {
  botToken: string;
  /** 默认 https://api.telegram.org；自建 Bot API 或回环测试时可覆盖 */
  baseUrl?: string;
}

export type SheJiaoPeiZhi = FeiShuPeiZhi | DingTalkPeiZhi | QiWeiPeiZhi | TelegramPeiZhi;

export const MO_REN_BASE_URL: Record<SheJiaoPingTai, string> = {
  feishu: 'https://open.feishu.cn',
  dingtalk: 'https://api.dingtalk.com',
  wecom: 'https://qyapi.weixin.qq.com',
  telegram: 'https://api.telegram.org',
};

export interface PeiZhiJianChaJieGuo {
  ok: boolean;
  errors: string[];
}

/** 最小 fetch 形状：便于门禁注入回环实现，不绑定 DOM / undici 类型。 */
export interface FetchXiangYing {
  status: number;
  body?: { cancel?: () => Promise<void> } | null;
}

export interface FetchChuShi {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchImpl = (url: string, init?: FetchChuShi) => Promise<FetchXiangYing>;

/** 注入 DNS：返回地址数组/字符串即可；抛错时按错误码归类。 */
export type DnsLookupFn = (
  hostname: string,
) => Promise<readonly string[] | string | undefined> | readonly string[] | string | undefined;

export type LianTongBuZhouMing = 'config' | 'dns' | 'http';

export interface LianTongBuZhou {
  name: LianTongBuZhouMing;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface LianTongJieGuo {
  ok: boolean;
  steps: LianTongBuZhou[];
  hint: string;
}

export interface LianTongXuanXiang {
  /** 默认 globalThis.fetch；门禁注入回环 fetch */
  fetchImpl?: FetchImpl;
  /** 单步超时，默认 8000ms */
  timeoutMs?: number;
  /** 注入时钟，便于确定性计时 */
  now?: () => number;
  /** 注入 DNS；不传则用 node:dns/promises.lookup */
  dnsLookup?: DnsLookupFn;
  /** 跳过 dns 步骤（调用方已保证域名可解析） */
  skipDns?: boolean;
}

const MO_REN_CHAO_SHI_MS = 8000;
const DNS_CHAO_SHI_SHANG_XIAN_MS = 3000;
const JSON_TOU = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'WArmy-SheJiaoWizard/1.0',
};
const GET_TOU = { 'user-agent': 'WArmy-SheJiaoWizard/1.0' };

const TI_SHI = {
  config: '按提示修正配置后重试；密钥只在本机内存中使用，不会写入日志。',
  dns: '检查 baseUrl 域名拼写、DNS 与代理设置；企业网络可能需要放行该域名。',
  timeout: '检查本机网络、代理与防火墙是否放行该域名与端口；必要时稍后重试。',
  credentials: '检查密钥是否填错或过期，并确认应用已开通机器人/消息能力、所需权限与 IP 白名单。',
  params: '检查应用类型与字段是否匹配（如 agentId、corpId 是否属于同一企业）。',
  notFound: '确认 baseUrl 与平台区域域名是否正确（飞书与 Lark 域名不同）。',
  rate: '平台限流，等待几分钟后重试。',
  server: '平台侧暂时异常，稍后重试；持续失败请查看平台开放状态页。',
  redirect: '检查 baseUrl 是否指向正确的开放平台域名。',
  proxy: '检查系统代理设置与代理凭据。',
  tls: '检查系统时间、代理或企业网关的 TLS 证书；自签证书需要先被系统信任。',
  generic: '核对平台应用配置与网络策略后重试。',
  runtime: '请升级 Node 或注入 fetchImpl 后重试。',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   脱敏
   ══════════════════════════════════════════════════════════════════════════ */

/** 只显示前 2 后 2；长度 ≤ 4 一律 ••••。 */
export function yanMo(miYao: string): string {
  const s = typeof miYao === 'string' ? miYao : String(miYao ?? '');
  if (!s) return '••••';
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '••••' + s.slice(-2);
}

/**
 * 把文本里出现的密钥、URL 里的 bot token、corpsecret 等替换成掩码。
 * 用于所有可能被展示/落日志的诊断文本。
 */
function tuoMin(text: unknown, miYaoLieBiao: readonly string[]): string {
  let out = String(text ?? '');
  const lieBiao = [...new Set(miYaoLieBiao.filter((s) => typeof s === 'string' && s.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  for (const s of lieBiao) out = out.split(s).join(yanMo(s));
  out = out.replace(/\/bot[^/?#\s]*/gi, '/bot••••');
  out = out.replace(
    /([?&](?:corpsecret|access_token|token|secret|app_secret|client_secret)=)[^&#\s]*/gi,
    '$1••••',
  );
  out = out.replace(
    /("(?:app_secret|client_secret|corpsecret|appSecret|clientSecret|corpSecret|botToken)"\s*:\s*")[^"]*(")/gi,
    '$1••••$2',
  );
  return out;
}

/** 展示用端点：去掉 URL 里的 token / corpsecret。 */
export function anQuanDuanDian(url: string): string {
  return tuoMin(String(url ?? ''), []);
}

/* ══════════════════════════════════════════════════════════════════════════
   配置校验
   ══════════════════════════════════════════════════════════════════════════ */

function shiPingTai(v: unknown): v is SheJiaoPingTai {
  return typeof v === 'string' && (SHE_JIAO_PING_TAI as readonly string[]).includes(v);
}

function quZiDuan(cfg: unknown, name: string): unknown {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return undefined;
  return (cfg as Record<string, unknown>)[name];
}

function wenBen(cfg: unknown, name: string): string {
  const v = quZiDuan(cfg, name);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function shiHuiHuan(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** 返回错误文案或 null；错误文案里不回显 baseUrl（可能含 userinfo）。 */
function jianChaBaseUrl(raw: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'baseUrl 不是合法 URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'baseUrl 只支持 http(s)';
  if (u.username || u.password) return 'baseUrl 不能包含用户名或密码';
  if (u.search || u.hash) return 'baseUrl 不能带查询串或片段';
  if (u.protocol === 'http:' && !shiHuiHuan(u.hostname)) {
    return 'baseUrl 必须使用 https（本机回环调试除外）';
  }
  return null;
}

function jianChaBiaoShi(errors: string[], label: string, value: string, maxLen = 128): void {
  if (!value) {
    errors.push(`${label} 不能为空`);
    return;
  }
  if (value.length > maxLen) {
    errors.push(`${label} 过长（最多 ${maxLen} 字符）`);
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    errors.push(`${label} 含非法字符（只允许字母、数字、. _ -）`);
  }
}

function jianChaMiYao(errors: string[], label: string, raw: string): void {
  if (!raw || !raw.trim()) {
    errors.push(`${label} 不能为空`);
    return;
  }
  if (raw !== raw.trim() || /\s/.test(raw)) {
    errors.push(`${label} 含空白字符（${yanMo(raw)}）`);
  }
  if (raw.length > 512) {
    errors.push(`${label} 过长（最多 512 字符，当前 ${raw.length} 字符）`);
  }
}

export function jianChaPeiZhi(
  platform: SheJiaoPingTai,
  cfg: SheJiaoPeiZhi | Record<string, unknown> | null | undefined,
): PeiZhiJianChaJieGuo {
  if (!shiPingTai(platform)) {
    return { ok: false, errors: ['未知平台，仅支持 feishu / dingtalk / wecom / telegram'] };
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, errors: ['配置对象为空'] };
  }

  const errors: string[] = [];
  const rawBase = quZiDuan(cfg, 'baseUrl');
  if (rawBase !== undefined && rawBase !== null && typeof rawBase !== 'string') {
    errors.push('baseUrl 必须是字符串');
  } else {
    const baseErr = jianChaBaseUrl(wenBen(cfg, 'baseUrl').trim());
    if (baseErr) errors.push(baseErr);
  }

  switch (platform) {
    case 'feishu': {
      jianChaBiaoShi(errors, 'appId', wenBen(cfg, 'appId').trim());
      jianChaMiYao(errors, 'appSecret', wenBen(cfg, 'appSecret'));
      break;
    }
    case 'dingtalk': {
      jianChaBiaoShi(errors, 'clientId', wenBen(cfg, 'clientId').trim());
      jianChaMiYao(errors, 'clientSecret', wenBen(cfg, 'clientSecret'));
      break;
    }
    case 'wecom': {
      // 兼容界面的旧字段名：botId/appSecret 就是 corpId/corpSecret
      const corpId = wenBen(cfg, 'corpId') || wenBen(cfg, 'botId') || wenBen(cfg, 'clientId');
      const corpSecret = wenBen(cfg, 'corpSecret') || wenBen(cfg, 'appSecret') || wenBen(cfg, 'clientSecret');
      jianChaBiaoShi(errors, 'corpId', corpId.trim());
      jianChaMiYao(errors, 'corpSecret', corpSecret);
      const agentId = wenBen(cfg, 'agentId').trim();
      if (!agentId) {
        errors.push('agentId 不能为空，且必须是正整数');
      } else if (!/^[1-9]\d{0,11}$/.test(agentId)) {
        errors.push('agentId 必须是正整数（最多 12 位，不能为 0）');
      }
      break;
    }
    case 'telegram': {
      const raw = wenBen(cfg, 'botToken');
      const token = raw.trim();
      if (!token) {
        errors.push('botToken 不能为空');
      } else if (raw !== token) {
        errors.push(`botToken 首尾含空白字符（${yanMo(token)}）`);
      } else {
        const i = token.indexOf(':');
        if (i <= 0) {
          errors.push(`botToken 格式应为 <botId>:<token>（当前 ${yanMo(token)}）`);
        } else {
          const id = token.slice(0, i);
          const rest = token.slice(i + 1);
          if (!/^\d{1,20}$/.test(id)) {
            errors.push(`botToken 冒号前应为数字 botId（当前 ${yanMo(token)}）`);
          }
          if (!/^[A-Za-z0-9_-]+$/.test(rest)) {
            errors.push(`botToken 冒号后含非法字符（当前 ${yanMo(token)}）`);
          } else if (rest.length > 200) {
            errors.push('botToken 冒号后过长（最多 200 字符）');
          }
          if (token.length > 256) errors.push('botToken 过长（最多 256 字符）');
        }
      }
      break;
    }
    default:
      break;
  }

  return { ok: errors.length === 0, errors };
}

/* ══════════════════════════════════════════════════════════════════════════
   端点推导（URL 可能含 token，只走内存）
   ══════════════════════════════════════════════════════════════════════════ */

interface QingQiuMiaoShu {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

function jiDi(platform: SheJiaoPingTai, cfg: unknown): string {
  const raw = wenBen(cfg, 'baseUrl').trim();
  const base = raw || MO_REN_BASE_URL[platform];
  return base.replace(/\/+$/, '');
}

function gouZaoQingQiu(platform: SheJiaoPingTai, cfg: unknown): QingQiuMiaoShu {
  const base = jiDi(platform, cfg);
  switch (platform) {
    case 'feishu': {
      const appId = wenBen(cfg, 'appId').trim();
      const appSecret = wenBen(cfg, 'appSecret').trim();
      if (!appId || !appSecret) throw new Error('飞书配置缺少 appId 或 appSecret，无法探测');
      return {
        url: `${base}/open-apis/auth/v3/tenant_access_token/internal`,
        method: 'POST',
        headers: { ...JSON_TOU },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      };
    }
    case 'dingtalk': {
      const clientId = wenBen(cfg, 'clientId').trim();
      const clientSecret = wenBen(cfg, 'clientSecret').trim();
      if (!clientId || !clientSecret) throw new Error('钉钉配置缺少 clientId 或 clientSecret，无法探测');
      return {
        url: `${base}/v1.0/oauth2/accessToken`,
        method: 'POST',
        headers: { ...JSON_TOU },
        body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
      };
    }
    case 'wecom': {
      const corpId = wenBen(cfg, 'corpId') || wenBen(cfg, 'botId') || wenBen(cfg, 'clientId');
      const corpSecret = wenBen(cfg, 'corpSecret') || wenBen(cfg, 'appSecret') || wenBen(cfg, 'clientSecret');
      if (!corpId || !corpSecret) throw new Error('企微配置缺少 corpId 或 corpSecret，无法探测');
      return {
        url:
          `${base}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}` +
          `&corpsecret=${encodeURIComponent(corpSecret)}`,
        method: 'GET',
        headers: { ...GET_TOU },
      };
    }
    case 'telegram': {
      const botToken = wenBen(cfg, 'botToken').trim();
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
        throw new Error('botToken 格式不正确，无法推导端点');
      }
      return {
        url: `${base}/bot${botToken}/getMe`,
        method: 'GET',
        headers: { ...GET_TOU },
      };
    }
    default:
      throw new Error('未知平台，无法推导端点');
  }
}

/** 返回要探测的 URL。可能含 token/corpsecret，展示请先过 anQuanDuanDian()。 */
export function duanDian(
  platform: SheJiaoPingTai,
  cfg: SheJiaoPeiZhi | Record<string, unknown>,
): string {
  if (!shiPingTai(platform)) throw new Error('未知平台，无法推导端点');
  return gouZaoQingQiu(platform, cfg).url;
}

/* ══════════════════════════════════════════════════════════════════════════
   连通性诊断
   ══════════════════════════════════════════════════════════════════════════ */

interface DengDaiJieGuo<T> {
  lei: 'ok' | 'timeout' | 'cuo';
  zhi?: T;
  e?: unknown;
}

/** Promise + 超时赛跑；fetch 不响应 signal 时也能按时返回。 */
async function dengDai<T>(
  p: Promise<T>,
  ms: number,
  chaoShiShi?: () => void,
): Promise<DengDaiJieGuo<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shiJian = new Promise<DengDaiJieGuo<T>>((resolve) => {
    timer = setTimeout(() => {
      // 先让“超时”赢下赛跑，再中止底层请求；否则 abort 的 rejection 可能抢跑，
      // 把超时误报成 AbortError。
      resolve({ lei: 'timeout' });
      queueMicrotask(() => {
        try {
          chaoShiShi?.();
        } catch {
          /* noop */
        }
      });
    }, ms);
  });
  const renWu = p.then(
    (zhi): DengDaiJieGuo<T> => ({ lei: 'ok', zhi }),
    (e): DengDaiJieGuo<T> => ({ lei: 'cuo', e }),
  );
  try {
    return await Promise.race([renWu, shiJian]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function zhengShu(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.round(n));
}

function guiFanChaoShi(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.max(1, Math.floor(v));
  return MO_REN_CHAO_SHI_MS;
}

function cuoWuXiaoXi(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 从 Error / cause / AggregateError / message 里挖错误码。 */
function cuoWuMa(e: unknown): string {
  const yiKan = new Set<unknown>();
  let cur: unknown = e;
  while (cur && (typeof cur === 'object' || typeof cur === 'function') && !yiKan.has(cur)) {
    yiKan.add(cur);
    const o = cur as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof o.code === 'string' && o.code) return o.code;
    if (typeof o.code === 'number' && Number.isFinite(o.code)) return String(o.code);
    if (Array.isArray(o.errors)) {
      for (const x of o.errors) {
        const c = cuoWuMa(x);
        if (c) return c;
      }
    }
    cur = o.cause;
  }
  const m = cuoWuXiaoXi(e).match(
    /\b(ENOTFOUND|ENODATA|EAI_AGAIN|EAI_NONAME|EAI_TIMEOUT|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH)\b/,
  );
  return m && m[1] ? m[1] : '';
}

function fenLeiDns(e: unknown): { detail: string; hint: string } {
  const code = cuoWuMa(e);
  if (code === 'ETIMEDOUT' || code === 'EAI_TIMEOUT') {
    return { detail: `DNS 查询超时（${code}）`, hint: TI_SHI.dns };
  }
  if (code === 'EAI_AGAIN') {
    return { detail: `DNS 暂时不可用（${code}）`, hint: TI_SHI.dns };
  }
  if (code) return { detail: `域名解析失败（${code}）`, hint: TI_SHI.dns };
  return { detail: '域名解析失败（未返回地址）', hint: TI_SHI.dns };
}

function fenLeiWangLuo(e: unknown): { detail: string; hint: string } {
  const code = cuoWuMa(e);
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return { detail: `TLS 证书校验失败（${code}）`, hint: TI_SHI.tls };
  }
  switch (code) {
    case 'ENOTFOUND':
    case 'ENODATA':
    case 'EAI_NONAME':
      return { detail: `域名解析失败（${code}）`, hint: TI_SHI.dns };
    case 'EAI_AGAIN':
      return { detail: `DNS 暂时不可用（${code}）`, hint: TI_SHI.dns };
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return { detail: `连接超时（${code}）`, hint: TI_SHI.timeout };
    case 'ECONNREFUSED':
      return { detail: `连接被拒绝（${code}）`, hint: TI_SHI.generic };
    case 'ECONNRESET':
      return { detail: `连接被重置（${code}）`, hint: TI_SHI.generic };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { detail: `网络不可达（${code}）`, hint: TI_SHI.generic };
    case 'AbortError':
      return { detail: '请求被中止（AbortError）', hint: TI_SHI.timeout };
    default:
      break;
  }
  const xiaoXi = cuoWuXiaoXi(e).replace(/\s+/g, ' ').slice(0, 160);
  return {
    detail: xiaoXi ? `网络错误（${code || '未知'}）：${xiaoXi}` : `网络错误（${code || '未知'}）`,
    hint: TI_SHI.generic,
  };
}

function fenLeiHttp(status: number): { ok: boolean; detail: string; hint: string } {
  if (status >= 200 && status < 300) {
    return { ok: true, detail: `HTTP ${status}，端点可达`, hint: '' };
  }
  if (status === 400) return { ok: false, detail: '请求参数被拒（HTTP 400）', hint: TI_SHI.params };
  if (status === 401 || status === 403) {
    return { ok: false, detail: `凭据被拒（HTTP ${status}）`, hint: TI_SHI.credentials };
  }
  if (status === 404) return { ok: false, detail: '端点不存在（HTTP 404）', hint: TI_SHI.notFound };
  if (status === 405) {
    return { ok: false, detail: '请求方法不被允许（HTTP 405）', hint: TI_SHI.params };
  }
  if (status === 407) return { ok: false, detail: '代理要求认证（HTTP 407）', hint: TI_SHI.proxy };
  if (status === 408) return { ok: false, detail: '请求超时（HTTP 408）', hint: TI_SHI.timeout };
  if (status === 429) return { ok: false, detail: '请求过于频繁（HTTP 429）', hint: TI_SHI.rate };
  if (status >= 500) {
    return { ok: false, detail: `平台服务端错误（HTTP ${status}）`, hint: TI_SHI.server };
  }
  if (status >= 300 && status < 400) {
    return { ok: false, detail: `端点返回重定向（HTTP ${status}）`, hint: TI_SHI.redirect };
  }
  return { ok: false, detail: `请求失败（HTTP ${status}）`, hint: TI_SHI.generic };
}

function miYaoLieBiao(platform: SheJiaoPingTai, cfg: unknown): string[] {
  switch (platform) {
    case 'feishu':
      return [wenBen(cfg, 'appSecret')];
    case 'dingtalk':
      return [wenBen(cfg, 'clientSecret')];
    case 'wecom':
      return [wenBen(cfg, 'corpSecret')];
    case 'telegram':
      return [wenBen(cfg, 'botToken')];
    default:
      return [];
  }
}

function chengGongTiShi(platform: SheJiaoPingTai): string {
  switch (platform) {
    case 'feishu':
      return '端点连通。下一步：在飞书开发者后台开通机器人能力、配置事件订阅（长连接）并发布应用版本。';
    case 'dingtalk':
      return '端点连通。下一步：在钉钉开放平台开启 Stream 模式，并配置机器人可见范围。';
    case 'wecom':
      return '端点连通。下一步：在企业微信后台配置可信 IP、接收消息服务器与机器人权限。';
    case 'telegram':
      return '端点连通。下一步：给机器人发送 /start，确认能正常收发消息。';
    default:
      return '端点连通。';
  }
}

/**
 * 分步诊断：config → dns → http。
 * 2xx 只代表端点可达（连通），业务返回码仍由接入向导下一步校验。
 */
export async function ceShiLianTong(
  platform: SheJiaoPingTai,
  cfg: SheJiaoPeiZhi | Record<string, unknown> | null | undefined,
  opts: LianTongXuanXiang = {},
): Promise<LianTongJieGuo> {
  const xuanXiang: LianTongXuanXiang = opts ?? {};
  const now = typeof xuanXiang.now === 'function' ? xuanXiang.now : () => Date.now();
  const miYao = miYaoLieBiao(platform, cfg);
  const steps: LianTongBuZhou[] = [];

  const configKaiShi = now();
  const jianCha = jianChaPeiZhi(platform, cfg);
  steps.push({
    name: 'config',
    ok: jianCha.ok,
    ms: zhengShu(now() - configKaiShi),
    detail: jianCha.ok ? '必填项与格式检查通过' : tuoMin(jianCha.errors.join('；'), miYao),
  });
  if (!jianCha.ok) return { ok: false, steps, hint: TI_SHI.config };

  let qingQiu: QingQiuMiaoShu;
  try {
    qingQiu = gouZaoQingQiu(platform, cfg);
  } catch (e) {
    steps.push({
      name: 'http',
      ok: false,
      ms: 0,
      detail: tuoMin('端点推导失败：' + cuoWuXiaoXi(e), miYao),
    });
    return { ok: false, steps, hint: TI_SHI.config };
  }

  let zhuJi = '';
  try {
    zhuJi = new URL(qingQiu.url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    zhuJi = '';
  }
  if (!zhuJi) {
    steps.push({ name: 'dns', ok: false, ms: 0, detail: '端点 URL 缺少主机名' });
    return { ok: false, steps, hint: TI_SHI.dns };
  }

  const chaoShiMs = guiFanChaoShi(xuanXiang.timeoutMs);
  const dnsChaoShi = Math.min(chaoShiMs, DNS_CHAO_SHI_SHANG_XIAN_MS);

  if (xuanXiang.skipDns) {
    steps.push({ name: 'dns', ok: true, ms: 0, detail: '已跳过（调用方声明 DNS 可用）' });
  } else {
    const dnsKaiShi = now();
    const dnsRenWu = Promise.resolve().then(() => {
      if (xuanXiang.dnsLookup) return xuanXiang.dnsLookup(zhuJi);
      return lookup(zhuJi, { all: true, verbatim: true }).then((list) => list.map((x) => x.address));
    });
    const dnsJieGuo = await dengDai(dnsRenWu, dnsChaoShi);
    const dnsMs = zhengShu(now() - dnsKaiShi);

    if (dnsJieGuo.lei === 'timeout') {
      steps.push({
        name: 'dns',
        ok: false,
        ms: dnsMs,
        detail: `DNS 查询超时（>${dnsChaoShi}ms）`,
      });
      return { ok: false, steps, hint: TI_SHI.dns };
    }
    if (dnsJieGuo.lei === 'cuo') {
      const info = fenLeiDns(dnsJieGuo.e);
      steps.push({ name: 'dns', ok: false, ms: dnsMs, detail: tuoMin(info.detail, miYao) });
      return { ok: false, steps, hint: info.hint };
    }
    const zhi = dnsJieGuo.zhi;
    const shu = Array.isArray(zhi) ? zhi.length : zhi ? 1 : 0;
    if (!shu) {
      steps.push({ name: 'dns', ok: false, ms: dnsMs, detail: '域名解析失败（未返回地址）' });
      return { ok: false, steps, hint: TI_SHI.dns };
    }
    steps.push({ name: 'dns', ok: true, ms: dnsMs, detail: `解析成功（${shu} 个地址）` });
  }

  const fetchImpl = xuanXiang.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== 'function') {
    steps.push({
      name: 'http',
      ok: false,
      ms: 0,
      detail: '当前运行环境没有可用的 fetch，请注入 fetchImpl',
    });
    return { ok: false, steps, hint: TI_SHI.runtime };
  }

  const httpKaiShi = now();
  const kongZhi = new AbortController();
  const httpRenWu = Promise.resolve().then(() => {
    const init: FetchChuShi = {
      method: qingQiu.method,
      headers: qingQiu.headers,
      signal: kongZhi.signal,
    };
    if (qingQiu.body !== undefined) init.body = qingQiu.body;
    return fetchImpl(qingQiu.url, init);
  });
  const httpJieGuo = await dengDai(httpRenWu, chaoShiMs, () => kongZhi.abort());
  const httpMs = zhengShu(now() - httpKaiShi);

  if (httpJieGuo.lei === 'timeout') {
    steps.push({ name: 'http', ok: false, ms: httpMs, detail: `请求超时（>${chaoShiMs}ms）` });
    return { ok: false, steps, hint: TI_SHI.timeout };
  }
  if (httpJieGuo.lei === 'cuo') {
    const info = fenLeiWangLuo(httpJieGuo.e);
    steps.push({ name: 'http', ok: false, ms: httpMs, detail: tuoMin(info.detail, miYao) });
    return { ok: false, steps, hint: info.hint };
  }

  const xiangYing = httpJieGuo.zhi;
  const status = Number(xiangYing && xiangYing.status);
  try {
    if (xiangYing && xiangYing.body && typeof xiangYing.body.cancel === 'function') {
      void xiangYing.body.cancel().catch(() => {});
    }
  } catch {
    /* noop */
  }

  if (!Number.isFinite(status) || status <= 0) {
    steps.push({ name: 'http', ok: false, ms: httpMs, detail: '响应无效（缺少 HTTP 状态码）' });
    return { ok: false, steps, hint: TI_SHI.generic };
  }

  const fenLei = fenLeiHttp(status);
  steps.push({ name: 'http', ok: fenLei.ok, ms: httpMs, detail: fenLei.detail });
  return fenLei.ok
    ? { ok: true, steps, hint: chengGongTiShi(platform) }
    : { ok: false, steps, hint: fenLei.hint };
}
