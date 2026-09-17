const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('../ai-server.cjs');

(async () => {
  const server = createServer({ apiKey: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base);
    assert.equal((await page.request.get(base + '/image-upload.js')).status(), 200);
    assert.equal(await page.locator('input[type=file]').count(), 6);
    assert.equal(await page.locator('[data-image-upload]').count(), 6, 'Every file input has a drop target');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 160;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3269a3'; ctx.fillRect(0, 0, 100, 160);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const fixture = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const drop = async (selector, names, type = 'image/png') => {
      const transfer = await page.evaluateHandle(({ png, names, type }) => {
        const data = new DataTransfer();
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        names.forEach(name => data.items.add(new File([bytes], name, { type })));
        return data;
      }, { png, names, type });
      await page.dispatchEvent(selector, 'dragenter', { dataTransfer: transfer });
      await page.dispatchEvent(selector, 'dragover', { dataTransfer: transfer });
      const prevented = await page.locator(selector).evaluate((element, transfer) => {
        const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
        element.dispatchEvent(event); return event.defaultPrevented;
      }, transfer);
      assert.equal(prevented, true, 'File drops must not navigate the browser');
      await transfer.dispose();
    };
    const idle = () => page.waitForFunction(() => !document.querySelector('[data-image-upload][aria-busy=true]'));
    const choose = async name => {
      await page.locator(`[data-tool="${name}"]`).click();
      assert.equal(await page.evaluate(() => StudioNavigation.current()), name);
    };
    const areas = [
      ['crop', '#dropzone', '#fileInput', '#thumbs button', '#status'],
      ['detail', '#productDrop', '#productInput', '#productAssets img', '#detailStatus'],
      ['detail', '#detailDrop', '#detailInput', '#detailAssets img', '#detailStatus'],
      ['portrait', '#batchDrop', '#batchFiles', '#batchAssets img', '#batchStatus'],
      ['ai', '#aiDropZone', '#aiFiles', '.ai-source', '#aiStatus']
    ];
    for (const [tool, zone, input, previews, status] of areas) {
      await choose(tool);
      await drop(zone, ['first.png', 'second.png']); await idle();
      assert.equal(await page.locator(previews).count(), 2, tool + ' accepts multiple dropped images');
      assert.ok(!/\b(drag|is-dragging)\b/.test(await page.locator(zone).getAttribute('class')));
      await drop(zone, ['bad.txt'], 'text/plain'); await idle();
      assert.equal(await page.locator(previews).count(), 2, 'Invalid files preserve existing assets');
      await page.locator(input).setInputFiles(fixture('same.png')); await idle();
      await page.locator(input).setInputFiles(fixture('same.png')); await idle();
      assert.equal(await page.locator(previews).count(), 4, 'Click selection and repeated files still work');
      await drop('#studioToolTitle', ['outside.png']);
      assert.match(await page.locator(status).textContent(), /上传框/);
      assert.equal(await page.locator(previews).count(), 4);
    }
    await drop('#aiReferenceDrop', ['reference.png']); await idle();
    assert.equal(await page.locator('#aiReferencePreview img').count(), 1);
    const reference = await page.locator('#aiReferencePreview img').getAttribute('src');
    await drop('#aiReferenceDrop', ['one.png', 'two.png']); await idle();
    assert.match(await page.locator('#aiStatus').textContent(), /只能上传 1 张/);
    await drop('#aiReferenceDrop', ['bad.txt'], 'text/plain'); await idle();
    assert.equal(await page.locator('#aiReferencePreview img').getAttribute('src'), reference);
    // The visible reference box supports keyboard selection as well as drag-and-drop.
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#aiReferenceDrop').press('Enter');
    const chooser = await chooserPromise; assert.equal(chooser.isMultiple(), false);
    await chooser.setFiles(fixture('replacement.png')); await idle();
    assert.equal(await page.locator('#aiReferencePreview img').count(), 1);
    assert.match(await page.locator('#aiStatus').textContent(), /参考图已更新/);
    await page.locator('#aiReferencePreview button').click();
    assert.equal(await page.locator('#aiReferencePreview img').count(), 0);

    // Nested text must not flicker the highlight. Plain text drags remain ordinary text.
    await choose('crop');
    const hover = await page.evaluate(() => {
      const zone = document.querySelector('#dropzone'), child = zone.querySelector('strong');
      const data = new DataTransfer(); data.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
      const dispatch = (target, name) => target.dispatchEvent(new DragEvent(name, { dataTransfer: data, bubbles: true, cancelable: true }));
      dispatch(zone, 'dragenter'); dispatch(child, 'dragenter'); dispatch(child, 'dragleave');
      const nested = zone.classList.contains('drag'); dispatch(zone, 'dragleave');
      const cleared = !zone.classList.contains('drag');
      const text = new DataTransfer(); text.setData('text/plain', 'ordinary text');
      const event = new DragEvent('drop', { dataTransfer: text, bubbles: true, cancelable: true });
      zone.dispatchEvent(event); return { nested, cleared, textPrevented: event.defaultPrevented };
    });
    assert.deepEqual(hover, { nested: true, cleared: true, textPrevented: false });
    const cropChooserPromise = page.waitForEvent('filechooser'); await page.locator('#dropzone').click();
    await (await cropChooserPromise).setFiles(fixture('click.png')); await idle();
    assert.equal(await page.locator('#thumbs button').count(), 5);

    // Shared upload controls remain usable in every navigation entry.
    await choose('translate'); await drop('#detailDrop', ['english-detail.png']); await idle();
    assert.equal(await page.locator('#detailAssets img').count(), 5);
    for (const tool of ['png800', 'resize', 'compress', 'collage', 'watermark', 'background']) {
      await choose(tool); await page.locator('#batchClear').click();
      await drop('#batchDrop', [tool + '.png']); await idle();
      assert.equal(await page.locator('#batchAssets img').count(), 1);
      await drop('#studioToolTitle', ['outside.png']);
      assert.match(await page.locator('#batchStatus').textContent(), /上传框/);
    }
    await choose('ai'); await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#aiReferenceDrop').screenshot({ path: '/tmp/yutang-reference-upload.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: all 6 upload inputs across 11 tools; multiple files; invalid files; reference replacement and single-file limit; click/keyboard; repeated selections; nested hover; outside-drop protection; mobile layout.');
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
