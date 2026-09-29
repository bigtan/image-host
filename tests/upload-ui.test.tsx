import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { default: App } = await import('../src/App.tsx');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('dropping files resets the overlay, shares the queue and cancels removed jobs', async () => {
  const original = fetch;
  const originalXHR = globalThis.XMLHttpRequest;
  const requests: any[] = [];
  class FakeXHR {
    upload: any = {}; status = 200; onabort?: () => void; aborted = false;
    constructor() { requests.push(this); }
    open() {} setRequestHeader() {} send() {}
    abort() { this.aborted = true; this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXHR as any;
  globalThis.fetch = async url => String(url) === '/api/health'
    ? json({ maxUploadSize: 10485760, providers: [] })
    : json({ provider: 'cos', providerLabel: 'COS', objectKey: 'test.png', publicUrl: 'https://example.com/test.png', upload: { method: 'PUT', url: 'https://example.com/test.png', headers: {} } });
  localStorage.setItem('image-host.upload-token', 'test-token');
  try {
    const view = render(<App />);
    const dropzone = view.getByRole('button', { name: '选择或拖拽图片上传' });
    const files = Array.from({ length: 5 }, (_, index) => new File(['123'], `${index}.png`, { type: 'image/png' }));
    fireEvent.dragEnter(dropzone, { dataTransfer: { types: ['Files'] } });
    assert.ok(view.container.querySelector('.global-drag-overlay.is-active'));
    fireEvent.drop(dropzone, { dataTransfer: { files: files.slice(0, 3) } });
    assert.equal(view.container.querySelector('.global-drag-overlay.is-active'), null);
    fireEvent.drop(dropzone, { dataTransfer: { files: files.slice(3) } });
    await waitFor(() => assert.equal(requests.length, 3));
    // New batches appear first. Cancel a queued file; it must never upload.
    fireEvent.click(view.getByText('3.png').closest('article')!.querySelector('button')!);
    fireEvent.click(view.getByText('0.png').closest('article')!.querySelector('button')!);
    await waitFor(() => assert.equal(requests.length, 4));
    assert.equal(requests[0].aborted, true);
    cleanup();
    assert.ok(requests.every(request => request.aborted));
  } finally { cleanup(); globalThis.fetch = original; globalThis.XMLHttpRequest = originalXHR; localStorage.clear(); }
});

test('history retries retain upload identity and original token, and failed saves survive clearing', async () => {
  const original = fetch;
  const originalXHR = globalThis.XMLHttpRequest;
  class FakeXHR {
    upload = {}; status = 200; onload?: () => void;
    open() {} setRequestHeader() {} send() { queueMicrotask(() => this.onload?.()); } abort() {}
  }
  globalThis.XMLHttpRequest = FakeXHR as any;
  const saved: { body: any; token: string }[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === '/api/health') return json({ providers: [] });
    if (String(url) === '/api/upload-history') {
      saved.push({ body: JSON.parse(init!.body as string), token: init!.headers!['x-upload-token'] });
      return saved.length === 1 ? json({ error: 'response lost' }, 503) : json({ item: saved.at(-1)!.body }, 201);
    }
    return json({ provider: 'cos', providerLabel: 'COS', objectKey: 'test.png', publicUrl: 'https://example.com/test.png', upload: { method: 'PUT', url: 'https://example.com/test.png', headers: {} } });
  };
  localStorage.setItem('image-host.upload-token', 'original-token');
  try {
    const view = render(<App />);
    fireEvent.drop(view.getByRole('button', { name: '选择或拖拽图片上传' }), { dataTransfer: { files: [new File(['123'], 'retry.png', { type: 'image/png' })] } });
    await waitFor(() => assert.ok(view.queryByRole('button', { name: '重试保存' })));
    fireEvent.click(view.getByRole('button', { name: '清空已保存' }));
    assert.ok(view.queryByText('retry.png'));
    fireEvent.change(view.getByPlaceholderText('令牌将保存至本地'), { target: { value: 'different-token' } });
    fireEvent.click(view.getByRole('button', { name: '重试保存' }));
    await waitFor(() => assert.equal(saved.length, 2));
    assert.deepEqual(saved[0], saved[1]);
    await waitFor(() => assert.equal(view.queryByText('正在保存上传历史…'), null));
    fireEvent.click(view.getByRole('button', { name: '清空已保存' }));
    assert.equal(view.queryByText('retry.png'), null);
  } finally { cleanup(); globalThis.fetch = original; globalThis.XMLHttpRequest = originalXHR; localStorage.clear(); }
});
