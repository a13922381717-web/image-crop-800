(function (root) {
  'use strict';

  var MAX_ZIP32 = 0xffffffff;
  var nameCounter = 0;
  var crcTable = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var value = n;
    for (var bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[n] = value >>> 0;
  }

  function safeName(text) {
    var name = String(text == null ? '' : text)
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, '');
    name = Array.from(name).slice(0, 100).join('').replace(/[. ]+$/g, '');
    if (!name) name = '详情图';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return name;
  }

  function uniqueBatchName(name) {
    var now = new Date();
    function pad(value, length) { return String(value).padStart(length || 2, '0'); }
    var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + pad(now.getMilliseconds(), 3);
    var random;
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    } else {
      random = Math.random().toString(36).slice(2, 10);
    }
    nameCounter = (nameCounter + 1) % 0x1000000;
    return safeName(name || '详情图') + '-' + stamp + '-' + random + nameCounter.toString(36);
  }

  function toBlob(canvas, mime) {
    mime = mime || 'image/jpeg';
    return new Promise(function (resolve, reject) {
      if (mime !== 'image/jpeg' && mime !== 'image/png') {
        reject(new TypeError('仅支持 JPG 或 PNG 导出。'));
        return;
      }
      if (!canvas || typeof canvas.toBlob !== 'function') {
        reject(new TypeError('无法读取要导出的画布。'));
        return;
      }
      canvas.toBlob(function (blob) {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error('图片导出失败，请重新生成后再试。'));
      }, mime, 0.95);
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName(filename);
    anchor.hidden = true;
    try {
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      // Give browsers time to start reading large local downloads.
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }
  }

  function checkedFiles(files) {
    if (!Array.isArray(files) || !files.length) throw new TypeError('请先生成需要导出的图片。');
    var names = new Set();
    return files.map(function (file) {
      if (!file || !(file.blob instanceof Blob)) throw new TypeError('导出文件缺少有效的图片数据。');
      var name = safeName(file.name);
      var key = name.toLowerCase();
      if (names.has(key)) throw new Error('导出文件名重复：' + name);
      names.add(key);
      return { name: name, blob: file.blob };
    });
  }

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var index = 0; index < bytes.length; index++) {
      crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDate() {
    var date = new Date();
    var year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  async function makeZip(files) {
    files = checkedFiles(files);
    if (files.length > 65535) throw new RangeError('一次导出的文件过多。');
    var encoder = new TextEncoder();
    var parts = [];
    var directory = [];
    var offset = 0;
    var directorySize = 0;
    var stamp = zipDate();
    for (var index = 0; index < files.length; index++) {
      var file = files[index];
      var name = encoder.encode(file.name);
      if (name.length > 65535 || file.blob.size > MAX_ZIP32) throw new RangeError('导出文件超出 ZIP 大小限制。');
      var bytes = new Uint8Array(await file.blob.arrayBuffer());
      var crc = crc32(bytes);
      var local = new Uint8Array(30 + name.length);
      var localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true); // UTF-8 filenames.
      localView.setUint16(8, 0, true); // Store without compression.
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);

      var central = new Uint8Array(46 + name.length);
      var centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);

      offset += local.length + bytes.length;
      directorySize += central.length;
      if (offset + directorySize + 22 > MAX_ZIP32) throw new RangeError('导出内容超过 4 GB，请分批导出。');
      parts.push(local, file.blob);
      directory.push(central);
    }
    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, directorySize, true);
    endView.setUint32(16, offset, true);
    return new Blob(parts.concat(directory, [end]), { type: 'application/zip' });
  }

  async function verifyPermission(handle) {
    if (typeof handle.queryPermission !== 'function') return;
    var options = { mode: 'readwrite' };
    var permission = await handle.queryPermission(options);
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission(options);
    }
    if (permission !== 'granted') {
      throw new DOMException('未获得文件夹写入权限，请重新选择文件夹或下载 ZIP。', 'NotAllowedError');
    }
  }

  async function createBatchDirectory(handle, name) {
    for (var attempt = 0; attempt < 20; attempt++) {
      var batchName = uniqueBatchName(name);
      try {
        await handle.getDirectoryHandle(batchName, { create: false });
      } catch (error) {
        if (error.name === 'NotFoundError') {
          return { name: batchName, handle: await handle.getDirectoryHandle(batchName, { create: true }) };
        }
        // A file with this name is also a collision; never replace it.
        if (error.name !== 'TypeMismatchError') throw error;
      }
    }
    throw new Error('无法创建新的导出文件夹，请重试。');
  }

  async function saveToDirectory(handle, files, onProgress, name) {
    files = checkedFiles(files);
    if (!handle || typeof handle.getDirectoryHandle !== 'function') throw new TypeError('请先选择保存文件夹。');
    await verifyPermission(handle);
    var batch = await createBatchDirectory(handle, name || '详情图');
    if (onProgress) onProgress({ done: 0, total: files.length });
    for (var index = 0; index < files.length; index++) {
      var file = files[index];
      // Check even inside the fresh batch directory before creating a file.
      var exists = false;
      try {
        await batch.handle.getFileHandle(file.name, { create: false });
        exists = true;
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
      if (exists) throw new Error('文件已经存在，已停止保存以避免覆盖：' + file.name);
      var fileHandle = await batch.handle.getFileHandle(file.name, { create: true });
      var writable;
      try {
        writable = await fileHandle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      } catch (error) {
        if (writable && typeof writable.abort === 'function') {
          try { await writable.abort(); } catch (_) { /* Preserve the original failure. */ }
        }
        throw error;
      }
      if (onProgress) onProgress({ done: index + 1, total: files.length });
    }
    return batch.name;
  }

  root.DetailExport = Object.freeze({
    toBlob: toBlob,
    download: download,
    makeZip: makeZip,
    saveToDirectory: saveToDirectory,
    safeName: safeName,
    uniqueBatchName: uniqueBatchName
  });
})(window);
