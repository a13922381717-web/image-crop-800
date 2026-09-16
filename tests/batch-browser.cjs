const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Exercise the generated files, rather than trusting labels or canvas attributes.
function parseZip(bytes) {
  const files = [];
  let cursor = 0;
  while (cursor + 30 <= bytes.length && bytes.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(cursor + 8), 0, 'The built-in ZIP writer uses stored entries');
    const length = bytes.readUInt32LE(cursor + 18);
    const nameLength = bytes.readUInt16LE(cursor + 26);
    const extraLength = bytes.readUInt16LE(cursor + 28);
    const start = cursor + 30 + nameLength + extraLength;
    assert.ok(start + length <= bytes.length, 'ZIP entries must not be truncated');
    files.push({ name: bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString('utf8'), bytes: bytes.subarray(start, start + length) });
    cursor = start + length;
  }
  assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, 'ZIP must contain a central directory');
  assert.equal(new Set(files.map(file => file.name)).size, files.length, 'ZIP names must be unique');
  return files;
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new Error('Downloaded file is neither PNG, JPEG nor WebP');
}

async function imageInfo(page, bytes) {
  const type = imageMime(bytes);
  return page.evaluate(async ({ bytes, type }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, blueMinX = canvas.width, blueMaxX = -1, blueMinY = canvas.height, blueMaxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++;
      if (data[i] < 20 && data[i + 1] < 30 && data[i + 2] > 220 && data[i + 3] > 245) {
        const index = i / 4, x = index % canvas.width, y = Math.floor(index / canvas.width);
        blueMinX = Math.min(blueMinX, x); blueMaxX = Math.max(blueMaxX, x);
        blueMinY = Math.min(blueMinY, y); blueMaxY = Math.max(blueMaxY, y);
      }
    }
    return { mime: type, width: canvas.width, height: canvas.height, transparent,
      corner: [...ctx.getImageData(0, 0, 1, 1).data],
      center: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data],
      blueWidth: blueMaxX >= 0 ? blueMaxX - blueMinX + 1 : 0,
      blueHeight: blueMaxY >= 0 ? blueMaxY - blueMinY + 1 : 0 };
  }, { bytes: [...bytes], type });
}

async function downloadFile(page, selector, artifacts, name) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await pending;
  const destination = path.join(artifacts, name || download.suggestedFilename());
  await download.saveAs(destination);
  return { bytes: await fs.readFile(destination), filename: download.suggestedFilename() };
}

(async () => {
  const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'image-crop-batch-'));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
  try {
    await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    const fixtures = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0000ff'; ctx.fillRect(150, 50, 100, 100);
      ctx.fillStyle = '#ef4030'; ctx.fillRect(50, 70, 60, 60);
      const transparent = canvas.toDataURL('image/png').split(',')[1];
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 200);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(150, 50, 100, 100);
      ctx.fillStyle = '#fff'; ctx.fillRect(185, 85, 30, 30);
      return { transparent, white: canvas.toDataURL('image/png').split(',')[1] };
    });
    const fixture = (key, name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(fixtures[key], 'base64') });

    assert.equal(await page.evaluate(() => typeof window.StudioNavigation?.select), 'function');
    const engine = await page.evaluate(async fixtures => {
      const load = async encoded => {
        const img = new Image(); img.src = 'data:image/png;base64,' + encoded; await img.decode();
        return { img, name: 'fixture.png' };
      };
      const transparent = await load(fixtures.transparent), white = await load(fixtures.white);
      const encode = async (canvas, mime = 'image/png') => [...new Uint8Array(await (await BatchImage.encode(canvas, mime, 0.9)).arrayBuffer())];
      const png = BatchImage.render(transparent, 'png800', { mode: 'fit', background: 'transparent' });
      const changed = BatchImage.render(transparent, 'watermark', { text: 'MY SHOP', color: '#000000', fontSize: 36, position: 'center', opacity: 1 });
      const source = document.createElement('canvas'); source.width = 400; source.height = 200;
      source.getContext('2d').drawImage(transparent.img, 0, 0);
      const before = source.getContext('2d').getImageData(0, 0, 400, 200).data;
      const after = changed.getContext('2d').getImageData(0, 0, 400, 200).data;
      let changedPixels = 0;
      for (let i = 0; i < before.length; i += 4) if (before.slice(i, i + 4).some((value, n) => value !== after[i + n])) changedPixels++;
      return {
        png: await encode(png), jpeg: await encode(png, 'image/jpeg'),
        background: await encode(BatchImage.render(white, 'background', { sourceColor: '#ffffff', targetColor: 'transparent', tolerance: 8 })),
        recolored: await encode(BatchImage.render(white, 'background', { sourceColor: '#ffffff', targetColor: '#ff0000', tolerance: 8 })),
        compressed: await encode(BatchImage.render(transparent, 'compress', { maxEdge: 160 })),
        unscaled: await encode(BatchImage.render(transparent, 'compress', { maxEdge: 1600 })),
        vertical: await encode(BatchImage.collage([transparent, white], { layout: 'vertical', width: 420, gap: 10, background: '#ffffff' })),
        changedPixels, watermarkSize: [changed.width, changed.height]
      };
    }, fixtures);
    const pngInfo = await imageInfo(page, Buffer.from(engine.png));
    assert.deepEqual([pngInfo.width, pngInfo.height], [800, 800]);
    assert.ok(pngInfo.transparent > 0, 'PNG conversion must retain transparency');
    assert.equal(pngInfo.blueWidth, pngInfo.blueHeight, 'Fit must preserve the square fixture without stretching');
    const jpegInfo = await imageInfo(page, Buffer.from(engine.jpeg));
    assert.equal(jpegInfo.mime, 'image/jpeg'); assert.equal(jpegInfo.transparent, 0);
    assert.deepEqual(jpegInfo.corner, [255, 255, 255, 255], 'JPG must flatten transparent padding to white');
    const removed = await imageInfo(page, Buffer.from(engine.background));
    assert.equal(removed.corner[3], 0, 'Edge-connected white becomes transparent');
    assert.deepEqual(removed.center, [255, 255, 255, 255], 'Enclosed white product areas remain intact');
    const recolored = await imageInfo(page, Buffer.from(engine.recolored));
    assert.deepEqual(recolored.corner, [255, 0, 0, 255]);
    assert.deepEqual(recolored.center, [255, 255, 255, 255]);
    for (const [key, width, height] of [['compressed', 160, 80], ['unscaled', 400, 200], ['vertical', 420, 430]]) {
      const info = await imageInfo(page, Buffer.from(engine[key]));
      assert.deepEqual([info.width, info.height], [width, height]);
    }
    assert.ok(engine.changedPixels > 100, 'Watermark must change actual output pixels');
    assert.deepEqual(engine.watermarkSize, [400, 200]);
    await fs.writeFile(path.join(artifacts, 'transparent.png'), Buffer.from(engine.png));
    await fs.writeFile(path.join(artifacts, 'edge-background.png'), Buffer.from(engine.background));

    const choose = async tool => {
      const button = page.locator(`[data-tool="${tool}"]`);
      if (!(await button.isVisible())) await page.click('#studioMenuToggle');
      await button.click();
      assert.equal(await page.evaluate(() => StudioNavigation.current()), tool);
    };
    const generate = async () => { await page.click('#batchGenerate'); await page.waitForFunction(() => !BatchWorkbench.isBusy() && !document.getElementById('batchZip').disabled); };
    const firstImage = async () => { const file = await downloadFile(page, '#batchResults [data-action="download"]', artifacts); return imageInfo(page, file.bytes); };
    await choose('portrait');
    await page.locator('#batchFiles').setInputFiles([fixture('transparent', '产品.png'), fixture('white', '产品.png')]);
    await page.waitForFunction(() => !BatchWorkbench.isBusy() && document.querySelectorAll('#batchAssets img').length === 2);
    await generate();
    let zip = await downloadFile(page, '#batchZip', artifacts, 'portrait.zip');
    let files = parseZip(zip.bytes); assert.equal(files.length, 2);
    for (const file of files) { const info = await imageInfo(page, file.bytes); assert.deepEqual([info.width, info.height, info.mime], [900, 1200, 'image/jpeg']); }
    await choose('png800');
    await generate();
    assert.equal(await page.locator('#batchFormat').isDisabled(), true);
    let file = await downloadFile(page, '#batchResults article:first-child [data-action="download"]', artifacts, 'png800.png');
    let info = await imageInfo(page, file.bytes); assert.equal(info.transparent > 0, true); assert.equal(info.blueWidth, info.blueHeight);
    await choose('resize');
    await page.fill('#batchOption-width', '600'); await page.fill('#batchOption-height', '400');
    await generate();
    file = await downloadFile(page, '#batchResults article:first-child [data-action="download"]', artifacts, 'resized.jpg');
    info = await imageInfo(page, file.bytes); assert.deepEqual([info.width, info.height], [600, 400]);
    await choose('compress');
    await page.fill('#batchOption-maxEdge', '200'); await page.selectOption('#batchFormat', 'image/webp');
    await generate();
    file = await downloadFile(page, '#batchResults article:first-child [data-action="download"]', artifacts, 'compressed.webp');
    info = await imageInfo(page, file.bytes); assert.deepEqual([info.width, info.height, info.mime], [200, 100, 'image/webp']);
    await choose('collage');
    await page.selectOption('#batchOption-layout', 'vertical'); await page.fill('#batchOption-width', '420'); await page.fill('#batchOption-gap', '10');
    await generate(); assert.equal(await page.locator('#batchResults article').count(), 1);
    info = await firstImage(); assert.deepEqual([info.width, info.height], [420, 430]);
    await choose('watermark');
    await page.click('#batchGenerate');
    await page.waitForFunction(() => !BatchWorkbench.isBusy());
    assert.match(await page.locator('#batchStatus').textContent(), /水印文字/);
    await page.fill('#batchOption-text', 'MY SHOP'); await page.fill('#batchOption-color', '#000000'); await page.selectOption('#batchOption-position', 'center');
    await generate();
    file = await downloadFile(page, '#batchResults article:first-child [data-action="download"]', artifacts, 'watermark.png');
    info = await imageInfo(page, file.bytes); assert.deepEqual([info.width, info.height], [400, 200]);
    await choose('background'); await generate();
    file = await downloadFile(page, '#batchResults article:nth-child(2) [data-action="download"]', artifacts, 'background.png');
    info = await imageInfo(page, file.bytes); assert.equal(info.corner[3], 0); assert.deepEqual(info.center, [255,255,255,255]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, 'workspace-desktop.png'), fullPage: true });

    await choose('resize'); assert.equal(await page.locator('#batchOption-width').inputValue(), '600');
    assert.equal(await page.locator('#batchZip').isEnabled(), true, 'Per-tool outputs survive navigation');
    await page.fill('#batchOption-width', '700'); assert.equal(await page.locator('#batchZip').isEnabled(), false);
    // User cancellation happens before the next image; navigation is blocked during generation.
    const cancellation = await page.evaluate(() => {
      document.getElementById('batchGenerate').click();
      const switched = StudioNavigation.select('portrait');
      document.getElementById('batchCancel').click();
      return switched;
    });
    assert.equal(cancellation, false);
    await page.waitForFunction(() => !BatchWorkbench.isBusy());
    assert.match(await page.locator('#batchStatus').textContent(), /取消/);
    await generate();
    await page.locator('#batchAssets [data-asset-action="remove"]').first().click();
    assert.equal(await page.locator('#batchZip').isEnabled(), false);
    await choose('portrait'); assert.equal(await page.locator('#batchZip').isEnabled(), false, 'Shared asset changes invalidate all tools');
    assert.equal(await page.locator('#batchAssets img').count(), 1);
    await page.locator('#batchFiles').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await page.waitForFunction(() => !BatchWorkbench.isBusy());
    assert.equal(await page.locator('#batchAssets img').count(), 1);
    await generate();
    await page.setViewportSize({ width: 390, height: 844 });
    await choose('compress'); await choose('background');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Switching tools returns to the top');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#studioMenuToggle').getAttribute('aria-expanded'), 'false');
    await page.screenshot({ path: path.join(artifacts, 'workspace-mobile.png'), fullPage: true });
    await choose('translate'); assert.equal(await page.locator('#detailLanguage').inputValue(), 'en');
    await choose('detail'); assert.equal(await page.locator('#detailLanguage').inputValue(), 'zh');
    await choose('crop'); assert.equal(await page.locator('#cropPanel').isVisible(), true);

    assert.deepEqual(errors, []);
    console.log('PASS: batch image browser checks.');
    console.log('Artifacts: ' + artifacts);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Artifacts: ' + artifacts);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
