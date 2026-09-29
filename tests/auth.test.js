import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { onRequestPost as sign } from '../node-functions/api/sign-upload.js';
import { onRequestGet as history } from '../edge-functions/api/upload-history.js';

test('signing and history accept uppercase hashes and reject invalid Unicode tokens', async () => {
  const previous = { ...process.env };
  const oldKv = globalThis.IMAGE_HISTORY_KV;
  globalThis.IMAGE_HISTORY_KV = { put() {}, get() {}, async list() { return { keys: [], complete: true }; } };
  try {
    delete process.env.UPLOAD_TOKEN;
    process.env.UPLOAD_TOKEN_SHA256 = createHash('sha256').update('test-token').digest('hex').toUpperCase();
    const request = (token, method = 'POST') => new Request('https://example.com/api', {
      method, headers: { 'x-upload-token': token }, ...(method === 'POST' ? { body: '{}' } : {})
    });
    // An authenticated but invalid payload reaches validation, rather than returning 401.
    assert.equal((await sign({ request: request('test-token') })).status, 400);
    assert.equal((await history({ request: request('test-token', 'GET'), env: process.env })).status, 200);
    process.env.UPLOAD_TOKEN = 'a';
    delete process.env.UPLOAD_TOKEN_SHA256;
    assert.equal((await sign({ request: request('é') })).status, 401);
    assert.equal((await history({ request: request('é', 'GET'), env: process.env })).status, 401);
  } finally {
    for (const key of ['UPLOAD_TOKEN', 'UPLOAD_TOKEN_SHA256']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    globalThis.IMAGE_HISTORY_KV = oldKv;
  }
});
