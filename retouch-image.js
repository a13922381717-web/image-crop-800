(function (root) {
  'use strict';
  function rect(value, width, height) {
    if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(value[key])) ||
        value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1 ||
        value.x + value.width > width || value.y + value.height > height) throw new Error('请选择图片范围内的修补区域。');
    return value;
  }
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const stop = signal => { if (signal?.aborted) { const error = new Error('已取消修补。'); error.name = 'AbortError'; throw error; } };

  // Return only the selected patch: every pixel outside it stays untouched.
  async function repair(data, width, height, target, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 12000000 || data?.length !== width * height * 4) throw new Error('图片数据无效或超过 1200 万像素。');
    const area = rect(target, width, height), mode = options.mode || 'surround';
    if (!['surround', 'clone'].includes(mode)) throw new Error('修补方式无效。');
    if (area.width * area.height > 2000000) throw new Error('单次修补区域过大，请分成几个小区域处理。');
    const feather = options.feather ?? 2;
    if (!Number.isFinite(feather) || feather < 0 || feather > 24) throw new Error('边缘融合须在 0–24 像素之间。');
    let source;
    if (mode === 'clone') {
      source = rect({ ...options.source, width: area.width, height: area.height }, width, height);
      if (overlap(source, area)) throw new Error('取样区域与水印区域重叠，请选择另一处干净区域。');
    }
    const left = area.x > 0, right = area.x + area.width < width;
    const top = area.y > 0, bottom = area.y + area.height < height;
    if (mode === 'surround' && !left && !right && !top && !bottom) throw new Error('请缩小选区，保留周围干净的像素用于修补。');
    const output = new Uint8ClampedArray(area.width * area.height * 4);
    const read = (x, y, c) => {
      const i = (y * width + x) * 4;
      return c === 3 ? data[i + 3] : data[i + c] * data[i + 3] / 255;
    };
    const repaired = [0, 0, 0, 0];
    for (let y = 0; y < area.height; y++) {
      stop(options.signal);
      const py = area.y + y, v = (y + 1) / (area.height + 1);
      const wy = (top ? 1 / (y + 1) : 0) + (bottom ? 1 / (area.height - y) : 0);
      for (let x = 0; x < area.width; x++) {
        const px = area.x + x, u = (x + 1) / (area.width + 1);
        const wx = (left ? 1 / (x + 1) : 0) + (right ? 1 / (area.width - x) : 0);
        const alpha = feather ? Math.min(1, Math.min(x + 1, y + 1, area.width - x, area.height - y) / (feather + 1)) : 1;
        const at = (y * area.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          let value;
          if (source) value = read(source.x + x, source.y + y, c);
          else {
            const vertical = top && bottom ? read(px, area.y - 1, c) * (1 - v) + read(px, area.y + area.height, c) * v : top ? read(px, area.y - 1, c) : bottom ? read(px, area.y + area.height, c) : 0;
            const horizontal = left && right ? read(area.x - 1, py, c) * (1 - u) + read(area.x + area.width, py, c) * u : left ? read(area.x - 1, py, c) : right ? read(area.x + area.width, py, c) : 0;
            value = (vertical * wy + horizontal * wx) / (wy + wx);
          }
          repaired[c] = value * alpha + read(px, py, c) * (1 - alpha);
        }
        output[at + 3] = repaired[3];
        for (let c = 0; c < 3; c++) output[at + c] = repaired[3] ? repaired[c] * 255 / repaired[3] : 0;
      }
      if (y % 32 === 0) {
        options.onProgress?.(Math.round((y + 1) / area.height * 100));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    stop(options.signal);
    options.onProgress?.(100);
    return output;
  }
  const api = Object.freeze({ repair });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RetouchImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
