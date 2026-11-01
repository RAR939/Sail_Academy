import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkCache } from '../src/world/ChunkCache.ts';

test('evicts least recently used data and releases resources', () => {
  const disposed = []; const cache = new ChunkCache(10);
  const put = (id, bytes) => cache.put(id, id, bytes, (item) => disposed.push(item));
  assert.equal(put('a', 4), true); assert.equal(put('b', 4), true);
  assert.equal(cache.get('a'), 'a'); assert.equal(put('c', 5), true);
  assert.deepEqual(disposed, ['b']); assert.equal(cache.usedBytes, 9);
  cache.clear(); assert.equal(cache.usedBytes, 0);
});

test('preserves pinned resources and rejects admissions atomically', () => {
  const cache = new ChunkCache(10); const disposed = [];
  cache.put('active', 1, 8, () => disposed.push('active')); cache.pin('active');
  assert.equal(cache.put('other', 2, 3, () => {}), false);
  assert.equal(cache.usedBytes, 8); assert.deepEqual(disposed, []);
  assert.throws(() => cache.remove('active'));
  cache.unpin('active'); assert.equal(cache.put('other', 2, 3, () => {}), true);
  assert.deepEqual(disposed, ['active']); assert.equal(cache.usedBytes, 3);
});
