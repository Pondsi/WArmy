/**
 * 在 packages/app-shell 里跑 electron-builder 的包装器。
 * 直接 `node node_modules/electron-builder/cli.js --config x` 会把脚本路径当成位置参数
 * （这个版本的 CLI 用 argv.slice(1) 解析）⇒ 这里把 argv 摆正再 require。
 */
process.argv = [process.argv[0], 'electron-builder', '--config', 'electron-builder.yml'];
await import('./node_modules/electron-builder/cli.js');
