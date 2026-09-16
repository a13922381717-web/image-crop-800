const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'image-crop-details-'));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const chooseTool = async name => {
    if (!(await page.locator('#' + name + 'Tab').isVisible())) await page.click('#studioMenuToggle');
    await page.click('#' + name + 'Tab');
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
  try {
    await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
    assert.equal(await page.locator('#canvas').isVisible(), false);
    await chooseTool('detail');
    assert.equal(await page.locator('#detailPanel table, #sizeEditor').count(), 0);
    assert.equal((await page.locator('#detailPanel').textContent()).includes('尺码'), false);
    await page.click('#generateDetails');
    assert.match(await page.locator('#detailStatus').textContent(), /至少上传/);
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 960;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#dfe9f7'; ctx.fillRect(0, 0, 640, 960);
      ctx.fillStyle = '#284669'; ctx.fillRect(145, 160, 350, 640); ctx.fillStyle = '#48719d'; ctx.fillRect(160, 180, 150, 600);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const fixture = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
    await chooseTool('crop');
    await page.locator('#fileInput').setInputFiles([fixture('原图一.png'), fixture('原图二.png')]);
    await page.waitForFunction(() => document.querySelectorAll('#thumbs button').length === 2);
    await page.locator('#thumbs button').nth(1).click();
    await page.locator('#zoom').fill('1.8');
    const bounds = await page.locator('#canvas').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 55); await page.mouse.up();
    const cropBefore = await page.locator('#canvas').evaluate(canvas => canvas.toDataURL());
    await chooseTool('detail');
    await page.click('#useCropBtn');
    await page.waitForFunction(() => document.querySelectorAll('#productAssets img').length === 1 && !document.querySelector('#generateDetails').disabled);
    await page.fill('#productName', '宽松直筒牛仔裤');
    await page.fill('#productSubtitle', '简约日常 · 自在穿搭');
    await page.fill('#sellingPoints', '宽松剪裁，穿着自在\n实用口袋，收纳随身物品\n直筒版型，方便搭配');
    await page.click('#generateDetails');
    await page.waitForFunction(() => document.querySelectorAll('#detailPreviewGrid img').length === 5 && !document.querySelector('#downloadDetailsZip').disabled);
    assert.match(await page.locator('#detailStatus').textContent(), /未上传细节图/);
    const dimensions = await page.locator('#detailPreviewGrid img').evaluateAll(async images => Promise.all(images.map(async image => { await image.decode(); return [image.naturalWidth, image.naturalHeight]; })));
    assert.deepEqual(dimensions, Array.from({ length: 5 }, () => [800, 1200]));
    const previewBounds = await page.locator('#detailPreviewGrid img').first().boundingBox();
    assert.ok(Math.abs(previewBounds.height / previewBounds.width - 1.5) < 0.01, 'Preview must retain the 800×1200 aspect ratio');
    assert.match(await page.locator('#detailPreviewGrid button').nth(4).textContent(), /产品总览/);
    assert.equal(await page.locator('#saveDetailsFolder').isEnabled(), false);
    const parseZip = bytes => {
      let cursor = 0; const files = [];
      while (bytes.readUInt32LE(cursor) === 0x04034b50) {
        const length = bytes.readUInt32LE(cursor + 18); const nameLength = bytes.readUInt16LE(cursor + 26); const extraLength = bytes.readUInt16LE(cursor + 28);
        const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString('utf8');
        const start = cursor + 30 + nameLength + extraLength;
        files.push({ name, bytes: bytes.subarray(start, start + length) }); cursor = start + length;
      }
      return files;
    };
    for (const [mime, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png']]) {
      await page.selectOption('#detailFormat', mime);
      const pending = page.waitForEvent('download'); await page.click('#downloadDetailsZip'); const download = await pending;
      const destination = path.join(artifacts, 'details-' + extension + '.zip'); await download.saveAs(destination);
      const files = parseZip(await fs.readFile(destination)); assert.equal(files.length, 5);
      assert.equal(files[4].name, '05_产品总览.' + extension);
      for (const file of files) {
        assert.equal(file.name.endsWith('.' + extension), true);
        const size = await page.evaluate(async ({ bytes, type }) => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type })); const size = [bitmap.width, bitmap.height]; bitmap.close(); return size; }, { bytes: [...file.bytes], type: mime });
        assert.deepEqual(size, [800, 1200]);
      }
    }
    await page.locator('#detailPreviewGrid button').nth(4).click();
    assert.equal(await page.locator('#detailLightbox').isVisible(), true);
    const singlePending = page.waitForEvent('download'); await page.click('#downloadSingleDetail'); const single = await singlePending;
    assert.match(single.suggestedFilename(), /05_产品总览\.png$/);
    await single.saveAs(path.join(artifacts, 'overview.png'));
    await page.keyboard.press('Escape');

    // Translation is opt-in: this route validates only text is sent, without real requests.
    const translationRequests = [];
    let translationMode = 'success';
    const translations = new Map([
      ['宽松直筒牛仔裤', 'Relaxed Straight-Leg Jeans'],
      ['简约日常 · 自在穿搭', 'Everyday Style, Effortless Comfort'],
      ['宽松剪裁，穿着自在', 'A relaxed fit for everyday comfort.'],
      ['实用口袋，收纳随身物品', 'Practical pockets for your everyday essentials.'],
      ['直筒版型，方便搭配', 'A straight-leg shape for easy styling.']
    ]);
    await page.route('https://api.mymemory.translated.net/get?*', async route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), 'GET');
      assert.equal(url.searchParams.get('langpair'), 'zh-CN|en');
      assert.ok([...url.searchParams.keys()].every(key => ['q', 'langpair', 'mt'].includes(key)));
      translationRequests.push(url.searchParams.get('q'));
      const mode = translationMode;
      if (mode === 'cancel') await new Promise(resolve => setTimeout(resolve, 1500));
      const payload = mode === 'quota' ? { responseStatus: 403, quotaFinished: true, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' } : { responseStatus: 200, quotaFinished: false, responseData: { translatedText: translations.get(url.searchParams.get('q')) || 'Updated product copy' } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload), headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {});
    });
    await page.selectOption('#detailLanguage', 'en');
    assert.equal(await page.locator('#englishCopyPanel').isVisible(), true);
    assert.equal(translationRequests.length, 0, 'Choosing English must not send text automatically');
    await page.click('#translateDetails');
    await page.waitForFunction(() => document.querySelector('#englishProductName').value === 'Relaxed Straight-Leg Jeans' && !document.querySelector('#generateDetails').disabled);
    assert.equal(translationRequests.length, 5);
    assert.equal(await page.locator('#productName').inputValue(), '宽松直筒牛仔裤');
    assert.equal(await page.locator('#englishSellingPoints').inputValue(), [...translations.values()].slice(2).join('\n'));
    await page.fill('#englishProductName', 'Relaxed Straight-Leg Jeans with Everyday Comfort and Practical Pockets '.repeat(2).slice(0, 120));
    await page.fill('#englishProductSubtitle', 'Edited English subtitle');
    await page.evaluate(() => {
      window.englishDrawCalls = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) { window.englishDrawCalls.push(String(text)); return original.call(this, text, ...args); };
    });
    await page.click('#generateDetails');
    await page.waitForFunction(() => !document.querySelector('#downloadDetailsZip').disabled);
    const englishDrawCalls = await page.evaluate(() => window.englishDrawCalls);
    assert.equal(englishDrawCalls.some(text => /\p{Script=Han}/u.test(text)), false, 'English canvases must not contain Chinese template or source copy');
    assert.ok(englishDrawCalls.includes('Edited English subtitle'));
    assert.match(await page.locator('#detailPreviewGrid button').nth(4).textContent(), /Product Overview/);
    for (const [mime, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png']]) {
      await page.selectOption('#detailFormat', mime);
      const pending = page.waitForEvent('download'); await page.click('#downloadDetailsZip'); const download = await pending;
      assert.match(download.suggestedFilename(), /details_en/);
      assert.ok(download.suggestedFilename().endsWith('.zip'), 'Long English names must retain the ZIP extension');
      const destination = path.join(artifacts, 'english-' + extension + '.zip'); await download.saveAs(destination);
      const files = parseZip(await fs.readFile(destination)); assert.equal(files.length, 5);
      assert.equal(files[4].name, '05_Product Overview.' + extension);
      assert.ok(files.every(file => !/\p{Script=Han}/u.test(file.name)));
      const imageSize = await page.evaluate(async ({ bytes, type }) => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type })); const result = [bitmap.width, bitmap.height]; bitmap.close(); return result; }, { bytes: [...files[4].bytes], type: mime });
      assert.deepEqual(imageSize, [800, 1200]);
      if (mime === 'image/png') await fs.writeFile(path.join(artifacts, 'english-overview.png'), files[4].bytes);
    }
    await page.screenshot({ path: path.join(artifacts, 'english-desktop.png'), fullPage: true });
    for (const index of [0, 4]) {
      await page.locator('#detailPreviewGrid button').nth(index).click();
      const pending = page.waitForEvent('download'); await page.click('#downloadSingleDetail'); const download = await pending;
      assert.ok(download.suggestedFilename().includes(`_${String(index + 1).padStart(2, '0')}_`));
      assert.ok(download.suggestedFilename().endsWith('.png'), 'Long English names must retain single-image extensions and sequence');
      await page.keyboard.press('Escape');
    }
    await page.fill('#productName', '中文修改后需要核对');
    assert.equal(await page.locator('#translationStaleNotice').isVisible(), true);
    await page.click('#generateDetails');
    assert.match(await page.locator('#detailStatus').textContent(), /中文已修改/);
    await page.click('#keepEnglishCopy');
    assert.equal(await page.locator('#translationStaleNotice').isVisible(), false);
    const oldEnglish = await page.locator('#englishSellingPoints').inputValue();
    translationMode = 'quota';
    await page.click('#translateDetails');
    await page.waitForFunction(() => document.querySelector('#translationStatus').textContent.includes('翻译未完成') && !document.querySelector('#generateDetails').disabled);
    assert.equal(await page.locator('#englishSellingPoints').inputValue(), oldEnglish);
    translationMode = 'cancel';
    await page.fill('#productName', '取消翻译测试文案');
    await page.click('#translateDetails');
    await page.click('#cancelTranslation');
    await page.waitForFunction(() => document.querySelector('#translationStatus').textContent.includes('已取消') && !document.querySelector('#generateDetails').disabled);
    assert.equal(await page.locator('#englishSellingPoints').inputValue(), oldEnglish);
    await page.selectOption('#detailLanguage', 'zh');
    assert.equal(await page.locator('#englishCopyPanel').isVisible(), false);
    await page.fill('#productName', '更新后的产品名称');
    assert.equal(await page.locator('#downloadDetailsZip').isEnabled(), false);
    assert.match(await page.locator('#detailResultHint').textContent(), /重新生成/);
    await page.locator('#detailInput').setInputFiles(Array.from({ length: 6 }, (_, index) => fixture(`细节${index + 1}.png`)));
    await page.waitForFunction(() => document.querySelectorAll('#detailAssets img').length === 6 && !document.querySelector('#generateDetails').disabled);
    await page.locator('#productInput').setInputFiles(Array.from({ length: 5 }, (_, index) => fixture(`产品${index + 2}.png`)));
    await page.waitForFunction(() => document.querySelectorAll('#productAssets img').length === 6 && !document.querySelector('#generateDetails').disabled);
    await page.fill('#sellingPoints', Array.from({ length: 4 }, () => '长文案测量边界'.repeat(14)).join('\n'));
    await page.check('input[name=detailTheme][value=sand]');
    await page.click('#generateDetails');
    await page.waitForFunction(() => !document.querySelector('#downloadDetailsZip').disabled);
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
    await chooseTool('crop');
    assert.equal(await page.locator('#zoom').inputValue(), '1.8');
    assert.equal(await page.locator('#thumbs button.active').getAttribute('title'), '原图二.png');
    assert.equal(await page.locator('#canvas').evaluate(canvas => canvas.toDataURL()), cropBefore);
    await page.selectOption('#mode', 'fit');
    const white = await page.locator('#canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data]);
    assert.deepEqual(white, [255, 255, 255, 255]);
    await page.selectOption('#format', 'image/png');
    const cropPending = page.waitForEvent('download'); await page.click('#downloadBtn'); const cropDownload = await cropPending;
    assert.equal(cropDownload.suggestedFilename(), '原图二_800x800.png');
    await chooseTool('detail');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });

    // An offline English workflow also works without entering any Chinese copy.
    const requestCount = translationRequests.length;
    await page.reload();
    await chooseTool('detail');
    await page.selectOption('#detailLanguage', 'en');
    await page.locator('#productInput').setInputFiles(fixture('manual.png'));
    await page.waitForFunction(() => document.querySelectorAll('#productAssets img').length === 1 && !document.querySelector('#generateDetails').disabled);
    await page.fill('#englishProductName', 'Everyday Jeans');
    await page.fill('#englishSellingPoints', 'A relaxed fit for everyday comfort.');
    await page.click('#generateDetails');
    await page.waitForFunction(() => !document.querySelector('#downloadDetailsZip').disabled);
    assert.match(await page.locator('#detailPreviewGrid button').nth(4).textContent(), /Product Overview/);
    assert.equal(await page.locator('#productName').inputValue(), '');
    assert.equal(translationRequests.length, requestCount, 'Manual English mode must not contact the translation service');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'english-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: Chinese/English five-image generation; opt-in translation; editable copy; source preservation; translation quota/cancel; JPG/PNG ZIP; single export; 6 assets; stale protection; crop regression; mobile layout.');
    console.log('Artifacts: ' + artifacts);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
