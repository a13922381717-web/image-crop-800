(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const engine = window.BatchImage, exporter = window.DetailExport;
  const definitions = {
    portrait: { label: '3:4 长图', hint: '输出 900×1200。完整显示会补边，居中裁剪会裁掉超出部分。', values: { mode: 'fit', background: '#ffffff', format: 'image/jpeg', quality: 0.92 } },
    png800: { label: '800×800 PNG', hint: '透明补边保留透明区域，不会自动移除原图片中的背景。', values: { mode: 'fit', background: 'transparent', format: 'image/png', quality: 1 } },
    resize: { label: '自定义尺寸', hint: '最大单边 8192 px，总像素不超过 1200 万。图片按比例适配，不会拉伸变形。', values: { width: 1000, height: 1000, mode: 'fit', background: '#ffffff', format: 'image/jpeg', quality: 0.92 } },
    compress: { label: '压缩与转换', hint: '只缩小，不放大。JPG / WebP 可调整质量；PNG 无损编码，文件可能变大。', values: { maxEdge: 1600, format: 'image/jpeg', quality: 0.8 } },
    collage: { label: '拼图与拼接', hint: '按左侧素材顺序拼接。过长时请缩小输出宽度或减少素材。', values: { layout: 'grid', columns: 2, width: 1200, gap: 16, background: '#ffffff', format: 'image/jpeg', quality: 0.92 } },
    watermark: { label: '文字水印', hint: '水印添加到工作副本，原文件不变。文字过长时会缩小以适应图片。', values: { text: '', fontSize: 48, opacity: 0.4, color: '#ffffff', position: 'bottom-right', format: 'image/png', quality: 0.92 } },
    background: { label: '纯色背景替换', hint: '仅替换与图片边缘连通的相近颜色，适合纯色背景。封闭区域及已有透明度保留；复杂背景不适用。', values: { sourceColor: '#ffffff', targetColor: 'transparent', tolerance: 24, format: 'image/png', quality: 0.92 } }
  };
  const states = Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, { values: { ...definition.values }, revision: 0, results: [], generatedRevision: -1, assetRevision: -1 }]));
  let current = 'portrait', assets = [], assetRevision = 0, busy = '', cancelled = false, selected = 0;
  const state = () => states[current];
  const fresh = () => state().results.length > 0 && state().generatedRevision === state().revision && state().assetRevision === assetRevision;
  const bytes = size => size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(2)} MB`;
  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
  const checkCancel = () => { if (cancelled) throw new DOMException('已取消处理。', 'AbortError'); };
  function message(text, error = false) { $('batchStatus').textContent = text; $('batchStatus').classList.toggle('error', error); }
  function release(results) { results.forEach(result => URL.revokeObjectURL(result.url)); }
  function setBusy(value) { busy = value; updateControls(); }

  $('batchPanel').innerHTML = `
    <div class="batch-layout">
      <div class="card batch-sources">
        <div class="batch-section-heading"><h2>产品素材</h2><span id="batchAssetCount">0 / 20</span></div>
        <label for="batchFiles" id="batchDrop" class="batch-drop" tabindex="0" role="button"><strong>＋ 上传图片，或拖入这里</strong><span>JPG / PNG / WebP · 每次最多 20 张</span></label>
        <input type="file" id="batchFiles" accept="image/jpeg,image/png,image/webp" multiple hidden />
        <p class="batch-help">每张 ≤ 20 MB、3200 万像素。工作副本最长边 2400 px；原文件不变。批量工具共享这些素材。</p>
        <div class="batch-asset-toolbar"><span>可调整顺序后拼接</span><button type="button" id="batchClear" class="text-button">清空素材</button></div>
        <div id="batchAssets" class="batch-assets"></div>
        <p id="batchSourceEmpty" class="batch-source-empty">添加素材后即可开始。<br />切换批量功能无需重复上传。</p>
      </div>
      <div class="batch-main">
        <form id="batchForm" class="card batch-settings" novalidate>
          <div class="batch-section-heading"><h2 id="batchSettingsTitle">处理参数</h2><span>本地处理</span></div>
          <fieldset id="batchFields"><div id="batchOptions" class="batch-options"></div>
            <div class="batch-options batch-export-options">
              <label>导出格式<select id="batchFormat"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label>
              <label>导出质量 <span id="batchQualityValue"></span><input type="range" id="batchQuality" min="0.1" max="1" step="0.01" /></label>
            </div>
          </fieldset>
          <p id="batchToolHint" class="batch-help"></p>
          <div class="batch-actions"><button type="submit" class="btn blue" id="batchGenerate">生成预览</button><button type="button" class="btn secondary" id="batchCancel" hidden>取消处理</button></div>
          <div id="batchStatus" class="batch-status" role="status" aria-live="polite">上传图片，设置参数后生成预览。</div>
        </form>
        <div class="card batch-output-bar"><div class="batch-section-heading"><h2>处理结果 <span id="batchResultCount">0 张</span></h2><span id="batchResultSummary"></span></div>
          <p id="batchResultHint" class="batch-help">预览与下载为同一份处理结果。</p>
          <div class="batch-actions"><button class="btn primary" type="button" id="batchZip" disabled>打包下载 ZIP</button><button class="btn secondary" type="button" id="batchFolder" disabled>保存到文件夹</button></div>
          <p class="batch-help" id="batchFolderHint">保存到文件夹时，每次创建独立子文件夹。</p>
        </div>
        <div id="batchResults" class="batch-results"></div>
        <div id="batchEmpty" class="card batch-empty"><span aria-hidden="true">▧</span><h3>处理好的图片将在这里显示</h3><p>支持放大检查、单张下载和整组导出</p></div>
      </div>
    </div>
    <dialog id="batchLightbox" class="batch-lightbox" aria-labelledby="batchLightboxTitle"><div class="batch-lightbox-toolbar"><strong id="batchLightboxTitle">图片预览</strong><button type="button" id="batchClose" class="btn secondary">关闭 ✕</button></div><img id="batchLargeImage" alt="处理后的图片" /><button type="button" class="btn blue" id="batchDownloadLarge">下载这张</button></dialog>`;

  function choice(key, label, entries) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const select = document.createElement('select'); select.id = `batchOption-${key}`;
    entries.forEach(([value, title]) => { const option = document.createElement('option'); option.value = String(value); option.textContent = title; select.append(option); });
    select.value = String(state().values[key]);
    select.addEventListener('change', () => { state().values[key] = typeof definitions[current].values[key] === 'number' ? Number(select.value) : select.value; changed(); updateControls(); });
    wrapper.append(select); $('batchOptions').append(wrapper);
  }
  function field(key, label, type, min, max, step) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.id = `batchOption-${key}`; input.type = type; input.value = state().values[key];
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    if (type === 'text') { input.maxLength = 80; input.placeholder = '例如：店铺名称'; }
    input.addEventListener('input', () => { state().values[key] = type === 'number' || type === 'range' ? Number(input.value) : input.value; changed(); });
    wrapper.append(input); $('batchOptions').append(wrapper);
  }
  function colorChoice(key, label) {
    const solid = state().values[key] !== 'transparent';
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const row = document.createElement('div'); row.className = 'batch-color-control';
    const select = document.createElement('select'); select.id = `batchOption-${key}Mode`;
    for (const [value, title] of [['transparent', '透明'], ['solid', '纯色']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; select.append(option); }
    const input = document.createElement('input'); input.type = 'color'; input.id = `batchOption-${key}`; input.setAttribute('aria-label', label + '颜色');
    input.value = solid ? state().values[key] : '#ffffff'; select.value = solid ? 'solid' : 'transparent'; input.disabled = !solid;
    select.addEventListener('change', () => { state().values[key] = select.value === 'transparent' ? 'transparent' : input.value; input.disabled = select.value === 'transparent'; changed(); });
    input.addEventListener('input', () => { state().values[key] = input.value; changed(); });
    row.append(select, input); wrapper.append(row); $('batchOptions').append(wrapper);
  }
  function renderSettings() {
    $('batchOptions').replaceChildren();
    const def = definitions[current];
    $('batchSettingsTitle').textContent = def.label + ' · 参数'; $('batchToolHint').textContent = def.hint;
    if (current === 'resize') { field('width', '输出宽度（px）', 'number', 1, 8192, 1); field('height', '输出高度（px）', 'number', 1, 8192, 1); }
    if (['portrait', 'png800', 'resize'].includes(current)) {
      choice('mode', '画面适配', [['fit', '完整显示 + 补边'], ['crop', '居中裁剪填满']]);
      if (current === 'portrait') field('background', '补边颜色', 'color'); else colorChoice('background', '补边背景');
    }
    if (current === 'compress') field('maxEdge', '最长边（px）', 'number', 1, 8192, 1);
    if (current === 'collage') {
      choice('layout', '拼接方式', [['grid', '网格拼图'], ['vertical', '竖向长图']]);
      choice('columns', '网格列数', [[2, '2 列'], [3, '3 列'], [4, '4 列']]);
      field('width', '输出宽度（px）', 'number', 100, 8192, 1); field('gap', '图片间距（px）', 'number', 0, 80, 1); field('background', '背景颜色', 'color');
    }
    if (current === 'watermark') {
      field('text', '水印文字（最多 80 字）', 'text');
      choice('position', '水印位置', [['bottom-right', '右下角'], ['bottom-left', '左下角'], ['top-right', '右上角'], ['top-left', '左上角'], ['center', '居中'], ['tile', '斜向平铺']]);
      field('fontSize', '字号（px）', 'number', 12, 180, 1); field('opacity', '透明度（0.1–1）', 'number', 0.1, 1, 0.05); field('color', '文字颜色', 'color');
    }
    if (current === 'background') { field('sourceColor', '需要替换的原背景色', 'color'); colorChoice('targetColor', '替换后的背景'); field('tolerance', '颜色容差（0–120）', 'number', 0, 120, 1); }
    $('batchFormat').value = state().values.format; $('batchQuality').value = state().values.quality;
    updateControls();
  }
  function changed() { state().revision++; updateControls(); }
  function updateControls() {
    const values = state().values;
    // Transparent background selections always use a format that preserves alpha.
    const forcePNG = current === 'png800' || (current === 'background' && values.targetColor === 'transparent');
    if (forcePNG && values.format !== 'image/png') values.format = 'image/png';
    $('batchFormat').value = values.format; $('batchFormat').disabled = forcePNG;
    $('batchFields').disabled = !!busy;
    $('batchQuality').disabled = values.format === 'image/png';
    $('batchQualityValue').textContent = values.format === 'image/png' ? '无损' : `${Math.round(values.quality * 100)}%`;
    if ($('batchOption-columns')) $('batchOption-columns').disabled = values.layout === 'vertical';
    $('batchFiles').disabled = !!busy; $('batchClear').disabled = !!busy || !assets.length;
    $('batchAssets').querySelectorAll('button').forEach(button => { button.disabled = !!busy || button.dataset.boundary === 'true'; });
    $('batchGenerate').disabled = !!busy || !assets.length;
    $('batchGenerate').textContent = busy === 'generating' ? '正在生成…' : busy === 'loading' ? '正在读取素材…' : state().results.length ? '重新生成预览' : '生成预览';
    $('batchCancel').hidden = !['generating', 'loading'].includes(busy);
    $('batchZip').disabled = !!busy || !fresh(); $('batchFolder').disabled = !!busy || !fresh() || typeof window.showDirectoryPicker !== 'function';
    $('batchDownloadLarge').disabled = !!busy || !fresh();
    $('batchResults').querySelectorAll('button').forEach(button => { button.disabled = !!busy || (button.dataset.action === 'download' && !fresh()); });
    $('batchResults').classList.toggle('stale', state().results.length > 0 && !fresh());
    $('batchResultHint').textContent = state().results.length && !fresh() ? '素材或参数已修改，下方为上次结果，请重新生成后导出。' : '预览与下载为同一份处理结果。';
    $('batchDrop').setAttribute('aria-disabled', String(!!busy));
  }
  function renderAssets() {
    $('batchAssets').replaceChildren(); $('batchAssetCount').textContent = `${assets.length} / 20`; $('batchSourceEmpty').hidden = assets.length > 0;
    assets.forEach((asset, index) => {
      const item = document.createElement('div'); item.className = 'batch-asset';
      const image = document.createElement('img'); image.src = asset.url; image.alt = asset.name;
      const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = `${index + 1}. ${asset.name}`; name.title = asset.name;
      const meta = document.createElement('small'); meta.textContent = `${asset.img.naturalWidth}×${asset.img.naturalHeight} · ${bytes(asset.inputSize)}`; info.append(name, meta);
      const actions = document.createElement('div'); actions.className = 'batch-asset-actions';
      for (const [label, action, boundary] of [['↑', 'up', index === 0], ['↓', 'down', index === assets.length - 1], ['×', 'remove', false]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.assetAction = action; button.dataset.boundary = String(boundary); button.setAttribute('aria-label', `${action === 'up' ? '上移' : action === 'down' ? '下移' : '删除'} ${asset.name}`);
        button.addEventListener('click', () => {
          if (busy || boundary) return;
          if (action === 'remove') { URL.revokeObjectURL(asset.url); assets.splice(index, 1); }
          else { const target = index + (action === 'up' ? -1 : 1); [assets[index], assets[target]] = [assets[target], assets[index]]; }
          assetRevision++; renderAssets(); updateControls();
        }); actions.append(button);
      }
      item.append(image, info, actions); $('batchAssets').append(item);
    }); updateControls();
  }
  async function addFiles(list) {
    if (busy) return;
    const files = Array.from(list || []); if (!files.length) return;
    setBusy('loading'); cancelled = false; const pending = []; const errors = [];
    try {
      for (const file of files) {
        checkCancel();
        if (assets.length + pending.length >= 20) { errors.push('超过 20 张的部分未添加。'); break; }
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) { errors.push(`${file.name}：格式不支持。`); continue; }
        if (file.size > 20 * 1024 * 1024) { errors.push(`${file.name}：超过 20 MB。`); continue; }
        let url = URL.createObjectURL(file); let transferred = false;
        try {
          const img = new Image(); img.src = url; await img.decode(); checkCancel();
          if (img.naturalWidth * img.naturalHeight > 32000000 || Math.max(img.naturalWidth, img.naturalHeight) > 12000) throw new Error('图片过大，请缩小后上传');
          if (Math.max(img.naturalWidth, img.naturalHeight) > 2400) {
            const canvas = engine.render({ img }, 'compress', { maxEdge: 2400 }); let blob;
            try { blob = await engine.encode(canvas, 'image/png'); } finally { canvas.width = canvas.height = 0; }
            URL.revokeObjectURL(url); url = URL.createObjectURL(blob); img.src = url; await img.decode(); checkCancel();
          }
          pending.push({ img, name: file.name, url, inputSize: file.size }); transferred = true;
          message(`已读取 ${pending.length} 张图片…`); await yieldFrame();
        } catch (error) { if (error.name === 'AbortError') throw error; errors.push(`${file.name}：${error.message || '无法读取图片'}`); }
        finally { if (!transferred) URL.revokeObjectURL(url); }
      }
      checkCancel();
      if (pending.length) { assets.push(...pending); assetRevision++; renderAssets(); }
      message(`已添加 ${pending.length} 张图片。${errors.join(' ')}`, errors.length > 0);
    } catch (error) { pending.forEach(asset => URL.revokeObjectURL(asset.url)); message(error.name === 'AbortError' ? '已取消读取，原有素材保留。' : error.message, error.name !== 'AbortError'); }
    finally { setBusy(''); }
  }
  ImageUpload.bind({ input: $('batchFiles'), zone: $('batchDrop'), onFiles: addFiles,
    isBusy: () => !!busy, onMessage: text => message(text, true) });
  $('batchClear').addEventListener('click', () => { if (busy) return; assets.forEach(asset => URL.revokeObjectURL(asset.url)); assets = []; assetRevision++; for (const saved of Object.values(states)) { release(saved.results); saved.results = []; } renderAssets(); renderResults(); message('素材和处理结果已清空。'); });
  $('batchFormat').addEventListener('change', event => { state().values.format = event.target.value; changed(); });
  $('batchQuality').addEventListener('input', event => { state().values.quality = Number(event.target.value); changed(); });
  $('batchCancel').addEventListener('click', () => { cancelled = true; message('正在取消，请稍候…'); });

  function renderResults() {
    const results = state().results; $('batchResults').replaceChildren(); $('batchResultCount').textContent = `${results.length} 张`; $('batchEmpty').hidden = results.length > 0;
    const total = results.reduce((sum, item) => sum + item.blob.size, 0); $('batchResultSummary').textContent = results.length ? `合计 ${bytes(total)}` : '';
    results.forEach((result, index) => {
      const card = document.createElement('article'); card.className = 'batch-result';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'batch-result-preview'; preview.setAttribute('aria-label', `放大 ${result.name}`);
      const img = document.createElement('img'); img.src = result.url; img.alt = result.name; preview.append(img);
      preview.addEventListener('click', () => { selected = index; $('batchLargeImage').src = result.url; $('batchLightboxTitle').textContent = `${result.width}×${result.height} · ${result.name}`; $('batchLightbox').showModal(); });
      const meta = document.createElement('div'); meta.className = 'batch-result-meta'; const title = document.createElement('strong'); title.textContent = result.name; title.title = result.name;
      const size = document.createElement('span'); size.textContent = `${result.width}×${result.height} · ${bytes(result.blob.size)}`;
      const change = document.createElement('small');
      if (result.inputSize) { const delta = (1 - result.blob.size / result.inputSize) * 100; change.textContent = `原文件 ${bytes(result.inputSize)} · ${delta >= 0 ? '减小' : '增大'} ${Math.abs(delta).toFixed(1)}%`; }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary'; button.dataset.action = 'download'; button.textContent = '下载这张'; button.addEventListener('click', () => { if (!busy && fresh()) exporter.download(result.blob, result.name); });
      meta.append(title, size, change, button); card.append(preview, meta); $('batchResults').append(card);
    }); updateControls();
  }
  $('batchClose').addEventListener('click', () => $('batchLightbox').close());
  $('batchDownloadLarge').addEventListener('click', () => { if (!busy && fresh()) { const result = state().results[selected]; exporter.download(result.blob, result.name); } });
  $('batchForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !assets.length) return;
    const saved = state(), tool = current, options = { ...saved.values }, next = [], inputs = [...assets];
    setBusy('generating'); cancelled = false;
    try {
      await document.fonts?.ready;
      const count = tool === 'collage' ? 1 : inputs.length;
      for (let index = 0; index < count; index++) {
        await yieldFrame(); checkCancel(); message(`正在处理 ${index + 1} / ${count}…`);
        const canvas = tool === 'collage' ? engine.collage(inputs, options) : engine.render(inputs[index], tool, options);
        try {
          const blob = await engine.encode(canvas, options.format, options.quality); checkCancel();
          const extension = options.format === 'image/png' ? 'png' : options.format === 'image/webp' ? 'webp' : 'jpg';
          const prefix = tool === 'collage' ? '商品拼图' : Array.from(exporter.safeName(inputs[index].name.replace(/\.[^.]+$/, ''))).slice(0, 40).join('');
          next.push({ blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, inputSize: tool === 'collage' ? inputs.reduce((sum, asset) => sum + asset.inputSize, 0) : inputs[index].inputSize, name: `${String(index + 1).padStart(2, '0')}_${prefix}_${tool}.${extension}` });
        } finally { canvas.width = canvas.height = 0; }
      }
      checkCancel(); release(saved.results); saved.results = next; saved.generatedRevision = saved.revision; saved.assetRevision = assetRevision;
      renderResults(); message(`完成：已生成 ${next.length} 张图片，可单张下载或批量导出。`);
    } catch (error) { release(next); message(error.name === 'AbortError' ? '已取消生成，上次结果保留。' : `处理未完成：${error.message}`, error.name !== 'AbortError'); }
    finally { setBusy(''); }
  });
  async function exportBatch(folder) {
    if (busy || !fresh()) return;
    const files = state().results.map(result => ({ name: result.name, blob: result.blob }));
    setBusy('exporting');
    try {
      if (folder) {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const name = await exporter.saveToDirectory(handle, files, progress => message(`正在保存 ${progress.done} / ${progress.total}…`), definitions[current].label);
        message(`已保存到“${handle.name} / ${name}”。`);
      } else { const zip = await exporter.makeZip(files); exporter.download(zip, `${current}_${Date.now()}.zip`); message(`已发起 ZIP 下载，包含 ${files.length} 张图片。`); }
    } catch (error) { message(error.name === 'AbortError' ? '已取消保存，处理结果保留。' : `导出未完成：${error.message}`, error.name !== 'AbortError'); }
    finally { setBusy(''); }
  }
  $('batchZip').addEventListener('click', () => void exportBatch(false)); $('batchFolder').addEventListener('click', () => void exportBatch(true));
  if (typeof window.showDirectoryPicker !== 'function') $('batchFolderHint').textContent = '当前浏览器不支持选择文件夹，可使用 ZIP 下载全部图片。';
  window.addEventListener('beforeunload', () => { cancelled = true; assets.forEach(asset => URL.revokeObjectURL(asset.url)); Object.values(states).forEach(saved => release(saved.results)); });
  window.BatchWorkbench = Object.freeze({ isBusy: () => !!busy, open(tool) { if (busy || !definitions[tool]) return false; current = tool; renderSettings(); renderAssets(); renderResults(); message(state().results.length ? fresh() ? '已恢复该工具的处理结果。' : '素材或参数已修改，请重新生成。' : '上传素材，设置参数后生成预览。'); return true; } });
  renderSettings();
})();
