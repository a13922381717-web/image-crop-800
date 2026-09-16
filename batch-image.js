(function (root) {
  'use strict';

  var MAX_PIXELS = 12000000;
  var COLORS = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

  function number(value, fallback, min, max, label, integer) {
    var result = value == null ? fallback : Number(value);
    if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
      throw new RangeError(label + '必须是 ' + min + ' 到 ' + max + ' 之间的' + (integer ? '整数。' : '数字。'));
    }
    return result;
  }

  function size(width, height, maxEdge, collage) {
    number(width, null, 1, maxEdge, '图片宽度', true);
    number(height, null, 1, maxEdge, '图片高度', true);
    if (width * height > MAX_PIXELS) {
      throw new RangeError(collage ? '拼图超过 1200 万像素，请缩小输出宽度或减少图片。' : '输出图片不能超过 1200 万像素，请缩小尺寸。');
    }
    return { width: width, height: height };
  }

  function imageSize(asset) {
    if (!asset || !asset.img) throw new TypeError('请先上传有效的图片。');
    var img = asset.img;
    var width = 'naturalWidth' in img ? img.naturalWidth : (img.width || asset.width);
    var height = 'naturalHeight' in img ? img.naturalHeight : (img.height || asset.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new TypeError('图片尚未加载或无法读取，请重新上传。');
    }
    return { width: width, height: height };
  }

  function color(value, fallback, allowTransparent) {
    value = value == null ? fallback : String(value);
    if ((allowTransparent && value === 'transparent') || COLORS.test(value)) return value;
    throw new TypeError('颜色格式无效，请使用 #RGB 或 #RRGGBB' + (allowTransparent ? '，透明背景请选择 transparent。' : '。'));
  }

  function rgb(value) {
    var hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map(function (char) { return char + char; }).join('');
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function canvasOf(width, height, background, maxEdge, collage) {
    size(width, height, maxEdge || 8192, collage);
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建图片画布，请更换浏览器后重试。');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (background && background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    return canvas;
  }

  function fitMode(value) {
    value = value || 'fit';
    if (value !== 'fit' && value !== 'crop') throw new TypeError('图片适配方式必须是完整显示或居中裁剪。');
    return value;
  }

  function drawFit(ctx, asset, x, y, width, height, mode) {
    var original = imageSize(asset);
    var scale = (mode === 'crop' ? Math.max : Math.min)(width / original.width, height / original.height);
    var drawWidth = original.width * scale;
    var drawHeight = original.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    try {
      ctx.drawImage(asset.img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    } catch (_) {
      throw new Error('图片无法绘制，请重新上传 JPG、PNG 或 WebP 图片。');
    } finally {
      ctx.restore();
    }
  }

  function replaceBackground(canvas, opts) {
    var from = rgb(color(opts.sourceColor, '#ffffff', false));
    var target = color(opts.targetColor, 'transparent', true);
    var to = target === 'transparent' ? null : rgb(target);
    var tolerance = number(opts.tolerance, 24, 0, 120, '背景容差', false);
    var ctx = canvas.getContext('2d');
    var pixels;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (_) {
      throw new Error('无法读取图片背景，请使用本地上传的图片后重试。');
    }
    var data = pixels.data;
    var width = canvas.width;
    var height = canvas.height;
    var count = width * height;
    var visited = new Uint8Array(count);
    var queue = new Uint32Array(count);
    var tail = 0;

    // Traverse transparent pixels too, but retain their alpha when recoloring.
    // Only four-neighbor regions touching an edge are considered background.
    function visit(index) {
      if (visited[index]) return;
      visited[index] = 1;
      var offset = index * 4;
      var matches = data[offset + 3] === 0 || (
        Math.abs(data[offset] - from[0]) <= tolerance &&
        Math.abs(data[offset + 1] - from[1]) <= tolerance &&
        Math.abs(data[offset + 2] - from[2]) <= tolerance
      );
      if (!matches) return;
      queue[tail++] = index;
      if (to) {
        data[offset] = to[0];
        data[offset + 1] = to[1];
        data[offset + 2] = to[2];
      } else {
        data[offset + 3] = 0;
      }
    }

    for (var x = 0; x < width; x++) {
      visit(x);
      visit((height - 1) * width + x);
    }
    for (var y = 1; y < height - 1; y++) {
      visit(y * width);
      visit(y * width + width - 1);
    }
    for (var head = 0; head < tail; head++) {
      var index = queue[head];
      var column = index % width;
      if (column > 0) visit(index - 1);
      if (column < width - 1) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index < count - width) visit(index + width);
    }
    ctx.putImageData(pixels, 0, 0);
  }

  function watermark(canvas, opts) {
    var text = String(opts.text == null ? '' : opts.text).replace(/\s+/g, ' ').trim();
    if (!text) throw new TypeError('请输入要添加的水印文字。');
    var fontSize = number(opts.fontSize, 48, 12, 180, '水印字号', false);
    var opacity = number(opts.opacity, 0.4, 0.1, 1, '水印透明度', false);
    var fill = color(opts.color, '#ffffff', false);
    var position = opts.position || 'bottom-right';
    if (['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile'].indexOf(position) < 0) {
      throw new TypeError('请选择有效的水印位置。');
    }
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var margin = Math.min(Math.max(12, Math.min(width, height) * 0.025), Math.min(width, height) * 0.12);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    fontSize = Math.min(fontSize, height - margin * 2);
    ctx.font = '600 ' + fontSize + 'px sans-serif';
    var textWidth = ctx.measureText(text).width;
    if (textWidth > width - margin * 2) {
      fontSize *= (width - margin * 2) / textWidth;
      ctx.font = '600 ' + fontSize + 'px sans-serif';
      textWidth = ctx.measureText(text).width;
    }
    if (position === 'tile') {
      var reach = Math.hypot(width, height);
      var stepX = Math.max(textWidth + fontSize * 3, 80);
      var stepY = Math.max(fontSize * 3.5, 60);
      ctx.translate(width / 2, height / 2);
      ctx.rotate(-Math.PI / 6);
      for (var y = -reach; y <= reach; y += stepY) {
        for (var x = -reach; x <= reach; x += stepX) ctx.fillText(text, x, y);
      }
    } else {
      var x = position === 'center' ? (width - textWidth) / 2 : position.indexOf('right') >= 0 ? width - margin - textWidth : margin;
      var y = position === 'center' ? (height - fontSize) / 2 : position.indexOf('bottom') === 0 ? height - margin - fontSize : margin;
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function render(asset, tool, opts) {
    opts = opts || {};
    var original = imageSize(asset);
    var width = original.width;
    var height = original.height;
    var mode = 'fit';
    var background = 'transparent';
    if (tool === 'portrait' || tool === 'png800' || tool === 'resize') {
      width = tool === 'portrait' ? 900 : tool === 'png800' ? 800 : number(opts.width, 800, 1, 8192, '图片宽度', true);
      height = tool === 'portrait' ? 1200 : tool === 'png800' ? 800 : number(opts.height, 800, 1, 8192, '图片高度', true);
      mode = fitMode(opts.mode);
      background = color(opts.background, tool === 'png800' ? 'transparent' : '#ffffff', tool !== 'portrait');
    } else if (tool === 'compress') {
      var edge = number(opts.maxEdge, 1600, 1, 8192, '最长边', true);
      var scale = Math.min(1, edge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    } else if (tool !== 'watermark' && tool !== 'background') {
      throw new TypeError('暂不支持此图片工具，请重新选择。');
    }
    var canvas = canvasOf(width, height, background);
    drawFit(canvas.getContext('2d'), asset, 0, 0, width, height, mode);
    if (tool === 'watermark') watermark(canvas, opts);
    if (tool === 'background') replaceBackground(canvas, opts);
    return canvas;
  }

  function collage(assets, opts) {
    opts = opts || {};
    if (!Array.isArray(assets) || !assets.length) throw new TypeError('请先上传需要拼接的图片。');
    if (assets.length > 20) throw new RangeError('一次最多拼接 20 张图片，请分批处理。');
    var layout = opts.layout || 'grid';
    if (layout !== 'grid' && layout !== 'vertical') throw new TypeError('请选择网格拼图或纵向长图。');
    var width = number(opts.width, 1200, 1, 16000, '拼图宽度', true);
    var gap = number(opts.gap, 16, 0, 80, '图片间距', true);
    var background = color(opts.background, '#ffffff', false);
    var dimensions = assets.map(imageSize);
    var height;
    var boxes = [];
    if (layout === 'grid') {
      var columns = number(opts.columns, 2, 2, 4, '拼图列数', true);
      var cell = (width - gap * (columns + 1)) / columns;
      if (cell < 1) throw new RangeError('图片间距过大，请增加拼图宽度或缩小间距。');
      var rows = Math.ceil(assets.length / columns);
      height = Math.ceil(rows * cell + gap * (rows + 1));
      assets.forEach(function (_, index) {
        boxes.push({ x: gap + (index % columns) * (cell + gap), y: gap + Math.floor(index / columns) * (cell + gap), width: cell, height: cell });
      });
    } else {
      var innerWidth = width - gap * 2;
      if (innerWidth < 1) throw new RangeError('图片间距过大，请增加拼图宽度或缩小间距。');
      var top = gap;
      dimensions.forEach(function (dimension) {
        var itemHeight = innerWidth * dimension.height / dimension.width;
        boxes.push({ x: gap, y: top, width: innerWidth, height: itemHeight });
        top += itemHeight + gap;
      });
      height = Math.ceil(top);
    }
    if (height > 16000) throw new RangeError('拼图高度超过 16000 像素，请缩小输出宽度或减少图片。');
    var canvas = canvasOf(width, height, background, 16000, true);
    var ctx = canvas.getContext('2d');
    assets.forEach(function (asset, index) {
      var box = boxes[index];
      drawFit(ctx, asset, box.x, box.y, box.width, box.height, 'fit');
    });
    return canvas;
  }

  function encode(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      try {
        mime = mime || 'image/jpeg';
        if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw new TypeError('仅支持 JPG、PNG 或 WebP 导出。');
        quality = number(quality, 0.9, 0, 1, '导出质量', false);
        if (!canvas || typeof canvas.toBlob !== 'function') throw new TypeError('无法读取要导出的图片，请先生成图片。');
        size(canvas.width, canvas.height, 16000, true);
        var output = canvas;
        if (mime === 'image/jpeg') {
          output = canvasOf(canvas.width, canvas.height, '#ffffff', 16000, true);
          output.getContext('2d').drawImage(canvas, 0, 0);
        }
        output.toBlob(function (blob) {
          if (output !== canvas) output.width = output.height = 0;
          if (!blob || !blob.size) reject(new Error('图片导出失败，请重新生成后重试。'));
          else if (blob.type !== mime) reject(new Error('当前浏览器不支持此导出格式，请选择 JPG 或 PNG。'));
          else resolve(blob);
        }, mime, quality);
      } catch (error) {
        reject(error);
      }
    });
  }

  root.BatchImage = Object.freeze({ render: render, collage: collage, encode: encode });
})(window);
