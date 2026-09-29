import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { default: HistoryPage } = await import('../src/HistoryPage.tsx');
const record = (name: string) => ({ id: name, fileName: name, originalUrl: `https://example.com/${name}`, provider: 'cos', providerLabel: 'COS', objectKey: name, contentType: 'image/png', fileSize: 5, uploadedAt: new Date().toISOString() });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('changing history token immediately removes old records and cursors even when the new token fails', async () => {
  const original = fetch;
  globalThis.fetch = async (_url, init) => init?.headers?.['x-upload-token'] === 'A'
    ? json({ items: [record('old.png')], nextCursor: 'old_cursor' }) : json({ error: 'invalid token' }, 401);
  try {
    const props = { onTokenChange() {}, onNavigateUpload() {} };
    const view = render(<HistoryPage token="A" {...props} />);
    await waitFor(() => assert.ok(view.queryByText('old.png', { selector: 'h2' })));
    assert.ok(view.queryByText('加载更多'));
    view.rerender(<HistoryPage token="B" {...props} />);
    assert.equal(view.queryByText('old.png', { selector: 'h2' }), null);
    assert.equal(view.queryByText('加载更多'), null);
    await waitFor(() => assert.ok(view.queryByText('invalid token')));
    assert.equal(view.queryByText('old.png', { selector: 'h2' }), null);
  } finally { cleanup(); globalThis.fetch = original; }
});

test('late responses from a previous token cannot replace the current history', async () => {
  const original = fetch;
  let release: (response: Response) => void = () => {};
  let previousSignal: AbortSignal | undefined;
  globalThis.fetch = async (_url, init) => {
    if (init?.headers?.['x-upload-token'] === 'A') {
      previousSignal = init.signal;
      return new Promise(resolve => { release = resolve; });
    }
    return json({ items: [record('new.png')], nextCursor: null });
  };
  try {
    const props = { onTokenChange() {}, onNavigateUpload() {} };
    const view = render(<HistoryPage token="A" {...props} />);
    view.rerender(<HistoryPage token="B" {...props} />);
    await waitFor(() => assert.ok(view.queryByText('new.png', { selector: 'h2' })));
    assert.equal(previousSignal?.aborted, true);
    await act(async () => { release(json({ items: [record('stale.png')], nextCursor: 'stale' })); });
    assert.equal(view.queryByText('stale.png', { selector: 'h2' }), null);
    assert.ok(view.queryByText('new.png', { selector: 'h2' }));
  } finally { cleanup(); globalThis.fetch = original; }
});


test('thumbnail failures fall back to the original image', async () => {
  const { default: HistoryThumbnail } = await import('../src/HistoryThumbnail.tsx');
  try {
    const original = 'https://example.com/image.png';
    const view = render(<HistoryThumbnail url={original} alt="preview" enabled />);
    const image = view.getByAltText('preview') as HTMLImageElement;
    assert.ok(image.src.includes('imageMogr2'));
    fireEvent.error(image);
    assert.equal(image.src, original);
    fireEvent.error(image);
    assert.equal(image.src, original);
  } finally { cleanup(); }
});
