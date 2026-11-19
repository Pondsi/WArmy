// 拟态（拟态）窗口的 preload：只暴露最小必要面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warmyMimic', {
  dragStart: (p) => ipcRenderer.send('warmy:mimicDragStart', p),
  dragMove: (p) => ipcRenderer.send('warmy:mimicDragMove', p),
  dragEnd: () => ipcRenderer.send('warmy:mimicDragEnd'),
  /**
   * 拟态本体矩形（窗口内 CSS 像素）：主进程据此做**命中测试**（见 main 里的 `mimicStartHoverPoll`）。
   * 之所以要上报而不是让渲染层自己判断：Windows 上 `forward:true` 的 hover 事件不可靠
   * （electron #30808/#15376），必须由主进程用屏幕光标坐标来判。
   */
  setBodyRect: (r) => ipcRenderer.send('warmy:mimicBodyRect', r),
  openChat: () => ipcRenderer.send('warmy:mimicOpenChat'),
  onSay: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSay', h); return () => ipcRenderer.removeListener('warmy:mimicSay', h); },
  onDot: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicDot', h); return () => ipcRenderer.removeListener('warmy:mimicDot', h); },
  onSetTi: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicSetTi', h); return () => ipcRenderer.removeListener('warmy:mimicSetTi', h); },
  /** 主进程命中测试的结果：光标是否落在本体上（用来切悬停样式） */
  onHover: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicHover', h); return () => ipcRenderer.removeListener('warmy:mimicHover', h); },
  /** R218：语音互动 —— 录音分片上交 / 查询当前模式 / 播放合成语音 */
  yuYinFenPian: (p) => ipcRenderer.invoke('warmy:mimicYuYinFenPian', p),
  yuYinMoShiQu: () => ipcRenderer.invoke('warmy:mimicYuYinMoShi'),
  onPlay: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicPlay', h); return () => ipcRenderer.removeListener('warmy:mimicPlay', h); },
  onKaPian: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicKaPian', h); return () => ipcRenderer.removeListener('warmy:mimicKaPian', h); },
  zhuoMianTuBiao: () => ipcRenderer.invoke('warmy:zhuoMianTuBiao'),
  onZhuoMianDongHua: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:zhuoMianDongHua', h); return () => ipcRenderer.removeListener('warmy:zhuoMianDongHua', h); },
  /** R259：本体走路/互动阶段（walk/arrive/back/idle） */
  onZouLu: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicZouLu', h); return () => ipcRenderer.removeListener('warmy:mimicZouLu', h); },
  mimicTuBiaoHuDong: (p) => ipcRenderer.invoke('warmy:mimicTuBiaoHuDong', p),
  /** R264：拟态显隐状态（隐藏时不应与桌面图标互动） */
  mimicZhuangTai: () => ipcRenderer.invoke('warmy:mimicZhuangTai'),
  mimicGuDing: (p) => ipcRenderer.invoke('warmy:mimicGuDing', p),
  /** R264 项19：显隐/固定即时广播（隐身瞬间覆盖窗立即停播，不等 5s 轮询） */
  onMimicState: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicState', h); return () => ipcRenderer.removeListener('warmy:mimicState', h); },
  /** R221：精灵图 JSON 读取（帧动画）/ 动作模型列表（外部动作注册） */
  sheetJson: (p) => ipcRenderer.invoke('warmy:mimicSheetJson', p),
  dongZuoLieBiao: () => ipcRenderer.invoke('warmy:mimicDongZuoLieBiao'),
  /** R223 项9：3D 部位触摸上报（AI 决定是否/如何回应）；R228 扩展 kind=tap/hold/stroke */
  moPart: (p) => ipcRenderer.invoke('warmy:mimicMoPart', p),
  /** R228 项3：右键松手且未旋转 → HTML 菜单（开菜单拿状态+文案 / 五项动作分发） */
  caiDanXian: () => ipcRenderer.invoke('warmy:mimicCaiDanXian'),
  caiDanKai: () => ipcRenderer.invoke('warmy:mimicCaiDanKai'),
  caiDanDong: (p) => ipcRenderer.invoke('warmy:mimicCaiDanDong', p),
  /** R218：动作触发与说话口型 */
  onDongZuo: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicDongZuo', h); return () => ipcRenderer.removeListener('warmy:mimicDongZuo', h); },
  /** R260 拟态情绪反馈（valence/arousal 映射出的动作/语气） */
  onQingXu: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicQingXu', h); return () => ipcRenderer.removeListener('warmy:mimicQingXu', h); },
  onKouXing: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicKouXing', h); return () => ipcRenderer.removeListener('warmy:mimicKouXing', h); },
  /** R260：阅读回复/静音同一开关变更（桌面右键静音 ⇄ 聊天窗三点阅读回复）；静音时本体窗立即停声 */
  onAutoReadBian: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('warmy:mimicAutoReadBian', h); return () => ipcRenderer.removeListener('warmy:mimicAutoReadBian', h); },
});
