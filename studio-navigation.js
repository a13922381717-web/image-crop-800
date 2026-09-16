(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const entries = {
    ai: { title: 'AI 模特与场景', category: '主图与详情', description: '上传同款产品实拍，替换模特与场景，生成主图和实拍细节套图。', panel: 'aiPanel' },
    crop: { title: '800×800 主图裁剪', category: '主图与详情', description: '拖动、缩放调整主体，裁剪填满或白底补边，批量保存标准电商主图。', panel: 'cropPanel' },
    detail: { title: '模板详情图生成', category: '主图与详情', description: '上传产品素材、填写卖点，自动生成产品封面、卖点、细节、多角度与产品总览。', panel: 'detailPanel' },
    translate: { title: '详情图英文翻译', category: '主图与详情', description: '保留中文原文，翻译或编辑英文文案，生成与导出整套英文详情图。', panel: 'detailPanel' },
    portrait: { title: '批量生成 3:4 长图', category: '批量图片处理', description: '把商品图片统一为 900×1200 竖版，适合需要 3:4 比例的商品展示。', panel: 'batchPanel' },
    png800: { title: '批量 800×800 PNG', category: '批量图片处理', description: '统一生成 800×800 PNG 图片，选择白底或透明补边，保留原始图片的透明区域。', panel: 'batchPanel' },
    resize: { title: '批量调整尺寸', category: '批量图片处理', description: '自定义目标宽高，选择完整保留或居中裁剪，批量处理同一组产品图片。', panel: 'batchPanel' },
    compress: { title: '图片压缩与格式转换', category: '批量图片处理', description: '调整最长边、导出格式与质量，查看处理前后的文件大小，再批量下载。', panel: 'batchPanel' },
    collage: { title: '商品拼图与长图拼接', category: '排版与修饰', description: '按素材顺序生成网格拼图或竖向长图，统一宽度、间距与背景。', panel: 'batchPanel' },
    watermark: { title: '批量添加文字水印', category: '排版与修饰', description: '统一添加店铺名或品牌文字，可设置位置、颜色、字号与透明度。', panel: 'batchPanel' },
    background: { title: '批量纯色背景替换', category: '排版与修饰', description: '替换与图片边缘连通的纯色背景，适合白底商品图，可输出纯色或透明背景。', panel: 'batchPanel' }
  };
  const buttons = Array.from($('studioNav').querySelectorAll('[data-tool]'));
  let current = 'crop';

  function setMenu(open) {
    document.querySelector('.studio-sidebar').classList.toggle('menu-open', open);
    $('studioMenuToggle').setAttribute('aria-expanded', String(open));
  }
  function refreshNavigation(id) {
    const entry = entries[id]; current = id;
    buttons.forEach(button => {
      const active = button.dataset.tool === id;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    ['cropPanel', 'detailPanel', 'batchPanel', 'aiPanel'].forEach(panel => { $(panel).hidden = panel !== entry.panel; });
    $('studioToolTitle').textContent = entry.title;
    $('studioToolDescription').textContent = entry.description;
    $('studioCategory').textContent = entry.category;
    $('detailPanel').setAttribute('aria-labelledby', id === 'translate' ? 'translateTab' : 'detailTab');
    $('studioNavStatus').textContent = '';
  }
  function select(id) {
    if (!entries[id]) return false;
    if (current === id) { setMenu(false); return true; }
    if (window.DetailWorkbench?.isBusy() || window.BatchWorkbench?.isBusy() || window.AIWorkbench?.isBusy()) {
      $('studioNavStatus').textContent = '正在处理，请完成或取消后切换功能。';
      return false;
    }
    if (entries[id].panel === 'detailPanel' && !window.DetailWorkbench.setLanguage(id === 'translate' ? 'en' : 'zh')) return false;
    if (entries[id].panel === 'batchPanel' && !window.BatchWorkbench.open(id)) return false;
    refreshNavigation(id); setMenu(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return true;
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(button.dataset.tool));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault(); buttons[next].focus();
    });
  });
  $('studioMenuToggle').addEventListener('click', () => setMenu($('studioMenuToggle').getAttribute('aria-expanded') !== 'true'));
  document.querySelector('.studio-sidebar').addEventListener('keydown', event => {
    if (event.key === 'Escape') { setMenu(false); $('studioMenuToggle').focus(); }
  });
  document.addEventListener('studio:detail-language-changed', event => {
    if (current === 'detail' || current === 'translate') refreshNavigation(event.detail.language === 'en' ? 'translate' : 'detail');
  });
  window.StudioNavigation = Object.freeze({ select, current: () => current });
  refreshNavigation('crop');
  const initialTool = new URLSearchParams(location.search).get('tool');
  if (initialTool && entries[initialTool]) select(initialTool);
})();
