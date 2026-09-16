(function () {
  'use strict';

  const WIDTH = 800;
  const HEIGHT = 1200;
  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
  const pageTitles = ['产品封面', '核心卖点', '细节展示', '多角度展示', '产品总览'];
  const englishPageTitles = ['Product Cover', 'Key Features', 'Product Details', 'Product Views', 'Product Overview'];
  const labels = {
    zh: { product: '产品展示', noImage: '未上传图片', noPoints: '尚未填写卖点文案', detail: '细节', view: '视图' },
    en: { product: 'Product Display', noImage: 'No image uploaded', noPoints: 'No key features added', detail: 'Detail', view: 'View' }
  };

  function getPageTitles(language) {
    return (language === 'en' ? englishPageTitles : pageTitles).slice();
  }
  const themes = {
    ink: { name: '极简黑白', background: '#f3f4f5', foreground: '#20262d', muted: '#68727b', accent: '#20262d', soft: '#e4e8eb', line: '#d9dfe3', onAccent: '#ffffff' },
    sand: { name: '暖沙米色', background: '#f4efe6', foreground: '#44372c', muted: '#80705e', accent: '#936c45', soft: '#e7dccb', line: '#ded1bd', onAccent: '#ffffff' },
    sage: { name: '清新鼠尾草', background: '#edf1eb', foreground: '#303f37', muted: '#6b7b6f', accent: '#55715e', soft: '#dbe5d9', line: '#cbd8c9', onAccent: '#ffffff' }
  };

  function clean(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength || 2000);
  }

  function normalize(data) {
    data = data || {};
    const language = data.language === 'en' ? 'en' : 'zh';
    const isImage = item => item && item.img && (item.img.naturalWidth || item.img.width) > 0 && (item.img.naturalHeight || item.img.height) > 0;
    const products = Array.isArray(data.productImages) ? data.productImages.filter(isImage) : [];
    const details = Array.isArray(data.detailImages) ? data.detailImages.filter(isImage) : [];
    return {
      language,
      labels: labels[language],
      name: clean(data.name, language === 'en' ? 120 : 300) || labels[language].product,
      subtitle: clean(data.subtitle, language === 'en' ? 180 : 500),
      sellingPoints: Array.isArray(data.sellingPoints) ? data.sellingPoints.map(v => clean(v, language === 'en' ? 240 : 100)).filter(Boolean).slice(0, 4) : [],
      products,
      details,
      theme: Object.assign({}, themes[data.theme] || themes.ink, { language })
    };
  }

  function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Keep ordinary English words together; only split tokens wider than a line.
  // CJK characters remain separate tokens so mixed Chinese/English copy also fits.
  function wrapText(ctx, text, width) {
    const lines = [];
    String(text).split(/\r?\n/).forEach(paragraph => {
      let line = '';
      let space = '';
      const tokens = paragraph.match(/\s+|[A-Za-z0-9\u00C0-\u024F]+(?:['’_-][A-Za-z0-9\u00C0-\u024F]+)*[.,!?;:)]*|[^\s]/gu) || [];
      for (const token of tokens) {
        if (/^\s+$/.test(token)) { space = line ? ' ' : ''; continue; }
        if (ctx.measureText(line + space + token).width <= width) {
          line += space + token;
        } else {
          if (line) { lines.push(line); line = ''; }
          if (ctx.measureText(token).width <= width) {
            line = token;
          } else {
            for (const character of Array.from(token)) {
              if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ''; }
              line += character;
            }
          }
        }
        space = '';
      }
      lines.push(line.trimEnd());
    });
    return lines;
  }

  function ellipsize(ctx, text, width) {
    let trimmed = text.trimEnd();
    while (ctx.measureText(trimmed + '…').width > width && /\s+[A-Za-z0-9\u00C0-\u024F][^\s]*$/.test(trimmed)) {
      trimmed = trimmed.replace(/\s+[^\s]*$/, '');
    }
    const characters = Array.from(trimmed);
    while (characters.length && ctx.measureText(characters.join('') + '…').width > width) characters.pop();
    return characters.join('').trimEnd() + '…';
  }

  function textBox(ctx, text, x, y, width, height, options) {
    const opt = Object.assign({ size: 28, minSize: 18, weight: 400, color: '#20262d', lineHeight: 1.4, align: 'left', vertical: 'top', maxLines: Infinity }, options);
    const value = clean(text, 5000);
    if (!value || width <= 0 || height <= 0) return { lines: [], fontSize: opt.size, truncated: false };
    ctx.save();
    let fontSize = opt.size;
    let lines;
    let capacity;
    for (; fontSize >= opt.minSize; fontSize--) {
      ctx.font = opt.weight + ' ' + fontSize + 'px ' + FONT;
      lines = wrapText(ctx, value, width);
      capacity = Math.max(1, Math.min(opt.maxLines, Math.floor(height / (fontSize * opt.lineHeight))));
      if (lines.length <= capacity && lines.every(line => ctx.measureText(line).width <= width)) break;
    }
    fontSize = Math.max(fontSize, opt.minSize);
    ctx.font = opt.weight + ' ' + fontSize + 'px ' + FONT;
    const truncated = lines.length > capacity;
    if (truncated) {
      lines = lines.slice(0, capacity);
      lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1], width);
    }
    lines = lines.map(line => ctx.measureText(line).width <= width ? line : ellipsize(ctx, line, width));
    const lineHeight = fontSize * opt.lineHeight;
    const usedHeight = lines.length * lineHeight;
    let top = y + (opt.vertical === 'middle' ? (height - usedHeight) / 2 : opt.vertical === 'bottom' ? height - usedHeight : 0);
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.fillStyle = opt.color;
    ctx.textAlign = opt.align;
    ctx.textBaseline = 'top';
    const left = opt.align === 'center' ? x + width / 2 : opt.align === 'right' ? x + width : x;
    lines.forEach(line => { ctx.fillText(line, left, top + (lineHeight - fontSize) / 2); top += lineHeight; });
    ctx.restore();
    return { lines, fontSize, truncated };
  }

  function line(ctx, x1, y1, x2, y2, color) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  }

  function photo(ctx, item, x, y, width, height, theme, padding) {
    const pad = padding == null ? 14 : padding;
    ctx.save();
    roundedRect(ctx, x, y, width, height, 18, '#ffffff');
    ctx.clip();
    const img = item && item.img;
    if (img) {
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      const scale = Math.min((width - pad * 2) / sourceWidth, (height - pad * 2) / sourceHeight);
      if (scale > 0) ctx.drawImage(img, x + (width - sourceWidth * scale) / 2, y + (height - sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale);
    } else {
      roundedRect(ctx, x + width / 2 - 25, y + height / 2 - 44, 50, 40, 5, null, theme.line);
      textBox(ctx, labels[theme.language].noImage, x + 12, y + height / 2 + 8, width - 24, 32, { size: 20, minSize: 16, color: theme.muted, align: 'center' });
    }
    ctx.restore();
  }

  function base(ctx, theme, index) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    roundedRect(ctx, 48, 50, 34, 5, 2, theme.accent);
    textBox(ctx, 'PRODUCT / ' + String(index + 1).padStart(2, '0'), 96, 40, 390, 28, { size: 16, minSize: 16, weight: 600, color: theme.muted });
    line(ctx, 48, 1137, 752, 1137, theme.line);
    textBox(ctx, getPageTitles(theme.language)[index], 48, 1150, 520, 28, { size: 16, minSize: 16, color: theme.muted });
    textBox(ctx, String(index + 1).padStart(2, '0') + ' / 05', 640, 1147, 112, 32, { size: 20, minSize: 20, weight: 600, color: theme.foreground, align: 'right' });
  }

  function heading(ctx, data, index) {
    const title = getPageTitles(data.language)[index];
    textBox(ctx, title, 48, 91, 704, 72, { size: 48, minSize: 36, weight: 700, color: data.theme.foreground });
    textBox(ctx, data.name, 50, 171, 700, 38, { size: 22, minSize: 18, color: data.theme.muted, maxLines: 1 });
  }

  function cover(ctx, data) {
    const theme = data.theme;
    textBox(ctx, data.name, 48, 104, 704, 152, { size: 58, minSize: 32, weight: 700, color: theme.foreground, lineHeight: 1.2, maxLines: 3 });
    textBox(ctx, data.subtitle, 50, 268, 700, 67, { size: 25, minSize: 19, color: theme.muted, maxLines: 2 });
    photo(ctx, data.products[0] || data.details[0], 48, 358, 704, 626, theme, 22);
    if (data.sellingPoints.length) {
      roundedRect(ctx, 48, 1008, 704, 96, 16, theme.accent);
      textBox(ctx, data.sellingPoints[0], 72, 1024, 656, 64, { size: 26, minSize: 19, weight: 600, color: theme.onAccent, vertical: 'middle', maxLines: 2 });
    } else {
      textBox(ctx, data.labels.product, 50, 1028, 700, 42, { size: 24, minSize: 24, color: theme.muted });
    }
  }

  function sellingPoints(ctx, data) {
    const theme = data.theme;
    heading(ctx, data, 1);
    const points = data.sellingPoints;
    const imageHeight = points.length > 2 ? 300 : 486;
    photo(ctx, data.products[0] || data.details[0], 48, 232, 704, imageHeight, theme, 20);
    if (!points.length) {
      textBox(ctx, data.subtitle || data.labels.noPoints, 66, 786, 668, 172, { size: 34, minSize: 22, color: theme.foreground, align: 'center', vertical: 'middle', maxLines: 4 });
      return;
    }
    const startY = 232 + imageHeight + 24;
    const cardHeight = Math.min(158, (1108 - startY - (points.length - 1) * 12) / points.length);
    points.forEach((point, i) => {
      const y = startY + i * (cardHeight + 12);
      roundedRect(ctx, 48, y, 704, cardHeight, 16, '#ffffff');
      roundedRect(ctx, 66, y + (cardHeight - 46) / 2, 46, 46, 12, theme.soft);
      textBox(ctx, String(i + 1).padStart(2, '0'), 68, y + (cardHeight - 38) / 2, 42, 38, { size: 22, minSize: 22, weight: 600, color: theme.accent, align: 'center', vertical: 'middle' });
      textBox(ctx, point, 132, y + 14, 594, cardHeight - 28, { size: 28, minSize: 18, weight: 600, color: theme.foreground, vertical: 'middle', maxLines: 4 });
    });
  }

  function detailPhotos(ctx, data) {
    const theme = data.theme;
    heading(ctx, data, 2);
    const items = (data.details.length ? data.details : data.products).slice(0, 6);
    const count = Math.max(1, items.length);
    if (count === 1) {
      photo(ctx, items[0], 48, 242, 704, 780, theme, 24);
      textBox(ctx, data.labels.detail + ' 01', 50, 1042, 700, 40, { size: 22, minSize: 22, color: theme.muted });
      return;
    }
    if (count === 2) {
      items.forEach((item, i) => {
        const y = 242 + i * 434;
        photo(ctx, item, 48, y, 704, 376, theme, 18);
        textBox(ctx, data.labels.detail + ' ' + String(i + 1).padStart(2, '0'), 52, y + 390, 692, 34, { size: 20, minSize: 20, color: theme.muted });
      });
      return;
    }
    if (count > 4) {
      items.forEach((item, i) => {
        const x = 48 + (i % 2) * 362;
        const y = 242 + Math.floor(i / 2) * 288;
        photo(ctx, item, x, y, 342, 238, theme, 12);
        textBox(ctx, data.labels.detail + ' ' + String(i + 1).padStart(2, '0'), x + 4, y + 252, 334, 32, { size: 20, minSize: 20, color: theme.muted });
      });
      if (count === 5) {
        roundedRect(ctx, 410, 818, 342, 238, 18, theme.soft);
        textBox(ctx, data.name, 434, 842, 294, 190, { size: 30, minSize: 21, weight: 600, color: theme.foreground, vertical: 'middle', maxLines: 6 });
      }
      return;
    }
    items.forEach((item, i) => {
      const x = 48 + (i % 2) * 362;
      const y = 242 + Math.floor(i / 2) * 434;
      photo(ctx, item, x, y, 342, 376, theme, 14);
      textBox(ctx, data.labels.detail + ' ' + String(i + 1).padStart(2, '0'), x + 4, y + 390, 334, 32, { size: 20, minSize: 20, color: theme.muted });
    });
    if (count === 3) {
      roundedRect(ctx, 410, 676, 342, 376, 18, theme.soft);
      textBox(ctx, data.name, 436, 706, 290, 300, { size: 37, minSize: 24, weight: 600, color: theme.foreground, vertical: 'middle', maxLines: 7 });
    }
  }

  function angles(ctx, data) {
    const theme = data.theme;
    heading(ctx, data, 3);
    const items = (data.products.length ? data.products : data.details).slice(0, 6);
    if (items.length <= 1) {
      roundedRect(ctx, 48, 242, 704, 842, 22, theme.soft);
      photo(ctx, items[0], 70, 264, 660, 728, theme, 24);
      textBox(ctx, data.subtitle || data.name, 78, 1010, 644, 54, { size: 24, minSize: 18, color: theme.foreground, align: 'center', vertical: 'middle', maxLines: 2 });
    } else if (items.length === 2) {
      items.forEach((item, i) => {
        const x = 48 + i * 362;
        photo(ctx, item, x, 242, 342, 770, theme, 16);
        textBox(ctx, data.labels.view + ' ' + String(i + 1).padStart(2, '0'), x, 1032, 342, 40, { size: 22, minSize: 22, color: theme.muted, align: 'center' });
      });
    } else if (items.length === 3) {
      photo(ctx, items[0], 48, 242, 704, 456, theme, 20);
      items.slice(1).forEach((item, i) => photo(ctx, item, 48 + i * 362, 722, 342, 360, theme, 14));
    } else if (items.length === 4) {
      photo(ctx, items[0], 48, 242, 438, 842, theme, 18);
      items.slice(1).forEach((item, i) => photo(ctx, item, 508, 242 + i * 288, 244, 266, theme, 12));
    } else {
      items.forEach((item, i) => photo(ctx, item, 48 + (i % 2) * 362, 242 + Math.floor(i / 2) * 288, 342, 266, theme, 12));
      if (items.length === 5) {
        roundedRect(ctx, 410, 818, 342, 266, 18, theme.soft);
        textBox(ctx, data.subtitle || data.name, 434, 842, 294, 218, { size: 30, minSize: 21, weight: 600, color: theme.foreground, vertical: 'middle', maxLines: 7 });
      }
    }
  }

  function overview(ctx, data) {
    const theme = data.theme;
    heading(ctx, data, 4);
    const items = data.products.concat(data.details).slice(0, 3);
    if (items.length < 2) {
      photo(ctx, items[0], 48, 242, 704, 478, theme, 22);
    } else {
      photo(ctx, items[0], 48, 242, 438, 478, theme, 18);
      if (items.length === 2) photo(ctx, items[1], 508, 242, 244, 478, theme, 12);
      else items.slice(1).forEach((item, i) => photo(ctx, item, 508, 242 + i * 250, 244, 228, theme, 12));
    }
    textBox(ctx, data.subtitle || data.name, 50, 744, 700, 82, { size: 28, minSize: 20, weight: 600, color: theme.foreground, maxLines: 2 });
    if (!data.sellingPoints.length) {
      roundedRect(ctx, 48, 850, 704, 234, 18, theme.soft);
      textBox(ctx, data.name, 78, 878, 644, 176, { size: 40, minSize: 24, weight: 600, color: theme.foreground, vertical: 'middle', align: 'center', maxLines: 4 });
      return;
    }
    data.sellingPoints.forEach((point, i) => {
      const y = 850 + i * 62;
      roundedRect(ctx, 48, y, 704, 52, 12, i % 2 === 0 ? theme.soft : '#ffffff');
      textBox(ctx, String(i + 1).padStart(2, '0'), 66, y + 8, 36, 36, { size: 20, minSize: 20, weight: 600, color: theme.accent, align: 'center', vertical: 'middle' });
      textBox(ctx, point, 122, y + 7, 610, 38, { size: 22, minSize: 18, color: theme.foreground, vertical: 'middle', maxLines: 1 });
    });
  }

  function render(data, pageIndex) {
    const normalized = normalize(data);
    const index = Math.max(0, Math.min(4, Math.floor(Number(pageIndex) || 0)));
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建 Canvas，请换用支持 Canvas 的浏览器。');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    base(ctx, normalized.theme, index);
    [cover, sellingPoints, detailPhotos, angles, overview][index](ctx, normalized);
    return canvas;
  }

  window.DetailRenderer = { render, themes, pageTitles, getPageTitles, WIDTH, HEIGHT, wrapText, textBox };
})();
