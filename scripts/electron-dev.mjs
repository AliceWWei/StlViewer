/**
 * 开发模式：先启动 Vite 开发服务器，再启动 Electron 加载它，改代码时页面会热更新。
 * 关掉 Electron 窗口时顺便关掉 Vite。不需要额外装 concurrently / wait-on。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // 在 Node 里 require('electron') 返回可执行文件路径

const server = await createServer({ server: { port: 5173 } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`Vite dev server: ${url}`);

// 多余的参数原样传给 Electron，例如 npm run electron:dev -- public/samples/box.stl
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
