/**
 * 第 20 轮 · 自动更新「安装」步骤（以前整块未实现）
 *
 * 安全口径必须成立，否则这就是一条"执行任意文件"的通路：
 *   · 没下载 / 未校验 ⇒ 拒绝；
 *   · 下载后文件被改动（TOCTOU）⇒ 执行前重算哈希，拒绝；
 *   · 不是本平台安装包扩展名 ⇒ 拒绝；
 *   · 文件在下载目录之外 ⇒ 拒绝；
 *   · 全部通过 ⇒ 才回 ok（由主进程交给系统打开）。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-install.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const { Gengxinqi } = await import(pathToFileURL(path.join(GEN, 'packages/app-shell/dist/updater.js')).href);
const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-inst-'));
const xiaZaiMu = path.join(gen, 'updates');
fs.mkdirSync(xiaZaiMu, { recursive: true });
const zhuangTai = path.join(gen, 'update-state.json');
const kuoZhan = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.AppImage';

const zao = (p) => new Gengxinqi({
  currentVersion: '0.1.0',
  downloadDir: xiaZaiMu,
  stateFile: zhuangTai,
  log: () => {},
  ...p,
});
const xieZhuangTai = (dl) => fs.writeFileSync(zhuangTai, JSON.stringify({ version: 1, lastDownload: dl }), 'utf8');
const haXi = (f) => {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(f));
  return h.digest('hex').toLowerCase();
};

console.log('\n自动更新 · 安装步骤');

// 1. 没有已下载构件 ⇒ 拒绝
{
  xieZhuangTai(undefined);
  const r = await zao().install();
  shuo(!r.ok && r.status === 'no-artifact', '没下载过 ⇒ 拒绝安装', JSON.stringify(r));
}

// 2. 下载过但未校验 ⇒ 拒绝
{
  const f = path.join(xiaZaiMu, 'setup' + kuoZhan);
  fs.writeFileSync(f, 'installer-bytes', 'utf8');
  xieZhuangTai({ status: 'downloaded', filePath: f, yiYanZheng: false, sha256: haXi(f), version: '0.2.0' });
  const r = await zao().install();
  shuo(!r.ok && r.status === 'not-verified', '未通过校验 ⇒ 拒绝安装', JSON.stringify(r));
}

// 3. 校验通过且文件没动过 ⇒ 允许
{
  const f = path.join(xiaZaiMu, 'setup' + kuoZhan);
  fs.writeFileSync(f, 'installer-bytes', 'utf8');
  xieZhuangTai({ status: 'downloaded', filePath: f, yiYanZheng: true, sha256: haXi(f), version: '0.2.0' });
  const r = await zao().install();
  shuo(r.ok && r.status === 'installing', '校验通过 ⇒ 允许安装', JSON.stringify(r));
  shuo(r.version === '0.2.0', '带回版本号');
  shuo(path.resolve(r.filePath || '') === path.resolve(f), '返回的是那个被校验过的文件');
}

// 4. **TOCTOU**：校验后文件被替换 ⇒ 执行前重算哈希，拒绝
{
  const f = path.join(xiaZaiMu, 'setup' + kuoZhan);
  fs.writeFileSync(f, 'good-bytes', 'utf8');
  const hao = haXi(f);
  xieZhuangTai({ status: 'downloaded', filePath: f, yiYanZheng: true, sha256: hao, version: '0.2.0' });
  fs.writeFileSync(f, 'EVIL-REPLACED-PAYLOAD', 'utf8');   // 偷换
  const r = await zao().install();
  shuo(!r.ok && r.status === 'checksum-changed',
    '下载后被偷换 ⇒ 重算哈希并拒绝运行（TOCTOU）', JSON.stringify(r));
}

// 5. 不是本平台安装包 ⇒ 拒绝
{
  const f = path.join(xiaZaiMu, 'notes.txt');
  fs.writeFileSync(f, 'hello', 'utf8');
  xieZhuangTai({ status: 'downloaded', filePath: f, yiYanZheng: true, sha256: haXi(f), version: '0.2.0' });
  const r = await zao().install();
  shuo(!r.ok && r.status === 'unsupported-artifact', '非安装包类型 ⇒ 拒绝执行', JSON.stringify(r));
}

// 6. 文件在下载目录之外 ⇒ 拒绝（防路径穿越）
{
  const wai = path.join(gen, 'outside' + kuoZhan);
  fs.writeFileSync(wai, 'x', 'utf8');
  xieZhuangTai({ status: 'downloaded', filePath: wai, yiYanZheng: true, sha256: haXi(wai), version: '0.2.0' });
  const r = await zao().install();
  shuo(!r.ok && r.status === 'no-artifact', '下载目录之外的文件 ⇒ 拒绝', JSON.stringify(r));
}

// 7. 接线：IPC + preload + UI
{
  const main = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
  const pre = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/preload.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  shuo(/'warmy:ziDongGengXinAnZhuang'/.test(main), '主进程注册了安装 IPC');
  shuo(/autoUpdateInstall:/.test(pre), 'preload 暴露了安装通道');
  shuo(/autoUpdateInstall\?\.\(/.test(app), '界面会调用安装');
  shuo(/uiConfirm\(tOr\('update\.install\.confirm'/.test(app), '安装前先问用户（会退出应用）');
  shuo(/if \(kai\)/.test(main) && /install-open-failed/.test(main),
    '安装包打不开时如实报错、**不退出应用**');
  shuo(!/installImplemented:\s*false[\s\S]{0,200}自动安装未实现/.test(main), '不再宣称"自动安装未实现"');
}

try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
