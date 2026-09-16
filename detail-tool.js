(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const renderer = window.DetailRenderer;
  const exporter = window.DetailExport;
  const assets = { product: [], detail: [] };
  let results = [];
  let resultName = '';
  let resultLanguage = 'zh';
  let translationSource = null;
  let translationController = null;
  let revision = 0;
  let generatedRevision = -1;
  let busy = '';
  let selectedPreview = 0;
  const fresh = () => results.length === 5 && generatedRevision === revision;
  // Leave room for the sequence, language marker and extension inside the exporter's limit.
  const outputPrefix = () => Array.from(exporter.safeName(resultName)).slice(0, 48).join('');
  const copyIDs = language => language === 'en' ? ['englishProductName', 'englishProductSubtitle', 'englishSellingPoints'] : ['productName', 'productSubtitle', 'sellingPoints'];
  function getCopy(language) {
    const [name, subtitle, points] = copyIDs(language);
    return { name: $(name).value.trim(), subtitle: $(subtitle).value.trim(), sellingPoints: $(points).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) };
  }
  const sourceSignature = () => JSON.stringify(getCopy('zh'));
  const staleTranslation = () => translationSource !== null && translationSource !== sourceSignature();
  const hasEnglish = () => copyIDs('en').some(id => $(id).value.trim());
  function translationStatus(message, kind = '') {
    $('translationStatus').textContent = message;
    $('translationStatus').className = 'detail-status ' + kind;
  }

  function status(message, kind = '') {
    $('detailStatus').textContent = message;
    $('detailStatus').className = 'detail-status ' + kind;
  }
  function exportStatus(message, kind = '') {
    $('detailExportStatus').textContent = message;
    $('detailExportStatus').className = 'detail-status ' + kind;
  }
  function updateControls() {
    const english = $('detailLanguage').value === 'en';
    $('detailFields').disabled = !!busy;
    $('generateDetails').disabled = !!busy;
    $('generateDetails').textContent = busy === 'translating' ? '正在翻译文案…' : busy === 'generating' ? '正在生成详情图…' : busy === 'loading' ? '正在读取素材…' : `${results.length ? '重新生成' : '生成'} 5 张${english ? '英文' : ''}详情图`;
    $('englishCopyPanel').hidden = !english;
    $('sourceNameHint').textContent = english ? '翻译原文 · 最多 40 字' : '必填 · 最多 40 字';
    $('sourcePointsHint').textContent = english ? '用于翻译，可直接填写下方英文' : '必填';
    $('productName').required = $('sellingPoints').required = !english;
    $('englishProductName').required = $('englishSellingPoints').required = english;
    $('translationStaleNotice').hidden = !staleTranslation();
    $('cancelTranslation').hidden = busy !== 'translating';
    $('translateDetails').textContent = busy === 'translating' ? '正在翻译…' : hasEnglish() ? '重新翻译并替换英文' : '将中文文案翻译成英文';
    const disabled = !!busy || !fresh();
    $('downloadDetailsZip').disabled = disabled;
    $('saveDetailsFolder').disabled = disabled || typeof window.showDirectoryPicker !== 'function';
    $('downloadSingleDetail').disabled = disabled;
    $('previousDetail').disabled = !!busy || selectedPreview === 0;
    $('nextDetail').disabled = !!busy || selectedPreview >= results.length - 1;
    $('detailFormat').disabled = !!busy;
    $('detailPreviewGrid').classList.toggle('stale', results.length > 0 && !fresh());
    $('detailPreviewGrid').querySelectorAll('button').forEach(button => { button.disabled = !!busy; });
    $('detailResultHint').textContent = results.length && !fresh() ? '内容已修改，请重新生成后再导出。下方为上次结果。' : `800×1200 px${results.length ? resultLanguage === 'en' ? ' · 英文版' : ' · 中文版' : ''} · 点击图片放大查看`;
  }
  function setBusy(value) { busy = value; updateControls(); }
  function changed() {
    revision++;
    exportStatus('');
    if (results.length) status('内容已修改，点击“重新生成”更新整套详情图。');
    updateControls();
  }

  function renderAssets(type) {
    const host = $(type === 'product' ? 'productAssets' : 'detailAssets');
    host.replaceChildren();
    assets[type].forEach((asset, index) => {
      const card = document.createElement('div'); card.className = 'detail-asset';
      const image = document.createElement('img'); image.src = asset.url; image.alt = asset.name;
      const caption = document.createElement('div'); caption.className = 'asset-caption'; caption.textContent = asset.name; caption.title = asset.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'asset-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除 ' + asset.name);
      remove.addEventListener('click', () => {
        if (busy) return;
        assets[type].splice(index, 1); URL.revokeObjectURL(asset.url); asset.img.src = '';
        changed(); renderAssets(type);
      });
      card.append(image, caption, remove);
      if (type === 'product') {
        if (index === 0) {
          const tag = document.createElement('span'); tag.className = 'asset-cover'; tag.textContent = '当前封面'; card.append(tag);
        } else {
          const cover = document.createElement('button'); cover.type = 'button'; cover.textContent = '设为封面';
          cover.addEventListener('click', () => { if (busy) return; assets.product.unshift(assets.product.splice(index, 1)[0]); changed(); renderAssets(type); });
          card.append(cover);
        }
      }
      host.append(card);
    });
  }

  async function addAssets(type, fileList) {
    if (busy) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy('loading'); status('正在读取图片…');
    const problems = [];
    let added = 0;
    try {
      for (const file of files) {
        if (assets[type].length >= 6) { problems.push('每组最多 6 张，超出的图片未添加。'); break; }
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) {
          problems.push(`${file.name}：仅支持 JPG、PNG 或 WebP。`); continue;
        }
        if (file.size > 20 * 1024 * 1024) { problems.push(`${file.name}：超过 20 MB。`); continue; }
        const url = URL.createObjectURL(file);
        const img = new Image(); img.decoding = 'async'; img.src = url;
        try {
          await img.decode();
          if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 32_000_000 || Math.max(img.naturalWidth, img.naturalHeight) > 12000) {
            throw new Error('图片过大，请缩小至 3200 万像素以内，最长边不超过 12000 像素');
          }
          // Keep decoded working images bounded; uploaded originals are never modified.
          const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale < 1) {
            const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器无法读取图片');
            context.imageSmoothingQuality = 'high'; context.drawImage(img, 0, 0, canvas.width, canvas.height);
            const blob = await exporter.toBlob(canvas, 'image/png'); canvas.width = canvas.height = 0;
            const resizedURL = URL.createObjectURL(blob);
            try { img.src = resizedURL; await img.decode(); } catch (error) { URL.revokeObjectURL(resizedURL); throw error; }
            URL.revokeObjectURL(url);
            assets[type].push({ name: file.name, url: resizedURL, img });
          } else { assets[type].push({ name: file.name, url, img }); }
          added++;
        } catch (error) {
          URL.revokeObjectURL(url); img.src = '';
          problems.push(`${file.name}：${error.message.includes('图片过大') ? error.message : '无法读取，请检查图片是否损坏。'}`);
        }
      }
      if (added) { changed(); renderAssets(type); }
      status([added ? `已添加 ${added} 张${type === 'product' ? '产品' : '细节'}图。` : '', ...problems].filter(Boolean).join(' '), problems.length ? 'error' : 'success');
    } finally { setBusy(''); }
  }
  ['product', 'detail'].forEach(type => {
    const input = $(type === 'product' ? 'productInput' : 'detailInput');
    const drop = $(type === 'product' ? 'productDrop' : 'detailDrop');
    input.addEventListener('change', () => { void addAssets(type, input.files); input.value = ''; });
    drop.addEventListener('keydown', event => { if (!busy && ['Enter', ' '].includes(event.key)) { event.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); if (!busy) drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', event => { void addAssets(type, event.dataTransfer.files); });
  });
  $('useCropBtn').addEventListener('click', () => {
    if (busy) return;
    setBusy('loading'); status('正在读取当前裁剪图…');
    document.dispatchEvent(new CustomEvent('detail:request-crop'));
  });
  document.addEventListener('detail:crop-ready', event => {
    setBusy('');
    if (event.detail.error) { status(event.detail.error, 'error'); return; }
    void addAssets('product', [new File([event.detail.blob], event.detail.name, { type: 'image/png' })]);
  });

  [...copyIDs('zh'), ...copyIDs('en')].forEach(id => $(id).addEventListener('input', changed));
  $('detailLanguage').addEventListener('change', () => {
    changed();
    document.dispatchEvent(new CustomEvent('studio:detail-language-changed', { detail: { language: $('detailLanguage').value } }));
  });
  document.querySelectorAll('input[name=detailTheme]').forEach(input => input.addEventListener('change', changed));

  function invalid(message, element) { element?.focus(); throw new Error(message); }
  function readCopy(language) {
    const english = language === 'en';
    const copy = getCopy(language);
    const ids = copyIDs(language);
    const limits = english ? [120, 180, 240] : [40, 60, 100];
    if (!copy.name || copy.name.length > limits[0]) invalid(`请填写${english ? '英文' : ''}产品名称，最多 ${limits[0]} ${english ? '字符' : '字'}。`, $(ids[0]));
    if (copy.subtitle.length > limits[1]) invalid(`副标题过长，请精简至 ${limits[1]} ${english ? '字符' : '字'}以内。`, $(ids[1]));
    if (!copy.sellingPoints.length || copy.sellingPoints.length > 4 || copy.sellingPoints.some(value => value.length > limits[2])) invalid(`请填写 1–4 条${english ? '英文' : ''}卖点，每行一条，每条最多 ${limits[2]} ${english ? '字符' : '字'}。`, $(ids[2]));
    if (english && [copy.name, copy.subtitle, ...copy.sellingPoints].some(value => /\p{Script=Han}/u.test(value))) invalid('英文文案中仍有中文，请翻译或编辑后再生成。', $(ids[0]));
    return copy;
  }
  function readData() {
    if (!assets.product.length) invalid('请至少上传一张产品图，或使用当前裁剪结果。', $('productDrop'));
    const language = $('detailLanguage').value;
    if (language === 'en' && staleTranslation()) invalid('中文已修改，请重新翻译，或核对并保留当前英文后再生成。', $('keepEnglishCopy'));
    return { ...readCopy(language), language, productImages: [...assets.product], detailImages: [...assets.detail], theme: document.querySelector('input[name=detailTheme]:checked').value };
  }

  $('translateDetails').addEventListener('click', async () => {
    if (busy) return;
    let copy;
    try { copy = readCopy('zh'); } catch (error) { translationStatus(error.message, 'error'); return; }
    const signature = sourceSignature();
    const controller = new AbortController(); translationController = controller;
    setBusy('translating'); translationStatus('正在连接翻译服务…');
    status('正在翻译产品文案，中文原文会保留。');
    try {
      const translated = await window.DetailTranslation.translate(copy, {
        signal: controller.signal,
        onProgress: progress => { translationStatus(`正在翻译 ${progress.done} / ${progress.total} 段文案…`); }
      });
      if (controller.signal.aborted) throw new DOMException('Translation cancelled', 'AbortError');
      // Replace the English fields together only after the complete translation succeeds.
      $('englishProductName').value = translated.name;
      $('englishProductSubtitle').value = translated.subtitle;
      $('englishSellingPoints').value = translated.sellingPoints.join('\n');
      translationSource = signature; changed();
      const tooLong = translated.name.length > 120 || translated.subtitle.length > 180 || translated.sellingPoints.some(point => point.length > 240);
      translationStatus(tooLong ? '翻译完成，部分英文超过排版长度限制，请精简后生成。完整译文已保留。' : '翻译完成，可以修改英文，再生成整套英文详情图。', tooLong ? 'error' : 'success');
      status('英文文案已就绪，核对后点击生成英文详情图。');
    } catch (error) {
      const message = error.name === 'AbortError' ? '已取消翻译，已有英文未改变。' : `翻译未完成：${error.message || '请检查网络，或直接填写英文。'} 已有英文未改变。`;
      translationStatus(message, error.name === 'AbortError' ? '' : 'error');
      status(message, error.name === 'AbortError' ? '' : 'error');
    } finally { translationController = null; setBusy(''); }
  });
  $('cancelTranslation').addEventListener('click', () => translationController?.abort());
  $('keepEnglishCopy').addEventListener('click', () => { if (busy) return; translationSource = sourceSignature(); changed(); translationStatus('已保留当前英文文案，可继续编辑或生成。'); });
  function releaseResults(list) {
    list.forEach(result => { URL.revokeObjectURL(result.url); result.canvas.width = result.canvas.height = 0; });
  }
  function renderPreviews() {
    $('detailPreviewGrid').replaceChildren();
    results.forEach((result, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'detail-preview'; button.setAttribute('aria-label', `放大查看第 ${index + 1} 张：${result.title}`);
      const img = document.createElement('img'); img.src = result.url; img.alt = result.title; img.width = 800; img.height = 1200;
      const caption = document.createElement('span'); caption.textContent = `${String(index + 1).padStart(2, '0')} ${result.title}`;
      const hint = document.createElement('small'); hint.textContent = '放大 ↗'; caption.append(hint);
      button.append(img, caption); button.addEventListener('click', () => { selectedPreview = index; showPreview(); $('detailLightbox').showModal(); });
      $('detailPreviewGrid').append(button);
    });
    $('detailCount').textContent = `${results.length} / 5`;
    $('detailEmpty').hidden = results.length > 0;
  }
  $('detailForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    let data;
    try { data = readData(); } catch (error) { status(error.message, 'error'); return; }
    setBusy('generating'); exportStatus('');
    const next = [];
    const titles = renderer.getPageTitles(data.language);
    try {
      await document.fonts?.ready;
      for (let index = 0; index < 5; index++) {
        status(`正在生成 ${index + 1} / 5：${titles[index]}…`);
        await new Promise(resolve => setTimeout(resolve, 0));
        const canvas = renderer.render(data, index);
        let blob;
        try { blob = await exporter.toBlob(canvas, 'image/png'); } catch (error) { canvas.width = canvas.height = 0; throw error; }
        next.push({ canvas, blob, url: URL.createObjectURL(blob), title: titles[index] });
      }
      releaseResults(results); results = next; resultName = data.name; resultLanguage = data.language; generatedRevision = revision;
      renderPreviews();
      const fallback = !assets.detail.length ? ' 未上传细节图，细节页已使用产品图。' : '';
      const single = assets.product.length === 1 ? ' 目前仅有一张产品图，多角度页使用该图；添加更多角度可丰富展示。' : '';
      status(`已生成 5 张 800×1200 ${data.language === 'en' ? '英文' : ''}详情图，可放大检查并批量导出。` + fallback + single, 'success');
    } catch (error) {
      releaseResults(next); status('生成失败：' + (error.message || '请减少图片大小后重试。'), 'error');
    } finally { setBusy(''); }
  });

  function showPreview() {
    const result = results[selectedPreview]; if (!result) return;
    $('lightboxImage').src = result.url; $('lightboxImage').alt = result.title;
    $('lightboxTitle').textContent = `${selectedPreview + 1} / 5 · ${result.title} · 800×1200`;
    $('detailLightbox').scrollTop = 0; updateControls();
  }
  $('closeLightbox').addEventListener('click', () => $('detailLightbox').close());
  $('detailLightbox').addEventListener('click', event => { if (event.target === $('detailLightbox')) { const rect = $('detailLightbox').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('detailLightbox').close(); } });
  $('previousDetail').addEventListener('click', () => { if (selectedPreview > 0) { selectedPreview--; showPreview(); } });
  $('nextDetail').addEventListener('click', () => { if (selectedPreview < results.length - 1) { selectedPreview++; showPreview(); } });

  async function exportFiles(mime) {
    const extension = mime === 'image/png' ? 'png' : 'jpg';
    const files = [];
    for (let index = 0; index < results.length; index++) {
      exportStatus(`正在准备 ${index + 1} / 5 张图片…`);
      const result = results[index];
      files.push({ name: `${String(index + 1).padStart(2, '0')}_${result.title}.${extension}`, blob: mime === 'image/png' ? result.blob : await exporter.toBlob(result.canvas, mime) });
    }
    return files;
  }
  function handleExportError(error) {
    if (error.name === 'AbortError') exportStatus('已取消保存，可以重新导出。');
    else exportStatus('导出未完成：' + (error.message || '请重新选择文件夹，或使用 ZIP 下载。'), 'error');
  }
  $('downloadDetailsZip').addEventListener('click', async () => {
    if (busy || !fresh()) return;
    const mime = $('detailFormat').value; setBusy('exporting');
    try {
      const files = await exportFiles(mime);
      const zip = await exporter.makeZip(files);
      exporter.download(zip, `${outputPrefix()}_${resultLanguage === 'en' ? 'details_en' : '详情图'}_${Date.now()}.zip`);
      exportStatus('已发起 ZIP 下载，包含 5 张独立详情图。请在浏览器下载记录中查看。', 'success');
    } catch (error) { handleExportError(error); } finally { setBusy(''); }
  });
  $('saveDetailsFolder').addEventListener('click', async () => {
    if (busy || !fresh() || typeof window.showDirectoryPicker !== 'function') return;
    const mime = $('detailFormat').value; setBusy('exporting');
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const files = await exportFiles(mime);
      const folderName = await exporter.saveToDirectory(handle, files, progress => exportStatus(`正在保存 ${progress.done} / ${progress.total} 张…`), outputPrefix() + (resultLanguage === 'en' ? '_details_en' : '_详情图'));
      exportStatus(`5 张详情图已保存到“${handle.name} / ${folderName}”。每次导出使用独立子文件夹。`, 'success');
    } catch (error) { handleExportError(error); } finally { setBusy(''); }
  });
  $('downloadSingleDetail').addEventListener('click', async () => {
    if (busy || !fresh()) return;
    const result = results[selectedPreview]; const index = selectedPreview; const mime = $('detailFormat').value;
    setBusy('exporting');
    try {
      const blob = mime === 'image/png' ? result.blob : await exporter.toBlob(result.canvas, mime);
      exporter.download(blob, `${outputPrefix()}_${String(index + 1).padStart(2, '0')}_${result.title}.${mime === 'image/png' ? 'png' : 'jpg'}`);
      exportStatus('已发起单张图片下载。', 'success');
    } catch (error) { handleExportError(error); } finally { setBusy(''); }
  });

  window.addEventListener('beforeunload', () => {
    translationController?.abort();
    [...assets.product, ...assets.detail].forEach(asset => URL.revokeObjectURL(asset.url)); releaseResults(results);
  });
  if (typeof window.showDirectoryPicker !== 'function') $('detailFolderHint').textContent = '此浏览器不支持选择保存文件夹，请使用 ZIP 下载整套图片。';
  window.DetailWorkbench = {
    isBusy: () => !!busy,
    setLanguage(language) {
      if (busy || !['zh', 'en'].includes(language)) return false;
      if ($('detailLanguage').value !== language) { $('detailLanguage').value = language; changed(); }
      return true;
    }
  };
  updateControls();
})();
