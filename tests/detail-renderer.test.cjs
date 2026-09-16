const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'detail-renderer.js'), 'utf8');

// A deterministic measurement context checks layout contracts without a browser
// dependency. Browser smoke tests separately exercise actual Canvas rendering.
function context() {
  const stack = [];
  return {
    font: '16px sans-serif', textAlign: 'left', clipBox: null, pathBox: null,
    texts: [], images: [],
    save() { stack.push({ font: this.font, textAlign: this.textAlign, clipBox: this.clipBox }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() { this.pathBox = null; },
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {},
    rect(x, y, w, h) { this.pathBox = { x, y, w, h }; },
    clip() { if (this.pathBox) this.clipBox = this.pathBox; },
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: Array.from(value).reduce((sum, char) => sum + size * (/\s/.test(char) ? 0.3 : char.charCodeAt(0) > 255 ? 1 : 0.58), 0) };
    },
    fillText(value, x, y) {
      const width = this.measureText(value).width;
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      const left = this.textAlign === 'center' ? x - width / 2 : this.textAlign === 'right' ? x - width : x;
      const box = this.clipBox;
      assert(left >= -0.01 && left + width <= 800.01, 'text stays inside page width');
      assert(y >= -0.01 && y + size <= 1200.01, 'text stays inside page height');
      if (box) {
        assert(left >= box.x - 0.01 && left + width <= box.x + box.w + 0.01, 'text stays inside its text box width');
        assert(y >= box.y - 0.01 && y + size <= box.y + box.h + 0.01, 'text stays inside its text box height');
      }
      this.texts.push(value);
    },
    drawImage(img, x, y, w, h) {
      assert(Math.abs(w / h - img.naturalWidth / img.naturalHeight) < 0.00001, 'image aspect ratio is unchanged');
      assert(x >= 0 && y >= 0 && x + w <= 800.01 && y + h <= 1200.01, 'image stays inside the page');
      this.images.push(img);
    }
  };
}

function load() {
  const canvases = [];
  const sandbox = {
    window: {},
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const ctx = context();
      const canvas = { width: 0, height: 0, ctx, getContext: () => ctx };
      canvases.push(canvas);
      return canvas;
    } }
  };
  vm.runInNewContext(source, sandbox, { filename: 'detail-renderer.js' });
  return { renderer: sandbox.window.DetailRenderer, canvases };
}

test('English titles are available without changing the default Chinese interface', () => {
  const { renderer } = load();
  assert.deepEqual(Array.from(renderer.getPageTitles('en')), ['Product Cover', 'Key Features', 'Product Details', 'Product Views', 'Product Overview']);
  assert.deepEqual(Array.from(renderer.getPageTitles()), ['产品封面', '核心卖点', '细节展示', '多角度展示', '产品总览']);
  assert.deepEqual(Array.from(renderer.pageTitles), Array.from(renderer.getPageTitles('zh')));
  renderer.getPageTitles('en')[0] = 'Changed';
  assert.equal(renderer.getPageTitles('en')[0], 'Product Cover');
});

test('wrapping preserves normal English words and explicit paragraph breaks', () => {
  const { renderer } = load();
  const ctx = context();
  const words = 'Soft cotton fabric with comfortable everyday styling';
  const width = ctx.measureText('comfortable').width + 1;
  const lines = Array.from(renderer.wrapText(ctx, words, width));
  assert(lines.length > 1);
  assert.equal(lines.join(' '), words);
  assert.deepEqual(Array.from(renderer.wrapText(ctx, 'First line\n\nSecond line', 500)), ['First line', '', 'Second line']);
  assert(lines.every(line => ctx.measureText(line).width <= width));
});

test('overlong words split safely and Chinese text still wraps by character', () => {
  const { renderer } = load();
  const ctx = context();
  for (const value of ['SUPERCALIFRAGILISTICEXPIALIDOCIOUS', '细腻织纹与日常穿着细节']) {
    const lines = Array.from(renderer.wrapText(ctx, value, 65));
    assert(lines.length > 1);
    assert.equal(lines.join(''), value);
    assert(lines.every(line => ctx.measureText(line).width <= 65));
  }
});

test('every English template and empty state renders without Chinese labels', () => {
  const { renderer } = load();
  for (let count = 0; count <= 6; count++) {
    const images = Array.from({ length: count }, (_, i) => ({ img: { naturalWidth: 400 + i * 100, naturalHeight: 900 - i * 100 } }));
    for (let index = 0; index < 5; index++) {
      const canvas = renderer.render({ language: 'en', productImages: images, detailImages: images }, index);
      assert.equal(canvas.width, 800);
      assert.equal(canvas.height, 1200);
      assert(canvas.ctx.texts.includes(renderer.getPageTitles('en')[index]));
      assert(!canvas.ctx.texts.some(text => /[\u3400-\u9fff]/.test(text)));
      if (index === 2 || index === 3) assert.equal(canvas.ctx.images.length, count);
    }
  }
});

test('long English copy fits all pages and retains selling points beyond 100 characters', () => {
  const { renderer } = load();
  const point = 'A carefully described product feature with clear wording for your customer and helpful information about the actual product. END_MARKER';
  assert(point.length > 100 && point.length <= 240);
  const base = {
    language: 'en',
    name: 'Everyday comfortable cotton crew neck T shirt with an easy relaxed shape for casual wardrobes and weekend styling',
    subtitle: 'Explore product photos from different angles and take a closer look at the texture, stitching and individual details shown in the uploaded pictures.',
    sellingPoints: [point, point, point, point],
    productImages: Array.from({ length: 6 }, () => ({ img: { naturalWidth: 600, naturalHeight: 800 } }))
  };
  for (const theme of ['ink', 'sand', 'sage']) {
    for (let index = 0; index < 5; index++) {
      const canvas = renderer.render({ ...base, theme }, index);
      assert(canvas.ctx.texts.length > 0);
      if (index === 1) assert.equal(canvas.ctx.texts.filter(text => text.includes('END_MARKER')).length, 4);
      renderer.render({ ...base, theme, name: 'W'.repeat(120), subtitle: 'W'.repeat(180), sellingPoints: Array(4).fill('W'.repeat(240)) }, index);
    }
  }
});
