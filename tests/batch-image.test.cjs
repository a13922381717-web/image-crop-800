const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'batch-image.js'), 'utf8');

// Small deterministic raster contexts test connectivity and alpha handling;
// browser checks separately exercise native Canvas and real encoded files.
function load() {
  const canvases = [];
  class Canvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.storage = null;
      this.ctx = new Context(this);
      canvases.push(this);
    }
    getContext() { return this.ctx; }
    bytes() {
      if (!this.storage || this.storage.length !== this.width * this.height * 4) {
        this.storage = new Uint8ClampedArray(this.width * this.height * 4);
      }
      return this.storage;
    }
    toBlob(callback, mime, quality) {
      this.encoding = { mime, quality };
      if (this.failEncoding) return callback(null);
      callback(new Blob([this.bytes()], { type: this.fallbackEncoding ? 'image/png' : mime }));
    }
  }
  class Context {
    constructor(canvas) {
      this.canvas = canvas;
      this.fillStyle = '#000000';
      this.globalAlpha = 1;
      this.font = '16px sans-serif';
      this.images = [];
      this.texts = [];
      this.stack = [];
    }
    save() { this.stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, font: this.font, clipBox: this.clipBox }); }
    restore() { Object.assign(this, this.stack.pop()); }
    beginPath() {}
    rect(x, y, width, height) { this.pendingClip = { x, y, width, height }; }
    clip() { this.clipBox = this.pendingClip; }
    translate() {}
    rotate() {}
    measureText(text) { return { width: text.length * Number(this.font.match(/[\d.]+(?=px)/)[0]) * 0.6 }; }
    fillText(text, x, y) { this.texts.push({ text, x, y, font: this.font, opacity: this.globalAlpha }); }
    fillRect(x, y, width, height) {
      let hex = this.fillStyle.slice(1);
      if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
      const rgba = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      rgba.push(Math.round(this.globalAlpha * 255));
      for (let row = y; row < y + height; row++) {
        for (let col = x; col < x + width; col++) this.write(col, row, rgba);
      }
    }
    write(x, y, rgba) {
      if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
      const data = this.canvas.bytes();
      const offset = (y * this.canvas.width + x) * 4;
      const alpha = rgba[3] / 255;
      const oldAlpha = data[offset + 3] / 255;
      const resultAlpha = alpha + oldAlpha * (1 - alpha);
      for (let i = 0; i < 3; i++) data[offset + i] = resultAlpha ? (rgba[i] * alpha + data[offset + i] * oldAlpha * (1 - alpha)) / resultAlpha : 0;
      data[offset + 3] = resultAlpha * 255;
    }
    drawImage(img, x, y, width, height) {
      const originalWidth = img.naturalWidth || img.width;
      const originalHeight = img.naturalHeight || img.height;
      width = width == null ? originalWidth : width;
      height = height == null ? originalHeight : height;
      this.images.push({ img, x, y, width, height });
      // Skip rasterization for geometry-only fixtures.
      if (!img.bytes) return;
      const bytes = img.bytes();
      const clip = this.clipBox || { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height };
      const xEnd = Math.min(this.canvas.width, x + width, clip.x + clip.width);
      const yEnd = Math.min(this.canvas.height, y + height, clip.y + clip.height);
      for (let row = Math.max(0, Math.ceil(y), Math.ceil(clip.y)); row < yEnd; row++) {
        for (let col = Math.max(0, Math.ceil(x), Math.ceil(clip.x)); col < xEnd; col++) {
          const sourceX = Math.min(originalWidth - 1, Math.floor((col - x) / width * originalWidth));
          const sourceY = Math.min(originalHeight - 1, Math.floor((row - y) / height * originalHeight));
          const offset = (sourceY * originalWidth + sourceX) * 4;
          this.write(col, row, bytes.slice(offset, offset + 4));
        }
      }
    }
    getImageData() { return { data: new Uint8ClampedArray(this.canvas.bytes()), width: this.canvas.width, height: this.canvas.height }; }
    putImageData(pixels) { this.canvas.storage = new Uint8ClampedArray(pixels.data); }
  }
  const sandbox = { window: {}, Blob, document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } } };
  vm.runInNewContext(source, sandbox, { filename: 'batch-image.js' });
  function asset(width, height, paint) {
    if (!paint) return { img: { naturalWidth: width, naturalHeight: height }, name: '产品.png' };
    const canvas = new Canvas();
    canvas.width = width;
    canvas.height = height;
    paint(canvas.ctx, canvas);
    return { img: canvas, name: '产品.png' };
  }
  return { api: sandbox.window.BatchImage, asset, canvases };
}

function pixel(canvas, x, y) { return Array.from(canvas.bytes().slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)); }

test('portrait, square, and custom dimensions preserve image proportions in fit and crop modes', () => {
  const { api, asset } = load();
  const image = asset(400, 200);
  for (const [tool, options, dimensions] of [
    ['portrait', {}, [900, 1200]], ['png800', {}, [800, 800]],
    ['resize', { width: 320, height: 640 }, [320, 640]]
  ]) {
    for (const mode of ['fit', 'crop']) {
      const canvas = api.render(image, tool, { ...options, mode });
      assert.deepEqual([canvas.width, canvas.height], dimensions);
      const draw = canvas.ctx.images[0];
      assert.equal(draw.width / draw.height, 2);
      assert.equal(draw.x, (canvas.width - draw.width) / 2);
      assert.equal(draw.y, (canvas.height - draw.height) / 2);
      if (mode === 'fit') assert(draw.width <= canvas.width && draw.height <= canvas.height);
      else assert(draw.width >= canvas.width && draw.height >= canvas.height);
    }
  }
});

test('compress only reduces dimensions and keeps transparent pixels', () => {
  const { api, asset } = load();
  assert.deepEqual([api.render(asset(4000, 2000), 'compress', { maxEdge: 1000 }).width, api.render(asset(4000, 2000), 'compress', { maxEdge: 1000 }).height], [1000, 500]);
  const image = asset(4, 2, ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 2); });
  const output = api.render(image, 'compress', { maxEdge: 1000 });
  assert.deepEqual([output.width, output.height], [4, 2]);
  assert.deepEqual(pixel(output, 3, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(output, 0, 0), [255, 0, 0, 255]);
});

test('background replacement affects edge-connected color and preserves an enclosed white detail', () => {
  const { api, asset } = load();
  const image = asset(7, 7, ctx => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 7, 7);
    ctx.fillStyle = '#000000'; ctx.fillRect(1, 1, 5, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(2, 2, 3, 3);
  });
  const transparent = api.render(image, 'background', { sourceColor: '#fff', targetColor: 'transparent', tolerance: 0 });
  assert.equal(pixel(transparent, 0, 0)[3], 0);
  assert.equal(pixel(transparent, 6, 6)[3], 0);
  assert.deepEqual(pixel(transparent, 3, 3), [255, 255, 255, 255]);
  assert.deepEqual(pixel(transparent, 1, 1), [0, 0, 0, 255]);
  const colored = api.render(image, 'background', { sourceColor: '#fff', targetColor: '#f00', tolerance: 0 });
  assert.deepEqual(pixel(colored, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(colored, 3, 3), [255, 255, 255, 255]);
  assert.deepEqual(pixel(image.img, 0, 0), [255, 255, 255, 255], 'source remains unchanged');
});

test('background tolerance is bounded and traversal retains existing alpha', () => {
  const { api, asset } = load();
  const image = asset(3, 1, (ctx, canvas) => {
    canvas.bytes().set([249, 250, 255, 255, 0, 0, 0, 0, 200, 200, 200, 255]);
  });
  const output = api.render(image, 'background', { tolerance: 6, targetColor: '#123456' });
  assert.deepEqual(pixel(output, 0, 0), [18, 52, 86, 255]);
  assert.equal(pixel(output, 1, 0)[3], 0);
  assert.deepEqual(pixel(output, 2, 0), [200, 200, 200, 255]);
  assert.throws(() => api.render(image, 'background', { tolerance: 121 }), /背景容差/);
});

test('watermarks keep source size, accept all positions, and require text', () => {
  const { api, asset } = load();
  for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile']) {
    const canvas = api.render(asset(800, 600), 'watermark', { text: '品牌 Brand', fontSize: 64, opacity: 0.5, color: '#fff', position });
    assert.deepEqual([canvas.width, canvas.height], [800, 600]);
    assert(canvas.ctx.texts.length > 0);
    assert.equal(canvas.ctx.texts[0].opacity, 0.5);
    if (position !== 'tile') {
      assert(canvas.ctx.texts[0].x >= 0 && canvas.ctx.texts[0].y >= 0);
      assert.equal(canvas.ctx.texts.length, 1);
    }
  }
  assert.throws(() => api.render(asset(800, 600), 'watermark', { text: '  ' }), /水印文字/);
  assert.throws(() => api.render(asset(800, 600), 'watermark', { text: 'X', fontSize: 181 }), /水印字号/);
});

test('grid and vertical collage place images in upload order with unchanged proportions', () => {
  const { api, asset } = load();
  const assets = [asset(200, 100), asset(100, 200), asset(100, 100)];
  const grid = api.collage(assets, { layout: 'grid', width: 400, columns: 2, gap: 0 });
  assert.deepEqual([grid.width, grid.height], [400, 400]);
  assert.deepEqual(grid.ctx.images.map(draw => draw.img), assets.map(asset => asset.img));
  assert.deepEqual(grid.ctx.images.map(draw => draw.width / draw.height), [2, 0.5, 1]);
  assert.equal(grid.ctx.images[2].y, 200);
  const vertical = api.collage(assets, { layout: 'vertical', width: 220, gap: 10 });
  assert.deepEqual([vertical.width, vertical.height], [220, 740]);
  assert.deepEqual(vertical.ctx.images.map(draw => draw.y), [10, 120, 530]);
  assert(vertical.ctx.images.every(draw => draw.width === 200));
});

test('invalid dimensions and oversized collages fail before allocating large canvases', () => {
  const { api, asset, canvases } = load();
  const image = asset(20, 20);
  for (const width of [0, -1, NaN, Infinity, 1.5, 8193]) {
    assert.throws(() => api.render(image, 'resize', { width, height: 20 }), /图片宽度/);
  }
  assert.throws(() => api.render(image, 'resize', { width: 4000, height: 4000 }), /1200 万像素/);
  assert.throws(() => api.collage([asset(1, 1000)], { layout: 'vertical', width: 1000, gap: 0 }), /16000/);
  assert.throws(() => api.collage([image, image], { width: 8000, gap: 0 }), /1200 万像素/);
  assert.throws(() => api.collage(Array(21).fill(image)), /20 张/);
  assert.throws(() => api.collage([]), /上传/);
  assert.throws(() => api.collage([image], { width: 20, gap: 80 }), /间距过大/);
  assert.equal(canvases.length, 0);
  assert.throws(() => api.render({ img: { naturalWidth: 0, naturalHeight: 0, width: 100, height: 100 } }, 'portrait'), /尚未加载/);
  assert.throws(() => api.render(image, 'unknown'), /暂不支持/);
  assert.throws(() => api.render(image, 'resize', { background: 'bad' }), /颜色格式/);
});

test('PNG and WebP export preserve transparency; JPEG adds white without changing its source', async () => {
  const { api, asset } = load();
  const canvas = api.render(asset(2, 1, ctx => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 1, 1); }), 'compress');
  for (const mime of ['image/png', 'image/webp', 'image/jpeg']) {
    const blob = await api.encode(canvas, mime, 0.8);
    assert.equal(blob.type, mime);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [255, 0, 0, 255]);
    assert.deepEqual(Array.from(bytes.slice(4, 8)), mime === 'image/jpeg' ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  }
  assert.deepEqual(pixel(canvas, 1, 0), [0, 0, 0, 0]);
  assert.equal(canvas.encoding.quality, 0.8);
});

test('encoder rejects unsupported formats, browser fallbacks, empty output and invalid quality', async () => {
  const { api, asset } = load();
  const canvas = api.render(asset(2, 2), 'compress');
  await assert.rejects(api.encode(canvas, 'image/gif'), /仅支持/);
  await assert.rejects(api.encode(canvas, 'image/png', 1.1), /导出质量/);
  await assert.rejects(api.encode(null, 'image/png'), /先生成/);
  canvas.fallbackEncoding = true;
  await assert.rejects(api.encode(canvas, 'image/webp'), /不支持此导出格式/);
  canvas.failEncoding = true;
  await assert.rejects(api.encode(canvas, 'image/png'), /图片导出失败/);
});
