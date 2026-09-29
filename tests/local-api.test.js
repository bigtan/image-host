import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalKv } from '../scripts/local-kv.mjs';
import { createApiMiddleware } from '../scripts/local-api.mjs';

test('local API serves health, authenticated history, durable KV pagination and preflight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'image-host-test-'));
  const oldKv = globalThis.IMAGE_HISTORY_KV;
  globalThis.IMAGE_HISTORY_KV = createLocalKv(directory);
  const middleware = createApiMiddleware({ UPLOAD_TOKEN: 'local-token', CORS_ALLOWED_ORIGINS: 'http://localhost:3000' });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-upload-token': 'local-token', origin: 'http://localhost:3000' };
  try {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/upload-history')).status, 401);
    assert.equal((await fetch(base + '/api/upload-history', { method: 'OPTIONS', headers })).status, 204);
    const input = { uploadId: crypto.randomUUID(), uploadedAt: new Date().toISOString(), provider: 'cos', objectKey: 'uploads/local.png', originalUrl: 'https://example.com/local.png', fileName: 'local.png', contentType: 'image/png', fileSize: 3 };
    for (const body of [input, input, { ...input, uploadId: crypto.randomUUID() }]) {
      assert.equal((await fetch(base + '/api/upload-history', { method: 'POST', headers, body: JSON.stringify(body) })).status, 201);
    }
    // Re-create the adapter to verify persistence beyond one instance.
    globalThis.IMAGE_HISTORY_KV = createLocalKv(directory);
    const first = await (await fetch(base + '/api/upload-history?limit=1', { headers })).json();
    assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const second = await (await fetch(base + '/api/upload-history?limit=1&cursor=' + first.nextCursor, { headers })).json();
    assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal((await fetch(base + '/api/missing')).status, 404);
    assert.equal((await fetch(base + '/api/upload-history', { method: 'DELETE' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    globalThis.IMAGE_HISTORY_KV = oldKv;
    await rm(directory, { recursive: true, force: true });
  }
});
