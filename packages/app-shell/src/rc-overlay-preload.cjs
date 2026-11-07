const { contextBridge, ipcRenderer } = require('electron');
// 被控端水印窗专用 preload：停止按钮/弹窗/穿透切换回传。
// 走 send → webContents 'ipc-message'（只在本水印窗有效，不经全局 ipcMain.handle）。
contextBridge.exposeInMainWorld('warmyRc', {
  tingzhi: () => { try { ipcRenderer.send('rc-tingzhi', { yongJiuJuJue: true }); } catch { /* noop */ } },
  jinTingzhi: () => { try { ipcRenderer.send('rc-jin-tingzhi'); } catch { /* noop */ } },
  chuantou: (on) => { try { ipcRenderer.send('rc-chuantou', { on: !!on }); } catch { /* noop */ } },
});
