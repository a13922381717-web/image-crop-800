const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createCloudServer } = require('../cloud-server.cjs');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
const edit = () => ({ id:randomUUID(), images:[png], prompt:'Keep product unchanged', size:'1024x1024' });
async function fixture(t, options = {}) {
  const server = createCloudServer({ origin:'https://studio.example', ...options }); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  function request(route, { token, body, method = body ? 'POST' : 'GET', origin = 'https://studio.example' } = {}) {
    return new Promise((resolve,reject) => {
      const req = http.request({ hostname:'127.0.0.1', port:server.address().port, path:route, method, headers:{ Host:'studio.example', Origin:origin, 'X-Studio-Token':token || '', 'Content-Type':'application/json' } }, res => { let text=''; res.on('data',c=>text+=c); res.on('end',()=>resolve({ status:res.statusCode, body:JSON.parse(text) })); }); req.on('error',reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return { request, session:async()=> (await request('/api/ai/status')).body.token };
}
async function completed(f,token,id) { for (let i=0;i<50;i++) { const r=await f.request('/api/ai/jobs/'+id,{token}); if (r.body.state !== 'running') return r; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('Job did not finish'); }
test('two visitors use separate keys and cannot read or cancel each other’s generated image', async t => {
  const authorizations=[];
  const f=await fixture(t,{fetchImpl:async(_url,options)=>{ authorizations.push(options.headers.Authorization); return Response.json({data:[{b64_json:png.split(',')[1]}]}); }});
  const a=await f.session(), b=await f.session(); assert.notEqual(a,b);
  await f.request('/api/ai/config',{token:a,body:{key:'sk-user-a-1234567890123456'}}); await f.request('/api/ai/config',{token:b,body:{key:'sk-user-b-1234567890123456'}});
  const first=edit(),second=edit();
  assert.equal((await f.request('/api/ai/jobs',{token:a,body:first})).status,202);
  assert.equal((await completed(f,a,first.id)).body.image,png);
  assert.equal((await f.request('/api/ai/jobs/'+first.id,{token:b})).status,404);
  assert.equal((await f.request('/api/ai/jobs/'+first.id,{token:b,method:'DELETE'})).status,404);
  assert.equal((await f.request('/api/ai/jobs',{token:b,body:second})).status,202); await completed(f,b,second.id);
  assert.deepEqual(authorizations,['Bearer sk-user-a-1234567890123456','Bearer sk-user-b-1234567890123456']);
  await f.request('/api/ai/jobs',{token:a,body:first}); assert.equal(authorizations.length,2,'completed request ID must not be billed twice');
  const fresh=await f.session(); assert.equal((await f.request('/api/ai/jobs',{token:fresh,body:edit()})).status,503);
  assert.equal((await f.request('/api/ai/disconnect',{token:a,method:'POST'})).status,200);
  assert.equal((await f.request('/api/ai/jobs/'+first.id,{token:a})).status,401);
});
test('expiry, invalid input and cross-site requests never expose keys or reach provider', async t => {
  let clock=100, calls=0;
  const f=await fixture(t,{now:()=>clock,sessionTTL:10,fetchImpl:async()=>{calls++;throw new Error();}});const token=await f.session();
  assert.equal((await f.request('/api/ai/config',{token,origin:'https://other.example',body:{key:'sk-not-allowed-123456789'}})).status,403);
  await f.request('/api/ai/config',{token,body:{key:'sk-valid-test-123456789012'}});
  assert.equal((await f.request('/api/ai/jobs',{token,body:{...edit(),images:['data:image/png;base64,AAAA']}})).status,400);
  clock=111; assert.equal((await f.request('/api/ai/jobs',{token,body:edit()})).status,401);assert.equal(calls,0);
  assert.equal((await f.request('/cloud-server.cjs')).status,404);
});
test('cancel aborts the provider and a busy session cannot submit a second paid job', async t => {
  let aborted=false;
  const f=await fixture(t,{fetchImpl:async(_url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));}))});
  const token=await f.session();await f.request('/api/ai/config',{token,body:{key:'sk-cancel-test-1234567890'}});
  const job=edit();await f.request('/api/ai/jobs',{token,body:job});
  assert.equal((await f.request('/api/ai/jobs',{token,body:edit()})).status,409);
  assert.equal((await f.request('/api/ai/jobs/'+job.id,{token,method:'DELETE'})).body.state,'cancelled');assert.equal(aborted,true);
});
