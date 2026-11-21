/**
 * R287 P2：IPC 注册＋来源安全闸唯一 owner（自 electron-main.ts 原 11798–11946 区迁出）。
 * 行为保持：主 frame/随包页面/额外页面白名单、data: 辅助窗受限通道、devtools 环境闸、
 * 参数 schema、登录态闸、别名兼容、错误净化与控制台上报，全部与原实现同序同口径。
 * 平台能力（ipcMain/BrowserWindow/审计/认证态）经窄依赖注入；本模块不导入业务域。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本应用渲染页的绝对 file:// 前缀：nm 远程网页（https）拿不到任何主业务通道 */
const IPC_DATA_SCOPE = ['chat', 'knowledge', 'contacts', 'settings', 'account', 'logs'];
/**
 * 敏感通道的参数 schema（第 111 轮）。
 * 只校验**形状/长度/枚举**，不做业务判断；业务判断仍在处理函数里。
 * 这是最小权限的第一层：坏参数在进入主进程业务前就被拒绝，避免“类型混淆当默认值”。
 */
const IPC_SCHEMAS: Record<string, (args: any[]) => string | null> = (() => {
  const str = (v: unknown, max = 4000) => typeof v === 'string' && v.length <= max;
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  const scope = (v: unknown) => Array.isArray(v) && v.length <= 6 && v.every((x) => str(x, 32) && IPC_DATA_SCOPE.includes(String(x)));
  return {
    'warmy:peiZhiDaoChu': (a) => (!a[0] || (obj(a[0])
      && (a[0].encrypt === undefined || typeof a[0].encrypt === 'boolean')
      && (a[0].include === undefined || scope(a[0].include)))) ? null : 'bad-export-options',
    'warmy:peiZhiDaoRu': (a) => (!a[0] || (obj(a[0])
      && (a[0].path === undefined || str(a[0].path, 4096))
      && (a[0].password === undefined || str(a[0].password, 512))
      && (a[0].mnemonic === undefined || str(a[0].mnemonic, 2000))
      && (a[0].include === undefined || scope(a[0].include)))) ? null : 'bad-import-options',
    'warmy:peiZhiXinFeng': (a) => (obj(a[0]) && (a[0].path === undefined || str(a[0].path, 4096))) ? null : 'bad-inspect-options',
    'warmy:gongYingShangMiYaoSheZhi': (a) => (obj(a[0]) && str(a[0].providerId, 200) && str(a[0].apiKey, 10000)) ? null : 'bad-key-payload',
    'warmy:gongYingShangMiYaoHas': (a) => (!a[0] || (obj(a[0]) && (a[0].providerIds === undefined
      || (Array.isArray(a[0].providerIds) && a[0].providerIds.length <= 100 && a[0].providerIds.every((x: unknown) => str(x, 200)))))) ? null : 'bad-key-query',
    'warmy:gongYingShangMiYaoQingChu': (a) => (obj(a[0]) && str(a[0].providerId, 200)) ? null : 'bad-key-clear',
    'warmy:zhengLiWenBen': (a) => (obj(a[0]) && str(a[0].text, 20000) && (a[0].context === undefined || str(a[0].context, 40000))
      && (a[0].requestId === undefined || str(a[0].requestId, 120))) ? null : 'bad-organizer-payload',
    'warmy:zhengLiQuXiao': (a) => (obj(a[0]) && str(a[0].requestId, 120)) ? null : 'bad-organizer-cancel',
    'warmy:dingShiDaoChuSet': (a) => (obj(a[0]) && (a[0].config === undefined || obj(a[0].config))) ? null : 'bad-schedule',
    'warmy:nmYueDu': (a) => (obj(a[0]) && (a[0].path === undefined || str(a[0].path, 4096))
      && (a[0].text === undefined || str(a[0].text, 5_000_000)) && (a[0].password === undefined || str(a[0].password, 512))) ? null : 'bad-nm-read',
    'warmy:daKaiLuJing': (a) => (obj(a[0]) && str(a[0].path, 4096)) ? null : 'bad-open-path',
    'warmy:daKaiWaiBuLianJie': (a) => (str(a[0], 4096) && /^https?:\/\//i.test(String(a[0]))) ? null : 'bad-external-url',
    'warmy:chatEditorAddFiles': (a) => (!a[0] || (obj(a[0]) && (a[0].files === undefined || (Array.isArray(a[0].files) && a[0].files.length <= 50
      && a[0].files.every((f: unknown) => !!f && typeof f === 'object'
        && ((f as { path?: unknown }).path === undefined || str((f as { path?: unknown }).path, 4096))
        && ((f as { name?: unknown }).name === undefined || str((f as { name?: unknown }).name, 512))
        && ((f as { bytes?: unknown }).bytes === undefined || typeof (f as { bytes?: unknown }).bytes === 'number')))))) ? null : 'bad-chat-editor-files',
    'warmy:chatEditorRemoveFile': (a) => (!a[0] || (obj(a[0]) && str(a[0].path, 4096))) ? null : 'bad-chat-editor-remove',
    'warmy:chatEditorAttachGet': (a) => (a[0] === undefined) ? null : 'bad-chat-editor-attach-get',
    'warmy:liaoTianFaSong': (a) => (obj(a[0]) && str(a[0].sessionId, 200) && (a[0].content === undefined || str(a[0].content, 400_000))) ? null : 'bad-chat-send',
    'warmy:huiFuJinXing': (a) => (obj(a[0]) && str(a[0].sessionId, 200) && (a[0].content === undefined || str(a[0].content, 400_000))) ? null : 'bad-progress-save',
    'warmy:liaoTianRiZhiZhuiJia': (a) => (obj(a[0]) && str(a[0].sessionId, 200)
      && (a[0].content === undefined || str(a[0].content, 2_000_000))) ? null : 'bad-log-append',
  };
})();
/** 这些通道在“已有账号且未解锁”时拒绝（首启/登录页需要的通道不在名单里） */
const IPC_LOGIN_REQUIRED = new Set([
  'warmy:peiZhiDaoChu', 'warmy:peiZhiDaoRu', 'warmy:peiZhiXinFeng',
  'warmy:gongYingShangMiYaoSheZhi', 'warmy:gongYingShangMiYaoHas', 'warmy:gongYingShangMiYaoQingChu',
  'warmy:dingShiDaoChuSet', 'warmy:dingShiDaoChuRunNow',
  'warmy:authViewMnemonic', 'warmy:authChangePin',
]);
/** R278 项8：nm 辅助窗（模态/收藏夹弹窗/下载弹窗，data: URL）允许调用的受限通道 */
const NM_FU_ZHU_IPC = new Set([
  'warmy:nmWangYePeiZhiShe', 'warmy:nmWangYePeiZhiDu',
  'warmy:nmShouCangTianJia', 'warmy:nmShouCangDaKai', 'warmy:nmShouCangXinJian',
  'warmy:nmWangYeShuJuGaiLan', 'warmy:nmWangYeShuJuQing',
  'warmy:nmWangYeZhangHaoLieBiao', 'warmy:nmWangYeZhangHaoBaoCun', 'warmy:nmWangYeZhangHaoDaoRu',
  'warmy:nmXiaZaiLieBiao', 'warmy:nmXiaZaiQingKong', 'warmy:nmXiaZaiDaKai', 'warmy:nmXiaZaiXianShi',
]);

export interface IpcAnQuanZhaYiLai {
  /** English -> 拼音 别名表（加载时机由组合根保持原口径） */
  aliases: Record<string, string>;
  /** 主进程 dist 目录（原 __dirname），用于渲染页白名单 */
  genMuLu: string;
  ipcMainHandle: (channel: string, handler: (event: any, ...args: any[]) => any) => void;
  chuangFromWc: (wc: any) => { isDestroyed(): boolean } | null;
  nmShiFuZhuChuang: (wc: any) => boolean;
  authState: () => { hasAccount?: boolean; unlocked?: boolean } | null;
  auditLog: (op: string, detail: unknown) => void;
  fachuKongzhitai: (msg: { cat: 'error' | 'model' | 'tool' | 'system' | 'net'; code: string; data?: Record<string, unknown> }) => void;
  jingHuaCuoWu: (e: unknown) => string;
}

export function chuangJianIpcAnQuanZha(yiLai: IpcAnQuanZhaYiLai) {
  /** 已登记通道（供门禁核对“每个通道都有归属”，不是运行时自动放行名单） */
  const IPC_CHANNELS = new Set<string>();
  function chuliIpc(channel: string, fn: (event: any, ...args: any[]) => any, extraRenderers: string[] = []): void {
    IPC_CHANNELS.add(channel);
    /**
     * 只接受**业务主窗口/独立会话窗/nm 查看器**的**主 frame**：
     *  · sender 必须是带业务 preload（preload.cjs）的 BrowserWindow；
     *  · frame 必须是该 WebContents 的 mainFrame（子 frame / iframe 一律拒绝）；
     *  · 页面只能是随包发布的 renderer/index.html、renderer/nm-viewer.html，
     *    以及**按通道显式放行**的额外页面（extraRenderers，如截图遮罩窗 snip.html）。
     * 旧实现只看 URL 前缀，任何 renderer 目录下的页面（含子 frame）都能打全部 IPC。
     */
    const yunXuLaiYuan = (event: any): boolean => {
      try {
        const wc = event.sender;
        const frame = event.senderFrame;
        if (!wc || !frame) return false;
        if (frame !== wc.mainFrame) return false;
        const u = String(frame.url || '');
        if (!u) return false;
        /* R278 项8：nm 模态/弹出辅助窗是 data: URL——旧白名单只认 file: 页面，
         * 辅助窗里所有 IPC 被拒⇒保存/新建按钮“点了没反应”。这里仅放行受限通道且必须是本进程登记的辅助窗。 */
        if (u.startsWith('data:')) return NM_FU_ZHU_IPC.has(channel) && yiLai.nmShiFuZhuChuang(wc);
        if (u.startsWith('devtools://') && process.env.WARMY_ALLOW_DEVTOOLS_IPC === '1') return true;
        const bw = yiLai.chuangFromWc(wc);
        if (!bw || bw.isDestroyed()) return false;
        const clean = new URL(u);
        clean.hash = '';
        clean.search = '';
        if (clean.protocol !== 'file:') return false;
        const actual = path.resolve(fileURLToPath(clean));
        const rendererDir = path.resolve(path.join(yiLai.genMuLu, 'renderer'));
        if (actual === path.join(rendererDir, 'index.html') || actual === path.join(rendererDir, 'nm-viewer.html')) return true;
        return extraRenderers.some((x) => actual === path.join(rendererDir, x));
      } catch { return false; }
    };
    const guaGou = async (event: any, ...args: any[]) => {
      if (!yunXuLaiYuan(event)) {
        const err = new Error('ipc: forbidden sender');
        console.error('[ipc] ' + channel + ' rejected non-app sender');
        throw err;
      }
      const schema = IPC_SCHEMAS[channel];
      if (schema) {
        const bad = schema(args);
        if (bad) {
          try { yiLai.auditLog('ipc.bad-args', { channel, why: bad }); } catch { /* noop */ }
          throw new Error('ipc: ' + bad);
        }
      }
      if (IPC_LOGIN_REQUIRED.has(channel) && process.env.WARMY_AUTH_BYPASS !== '1') {
        let st: { hasAccount?: boolean; unlocked?: boolean } | null = null;
        try { st = yiLai.authState() ?? null; } catch { st = null; }
        /**
         * 只有“已经有账号但还没解锁”才拒绝。**没有账号**（首启/开发门禁）允许配置供应商等本机设置，
         * 真正需要数据/身份的通道自己会返回 no-account / vault-locked；这里不能把首启直接锁死。
         */
        if (st?.hasAccount === true && st.unlocked !== true) throw new Error('ipc: login required');
      }
      try {
        return await fn(event, ...args);
      } catch (e) {
        console.error('[ipc] ' + channel + ' failed:', e);
        yiLai.fachuKongzhitai({ cat: 'error', code: 'err.ipc', data: { channel, message: yiLai.jingHuaCuoWu(e) } });
        throw new Error(yiLai.jingHuaCuoWu(e));
      }
    };
    try { yiLai.ipcMainHandle(channel, guaGou); } catch { /* already registered */ }
    for (const [yingWen, pinYin] of Object.entries(yiLai.aliases)) {
      if (pinYin === channel && yingWen !== channel) {
        IPC_CHANNELS.add(yingWen);
        try { yiLai.ipcMainHandle(yingWen, guaGou); } catch { /* already */ }
      }
    }
  }
  return { chuliIpc, ipcChannels: IPC_CHANNELS };
}
