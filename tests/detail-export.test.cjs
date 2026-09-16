const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'detail-export.js'), 'utf8');
function load(extra = {}) {
  const context = { window: {}, Blob, TextEncoder, DOMException, ...extra };
  vm.runInNewContext(source, context, { filename: 'detail-export.js' });
  return context.window.DetailExport;
}
function missing() { return new DOMException('Missing', 'NotFoundError'); }
const files = () => [
  { name: '01-产品主图.jpg', blob: new Blob(['hello world']) },
  { name: '02-细节🌿.png', blob: new Blob([new Uint8Array([0, 128, 255, 10])]) }
];

test('ZIP stores binary data, UTF-8 names, valid CRC32 and correct central offsets', async () => {
  const input = files();
  const zip = await load().makeZip(input);
  assert.equal(zip.type, 'application/zip');
  const buffer = Buffer.from(await zip.arrayBuffer());
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  assert.equal(buffer.readUInt16LE(end + 8), 2);
  assert.equal(buffer.readUInt16LE(end + 10), 2);
  const centralOffset = buffer.readUInt32LE(end + 16);
  assert.equal(buffer.readUInt32LE(end + 12), end - centralOffset);
  let local = 0;
  let central = centralOffset;
  for (const [index, file] of input.entries()) {
    const bytes = Buffer.from(await file.blob.arrayBuffer());
    const name = Buffer.from(file.name);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    assert.equal(buffer.readUInt16LE(local + 6), 0x0800);
    assert.equal(buffer.readUInt16LE(local + 8), 0);
    assert.equal(buffer.readUInt32LE(local + 18), bytes.length);
    assert.equal(buffer.readUInt32LE(local + 22), bytes.length);
    assert.equal(buffer.readUInt16LE(local + 26), name.length);
    assert.deepEqual(buffer.subarray(local + 30, local + 30 + name.length), name);
    assert.deepEqual(buffer.subarray(local + 30 + name.length, local + 30 + name.length + bytes.length), bytes);
    if (index === 0) assert.equal(buffer.readUInt32LE(local + 14), 0x0d4a1185);
    assert.equal(buffer.readUInt32LE(central), 0x02014b50);
    assert.equal(buffer.readUInt16LE(central + 8), 0x0800);
    assert.equal(buffer.readUInt32LE(central + 16), buffer.readUInt32LE(local + 14));
    assert.equal(buffer.readUInt32LE(central + 42), local);
    assert.deepEqual(buffer.subarray(central + 46, central + 46 + name.length), name);
    local += 30 + name.length + bytes.length;
    central += 46 + name.length;
  }
  assert.equal(local, centralOffset);
  assert.equal(central, end);
});

test('filenames are portable and batches are unique even within one millisecond', () => {
  const exporter = load();
  assert.equal(exporter.safeName('../产品:主图?.jpg '), '-产品-主图-.jpg');
  assert.equal(exporter.safeName('CON.jpg'), '_CON.jpg');
  assert.equal(exporter.safeName(' . '), '详情图');
  assert.equal(exporter.safeName('02-细节🌿.png'), '02-细节🌿.png');
  assert.equal(new Set(Array.from({ length: 100 }, () => exporter.uniqueBatchName('详情图'))).size, 100);
});

test('ZIP rejects missing data and filenames that would collide after sanitizing', async () => {
  const exporter = load();
  await assert.rejects(exporter.makeZip([]), /请先生成/);
  await assert.rejects(exporter.makeZip([{ name: 'a.jpg', blob: null }]), /图片数据/);
  await assert.rejects(exporter.makeZip([
    { name: 'A.jpg', blob: new Blob() }, { name: 'a.jpg', blob: new Blob() }
  ]), /文件名重复/);
  await assert.rejects(exporter.makeZip([
    { name: 'a?.jpg', blob: new Blob() }, { name: 'a*.jpg', blob: new Blob() }
  ]), /文件名重复/);
});

test('canvas conversion uses JPG quality 0.95 and rejects failed/empty encodes', async () => {
  const exporter = load();
  const blob = new Blob(['encoded']);
  for (const mime of ['image/jpeg', 'image/png']) {
    assert.equal(await exporter.toBlob({
      toBlob(callback, actualMime, quality) {
        assert.equal(actualMime, mime);
        assert.equal(quality, 0.95);
        callback(blob);
      }
    }, mime), blob);
  }
  await assert.rejects(exporter.toBlob({ toBlob(callback) { callback(null); } }), /图片导出失败/);
  await assert.rejects(exporter.toBlob({ toBlob(callback) { callback(new Blob()); } }), /图片导出失败/);
  const securityError = new DOMException('Tainted canvas', 'SecurityError');
  await assert.rejects(exporter.toBlob({ toBlob() { throw securityError; } }), error => error === securityError);
});

test('download delays URL revocation and removes the temporary link', () => {
  const calls = [];
  let cleanup;
  const anchor = {
    click() { calls.push(['click', this.download]); },
    remove() { calls.push(['remove']); }
  };
  const exporter = load({
    URL: {
      createObjectURL() { calls.push(['create']); return 'blob:generated'; },
      revokeObjectURL(url) { calls.push(['revoke', url]); }
    },
    document: {
      createElement(tag) { assert.equal(tag, 'a'); return anchor; },
      body: { appendChild(value) { assert.equal(value, anchor); calls.push(['append']); } }
    },
    setTimeout(callback, delay) { assert.ok(delay >= 1000); cleanup = callback; }
  });
  exporter.download(new Blob(['zip']), '详情图.zip');
  assert.deepEqual(calls, [['create'], ['append'], ['click', '详情图.zip'], ['remove']]);
  cleanup();
  assert.deepEqual(calls.at(-1), ['revoke', 'blob:generated']);
});

function mockDirectory({ permission = 'granted', fail, collide = false } = {}) {
  const calls = [];
  let batchName;
  let probed = 0;
  const failure = new DOMException('Operation failed', 'AbortError');
  const handle = {
    async queryPermission(options) { assert.equal(options.mode, 'readwrite'); return permission; },
    async requestPermission() { calls.push('requestPermission'); return permission; },
    async getDirectoryHandle(name, options) {
      calls.push(['directory', name, options.create]);
      if (!options.create) {
        if (collide && probed++ === 0) return {};
        throw missing();
      }
      batchName = name;
      return {
        async getFileHandle(filename, options) {
          calls.push(['file', filename, options.create]);
          if (!options.create) throw missing();
          return {
            async createWritable() {
              calls.push(['createWritable', filename]);
              if (fail === 'createWritable') throw failure;
              return {
                async write(blob) { calls.push(['write', filename, blob]); if (fail === 'write') throw failure; },
                async close() { calls.push(['close', filename]); if (fail === 'close') throw failure; },
                async abort() { calls.push(['abort', filename]); throw new Error('Abort also failed'); }
              };
            }
          };
        }
      };
    }
  };
  return { handle, calls, failure, get batchName() { return batchName; } };
}

test('directory saving uses a fresh batch folder and reports completed writes', async () => {
  const directory = mockDirectory({ collide: true });
  const progress = [];
  const result = await load().saveToDirectory(directory.handle, files(), event => progress.push({ ...event }), '春季详情');
  assert.equal(result, directory.batchName);
  assert.match(result, /^春季详情-\d{8}-\d{6}-\d{3}-[a-z0-9]+$/);
  assert.deepEqual(progress, [{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
  const probes = directory.calls.filter(call => call[0] === 'directory');
  assert.equal(probes.length, 3);
  assert.notEqual(probes[0][1], probes[1][1]);
  assert.equal(probes[1][1], probes[2][1]);
  assert.equal(directory.calls.filter(call => call[0] === 'close').length, 2);
  assert.equal(directory.calls.filter(call => call[0] === 'abort').length, 0);
});

test('denied permissions stop before creating a directory', async () => {
  const directory = mockDirectory({ permission: 'denied' });
  await assert.rejects(load().saveToDirectory(directory.handle, files()), error => error.name === 'NotAllowedError');
  assert.deepEqual(directory.calls, ['requestPermission']);
});

for (const fail of ['write', 'close', 'createWritable']) {
  test(`${fail} failures preserve the error and abort an open writable`, async () => {
    const directory = mockDirectory({ fail });
    const progress = [];
    await assert.rejects(load().saveToDirectory(directory.handle, files(), event => progress.push({ ...event })), error => error === directory.failure);
    assert.equal(directory.calls.filter(call => call[0] === 'abort').length, fail === 'createWritable' ? 0 : 1);
    assert.equal(directory.calls.filter(call => call[0] === 'createWritable').length, 1);
    assert.deepEqual(progress, [{ done: 0, total: 2 }]);
  });
}

test('an unexpected existing file is never opened for writing', async () => {
  const calls = [];
  const handle = {
    async getDirectoryHandle(name, options) {
      if (!options.create) throw missing();
      return { async getFileHandle(filename, options) { calls.push(options.create); return {}; } };
    }
  };
  await assert.rejects(load().saveToDirectory(handle, files()), /避免覆盖/);
  assert.deepEqual(calls, [false]);
});
