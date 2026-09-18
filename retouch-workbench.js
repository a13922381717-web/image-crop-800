(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  $('retouchPanel').innerHTML = `
    <div class="retouch-layout">
      <div class="card retouch-controls"><div>
        <h2>1 上传图片</h2>
        <label class="retouch-drop" id="retouchDrop" for="retouchFile"><strong>拖拽图片到这里，或点击选择</strong><small>JPG / PNG / WebP · 单张 ≤ 20 MB<br>保留原图尺寸，最多 1200 万像素</small></label>
        <input id="retouchFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <p id="retouchMeta" class="retouch-meta">无需 API，图片仅在本机处理。</p>
        <h2>2 框选与修补</h2>
        <p class="retouch-help">在右侧按住拖动，框住水印并在四周留少量边距。每次处理一个区域，可连续修补多处。</p>
        <label for="retouchMode">修补方式</label>
        <select id="retouchMode"><option value="surround">周边颜色修补 · 纯色 / 渐变背景</option><option value="clone">取样覆盖 · 从干净区域复制</option></select>
        <button id="retouchSource" class="btn secondary" hidden>选取干净区域</button>
        <label for="retouchFeather">边缘融合 <span id="retouchFeatherValue">2 px</span></label>
        <input id="retouchFeather" type="range" min="0" max="24" value="2">
        <button id="retouchApply" class="btn blue" disabled>修补选中区域</button>
        <button id="retouchCancel" class="btn danger" hidden>取消修补</button>
        <div class="row"><button id="retouchUndo" class="btn secondary" disabled>撤销上一步</button><button id="retouchReset" class="btn secondary" disabled>恢复原图</button></div>
      </div><div>
        <p class="retouch-help retouch-note">背景水印可使用周边颜色修补。水印位于牛仔纹理、口袋或缝线上时，可选取干净区域覆盖，并放大核对。被遮挡的细节无法保证准确还原。</p>
        <h2>3 下载图片</h2>
        <label for="retouchFormat">导出格式</label>
        <select id="retouchFormat"><option value="image/png">PNG · 无损，保留透明</option><option value="image/jpeg">JPG · 高质量，白底</option></select>
        <button id="retouchDownload" class="btn primary" disabled>下载修补后的图片</button>
        <p class="retouch-help">保留未选中区域。刷新或关闭前请下载结果；上传新图会替换当前图片。</p>
      </div></div>
      <div class="card retouch-editor">
        <div class="retouch-editor-head"><strong id="retouchViewTitle">修补预览</strong><div class="retouch-view"><select id="retouchZoom" aria-label="预览缩放"><option value="fit">适应窗口</option><option value="1">100% 放大检查</option><option value="2">200% 放大检查</option></select><button id="retouchCompare" class="btn secondary" disabled aria-pressed="false">查看原图</button></div></div>
        <div class="retouch-stage" id="retouchStage"><div id="retouchEmpty" class="retouch-empty"><span>◇</span><strong>框选水印，局部修补</strong><p>先上传图片，再框住需要处理的位置。<br>支持撤销、原图对照和原尺寸下载。</p></div><canvas id="retouchCanvas" hidden aria-label="修补画布，按住拖动框选水印区域"></canvas></div>
        <div class="retouch-selection"><span id="retouchSelection">尚未框选区域</span><button id="retouchClearSelection" class="text-button" disabled>清除选区</button></div>
        <p class="retouch-legend">蓝框：水印区域　绿框：取样区域。放大后可在画布区域滚动查看。</p>
        <div id="retouchStatus" class="retouch-status" role="status" aria-live="polite">上传图片后，拖动框选需要去除的水印。</div>
      </div>
    </div>`;
  const original = document.createElement('canvas'), work = document.createElement('canvas'), canvas = $('retouchCanvas');
  let loaded = false, name = '', busy = false, selection = null, source = null, choosingSource = false, gesture = null, comparing = false, history = [], edits = 0, controller = null;
  const message = (text, error = false) => { $('retouchStatus').textContent = text; $('retouchStatus').classList.toggle('error', error); };
  function update() {
    const clone = $('retouchMode').value === 'clone';
    ['retouchFile', 'retouchMode', 'retouchFeather', 'retouchFormat'].forEach(id => { $(id).disabled = busy; });
    $('retouchDrop').setAttribute('aria-disabled', String(busy));
    $('retouchApply').disabled = busy || !selection || comparing || (clone && !source);
    $('retouchSource').hidden = !clone;
    $('retouchSource').disabled = busy || !selection || comparing;
    $('retouchSource').textContent = choosingSource ? '在图片上点击干净区域…' : source ? '重新选择取样区' : '选取干净区域';
    $('retouchUndo').disabled = busy || !history.length;
    $('retouchReset').disabled = busy || !edits;
    $('retouchDownload').disabled = busy || !edits;
    $('retouchCompare').disabled = busy || !loaded;
    $('retouchCompare').textContent = comparing ? '返回修补图' : '查看原图';
    $('retouchCompare').setAttribute('aria-pressed', String(comparing));
    $('retouchViewTitle').textContent = comparing ? '原图对照' : '修补预览';
    $('retouchClearSelection').disabled = busy || !selection;
    $('retouchCancel').hidden = !controller;
    $('retouchSelection').textContent = selection ? `选区 ${selection.width} × ${selection.height} px · 位置 ${selection.x}, ${selection.y}` : '尚未框选区域';
    $('retouchEmpty').hidden = loaded; canvas.hidden = !loaded;
    $('retouchFeatherValue').textContent = $('retouchFeather').value + ' px';
  }
  function draw() {
    if (!loaded) return;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(comparing ? original : work, 0, 0);
    if (comparing) return;
    const scale = canvas.getBoundingClientRect().width / canvas.width || 1;
    const box = (area, color) => {
      if (!area) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2 / scale; ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeRect(area.x, area.y, area.width, area.height); ctx.restore();
    };
    box(selection, '#3478f6'); if ($('retouchMode').value === 'clone') box(source, '#159a65');
  }
  function resize() {
    if (!loaded) return;
    const scale = $('retouchZoom').value === 'fit' ? Math.min(1, Math.max(100, $('retouchStage').clientWidth - 2) / work.width, 590 / work.height) : Number($('retouchZoom').value);
    canvas.style.width = Math.round(work.width * scale) + 'px'; canvas.style.height = Math.round(work.height * scale) + 'px'; draw();
  }
  async function load(files) {
    if (busy) return;
    const file = files[0];
    if (!file || (!/^image\/(jpeg|png|webp)$/.test(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name)))) return message('请上传 JPG、PNG 或 WebP 图片。', true);
    if (file.size > 20 * 1024 * 1024) return message('图片超过 20 MB，请缩小后上传。', true);
    busy = true; update(); const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 12000000 || Math.max(img.naturalWidth, img.naturalHeight) > 12000) throw new Error('请上传 1200 万像素以内、最长边不超过 12000 像素的图片。');
      for (const c of [original, work, canvas]) { c.width = img.naturalWidth; c.height = img.naturalHeight; }
      original.getContext('2d').drawImage(img, 0, 0); work.getContext('2d').drawImage(img, 0, 0);
      loaded = true; name = file.name; selection = source = gesture = null; history = []; edits = 0; comparing = choosingSource = false;
      $('retouchMeta').textContent = `${name} · ${work.width} × ${work.height} px · 本机处理`;
      $('retouchZoom').value = 'fit'; update(); resize();
      message('图片已载入。拖动框住水印，留少量边距，再点击修补。');
    } catch (error) { message(error.message.includes('像素') ? error.message : '无法读取这张图片，请检查文件是否损坏。', true); }
    finally { URL.revokeObjectURL(url); busy = false; update(); }
  }
  ImageUpload.bind({ input: $('retouchFile'), zone: $('retouchDrop'), onFiles: load, isBusy: () => busy, onMessage: text => message(text, true) });
  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(work.width, Math.round((event.clientX - bounds.left) * work.width / bounds.width))), y: Math.max(0, Math.min(work.height, Math.round((event.clientY - bounds.top) * work.height / bounds.height))) };
  }
  function sourceAt(p) {
    return { x: Math.max(0, Math.min(work.width - selection.width, Math.round(p.x - selection.width / 2))), y: Math.max(0, Math.min(work.height - selection.height, Math.round(p.y - selection.height / 2))), width: selection.width, height: selection.height };
  }
  canvas.addEventListener('pointerdown', event => {
    if (busy || !loaded || comparing || event.button !== 0) return;
    event.preventDefault(); const p = point(event);
    if (choosingSource && selection) { source = sourceAt(p); choosingSource = false; update(); draw(); message('取样区域已选中。绿框应为干净背景或相近纹理，点击修补应用。'); return; }
    gesture = { ...p, pointerId: event.pointerId }; source = null; selection = null; canvas.setPointerCapture(event.pointerId); update(); draw();
  });
  canvas.addEventListener('pointermove', event => {
    if (busy || comparing) return;
    const p = point(event);
    if (choosingSource && selection) { source = sourceAt(p); draw(); return; }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    selection = { x: Math.min(gesture.x, p.x), y: Math.min(gesture.y, p.y), width: Math.abs(p.x - gesture.x), height: Math.abs(p.y - gesture.y) }; draw();
  });
  const finish = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!selection || selection.width < 2 || selection.height < 2) { selection = null; message('按住并拖动，框选至少 2 × 2 像素的区域。'); }
    else if ($('retouchMode').value === 'clone') message('水印区域已选中。点击「选取干净区域」，再点击图片中合适的位置。');
    else message('选区已就绪。确认蓝框完整包住水印后，点击修补。');
    update(); draw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', event => { if (gesture?.pointerId === event.pointerId) { gesture = selection = null; update(); draw(); } });
  $('retouchSource').onclick = () => { if (!selection || busy) return; source = null; choosingSource = true; update(); draw(); message('在图片上移动查看绿框，点击选取干净区域。'); };
  $('retouchMode').onchange = () => { source = null; choosingSource = false; update(); draw(); };
  $('retouchFeather').oninput = update;
  $('retouchZoom').onchange = resize;
  new ResizeObserver(() => { if (!$('retouchPanel').hidden) resize(); }).observe($('retouchStage'));
  $('retouchClearSelection').onclick = () => { selection = source = null; choosingSource = false; update(); draw(); };
  $('retouchCompare').onclick = () => { comparing = !comparing; choosingSource = false; update(); draw(); };
  $('retouchCancel').onclick = () => controller?.abort();
  $('retouchApply').onclick = async () => {
    if (busy || !selection || comparing) return;
    const area = { ...selection }, ctx = work.getContext('2d');
    busy = true; choosingSource = false; controller = new AbortController(); update();
    try {
      const before = ctx.getImageData(area.x, area.y, area.width, area.height);
      const data = ctx.getImageData(0, 0, work.width, work.height);
      const patch = await RetouchImage.repair(data.data, work.width, work.height, area, { mode: $('retouchMode').value, source, feather: Number($('retouchFeather').value), signal: controller.signal, onProgress: n => message(`正在修补 ${n}%…`) });
      ctx.putImageData(new ImageData(patch, area.width, area.height), area.x, area.y);
      history.push({ area, before }); if (history.length > 5) history.shift(); edits++;
      selection = source = null; draw(); message('修补完成。可查看原图对照、继续框选其他水印，或下载结果。支持撤销最近 5 步。');
    } catch (error) { message(error.name === 'AbortError' ? '已取消，图片保持不变。' : error.message, error.name !== 'AbortError'); }
    finally { busy = false; controller = null; update(); }
  };
  $('retouchUndo').onclick = () => {
    if (busy || !history.length) return;
    const last = history.pop(); work.getContext('2d').putImageData(last.before, last.area.x, last.area.y); edits--;
    selection = source = null; comparing = choosingSource = false; update(); draw(); message('已撤销上一步修补。');
  };
  $('retouchReset').onclick = () => {
    if (busy || !loaded) return;
    const ctx = work.getContext('2d'); ctx.clearRect(0, 0, work.width, work.height); ctx.drawImage(original, 0, 0);
    history = []; edits = 0; selection = source = null; comparing = choosingSource = false; update(); draw(); message('已恢复原图。');
  };
  $('retouchDownload').onclick = async () => {
    if (busy || !edits) return;
    busy = true; update(); let output = work;
    try {
      const format = $('retouchFormat').value;
      if (format === 'image/jpeg') { output = document.createElement('canvas'); output.width = work.width; output.height = work.height; const ctx = output.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(work, 0, 0); }
      const blob = await DetailExport.toBlob(output, format, .95);
      DetailExport.download(blob, DetailExport.safeName(name.replace(/\.[^.]+$/, '')) + '_去水印.' + (format === 'image/png' ? 'png' : 'jpg'));
      message('已下载修补图片，尺寸与原图一致。');
    } catch (error) { message('下载失败：' + error.message, true); }
    finally { if (output !== work) { output.width = output.height = 0; } busy = false; update(); }
  };
  window.RetouchWorkbench = Object.freeze({ isBusy: () => busy });
  update();
})();
