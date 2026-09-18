const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createServer } = require('../ai-server.cjs');
(async () => {
  const server = createServer({ apiKey: '' }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/?tool=retouch');
    for (const file of ['retouch-image.js', 'retouch-workbench.js', 'retouch-workbench.css']) assert.equal((await page.request.get(base + '/' + file)).status(), 200);
    assert.equal(await page.locator('#retouchPanel').isVisible(), true);
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#dce4ed'; ctx.fillRect(0, 0, 600, 400);
      ctx.fillStyle = '#254568'; ctx.fillRect(70, 50, 200, 300);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('WATERMARK', 310, 265);
      return c.toDataURL('image/png').split(',')[1];
    });
    const transfer = await page.evaluateHandle(data => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], '产品测试.png', { type: 'image/png' })); return dt;
    }, data);
    await page.dispatchEvent('#retouchDrop', 'drop', { dataTransfer: transfer }); await transfer.dispose();
    await page.waitForFunction(() => !document.querySelector('#retouchCanvas').hidden && !RetouchWorkbench.isBusy());
    const point = async (x, y) => { const box = await page.locator('#retouchCanvas').boundingBox(); return { x: box.x + x * box.width / 600, y: box.y + y * box.height / 400 }; };
    const select = async (x1, y1, x2, y2) => {
      await page.locator('#retouchCanvas').scrollIntoViewIfNeeded();
      const a = await point(x1, y1), b = await point(x2, y2);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    };
    const pixels = () => page.locator('#retouchCanvas').evaluate(c => [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data]);
    const before = await pixels();
    await select(300, 230, 505, 280);
    await page.locator('#retouchApply').click(); await page.waitForFunction(() => !RetouchWorkbench.isBusy());
    const after = await pixels(); let changed = 0;
    for (let y = 0; y < 400; y++) for (let x = 0; x < 600; x++) {
      const i = (y * 600 + x) * 4;
      if (x < 300 || x >= 505 || y < 230 || y >= 280) {
        for (let c = 0; c < 4; c++) assert.equal(after[i + c], before[i + c], 'Pixels outside the selected area stay unchanged');
      } else {
        if (after[i] !== before[i]) changed++;
        assert.deepEqual(after.slice(i, i + 4), [220, 228, 237, 255], 'The background watermark is actually removed');
      }
    }
    assert.ok(changed > 200);
    await page.locator('#retouchCompare').click(); assert.deepEqual(await pixels(), before);
    await page.locator('#retouchCompare').click(); assert.deepEqual(await pixels(), after);
    for (const format of ['image/png', 'image/jpeg']) {
      await page.selectOption('#retouchFormat', format);
      const pending = page.waitForEvent('download'); await page.click('#retouchDownload'); const download = await pending;
      assert.match(download.suggestedFilename(), /_去水印\.(png|jpg)$/);
      const bytes = await fs.readFile(await download.path());
      const dimensions = await page.evaluate(async ({ bytes, format }) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: format }));
        return [image.width, image.height];
      }, { bytes: [...bytes], format });
      assert.deepEqual(dimensions, [600, 400]);
    }
    await page.click('#retouchUndo'); assert.deepEqual(await pixels(), before);
    assert.equal(await page.locator('#retouchDownload').isDisabled(), true);
    await page.selectOption('#retouchMode', 'clone');
    await page.selectOption('#retouchZoom', '2');
    await select(40, 25, 120, 55);
    await page.click('#retouchSource');
    await page.locator('#retouchCanvas').scrollIntoViewIfNeeded();
    const source = await point(180, 100); await page.mouse.click(source.x, source.y);
    await page.click('#retouchApply'); await page.waitForFunction(() => !RetouchWorkbench.isBusy());
    assert.match(await page.locator('#retouchStatus').textContent(), /修补完成/);
    await page.click('#retouchReset'); assert.deepEqual(await pixels(), before);
    await page.locator('#retouchFile').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    assert.match(await page.locator('#retouchStatus').textContent(), /JPG/);
    assert.deepEqual(await pixels(), before, 'Invalid replacement keeps current image');
    await page.locator('[data-tool=crop]').click(); assert.equal(await page.locator('#retouchPanel').isVisible(), false);
    await page.locator('[data-tool=ai]').click(); assert.equal(await page.locator('#aiDropZone').isVisible(), true);
    await page.locator('[data-tool=retouch]').click(); assert.deepEqual(await pixels(), before);
    await page.selectOption('#retouchZoom', 'fit');
    await page.screenshot({ path: '/tmp/yutang-retouch-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '/tmp/yutang-retouch-mobile.png', fullPage: true });
    // Direct local HTML, without either API server, must also work.
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?tool=retouch');
    await page.locator('#retouchFile').setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
    await page.waitForFunction(() => !RetouchWorkbench.isBusy() && !document.querySelector('#retouchCanvas').hidden);
    assert.match(await page.locator('#retouchMeta').textContent(), /600 × 400/);
    assert.deepEqual(errors, []);
    console.log('PASS: drag upload; actual watermark pixels removed; untouched product pixels; clone at 200% zoom; undo/reset/compare; full-size PNG/JPG export; invalid file preservation; navigation; mobile; offline HTML.');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
