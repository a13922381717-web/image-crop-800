const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createServer } = require('../ai-server.cjs');
(async () => {
  let png, requests = [], failure = false, stalled = false;
  let factory = createServer, serverOptions = { apiKey: '' };
  if (process.env.CLOUD_TEST === '1') {
    const reservation = require('node:net').createServer(); await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    factory = require('../cloud-server.cjs').createCloudServer; serverOptions = { origin:'http://127.0.0.1:' + port, port };
  }
  const server = factory({ ...serverOptions, fetchImpl: async (_url, options) => {
    requests.push({ images: options.body.getAll('image[]').length, prompt: options.body.get('prompt') });
    if (stalled) { await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), { once: true }); }); }
    if (failure) { failure = false; return Response.json({}, { status: 429 }); }
    return Response.json({ data: [{ b64_json: png }] });
  } });
  await new Promise(resolve => server.listen(serverOptions.port || 0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/?tool=ai');
    await page.waitForFunction(() => document.querySelector('#aiConnection').textContent === '待配置 API');
    assert.equal(await page.locator('#aiPanel').isVisible(), true);
    if (process.env.CLOUD_TEST === '1') { assert.equal(await page.locator('#aiShare').isVisible(),true); assert.ok((await page.locator('#aiKeyNote').textContent()).includes('HTTPS')); }
    assert.equal(await page.locator('#aiSample').isDisabled(), true);
    png = await page.evaluate(() => { const c=document.createElement('canvas'); c.width=800;c.height=1200;const ctx=c.getContext('2d');ctx.fillStyle='#b4c8e6';ctx.fillRect(0,0,800,1200);ctx.fillStyle='#2e5f95';ctx.fillRect(200,180,400,900);return c.toDataURL('image/png').split(',')[1]; });
    const upload = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const dropFiles = async (selector, names, mime = 'image/png') => {
      const transfer = await page.evaluateHandle(({ png, names, mime }) => {
        const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
        const data = new DataTransfer(); names.forEach(name => data.items.add(new File([bytes], name, { type:mime }))); return data;
      }, { png, names, mime });
      await page.dispatchEvent(selector, 'dragenter', { dataTransfer:transfer });
      if (selector === '#aiDropZone' && !(await page.locator('#aiInputs').evaluate(element => element.disabled))) assert.ok((await page.locator(selector).getAttribute('class')).includes('is-dragging'));
      await page.dispatchEvent(selector, 'dragover', { dataTransfer:transfer });
      await page.dispatchEvent(selector, 'drop', { dataTransfer:transfer }); await transfer.dispose();
    };
    await dropFiles('#aiDropZone', ['front.png', 'back.png']);
    await page.waitForFunction(() => document.querySelectorAll('.ai-source').length === 2);
    assert.ok(!(await page.locator('#aiDropZone').getAttribute('class')).includes('is-dragging'));
    await dropFiles('#aiDropZone', ['invalid.txt'], 'text/plain');
    await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('请使用'));
    assert.equal(await page.locator('.ai-source').count(), 2);
    await dropFiles('#aiStatus', ['outside.png']);
    assert.equal(await page.locator('.ai-source').count(), 2);
    assert.ok((await page.locator('#aiStatus').textContent()).includes('上传框'));
    await page.locator('#aiFiles').setInputFiles([upload('detail.png')]);
    await page.waitForFunction(() => document.querySelectorAll('.ai-source').length === 3);
    await page.getByLabel('素材 2 角度', { exact: true }).selectOption('back');
    await page.getByLabel('素材 3 标题', { exact: true }).fill('工装口袋');
    await page.locator('#aiDetails').click(); await page.waitForFunction(() => document.querySelectorAll('.ai-result').length === 1);
    assert.equal(await page.locator('.ai-result strong').textContent(), '工装口袋');
    const actual = await page.locator('.ai-result img').evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight })); assert.deepEqual(actual, { width:800, height:1200 });
    assert.equal(requests.length, 0);
    await page.locator('#aiKey').fill('sk-test-secret-123456789012345'); await page.locator('#aiSaveKey').click(); await page.waitForFunction(() => !document.querySelector('#aiSample').disabled);
    assert.equal(await page.locator('#aiKey').inputValue(), '');
    await page.locator('#aiSample').click(); await page.waitForFunction(() => !document.querySelector('#aiApprove').disabled);
    assert.equal(requests.length, 1); assert.equal(requests[0].images, 3);
    await page.locator('#aiApprove').check(); failure = true;
    await page.locator('#aiSet').click(); await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('额度'));
    assert.equal(requests.length, 2);
    await page.locator('#aiSet').click(); await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('套图处理完成'));
    assert.equal(requests.length, 4); assert.equal(requests[2].images, 4); assert.ok((await page.locator('#aiStatus').textContent()).includes('侧面主图'));
    await page.locator('#aiSet').click(); await page.waitForFunction(() => !document.querySelector('#aiSet').disabled); assert.equal(requests.length, 4, 'successful shots are not regenerated on retry');
    const before = await page.locator('.ai-result img').last().getAttribute('src'); await page.locator('.ai-result').last().getByText('查看原图').click(); await page.locator('.ai-result').last().getByText('查看结果').click(); assert.equal(await page.locator('.ai-result img').last().getAttribute('src'), before);
    const downloadWait = page.waitForEvent('download'); await page.locator('#aiDownloadAll').click(); const dl=await downloadWait; const bytes=await fs.readFile(await dl.path()); assert.equal(bytes.readUInt32LE(0),0x04034b50);
    await page.locator('#aiScene').selectOption({ label: '纯白摄影棚' }); assert.equal(await page.locator('#aiSet').isDisabled(), true);
    stalled = true; await page.locator('#aiSample').click(); await page.waitForFunction(() => !document.querySelector('#aiCancel').hidden); await new Promise(resolve => setTimeout(resolve, 150)); await dropFiles('#aiDropZone', ['busy.png']); assert.equal(await page.locator('.ai-source').count(), 3); await page.locator('#aiCancel').click(); await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('已取消')); assert.equal(await page.locator('.ai-result').count(), 4);
    await dropFiles('#aiDropZone', Array.from({ length:6 }, (_, i) => `extra-${i}.png`));
    await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('最多保留'));
    assert.equal(await page.locator('.ai-source').count(), 8);
    await page.setViewportSize({ width:390,height:844 }); await page.screenshot({ path:'/tmp/ai-workbench-mobile.png',fullPage:true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.setViewportSize({ width:1440,height:1100 }); await page.screenshot({ path:'/tmp/ai-workbench-desktop.png',fullPage:true });
    assert.deepEqual(errors, []); console.log('AI browser: file drop, invalid files, outside drop, busy guard, 8-image limit, local details, config, sample, reference consistency, failure/retry, missing angles, ZIP, stale approval, cancellation and mobile passed.');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
