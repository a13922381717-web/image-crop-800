const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repair } = require('../retouch-image.js');
const fixture = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return data;
};
test('background repair removes a mark on a linear gradient without mutating input', async () => {
  const clean = fixture(32, 24, (x, y) => [60 + x * 3, 80 + y * 2, 120, 255]);
  const marked = clean.slice(), area = { x: 8, y: 6, width: 12, height: 10 };
  for (let y = 8; y < 14; y++) for (let x = 10; x < 18; x++) marked.set([255, 0, 0, 255], (y * 32 + x) * 4);
  const before = marked.slice(), patch = await repair(marked, 32, 24, area, { feather: 0 });
  for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
    const at = (y * area.width + x) * 4, expected = ((y + area.y) * 32 + x + area.x) * 4;
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(patch[at + c] - clean[expected + c]) <= 1);
  }
  assert.deepEqual(marked, before);
});
test('clone copies exact texture; transparency is preserved and overlap rejected', async () => {
  const data = fixture(16, 12, (x, y) => [x * 10, y * 15, (x + y) * 5, x === 1 ? 128 : 255]);
  const area = { x: 10, y: 3, width: 4, height: 5 }, source = { x: 0, y: 1 };
  const patch = await repair(data, 16, 12, area, { mode: 'clone', source, feather: 0 });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
    assert.deepEqual(patch.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4), data.slice(((y + 1) * 16 + x) * 4, ((y + 1) * 16 + x + 1) * 4));
  }
  await assert.rejects(repair(data, 16, 12, area, { mode: 'clone', source: { x: 9, y: 3 } }), /重叠/);
});
test('edge repair works with remaining clean borders and rejects a full-image selection', async () => {
  const data = fixture(12, 12, () => [70, 90, 110, 255]);
  for (const area of [{ x: 0, y: 0, width: 4, height: 5 }, { x: 0, y: 8, width: 12, height: 4 }]) {
    const patch = await repair(data, 12, 12, area);
    for (let i = 0; i < patch.length; i += 4) assert.deepEqual([...patch.slice(i, i + 4)], [70, 90, 110, 255]);
  }
  await assert.rejects(repair(data, 12, 12, { x: 0, y: 0, width: 12, height: 12 }), /缩小/);
  await assert.rejects(repair(data, 12, 12, { x: -1, y: 0, width: 2, height: 2 }), /范围/);
});
test('cancellation stops work without returning or applying a partial patch', async () => {
  const controller = new AbortController(), data = fixture(120, 120, () => [30, 40, 50, 255]);
  await assert.rejects(repair(data, 120, 120, { x: 5, y: 5, width: 100, height: 100 }, { signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
});
