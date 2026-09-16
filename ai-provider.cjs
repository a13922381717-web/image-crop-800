const fail = (status, message) => Object.assign(new Error(message), { status });
function decodeImage(value) {
  const match = typeof value === 'string' && value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw fail(400, '只支持 PNG、JPEG、WebP 图片。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw fail(400, '单张参考图不能超过 8 MB。');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail(400, '图片文件与格式不符。');
  return { bytes, mime: 'image/' + match[1], extension: match[1] };
}
function validateEdit(body) {
  if (!body || !Array.isArray(body.images) || !body.images.length || body.images.length > 9) throw fail(400, '请提供 1–9 张参考图。');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) throw fail(400, '图片描述无效。');
  if (!['1024x1024', '1024x1536'].includes(body.size)) throw fail(400, '图片尺寸无效。');
  return body.images.map(decodeImage);
}
async function generateImage(body, { key, model = 'gpt-image-2', fetchImpl = fetch, signal }) {
  const images = validateEdit(body);
  const form = new FormData();
  for (const [i, image] of images.entries()) form.append('image[]', new Blob([image.bytes], { type: image.mime }), `reference-${i}.${image.extension}`);
  for (const [name, value] of Object.entries({ model, prompt: body.prompt, n: '1', size: body.size, quality: 'high', output_format: 'png' })) form.append(name, value);
  const response = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: signal });
  if (!response.ok) throw fail(502, response.status === 401 ? 'API Key 无效，请重新配置。' : response.status === 429 ? 'API 额度不足或请求受限，请检查 API 账户后手动重试。' : response.status === 403 ? 'API 账户没有此图片模型的访问权限。' : '图片服务未完成请求，请检查素材后重试。');
  const result = await response.json();
  const data = result.data?.[0]?.b64_json;
  if (typeof data !== 'string' || data.length > 40 * 1024 * 1024) throw fail(502, '图片服务未返回有效图片。');
  return "data:image/png;base64," + data;
}
module.exports = { decodeImage, validateEdit, generateImage };
