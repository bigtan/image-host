import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadQueue } from '../src/uploadQueue.ts';
import { requestJson } from '../src/request.ts';
import { uploadToSignedUrl } from '../src/upload.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('one concurrency cap applies across batches; canceled queued jobs never start', async () => {
  const queue = new UploadQueue(3);
  let active = 0, peak = 0;
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const add = (id: string) => queue.add(id, async signal => {
    started.push(id); active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => { releases.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
    active--;
  });
  ['a', 'b', 'c'].forEach(add);
  await tick();
  ['d', 'e', 'f'].forEach(add);
  queue.cancel('e');
  assert.equal(active, 3);
  queue.cancel('a');
  await tick();
  assert.ok(started.includes('d'));
  while (releases.length) { releases.shift()!(); await tick(); }
  assert.equal(peak, 3);
  assert.deepEqual(started, ['a', 'b', 'c', 'd', 'f']);
});

test('failed jobs release slots and cancelAll stops pending work', async () => {
  const queue = new UploadQueue(1);
  const started: string[] = [];
  queue.add('bad', async () => { throw new Error('network'); });
  queue.add('next', async signal => {
    started.push('next');
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  queue.add('pending', async () => { started.push('pending'); });
  await tick();
  queue.cancelAll();
  await tick();
  assert.deepEqual(started, ['next']);
});

test('JSON requests time out during body consumption and honor cancellation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }) }) as Response;
  try {
    await assert.rejects(requestJson('/api', {}, 10), { name: 'TimeoutError' });
    const controller = new AbortController();
    const pending = requestJson('/api', { signal: controller.signal });
    await tick();
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    const canceled = new AbortController(); canceled.abort();
    await assert.rejects(requestJson('/api', { signal: canceled.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

test('XHR uploads handle timeout, abort, errors and repeated progress', async () => {
  const OriginalXHR = globalThis.XMLHttpRequest;
  let xhr: any;
  class FakeXHR {
    upload: any = {}; status = 200; timeout = 0;
    onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void;
    constructor() { xhr = this; }
    open() {} setRequestHeader() {} send() {}
    abort() { this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXHR as any;
  const sign: any = { providerLabel: 'COS', upload: { method: 'PUT', url: 'https://example.com', headers: {} } };
  const file = new File(['data'], 'test.png', { type: 'image/png' });
  try {
    let pending = uploadToSignedUrl(file, sign, () => {}, undefined, 10);
    assert.equal(xhr.timeout, 10); xhr.ontimeout();
    await assert.rejects(pending, /超时/);
    const controller = new AbortController();
    pending = uploadToSignedUrl(file, sign, () => {}, controller.signal);
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    pending = uploadToSignedUrl(file, sign, () => {});
    xhr.onerror(); await assert.rejects(pending, /网络异常/);
    const progress: number[] = [];
    pending = uploadToSignedUrl(file, sign, p => progress.push(p));
    for (const loaded of [1, 1, 2]) xhr.upload.onprogress({ lengthComputable: true, loaded, total: 100 });
    xhr.onload(); await pending;
    assert.deepEqual(progress, [1, 2]);
  } finally { globalThis.XMLHttpRequest = OriginalXHR; }
});
