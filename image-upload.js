(() => {
  'use strict';
  const bindings = [];
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');

  function bind({ input, zone, onFiles, isBusy = () => false, onMessage = () => {}, dragClass = 'drag' }) {
    let depth = 0, reading = false;
    const active = () => zone.isConnected && !zone.closest('[hidden]');
    const disabled = () => reading || isBusy() || input.matches(':disabled');
    const reset = () => { depth = 0; zone.classList.remove(dragClass); };
    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.dataset.imageUpload = input.id;
    const receive = async list => {
      if (!active() || disabled()) return;
      const files = Array.from(list || []);
      if (!files.length) return;
      if (!input.multiple && files.length > 1) {
        onMessage('此处一次只能上传 1 张图片，请重新选择或拖入。');
        return;
      }
      reading = true;
      zone.setAttribute('aria-busy', 'true');
      try { await onFiles(files); }
      catch (error) { onMessage(error.message || '图片读取失败，请重试。'); }
      finally { reading = false; zone.removeAttribute('aria-busy'); }
    };
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      void receive(files);
    });
    zone.addEventListener('click', event => { if (disabled()) event.preventDefault(); });
    zone.addEventListener('keydown', event => {
      if (event.target !== zone || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (!disabled()) input.click();
    });
    zone.addEventListener('dragenter', event => {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation(); depth++;
      if (active() && !disabled()) zone.classList.add(dragClass);
    });
    zone.addEventListener('dragover', event => {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = active() && !disabled() ? 'copy' : 'none';
    });
    zone.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) reset();
    });
    zone.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation(); reset();
      void receive(event.dataTransfer.files);
    });
    bindings.push({ active, disabled, reset, onMessage });
  }

  // File drops outside an upload box must never navigate away from unsaved work.
  ['dragover', 'drop'].forEach(type => document.addEventListener(type, event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (type === 'dragover') event.dataTransfer.dropEffect = 'none';
    else {
      bindings.forEach(binding => binding.reset());
      bindings.find(binding => binding.active() && !binding.disabled())?.onMessage('请把图片拖到当前功能的图片上传框内。');
    }
  }));
  window.addEventListener('dragend', () => bindings.forEach(binding => binding.reset()));
  window.ImageUpload = Object.freeze({ bind });
})();
