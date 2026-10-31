/**
 * 第 121 轮：技能/插件执行时的**最小副本**。
 *
 * 代码在仓库里是明文（决定 1/C），但配置仍是密文；外部解释器既不该读整仓，
 * 也不该拿到密文配置文件。这里只把「入口 + 清单 + 配置」复制到一个临时目录：
 *   · 入口/清单原样复制（明文代码）；
 *   · 配置用应用内 fs 读取（会解密）后写成临时明文，权限 0600；
 *   · 用完调用 cleanup()，临时目录整棵删除；
 *   · 不复制 node_modules、缓存、其它用户文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ZhiXingFuBenXuanXiang {
  /** 是否把配置一起解密进副本（默认 true；不需要配置的插件可关掉，少暴露一份明文） */
  withConfig?: boolean;
}

export interface ZhiXingFuBen {
  dir: string;
  entry: string;
  config: string;
  files: string[];
  cleanup: () => void;
}

function anQuanMing(ming: string): string {
  return path.basename(String(ming || '')).replace(/[^A-Za-z0-9._-]/g, '_');
}

export function zhunBeiZhiXingFuBen(pluginDir: string, opts: ZhiXingFuBenXuanXiang = {}): ZhiXingFuBen {
  const src = path.resolve(String(pluginDir || ''));
  const manPath = path.join(src, 'plugin.json');
  if (!fs.existsSync(manPath)) throw new Error('plugin.json missing');
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8')) as { entry?: string; configFile?: string };
  const entryName = anQuanMing(String(man.entry || ''));
  if (!entryName || !fs.existsSync(path.join(src, entryName))) throw new Error('plugin entry missing');
  const configName = anQuanMing(String(man.configFile || ''));
  const files: string[] = [];
  const tmp = path.join(os.tmpdir(), `warmy-plugin-run-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const put = (name: string, content: string | Buffer): string => {
    const dest = path.join(tmp, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, content, { mode: 0o600 });
    try { fs.chmodSync(dest, 0o600); } catch { /* Windows 权限尽力而为 */ }
    files.push(name);
    return dest;
  };
  try {
    put('plugin.json', fs.readFileSync(manPath));
    put('package.json', fs.existsSync(path.join(src, 'package.json')) ? fs.readFileSync(path.join(src, 'package.json')) : '{"type":"module"}');
    const entry = put(entryName, fs.readFileSync(path.join(src, entryName)));
    let config = '';
    if (opts.withConfig !== false && configName && fs.existsSync(path.join(src, configName))) {
      /** 应用内 fs 是加密层：这里读出来就是明文配置，仅落在 0600 的临时副本里 */
      config = put(configName, fs.readFileSync(path.join(src, configName)));
    }
    const cleanup = (): void => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ } };
    return { dir: tmp, entry, config, files, cleanup };
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    throw e;
  }
}
