(() => {
  'use strict';
  const panel = document.getElementById('aiPanel');
  panel.innerHTML = `
    <div class="ai-banner"><div><strong>同一款产品，新的模特与场景</strong><p>先出样图，再扩展套图。实拍细节保留原始面料与工艺。</p></div><div class="ai-inline"><button id="aiShare" class="btn secondary" hidden>复制分享链接</button><span id="aiConnection" class="ai-badge">检查服务中</span></div></div>
    <details class="ai-config card" id="aiConfig"><summary>图片 API 配置 <span>首次使用在这里设置</span></summary>
      <p id="aiSetupHelp">使用本机启动器打开工作台后，可在此填写 OpenAI API Key。</p>
      <p>① <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">创建 API Key</a>　② <a href="https://platform.openai.com/account/billing/overview" target="_blank" rel="noopener noreferrer">查看 API 余额 / 充值</a>　③ 在下方粘贴密钥并连接，再上传素材生成样图。</p>
      <form id="aiKeyForm"><label for="aiKey">OpenAI API Key</label><div class="ai-inline"><input id="aiKey" type="password" autocomplete="off" placeholder="粘贴 API Key" maxlength="512"><button class="btn secondary" type="submit" id="aiSaveKey">连接</button></div></form>
      <p class="ai-note" id="aiKeyNote">密钥仅保存在本机服务内存，重启服务后需重新填写。API 单独计费，和聊天订阅额度分开。配置连接不会发起付费出图。</p><button id="aiDisconnect" class="text-button" type="button" hidden>清除本次会话密钥</button>
      <div id="aiConfigStatus" role="status"></div>
    </details>
    <div class="ai-layout"><div class="ai-controls card"><fieldset id="aiInputs">
      <h2><span class="ai-step">1</span> 产品素材</h2>
      <p class="ai-note">同一个款式，最多 8 张。标记正面、背面、侧面和细节，避免凭空生成未拍摄的角度。</p>
      <label class="ai-upload" id="aiDropZone" for="aiFiles">拖拽产品图片到这里，或点击选择<span class="ai-upload-hint">支持多张 JPG / PNG / WebP，最多 8 张</span><input id="aiFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
      <div id="aiSources" class="ai-sources"></div>
      <label for="aiName">款号 / 产品名称</label><input id="aiName" maxlength="60" placeholder="例如：9993 大码工装牛仔裤">
      <label for="aiLocks">需要保留的产品特征</label><textarea id="aiLocks" rows="3" maxlength="1500" placeholder="例如：蓝色水洗、松紧腰、白色抽绳、两侧工装袋、宽松直筒。请以实物为准。"></textarea>
      <h2><span class="ai-step">2</span> 模特与场景</h2>
      <label for="aiModel">模特</label><select id="aiModel"><option value="大码成年男性，自然结实身材，白色素色T恤，白色无标运动鞋">大码男模 · 白色 T 恤</option><option value="成年男性，标准身材，白色素色T恤，白色无标运动鞋">标准男模 · 白色 T 恤</option><option value="保留原图人物、服装搭配和姿势，只替换背景">保留原模特 · 只换背景</option></select>
      <label for="aiScene">场景</label><select id="aiScene"><option value="简洁城市街景，浅灰混凝土墙，自然柔光，背景干净">简洁城市街景</option><option value="纯白摄影棚，柔和自然接触阴影">纯白摄影棚</option><option value="暖灰简约摄影棚，柔和均匀光线">暖灰摄影棚</option></select>
      <label for="aiReference">模特 / 风格参考图（可选，1 张）</label><input id="aiReference" type="file" accept="image/jpeg,image/png,image/webp"><div id="aiReferencePreview"></div>
      <label for="aiSize">生成尺寸</label><select id="aiSize"><option value="1024x1024">方图 1024 × 1024</option><option value="1024x1536">竖图 1024 × 1536</option></select>
      <p class="ai-note">AI 会重新绘制画面，不能保证产品像素不变。出图后请对照原图检查颜色、口袋、抽绳和版型；细节图使用下方的实拍排版。</p>
    </fieldset>
    <div class="ai-actions"><button id="aiSample" class="btn blue">先生成 1 张样图</button><label class="ai-check"><input id="aiApprove" type="checkbox" disabled> 已核对当前样图的产品细节</label><button id="aiSet" class="btn primary" disabled>继续生成套图</button><button id="aiDetails" class="btn secondary">生成实拍细节图 · 免费</button><button id="aiCancel" class="btn danger" hidden>取消生成</button></div>
    <p class="ai-note">点击 AI 生成会把所选产品图和参考图发给 OpenAI。套图逐张生成，已成功的图片会保留；失败不会自动付费重试。</p>
    </div><div class="ai-output"><div class="ai-output-head"><div><h2>图片预览</h2><p>样图 + 多角度主图 + 实拍细节图</p></div><button id="aiDownloadAll" class="btn secondary" disabled>下载全部 ZIP</button></div>
      <div id="aiStatus" class="ai-status" role="status" aria-live="polite">添加正面产品图开始。没有 API 也可以生成实拍细节图。</div>
      <div id="aiEmpty" class="ai-empty"><span>✧</span><h3>你的下一套商品图，从这里开始</h3><p>先上传实拍照片，选好模特与场景。<br>同一套图会沿用已确认的样图作为人物参考。</p></div><div id="aiResults" class="ai-results"></div>
      <p class="ai-note">素材与结果仅保留在当前页面，刷新或关闭前请下载。修改素材或设置后，需要重新生成并核对样图。</p>
    </div></div>`;
  const $ = id => document.getElementById(id);
  const state = { sources: [], reference: null, results: [], revision: 0, sample: null, busy: false, controller: null, configured: false, token: null, hosted: false, jobs: false, serial: 0 };
  const status = message => { $('aiStatus').textContent = message; };
  function update() {
    $('aiInputs').disabled = state.busy;
    $('aiDropZone').setAttribute('aria-disabled', String(state.busy));
    $('aiSample').disabled = state.busy || !state.configured || !state.sources.some(x => x.role === 'front');
    $('aiApprove').disabled = state.busy || !state.sample || state.sample.revision !== state.revision;
    $('aiSet').disabled = state.busy || !state.configured || !$('aiApprove').checked || !state.sample || state.sample.revision !== state.revision;
    $('aiDetails').disabled = state.busy || !state.sources.length;
    $('aiCancel').hidden = !state.busy || !state.controller;
    $('aiDownloadAll').disabled = state.busy || !state.results.length;
    $('aiSaveKey').disabled = state.busy || !state.token;
    $('aiDisconnect').disabled = state.busy || !state.configured;
    $('aiEmpty').hidden = state.results.length > 0;
  }
  function changed() { state.revision++; $('aiApprove').checked = false; if (state.results.length) status('素材或设置已修改。已有图片仍可下载；请重新生成样图后再扩展套图。'); update(); }
  function imageFrom(data) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片无法解码，请更换文件。')); img.src = data; }); }
  async function loadFile(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请使用不超过 20 MB 的 JPEG、PNG 或 WebP 图片。');
    const url = URL.createObjectURL(file);
    try {
      const img = await imageFrom(url);
      if (img.width * img.height > 40000000) throw new Error('图片尺寸过大，请缩小到 4000 万像素以内。');
      const canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/jpeg', .94), img, url, name: file.name, role: 'detail', caption: '' };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  function renderSources() {
    $('aiSources').replaceChildren();
    state.sources.forEach((source, i) => {
      const row = document.createElement('div'); row.className = 'ai-source';
      const img = document.createElement('img'); img.src = source.data; img.alt = source.name;
      const content = document.createElement('div'); const name = document.createElement('span'); name.textContent = source.name; name.title = source.name;
      const role = document.createElement('select'); role.setAttribute('aria-label', '素材 ' + (i + 1) + ' 角度');
      [['front','正面'],['back','背面'],['side','侧面'],['detail','细节']].forEach(([value, label]) => role.add(new Option(label, value)));
      role.value = source.role; role.onchange = () => { source.role = role.value; changed(); };
      const caption = document.createElement('input'); caption.placeholder = '细节图标题（可选）'; caption.maxLength = 24; caption.value = source.caption; caption.setAttribute('aria-label', '素材 ' + (i + 1) + ' 标题'); caption.oninput = () => { source.caption = caption.value; changed(); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '移除'; remove.onclick = () => { URL.revokeObjectURL(source.url); state.sources.splice(i, 1); changed(); renderSources(); };
      content.append(name, role, caption); row.append(img, content, remove); $('aiSources').append(row);
    });
  }
  async function addSources(files) {
    if (state.busy || !files.length) return;
    state.busy = true; update();
    const errors = [];
    for (const file of files) {
      if (state.sources.length >= 8) { errors.push('最多保留 8 张产品图。'); break; }
      try { const item = await loadFile(file); if (!state.sources.length) item.role = 'front'; state.sources.push(item); } catch (error) { errors.push(file.name + '：' + error.message); }
    }
    state.busy = false; changed(); renderSources(); status(errors.join(' ') || '素材已添加。请为背面、侧面和细节照片标记角度。');
  }
  $('aiFiles').onchange = event => {
    const files = [...event.target.files]; event.target.value = '';
    addSources(files);
  };
  const dropZone = $('aiDropZone');
  let dragDepth = 0;
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const resetDrag = () => { dragDepth = 0; dropZone.classList.remove('is-dragging'); };
  dropZone.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); dragDepth++;
    if (!state.busy) dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy';
  });
  dropZone.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) resetDrag();
  });
  dropZone.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation(); resetDrag();
    addSources(Array.from(event.dataTransfer.files));
  });
  // Prevent an accidental drop outside the upload area from replacing this page.
  ['dragover', 'drop'].forEach(type => document.addEventListener(type, event => {
    if (panel.hidden || !hasFiles(event)) return;
    event.preventDefault();
    if (type === 'dragover') event.dataTransfer.dropEffect = 'none';
    else { resetDrag(); if (!state.busy) status('请把图片拖到左侧「产品素材」上传框内。'); }
  }));
  window.addEventListener('dragend', resetDrag);
  $('aiReference').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    state.busy = true; update();
    try {
      const reference = await loadFile(file); if (state.reference) URL.revokeObjectURL(state.reference.url); state.reference = reference;
      const img = document.createElement('img'); img.src = reference.data; img.alt = '风格参考图';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '移除参考'; remove.onclick = () => { URL.revokeObjectURL(state.reference.url); state.reference = null; $('aiReferencePreview').replaceChildren(); changed(); };
      $('aiReferencePreview').replaceChildren(img, remove); changed();
    } catch (error) { status(error.message); } finally { state.busy = false; update(); }
  };
  ['aiName','aiLocks','aiModel','aiScene','aiSize'].forEach(id => $(id).addEventListener('input', changed));
  $('aiApprove').onchange = update;
  async function connection() {
    try {
      if (!/^https?:$/.test(location.protocol)) throw new Error();
      const response = await fetch('/api/ai/status'); if (!response.ok) throw new Error();
      const data = await response.json(); if (!data.token) throw new Error();
      state.token = data.token; state.configured = data.configured; state.hosted = Boolean(data.hosted); state.jobs = Boolean(data.jobs);
      $('aiConnection').textContent = data.configured ? 'API 已配置' : '待配置 API';
      $('aiSetupHelp').textContent = state.hosted ? '在线分享版：每位使用者填写自己的 OpenAI API Key，费用由各自的 API 账户承担。' : '填写密钥即可启用 AI 模特和场景生成。密钥不会写入页面文件或浏览器存储。';
      if (state.hosted) $('aiKeyNote').textContent = '密钥会经 HTTPS 发送到此工作台的服务器，再用于调用 OpenAI；请仅在信任此网站运营者时填写。密钥只保留在当前会话的服务器内存中，闲置一小时、清除会话或服务重启后失效。刷新页面需重新填写。连接不产生出图费用。';
      $('aiShare').hidden = !state.hosted; $('aiDisconnect').hidden = !state.hosted;
    } catch {
      $('aiConnection').textContent = '本地素材模式';
      $('aiSetupHelp').textContent = 'AI 功能需要本机服务：在项目文件夹双击「启动电商图片工作台.command」，再在打开的工作台填写密钥。直接打开 HTML 或 GitHub Pages 时仍可生成实拍细节图。';
    }
    $('aiConfig').open = !state.configured; update();
  }
  $('aiKeyForm').onsubmit = async event => {
    event.preventDefault(); if (!state.token || state.busy) return;
    const key = $('aiKey').value.trim(); $('aiKey').value = ''; state.busy = true; update();
    try {
      const response = await fetch('/api/ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': state.token }, body: JSON.stringify({ key }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '配置失败。');
      state.configured = true; $('aiConnection').textContent = 'API 已配置'; $('aiConfigStatus').textContent = state.hosted ? '密钥已保存到你的独立会话。首次出图时验证账户权限和额度。' : '配置已保存到本次服务。首次出图时验证账户权限和额度。';
    } catch (error) { $('aiConfigStatus').textContent = error.message; } finally { state.busy = false; update(); }
  };
  function buildRequest(source, shot, approved) {
    const products = [source, ...state.sources.filter(x => x !== source)].slice(0, 8);
    const images = products.map(x => x.data);
    let prompt = `请制作真实电商男装产品照片。前 ${products.length} 张为同一款产品实拍，第一张是当前角度的主要依据。产品图的角色依次为：${products.map(x => x.role).join('、')}。\n只改变人物和环境，忠实保留商品的颜色、水洗分布、面料纹理、版型宽度、裤长、腰头、抽绳、口袋数量形状位置、缝线和裤脚；不增加配件、标志、破洞或扣子。不可把参考图中的其他裤子或衣服当作目标产品。产品结构优先于风格。\n用户补充的产品特征：${$('aiLocks').value || '严格以产品实拍为准'}。\n模特要求：${$('aiModel').value}。场景：${$('aiScene').value}。镜头：${shot}。完整展示目标裤子，腰头不被上衣遮挡，双手不遮住口袋，鞋子和裤脚在画面内。真实自然光，清晰产品纹理。无文字、无拼图、无水印。`;
    const reference = approved ? state.sample.data : state.reference?.data;
    if (reference) { images.push(reference); prompt += '\n最后一张仅用于统一模特身份、上衣与场景风格，不能覆盖前面实拍的商品结构和颜色。'; }
    return { images, prompt, size: $('aiSize').value };
  }
  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
      signal.addEventListener('abort', stop, { once:true }); if (signal.aborted) stop();
    });
  }
  async function edit(source, shot, approved) {
    const signal = state.controller.signal;
    const headers = { 'Content-Type':'application/json', 'X-Studio-Token':state.token };
    const body = buildRequest(source, shot, approved);
    let data;
    if (state.jobs) {
      const id = crypto.randomUUID();
      const route = '/api/ai/jobs/' + id;
      try {
        const response = await fetch('/api/ai/jobs', { method:'POST', headers, body:JSON.stringify({ ...body, id }), signal });
        data = await response.json(); if (!response.ok) throw new Error(data.error || '任务提交失败。');
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
          await pause(2000, signal);
          const progress = await fetch(route, { headers, signal, cache:'no-store' });
          data = await progress.json(); if (!progress.ok) throw new Error(data.error || '无法查询生成进度。');
          if (data.state === 'done') break;
          if (data.state === 'failed' || data.state === 'cancelled') throw new Error(data.error || '任务已取消。');
        }
        if (data.state !== 'done') throw new Error('等待图片超时，请稍后重试。');
      } catch (error) {
        // Cancel by a client-selected ID even if the POST response was interrupted.
        fetch(route, { method:'DELETE', headers, keepalive:true }).catch(() => {});
        throw error;
      }
    } else {
      const response = await fetch('/api/ai/edit', { method:'POST', headers, body:JSON.stringify(body), signal });
      data = await response.json(); if (!response.ok) throw new Error(data.error || '生成失败，请手动重试。');
    }
    if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error('服务返回的图片无效。');
    await imageFrom(data.image); signal.throwIfAborted(); return data.image;
  }
  $('aiShare').onclick = async () => {
    try { await navigator.clipboard.writeText(location.origin + '/?tool=ai'); status('分享链接已复制。对方打开后填写自己的 API Key，即可使用 AI 出图。'); }
    catch { status('请复制浏览器地址栏中的网址分享。'); }
  };
  $('aiDisconnect').onclick = async () => {
    if (state.busy || !state.hosted) return;
    state.busy=true; update();
    try {
      const response = await fetch('/api/ai/disconnect', { method:'POST', headers:{ 'X-Studio-Token':state.token } });
      if (!response.ok) throw new Error('清除会话失败，请重试。');
      state.configured=false; state.token=null; await connection(); $('aiConfigStatus').textContent='本次会话密钥已清除，已有图片仍可下载。';
    } catch (error) { $('aiConfigStatus').textContent=error.message; }
    finally { state.busy=false; update(); }
  };
  function addResult(data, label, source, kind, shot) {
    const result = { data, label, source, kind, shot, revision: state.revision, id: ++state.serial, name: $('aiName').value.trim() || '商品' }; state.results.push(result);
    const card = document.createElement('article'); card.className = 'ai-result';
    const picture = document.createElement('img'); picture.src = data; picture.alt = label;
    picture.tabIndex = 0; picture.setAttribute('role', 'button'); picture.setAttribute('aria-label', '放大查看' + label);
    const enlarge = () => { const dialog = document.createElement('dialog'); dialog.className = 'ai-lightbox'; const full = document.createElement('img'); full.src = picture.src; full.alt = label; const close = document.createElement('button'); close.className = 'btn secondary'; close.textContent = '关闭预览'; close.onclick = () => dialog.close(); dialog.append(close, full); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal(); };
    picture.onclick = enlarge; picture.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enlarge(); } };
    const title = document.createElement('strong'); title.textContent = label;
    const note = document.createElement('p'); note.textContent = `第 ${result.revision + 1} 版设置 · ` + (kind === 'detail' ? '实拍原图排版 · 800 × 1200' : 'AI 生成 · 请核对产品细节');
    const actions = document.createElement('div'); actions.className = 'ai-inline';
    const compare = document.createElement('button'); compare.className = 'btn secondary'; compare.textContent = '查看原图'; compare.onclick = () => { const original = compare.textContent === '查看原图'; picture.src = original ? source.data : data; compare.textContent = original ? '查看结果' : '查看原图'; };
    const download = document.createElement('button'); download.className = 'btn secondary'; download.textContent = '下载'; download.onclick = async () => { try { const file = await resultFile(result); window.DetailExport.download(file.blob, file.name); } catch { status('下载失败，请重试。'); } };
    actions.append(compare, download); card.append(picture, title, note, actions); $('aiResults').append(card); update(); return result;
  }
  async function run(task) {
    if (state.busy) return;
    state.busy = true; state.controller = new AbortController(); update();
    try { await task(); } catch (error) { status(error.name === 'AbortError' ? '已取消。已完成图片可以下载；已提交的 API 请求可能仍会计费。' : error.message + ' 已完成图片已保留，可手动重试。'); }
    finally { state.busy = false; state.controller = null; update(); }
  }
  $('aiSample').onclick = () => run(async () => {
    const source = state.sources.find(x => x.role === 'front'); if (!source || !state.configured) return;
    $('aiApprove').checked = false; state.sample = null;
    status('正在生成正面样图，通常需要几分钟…');
    const data = await edit(source, '正面全身主图，自然站姿', false);
    state.sample = addResult(data, '正面样图', source, 'ai', 'sample');
    status('样图已生成。点击「查看原图」核对产品；满意后勾选确认，再继续生成套图。');
  });
  $('aiSet').onclick = () => run(async () => {
    if (!state.sample || state.sample.revision !== state.revision || !$('aiApprove').checked) return;
    const shots = [{ role: 'front', id: 'lifestyle', label: '场景主图', prompt: '正面全身，轻松自然站姿，略有环境空间' }, { role: 'side', id: 'side', label: '侧面主图', prompt: '按第一张产品图已提供的侧面角度拍摄，展示侧袋' }, { role: 'back', id: 'back', label: '背面主图', prompt: '背面全身，完整展示后腰和两个后袋' }];
    const missing = []; let count = 0;
    for (const shot of shots) {
      if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const source = state.sources.find(x => x.role === shot.role);
      if (!source) { missing.push(shot.label); continue; }
      if (state.results.some(x => x.sampleId === state.sample.id && x.shot === shot.id)) continue;
      status('正在生成' + shot.label + '，请稍候…');
      const data = await edit(source, shot.prompt, true);
      const result = addResult(data, shot.label, source, 'ai', shot.id); result.sampleId = state.sample.id; count++;
    }
    status(`套图处理完成，新增 ${count} 张。${missing.length ? '缺少对应实拍角度，已跳过：' + missing.join('、') + '。' : ''}可继续用实拍素材生成细节图。`);
  });
  $('aiCancel').onclick = () => { state.controller?.abort(); };
  $('aiDetails').onclick = () => run(async () => {
    const details = state.sources.filter(x => x.role === 'detail'); const sources = (details.length ? details : state.sources).slice(0, 4);
    for (const [index, source] of sources.entries()) {
      if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1200;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, 800, 1200);
      ctx.fillStyle = '#68717d'; ctx.font = '18px sans-serif'; ctx.fillText('PRODUCT DETAILS  /  ' + String(index + 1).padStart(2, '0'), 48, 68);
      ctx.fillStyle = '#24282e'; let title = source.caption || '产品细节'; let font = 38; do { ctx.font = `600 ${font--}px sans-serif`; } while (ctx.measureText(title).width > 704 && font > 14); ctx.fillText(title, 48, 135);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(32, 188, 736, 916);
      const scale = Math.min(704 / source.img.width, 884 / source.img.height); const w = source.img.width * scale, h = source.img.height * scale;
      ctx.drawImage(source.img, (800 - w) / 2, 204 + (884 - h) / 2, w, h);
      addResult(canvas.toDataURL('image/png'), source.caption || '实拍细节 ' + (index + 1), source, 'detail', 'detail');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    status(`已生成 ${sources.length} 张实拍细节图。产品区域来自原图，未使用 AI 重绘。`);
  });
  async function resultFile(result) { return { name: window.DetailExport.safeName(result.name + '_' + String(result.id).padStart(2, '0') + '_' + result.label) + '.png', blob: await (await fetch(result.data)).blob() }; }
  $('aiDownloadAll').onclick = async () => {
    if (state.busy) return; state.busy = true; update();
    try { const files = await Promise.all(state.results.map(resultFile)); const zip = await window.DetailExport.makeZip(files); window.DetailExport.download(zip, '商品套图_' + Date.now() + '.zip'); status('整套图片 ZIP 已准备下载。'); } catch { status('打包失败，请尝试逐张下载。'); } finally { state.busy = false; update(); }
  };
  window.AIWorkbench = Object.freeze({ isBusy: () => state.busy });
  connection();
})();
