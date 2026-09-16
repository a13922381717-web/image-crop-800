// Single-instance, bring-your-own-key sharing service. No global/provider owner key.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { readJSON, ASSETS, MIME, ROOT, fail } = require('./ai-server.cjs');
const { validateEdit, generateImage } = require('./ai-provider.cjs');
function createCloudServer({ origin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL, fetchImpl = fetch, now = Date.now, sessionTTL = 3600000, resultTTL = 300000 } = {}) {
  const site = new URL(origin);
  if (site.origin !== origin || (site.protocol !== 'https:' && site.hostname !== '127.0.0.1')) throw new Error('PUBLIC_ORIGIN must be the HTTPS site origin.');
  const sessions = new Map(); let active = 0; let cachedBytes = 0;
  function discard(session) { if (session.job?.image) cachedBytes -= session.job.image.length; session.job = null; }
  function clean() {
    for (const [token, session] of sessions) {
      if (session.job && session.job.state !== 'running' && now() - session.job.updated > resultTTL) discard(session);
      if (!session.reading && session.job?.state !== 'running' && now() - session.touched > sessionTTL) { discard(session); session.key = ''; sessions.delete(token); }
    }
  }
  function room(bytes) {
    const old = [...sessions.values()].filter(s => s.job?.image).sort((a,b) => a.job.updated-b.job.updated);
    while (cachedBytes + bytes > 64 * 1024 * 1024 && old.length) discard(old.shift());
  }
  const server = http.createServer(async (req, res) => {
    const send = (code, value) => { if (!res.destroyed) { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(value)); } };
    try {
      clean();
      const url = new URL(req.url, site);
      if (url.pathname === '/healthz' && req.method === 'GET') return send(200, { ok:true });
      if (req.headers.host !== site.host) throw fail(403, '请使用工作台的正式网址。');
      if (url.pathname.startsWith('/api/')) {
        if ((req.headers.origin && req.headers.origin !== site.origin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '不允许跨站请求。');
        if (url.pathname === '/api/ai/status' && req.method === 'GET') {
          if (sessions.size >= 100) throw fail(429, '当前试用人数较多，请稍后重试。');
          const token = randomBytes(32).toString('hex');
          sessions.set(token, { key:'', touched:now(), job:null, reading:false, attempts:[] });
          return send(200, { configured:false, hosted:true, jobs:true, token });
        }
        const token = String(req.headers['x-studio-token'] || '');
        const session = sessions.get(token);
        if (!session) throw fail(401, '当前会话已过期或服务已重启。请先下载已有图片，再刷新页面重新填写密钥。');
        session.touched = now();
        if (url.pathname === '/api/ai/disconnect' && req.method === 'POST') {
          session.job?.abort?.abort(); discard(session); session.key=''; sessions.delete(token); return send(200, { disconnected:true });
        }
        const match = url.pathname.match(/^\/api\/ai\/jobs\/([a-f0-9-]{36})$/);
        if (match) {
          const job = session.job;
          if (!job || job.id !== match[1]) throw fail(404, '任务不存在或结果已过期，请重新生成。');
          if (req.method === 'DELETE') { job.abort.abort(); if (job.image) cachedBytes-=job.image.length; job.image=null; job.state='cancelled'; job.updated=now(); return send(200, { state:'cancelled' }); }
          if (req.method !== 'GET') throw fail(405, '请求方法错误。');
          return send(200, { id:job.id, state:job.state, ...(job.image ? { image:job.image } : {}), ...(job.error ? { error:job.error } : {}) });
        }
        if (req.method !== 'POST' || !['/api/ai/config','/api/ai/jobs'].includes(url.pathname)) throw fail(404, '接口不存在。');
        if (session.reading || session.job?.state === 'running') throw fail(409, '你的上一张图片还在生成，请等待完成或取消。');
        if (active >= 3) throw fail(429, '当前同时生成的人较多，请稍后手动重试。');
        session.attempts = session.attempts.filter(time => now()-time < 60000);
        if (session.attempts.length >= 12) throw fail(429, '操作较频繁，请一分钟后重试。');
        session.attempts.push(now()); session.reading=true; active++;
        let held = true;
        try {
          const body = await readJSON(req);
          if (!body || typeof body !== 'object') throw fail(400, '请求内容无效。');
          if (url.pathname === '/api/ai/config') {
            if (typeof body.key !== 'string' || body.key.length < 20 || body.key.length > 512 || /\s/.test(body.key)) throw fail(400, '请填写有效的 OpenAI API Key。');
            session.key = body.key; return send(200, { configured:true });
          }
          if (!session.key) throw fail(503, '请先填写你自己的图片 API Key。');
          if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw fail(400, '任务标识无效。');
          // Never start a second paid request for an already accepted request ID.
          if (session.job?.id === body.id) return send(200, { id:body.id, state:session.job.state });
          validateEdit(body);
          if (req.aborted || res.destroyed || !sessions.has(token)) throw fail(400, '请求已取消。');
          discard(session);
          const job = { id:body.id, state:'running', updated:now(), abort:new AbortController() }; session.job=job;
          const key = session.key;
          const timer = setTimeout(() => job.abort.abort(), 240000); timer.unref();
          held = false;
          generateImage(body, { key, model:process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', fetchImpl, signal:job.abort.signal })
            .then(image => { if (job.state !== 'running' || !sessions.has(token)) return; room(image.length); cachedBytes+=image.length; job.image=image; job.state='done'; })
            .catch(error => { if (job.state !== 'running') return; job.state='failed'; job.error=error.name === 'AbortError' ? '生成超时或已取消。' : error.status ? error.message : '图片服务连接失败，请检查网络后手动重试。'; })
            .finally(() => { clearTimeout(timer); active--; job.updated=now(); session.touched=now(); });
          send(202, { id:job.id, state:'running' });
        } finally { session.reading=false; if (held) active--; }
        return;
      }
      if (!['GET','HEAD'].includes(req.method)) throw fail(405, '请求方法错误。');
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!ASSETS.has(file)) throw fail(404, '文件不存在。');
      const bytes = await fs.readFile(path.join(ROOT,file));
      res.writeHead(200, { 'Content-Type':MIME[path.extname(file)]+'; charset=utf-8', 'Cache-Control':'no-cache', 'Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'self'", 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' }); res.end(req.method==='HEAD' ? undefined : bytes);
    } catch (error) { send(error.status || 500, { error:error.status ? error.message : '服务暂时不可用，请稍后重试。' }); }
  });
  const cleanup = setInterval(clean, 60000); cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); for (const session of sessions.values()) { session.job?.abort?.abort(); session.key=''; } sessions.clear(); });
  server.requestTimeout = 60000;
  return server;
}
if (require.main === module) {
  const server = createCloudServer(); server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Image workbench online service ready.'));
}
module.exports = { createCloudServer };
