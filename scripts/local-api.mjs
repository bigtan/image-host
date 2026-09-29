import * as health from '../node-functions/api/health.js';
import * as sign from '../node-functions/api/sign-upload.js';
import * as history from '../edge-functions/api/upload-history.js';

const routes = { '/api/health': health, '/api/sign-upload': sign, '/api/upload-history': history };
const methods = { GET: 'onRequestGet', POST: 'onRequestPost', OPTIONS: 'onRequestOptions' };

export function createApiMiddleware(env = process.env) {
  return async (req, res, next) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return next();
    const route = routes[path];
    const handler = route?.[methods[req.method]];
    if (!handler) {
      res.writeHead(route ? 405 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: route ? '请求方法不受支持' : '接口不存在' }));
      return;
    }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: '请求体过大' }));
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach(entry => headers.append(key, entry));
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(new URL(req.url, 'http://localhost'), {
        method: req.method, headers, signal: controller.signal,
        ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) })
      });
      const response = await handler({ request, env });
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.destroyed) {
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: '本地 API 请求失败' }));
      }
    } finally { res.off('close', disconnected); }
  };
}
