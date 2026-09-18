// Local-only bridge. The API key stays on this computer, never in static assets.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const ROOT = __dirname;
const ASSETS = new Set(['index.html', 'image-upload.js', 'studio.css', 'studio-navigation.js', 'batch-image.js', 'batch-workbench.js', 'batch-workbench.css', 'detail-tool.js', 'detail-tool.css', 'detail-renderer.js', 'detail-export.js', 'detail-translation.js', 'ai-workbench.js', 'ai-workbench.css', 'retouch-image.js', 'retouch-workbench.js', 'retouch-workbench.css']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
function fail(status, message) { return Object.assign(new Error(message), { status }); }
async function readJSON(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw fail(415, '请求格式错误。');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) throw fail(413, '图片总量过大，请减少素材。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, '请求内容无效。'); }
}
const { decodeImage, validateEdit, generateImage } = require('./ai-provider.cjs');
function createServer({ apiKey = process.env.OPENAI_API_KEY || '', model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', fetchImpl = fetch } = {}) {
  let key = apiKey; let running = false;
  const token = randomBytes(32).toString('hex');
  return http.createServer(async (req, res) => {
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); } };
    try {
      const host = req.headers.host || '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) throw fail(403, '请通过本机 127.0.0.1 地址打开工作台。');
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== 'http://' + host) throw fail(403, '不允许跨站访问。');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '不允许跨站访问。');
        if (req.method === 'GET' && url.pathname === '/api/ai/status') return send(200, { configured: Boolean(key), token });
        const supplied = Buffer.from(String(req.headers['x-studio-token'] || ''));
        if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) throw fail(403, '请刷新页面后重试。');
        if (req.method !== 'POST') throw fail(405, '请求方法错误。');
        if (running) throw fail(409, '正在生成图片，请等待完成或取消。');
        const body = await readJSON(req);
        if (url.pathname === '/api/ai/config') {
          if (typeof body.key !== 'string' || body.key.length < 20 || body.key.length > 512 || /\s/.test(body.key)) throw fail(400, '请填写有效的 OpenAI API Key。');
          key = body.key;
          return send(200, { configured: true });
        }
        if (url.pathname !== '/api/ai/edit') throw fail(404, '接口不存在。');
        if (!key) throw fail(503, '尚未配置图片 API。');
        validateEdit(body);
        if (running) throw fail(409, '正在生成图片，请稍候。');
        running = true;
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 240000);
        res.once('close', () => { if (!res.writableEnded) abort.abort(); });
        try {
          const image = await generateImage(body, { key, model, fetchImpl, signal: abort.signal });
          send(200, { image });
        } finally { clearTimeout(timer); running = false; }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, '请求方法错误。');
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!ASSETS.has(file)) throw fail(404, '文件不存在。');
      const content = await fs.readFile(path.join(ROOT, file));
      res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'" });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { send(error.status || 502, { error: error.name === 'AbortError' ? '生成超时或已取消，请稍后手动重试。' : error.status ? error.message : '无法连接图片服务，请检查网络后重试。' }); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请关闭之前的工作台服务，或修改 PORT。' : '本地服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/?tool=ai`;
    console.log(`电商图片工作台：${url}\n保持本窗口打开；按 Control+C 停止服务。`);
    if (process.argv.includes('--open') && process.platform === 'darwin') require('node:child_process').execFile('open', [url], () => {});
  });
}
module.exports = { createServer, decodeImage, readJSON, ASSETS, MIME, ROOT, fail };
