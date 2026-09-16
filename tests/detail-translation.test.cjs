const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'detail-translation.js'), 'utf8');
function load(fetch, extra = {}) {
  const context = {
    window: {}, Blob, TextEncoder, URLSearchParams, AbortController, DOMException,
    setTimeout, clearTimeout, fetch, ...extra
  };
  vm.runInNewContext(source, context, { filename: 'detail-translation.js' });
  return context.window.DetailTranslation;
}
function response(text, options = {}) {
  return {
    ok: true, status: 200,
    async json() { return { responseStatus: 200, responseData: { translatedText: text } }; },
    ...options
  };
}
function copy(extra = {}) {
  return { name: '纯棉衬衫', subtitle: '', sellingPoints: [], ...extra };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('sends only whitelisted text with encoded GET parameters and privacy options', async () => {
  const calls = [];
  const translations = ['Cotton shirt', 'Cotton &amp; linen &#x2014; soft &#39;touch&#39;'];
  const translator = load(async (url, options) => {
    calls.push({ url, options });
    return response(translations[calls.length - 1]);
  });
  const input = copy({
    sellingPoints: ['  纯棉 + 柔软 & 透气?  ', '  纯棉 + 柔软 & 透气?  ', '100% cotton'],
    productImage: 'data:image/png;base64,private', apiKey: 'private-secret'
  });
  const before = JSON.stringify(input);
  const progress = [];
  const result = await translator.translate(input, { onProgress: event => progress.push(plain(event)) });
  assert.deepEqual(plain(result), {
    name: 'Cotton shirt', subtitle: '',
    sellingPoints: ["Cotton & linen — soft 'touch'", "Cotton & linen — soft 'touch'", '100% cotton']
  });
  assert.equal(JSON.stringify(input), before);
  assert.equal(calls.length, 2);
  for (const [index, call] of calls.entries()) {
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, 'https://api.mymemory.translated.net/get');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['langpair', 'mt', 'q']);
    assert.equal(url.searchParams.get('langpair'), 'zh-CN|en');
    assert.equal(url.searchParams.get('mt'), '1');
    assert.equal(url.searchParams.get('q'), index === 0 ? input.name : input.sellingPoints[0]);
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.body, undefined);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.deepEqual(progress, [{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
});

test('English and empty fields pass through exactly without contacting the service', async () => {
  const translator = load(() => assert.fail('No request should be made'));
  const input = copy({ name: ' Cotton shirt ', subtitle: '', sellingPoints: ['  Soft & breathable  ', ''] });
  const result = await translator.translate(input);
  assert.deepEqual(plain(result), input);
});

test('accepts exactly 500 UTF-8 bytes and prevalidates every segment before any request', async () => {
  let calls = 0;
  const translator = load(async () => { calls++; return response('Translated title'); });
  await translator.translate(copy({ name: 'a'.repeat(497) + '中' }));
  assert.equal(calls, 1);
  await assert.rejects(
    translator.translate(copy({ subtitle: 'a'.repeat(498) + '中' })),
    error => error.code === 'QUERY_TOO_LONG' && /500 字节/.test(error.message)
  );
  assert.equal(calls, 1);
});

test('waits for each response body before requesting the next segment', async () => {
  const requests = [];
  const releases = [];
  const translator = load(async url => {
    requests.push(new URL(url).searchParams.get('q'));
    return response('', { json: () => new Promise(resolve => releases.push(resolve)) });
  });
  const pending = translator.translate(copy({ subtitle: '轻薄透气' }));
  await nextTurn();
  assert.deepEqual(requests, ['纯棉衬衫']);
  releases[0]({ responseStatus: 200, responseData: { translatedText: 'Cotton shirt' } });
  await nextTurn();
  assert.deepEqual(requests, ['纯棉衬衫', '轻薄透气']);
  releases[1]({ responseStatus: 200, responseData: { translatedText: 'Light and breathable' } });
  assert.deepEqual(plain(await pending), { name: 'Cotton shirt', subtitle: 'Light and breathable', sellingPoints: [] });
});

const failureCases = [
  ['HTTP failure', response('', { ok: false, status: 503 }), 'HTTP_ERROR'],
  ['HTTP rate limit', response('', { ok: false, status: 429 }), 'QUOTA_EXCEEDED'],
  ['service status failure', response('', { json: async () => ({ responseStatus: 403, responseData: { translatedText: 'Forbidden' } }) }), 'SERVICE_ERROR'],
  ['quota flag', response('', { json: async () => ({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'Cotton shirt' } }) }), 'QUOTA_EXCEEDED'],
  ['quota warning with 403 status', response('', { json: async () => ({ responseStatus: 403, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' } }) }), 'QUOTA_EXCEEDED'],
  ['missing translated text', response('', { json: async () => ({ responseStatus: 200, responseData: {} }) }), 'INVALID_RESPONSE'],
  ['invalid JSON', response('', { json: async () => { throw new SyntaxError('Unexpected token'); } }), 'INVALID_RESPONSE'],
  ['service error disguised as text', response('MYMEMORY ERROR: INVALID REQUEST'), 'SERVICE_ERROR'],
  ['Chinese remains in translation', response('Soft 纯棉 shirt'), 'INCOMPLETE_TRANSLATION'],
  ['Chinese encoded as entities', response('Cotton &#x886C;&#x886B;'), 'INCOMPLETE_TRANSLATION'],
  ['abnormally long response', response('a'.repeat(5001)), 'RESULT_TOO_LONG']
];
for (const [label, result, code] of failureCases) {
  test(`rejects ${label}`, async () => {
    const translator = load(async () => result);
    await assert.rejects(translator.translate(copy()), error => error.code === code && error.message.length > 0);
  });
}

test('network errors are reported without dictionary fallback', async () => {
  const translator = load(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(translator.translate(copy()), error => error.code === 'NETWORK_ERROR');
});

test('does not truncate a valid long translation to the original Chinese UI limits', async () => {
  const text = 'A comfortably fitted cotton shirt with soft and breathable fabric. '.repeat(4);
  const translator = load(async () => response(text));
  assert.equal((await translator.translate(copy())).name, text);
});

test('rejects an already cancelled signal before making any request', async () => {
  const controller = new AbortController();
  controller.abort();
  const translator = load(() => assert.fail('No request should be made'));
  await assert.rejects(translator.translate(copy(), { signal: controller.signal }), error => error.name === 'AbortError');
});

test('cancels an in-flight request even when a mock fetch ignores abort', async () => {
  const controller = new AbortController();
  let requestSignal;
  const translator = load((url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  });
  const pending = translator.translate(copy(), { signal: controller.signal });
  controller.abort(new Error('User cancelled'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(requestSignal.aborted, true);
});

test('15-second timeout aborts both stalled fetch and stalled response body', async () => {
  for (const stallBody of [false, true]) {
    let expire;
    let requestSignal;
    let cleared = false;
    const translator = load((url, options) => {
      requestSignal = options.signal;
      return stallBody ? Promise.resolve(response('', { json: () => new Promise(() => {}) })) : new Promise(() => {});
    }, {
      setTimeout(callback, milliseconds) { assert.equal(milliseconds, 15000); expire = callback; return 7; },
      clearTimeout(timer) { assert.equal(timer, 7); cleared = true; }
    });
    const pending = translator.translate(copy());
    await nextTurn();
    expire();
    await assert.rejects(pending, error => error.name === 'TimeoutError' && error.code === 'TIMEOUT');
    assert.equal(requestSignal.aborted, true);
    assert.equal(cleared, true);
  }
});

test('a failed batch returns no partial result and commits no partial cache entries', async () => {
  let calls = 0;
  const translator = load(async () => {
    calls++;
    if (calls === 2) throw new TypeError('Disconnected');
    return response('Cotton shirt');
  });
  await assert.rejects(translator.translate(copy({ subtitle: '轻薄透气' })), error => error.code === 'NETWORK_ERROR');
  assert.equal(calls, 2);
  await translator.translate(copy());
  assert.equal(calls, 3);
  await translator.translate(copy());
  assert.equal(calls, 3, 'A successful batch should populate the session cache');
});

test('session cache is bounded to 100 strings', async () => {
  let calls = 0;
  const translator = load(async () => { calls++; return response('Cotton shirt'); });
  for (let index = 0; index < 101; index++) await translator.translate(copy({ name: `衬衫${index}` }));
  assert.equal(calls, 101);
  await translator.translate(copy({ name: '衬衫100' }));
  assert.equal(calls, 101);
  await translator.translate(copy({ name: '衬衫0' }));
  assert.equal(calls, 102);
});
