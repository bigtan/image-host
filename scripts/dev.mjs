import { createServer, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { createLocalKv } from './local-kv.mjs';
import { createApiMiddleware } from './local-api.mjs';

const env = loadEnv('development', process.cwd(), '');
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000,http://127.0.0.1:3000';
globalThis.IMAGE_HISTORY_KV = createLocalKv(resolve('.local-data/history'));
const server = await createServer({
  server: { host: '127.0.0.1', strictPort: true },
  plugins: [{ name: 'local-functions', configureServer(server) { server.middlewares.use(createApiMiddleware()); } }]
});
await server.listen();
server.printUrls();
console.log('本地 API 已启动；历史记录保存在 .local-data/history，上传使用 .env.local 中的真实 COS 配置。');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
