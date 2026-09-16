(function (root) {
  'use strict';

  var API_URL = 'https://api.mymemory.translated.net/get';
  var TIMEOUT_MS = 15000;
  var MAX_QUERY_BYTES = 500;
  var MAX_TEXT_LENGTH = 5000;
  var CACHE_LIMIT = 100;
  var cache = new Map();
  var hasHan = /\p{Script=Han}/u;

  function failure(code, message) {
    var error = new Error(message);
    error.name = 'TranslationError';
    error.code = code;
    return error;
  }

  function cancelled() {
    return new DOMException('已取消翻译。', 'AbortError');
  }

  function timeout() {
    var error = failure('TIMEOUT', '翻译请求超时（15 秒），请重试。');
    error.name = 'TimeoutError';
    return error;
  }

  function checkSignal(signal) {
    if (signal && signal.aborted) throw cancelled();
  }

  // Decode only text entities, without creating DOM nodes or interpreting markup.
  function decodeEntities(text) {
    var named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
    return text.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt|nbsp);/gi, function (match, entity) {
      var key = entity.toLowerCase();
      if (key[0] !== '#') return named[key];
      var hexadecimal = key[1] === 'x';
      var value = parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return match;
      return String.fromCodePoint(value);
    });
  }

  function readTranslation(payload) {
    if (!payload || typeof payload !== 'object') {
      throw failure('INVALID_RESPONSE', '翻译服务返回的数据无效，请重试。');
    }
    var quotaFinished = payload.quotaFinished === true || payload.quotaFinished === 1 || payload.quotaFinished === 'true';
    var rawText = payload.responseData && payload.responseData.translatedText;
    var quotaMessage = /YOU (?:HAVE )?USED ALL AVAILABLE FREE TRANSLATIONS|NEXT AVAILABLE IN\s+\d/i;
    if (quotaFinished || Number(payload.responseStatus) === 429 ||
      (typeof rawText === 'string' && quotaMessage.test(rawText)) ||
      (typeof payload.responseDetails === 'string' && quotaMessage.test(payload.responseDetails))) {
      throw failure('QUOTA_EXCEEDED', '翻译服务今日免费额度已用完，请稍后再试或手动填写英文。');
    }
    if (Number(payload.responseStatus) !== 200) {
      throw failure('SERVICE_ERROR', '翻译服务未完成请求，请稍后重试或手动填写英文。');
    }
    var text = rawText;
    if (typeof text !== 'string' || !text.trim()) {
      throw failure('INVALID_RESPONSE', '翻译服务没有返回有效译文，请重试。');
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw failure('RESULT_TOO_LONG', '翻译结果异常过长，请重试或手动填写英文。');
    }
    text = decodeEntities(text);
    if (quotaMessage.test(text)) {
      throw failure('QUOTA_EXCEEDED', '翻译服务今日免费额度已用完，请稍后再试或手动填写英文。');
    }
    if (/^\s*(?:MYMEMORY\s+(?:WARNING|ERROR)|QUERY\s+LENGTH\s+LIMIT\s+EXCEEDED|INVALID\s+(?:LANGPAIR|LANGUAGE|EMAIL)|NO\s+QUERY\s+SPECIFIED|PLEASE\s+SELECT\s+TWO\s+DISTINCT\s+LANGUAGES)/i.test(text)) {
      throw failure('SERVICE_ERROR', '翻译服务返回了错误信息，请稍后重试或手动填写英文。');
    }
    if (!text.trim()) {
      throw failure('INVALID_RESPONSE', '翻译服务没有返回有效译文，请重试。');
    }
    if (hasHan.test(text)) {
      throw failure('INCOMPLETE_TRANSLATION', '译文仍包含中文，未完成英文翻译，请重试或手动填写英文。');
    }
    return text;
  }

  async function requestTranslation(text, signal) {
    checkSignal(signal);
    var controller = new AbortController();
    var timer;
    var abortListener;
    var interrupt = new Promise(function (_, reject) {
      abortListener = function () {
        controller.abort();
        reject(cancelled());
      };
      if (signal) signal.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(function () {
        controller.abort();
        reject(timeout());
      }, TIMEOUT_MS);
    });
    var parameters = new URLSearchParams({ q: text, langpair: 'zh-CN|en', mt: '1' });
    async function work() {
      var response;
      try {
        response = await fetch(API_URL + '?' + parameters.toString(), {
          method: 'GET',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: controller.signal
        });
      } catch (error) {
        checkSignal(signal);
        if (controller.signal.aborted) throw timeout();
        throw failure('NETWORK_ERROR', '无法连接翻译服务，请检查网络后重试。');
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw failure('QUOTA_EXCEEDED', '翻译服务请求过多或额度已用完，请稍后重试。');
        }
        throw failure('HTTP_ERROR', '翻译服务请求失败（HTTP ' + response.status + '），请稍后重试。');
      }
      var payload;
      try {
        payload = await response.json();
      } catch (error) {
        checkSignal(signal);
        if (controller.signal.aborted) throw timeout();
        throw failure('INVALID_RESPONSE', '翻译服务返回的数据无法读取，请重试。');
      }
      checkSignal(signal);
      return readTranslation(payload);
    }
    try {
      // The race also bounds implementations where fetch/body reading ignores abort.
      return await Promise.race([work(), interrupt]);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortListener);
    }
  }

  function validateCopy(copy) {
    if (!copy || typeof copy.name !== 'string' || typeof copy.subtitle !== 'string' ||
      !Array.isArray(copy.sellingPoints) || copy.sellingPoints.length > 4 ||
      copy.sellingPoints.some(function (point) { return typeof point !== 'string'; })) {
      throw failure('INVALID_INPUT', '请提供产品名称、副标题和最多 4 条卖点文案。');
    }
    var texts = [copy.name, copy.subtitle].concat(copy.sellingPoints);
    var encoder = new TextEncoder();
    texts.forEach(function (text) {
      if (text.length > MAX_TEXT_LENGTH) throw failure('INPUT_TOO_LONG', '文案过长，请精简后再翻译。');
      if (hasHan.test(text) && encoder.encode(text).length > MAX_QUERY_BYTES) {
        throw failure('QUERY_TOO_LONG', '单段文案超过翻译服务的 500 字节限制，请精简后再翻译。');
      }
    });
    return texts;
  }

  /**
   * Only the three copy fields are considered. Photos and any extra fields stay local.
   * Progress counts unique Chinese text segments, including session cache hits.
   * A failure rejects the whole result and does not commit any new cache entries.
   */
  async function translate(copy, options) {
    options = options || {};
    var signal = options.signal;
    checkSignal(signal);
    var texts = validateCopy(copy);
    var queries = Array.from(new Set(texts.filter(function (text) { return hasHan.test(text); })));
    var translated = new Map();
    var fresh = new Map();
    var done = 0;
    function progress() {
      if (typeof options.onProgress === 'function') options.onProgress({ done: done, total: queries.length });
    }
    progress();
    for (var index = 0; index < queries.length; index++) {
      checkSignal(signal);
      var source = queries[index];
      var result = cache.has(source) ? cache.get(source) : await requestTranslation(source, signal);
      checkSignal(signal);
      translated.set(source, result);
      if (!cache.has(source)) fresh.set(source, result);
      done++;
      progress();
    }
    checkSignal(signal);
    fresh.forEach(function (text, source) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(source, text);
    });
    var results = texts.map(function (text) { return translated.has(text) ? translated.get(text) : text; });
    return { name: results[0], subtitle: results[1], sellingPoints: results.slice(2) };
  }

  root.DetailTranslation = Object.freeze({ translate: translate });
})(window);
