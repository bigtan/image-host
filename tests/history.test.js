import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet } from '../edge-functions/api/upload-history.js';

test('history retries use one stable key, including concurrent requests', async () => {
  const rows = new Map();
  const oldKv = globalThis.IMAGE_HISTORY_KV;
  globalThis.IMAGE_HISTORY_KV = {
    async put(key, value) { rows.set(key, value); },
    async get(key) { return JSON.parse(rows.get(key)); },
    async list({ prefix }) { return { keys: [...rows.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })), complete: true }; }
  };
  const env = { UPLOAD_TOKEN: 'token' };
  const input = { uploadId: crypto.randomUUID(), uploadedAt: new Date().toISOString(), provider: 'cos', objectKey: 'uploads/test.png', originalUrl: 'https://example.com/test.png', fileName: 'test.png', contentType: 'image/png', fileSize: 123 };
  const save = (body) => onRequestPost({ env, request: new Request('https://example.com/api/upload-history', { method: 'POST', headers: { 'x-upload-token': 'token' }, body: JSON.stringify(body) }) });
  try {
    const responses = await Promise.all([save(input), save(input), save(input)]);
    assert.deepEqual(responses.map(r => r.status), [201, 201, 201]);
    assert.equal(rows.size, 1);
    assert.deepEqual((await responses[0].json()).item, (await responses[1].json()).item);
    await save({ ...input, uploadId: crypto.randomUUID() });
    assert.equal(rows.size, 2);
    assert.equal((await save({ ...input, uploadId: '../bad' })).status, 400);
    assert.equal((await save({ ...input, uploadedAt: 'invalid' })).status, 400);
    const response = await onRequestGet({ env, request: new Request('https://example.com/api/upload-history', { headers: { 'x-upload-token': 'token' } }) });
    assert.equal((await response.json()).items.length, 2);
  } finally { globalThis.IMAGE_HISTORY_KV = oldKv; }
});
