const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../ai-server.cjs');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
async function fixture(t, options) {
  const server = createServer(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const status = await (await fetch(base + '/api/ai/status')).json();
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': status.token, ...headers }, body: JSON.stringify(body) });
  return { base, status, post };
}
const request = { images: [png], prompt: 'Preserve product, replace scene', size: '1024x1024' };
test('local configuration stays server-side; static assets never expose files or secrets', async t => {
  const f = await fixture(t, { apiKey: '' });
  assert.equal(f.status.configured, false);
  assert.equal((await f.post('/api/ai/edit', request)).status, 503);
  assert.equal((await f.post('/api/ai/config', { key: 'sk-test-secret-123456789012345' })).status, 200);
  const status = await (await fetch(f.base + '/api/ai/status')).json();
  assert.equal(status.configured, true); assert.ok(!JSON.stringify(status).includes('secret'));
  for (const name of ['.env', 'ai-server.cjs', '.git/config', 'tests/ai-server.test.cjs']) assert.equal((await fetch(f.base + '/' + name)).status, 404);
  assert.equal((await fetch(f.base + '/ai-workbench.js')).status, 200);
});
test('cross-site mutations, missing tokens, malformed inputs never call provider', async t => {
  let calls = 0;
  const f = await fixture(t, { apiKey: 'test', fetchImpl: async () => { calls++; throw new Error(); } });
  assert.equal((await f.post('/api/ai/edit', request, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('/api/ai/edit', request, { 'X-Studio-Token': '' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { require('node:http').get(f.base + '/api/ai/status', { headers: { Host: 'evil.example:1234' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(hostStatus, 403);
  for (const body of [{ ...request, size: '100x100' }, { ...request, images: [] }, { ...request, images: ['data:image/png;base64,AAAA'] }, { ...request, prompt: '' }]) assert.equal((await f.post('/api/ai/edit', body)).status, 400);
  assert.equal(calls, 0);
});
test('edits forwards actual image bytes as multipart and returns only generated image', async t => {
  const f = await fixture(t, { apiKey: 'private-test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(options.headers.Authorization, 'Bearer private-test-key');
    assert.equal(options.body.get('model'), 'gpt-image-2');
    assert.equal(options.body.get('prompt'), request.prompt);
    assert.equal(options.body.getAll('image[]').length, 1);
    assert.deepEqual(Buffer.from(await options.body.get('image[]').arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
    return Response.json({ data: [{ b64_json: png.split(',')[1] }] });
  } });
  const response = await f.post('/api/ai/edit', request); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { image: png });
});
test('provider failures are sanitized; no automatic retry or leaked provider message', async t => {
  let calls = 0;
  const f = await fixture(t, { apiKey: 'private-test-key', fetchImpl: async () => { calls++; return Response.json({ error: 'secret-provider-information' }, { status: 429 }); } });
  const response = await f.post('/api/ai/edit', request); assert.equal(response.status, 502); const text = await response.text(); assert.ok(text.includes('额度')); assert.ok(!text.includes('secret')); assert.equal(calls, 1);
});
