import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailUrl } from '../src/thumbnail.ts';

test('thumbnails preserve original and signed links when processing is disabled or unsafe', () => {
  const original = 'https://images.example.com/uploads/test.png';
  assert.equal(thumbnailUrl(original, false), original);
  assert.equal(thumbnailUrl(original, true), original + '?imageMogr2/thumbnail/640x640');
  const signed = original + '?q-signature=abc';
  assert.equal(thumbnailUrl(signed, true), signed);
  assert.equal(thumbnailUrl(original + '#preview', true), original + '?imageMogr2/thumbnail/640x640#preview');
});
