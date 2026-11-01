import { BrowserWindow } from 'electron';

export async function yinPinZhuanWav(buf: Buffer): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decode = async () => {
      await win.loadURL('about:blank');
      const b64 = await win.webContents.executeJavaScript(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(buf.toString('base64'))}), c => c.charCodeAt(0));
        const ctx = new OfflineAudioContext(1, 16000, 16000);
        const audio = await ctx.decodeAudioData(bytes.buffer);
        const channels = Array.from({length: audio.numberOfChannels}, (_, i) => audio.getChannelData(i));
        const out = new Uint8Array(44 + audio.length * 2);
        const view = new DataView(out.buffer);
        const text = (offset, value) => { for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i); };
        text(0, 'RIFF'); view.setUint32(4, out.length - 8, true); text(8, 'WAVE');
        text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, out.length - 44, true);
        for (let i = 0; i < audio.length; i++) {
          const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
          view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        }
        let binary = '';
        for (let i = 0; i < out.length; i += 32768) binary += String.fromCharCode(...out.subarray(i, i + 32768));
        return btoa(binary);
      })()`);
      return Buffer.from(String(b64), 'base64');
    };
    return await Promise.race([
      decode(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('audio-decode-timeout')), 30000); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
