/**
 * Announcement Editor - rich text, inline images, multi-link rows,
 * multi-file attachments, and generated/uploaded graphic preview.
 */
(function(){
  const state = {
    attachments: [],
    graphicFile: null,
    graphicPreviewUrl: null,
    inlineImages: new Map(),
    nextInlineId: 1
  };

  function $(id){ return document.getElementById(id); }

  function escapeAttr(value){
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function isImageFile(file){
    return !!file && file.type && file.type.startsWith('image/');
  }

  function formatSize(bytes){
    return window.Utils?.formatFileSize ? Utils.formatFileSize(bytes) : ((bytes / 1024).toFixed(1) + ' KB');
  }

  function revokeUrl(url){
    if(url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function setStatus(message, tone){
    const status = $('annGraphicStatus');
    if(!status) return;
    status.textContent = message || '';
    status.style.color = tone === 'error' ? '#d84a3a' : (tone === 'success' ? 'var(--green-teal)' : '');
  }

  function updateCharCount(){
    const editor = $('announcementContent');
    const charCount = $('annCharCount');
    if(!editor || !charCount) return;
    const len = (editor.innerText || '').length;
    charCount.textContent = len.toLocaleString() + ' / 5,000';
    charCount.style.color = len > 5000 ? '#e74c3c' : '';
  }

  function updateToolbarState(){
    const toolbar = $('announcementToolbar');
    if(!toolbar) return;
    toolbar.querySelectorAll('.ann-tb-btn[data-cmd]').forEach(function(btn){
      const cmd = btn.dataset.cmd;
      if(cmd === 'removeFormat') return;
      try{ btn.classList.toggle('active', document.queryCommandState(cmd)); }catch(e){}
    });
  }

  function insertInlineImage(file){
    const editor = $('announcementContent');
    if(!editor || !isImageFile(file)){
      alert('Please choose a PNG, JPG, or WebP image.');
      return;
    }

    const id = `ann-inline-${Date.now()}-${state.nextInlineId++}`;
    const reader = new FileReader();
    reader.onload = function(e){
      const html = `<img src="${e.target.result}" alt="${escapeAttr(file.name)}" class="announcement-inline-image" data-ann-inline-id="${id}">`;
      editor.focus();
      document.execCommand('insertHTML', false, html);
      state.inlineImages.set(id, { id, file });
      updateCharCount();
    };
    reader.readAsDataURL(file);
  }

  function addAttachments(files){
    const incoming = Array.from(files || []);
    incoming.forEach(function(file){
      const duplicate = state.attachments.some(item =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
      );
      if(!duplicate && state.attachments.length < 10){
        state.attachments.push({ file, previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null });
      }
    });
    renderAttachments();
    updateGraphicPreview();
  }

  function removeAttachment(index){
    const [removed] = state.attachments.splice(index, 1);
    if(removed) revokeUrl(removed.previewUrl);
    renderAttachments();
    updateGraphicPreview();
  }

  function renderAttachments(){
    const list = $('annAttachmentList');
    if(!list) return;
    if(state.attachments.length === 0){
      list.innerHTML = '';
      return;
    }

    list.innerHTML = state.attachments.map(function(item, index){
      const file = item.file;
      const thumb = item.previewUrl
        ? `<img src="${item.previewUrl}" alt="">`
        : `<i class="fas ${Utils.fileIconForMime ? Utils.fileIconForMime(file.type) : 'fa-file'}"></i>`;
      return `
        <div class="announcement-attachment-item">
          <div class="announcement-attachment-thumb">${thumb}</div>
          <div>
            <div class="announcement-attachment-name">${Utils.escapeHtml(file.name)}</div>
            <div class="announcement-attachment-meta">${Utils.escapeHtml(file.type || 'file')} &middot; ${formatSize(file.size)}</div>
          </div>
          <button type="button" class="announcement-attachment-remove" data-index="${index}" title="Remove attachment"><i class="fas fa-times-circle"></i></button>
        </div>
      `;
    }).join('');
  }

  function setGraphicFile(file, source){
    if(file && !isImageFile(file)){
      alert('The announcement graphic must be an image.');
      return;
    }

    revokeUrl(state.graphicPreviewUrl);
    state.graphicFile = file || null;
    state.graphicPreviewUrl = file ? URL.createObjectURL(file) : null;
    updateGraphicPreview();

    if(file){
      setStatus(source === 'ai' ? 'AI picture ready for publishing.' : `${file.name} ready for publishing.`, 'success');
    } else {
      setStatus('');
    }
  }

  function firstImageAttachment(){
    const found = state.attachments.find(item => isImageFile(item.file));
    return found || null;
  }

  function updateGraphicPreview(){
    const image = $('annGraphicPreviewImage');
    const empty = $('annGraphicPreviewEmpty');
    if(!image || !empty) return;

    const fallback = firstImageAttachment();
    const url = state.graphicPreviewUrl || fallback?.previewUrl || '';

    if(url){
      image.src = url;
      image.hidden = false;
      empty.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      empty.hidden = false;
    }
  }

  function addLinkRow(labelValue, urlValue){
    const list = $('announcementLinks');
    if(!list) return;
    const rows = list.querySelectorAll('.announcement-link-row');
    if(rows.length >= 10) return;

    const row = document.createElement('div');
    row.className = 'announcement-link-row';
    row.innerHTML = `
      <input type="text" class="ann-link-label" placeholder="Label" aria-label="Link label" value="${escapeAttr(labelValue || '')}" />
      <input type="url" class="ann-link-url" placeholder="https://..." aria-label="Link URL" value="${escapeAttr(urlValue || '')}" />
      <button type="button" class="ann-link-remove" title="Remove link"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
    row.querySelector('.ann-link-label')?.focus();
  }

  function getLinks(){
    const list = $('announcementLinks');
    if(!list) return [];
    return Array.from(list.querySelectorAll('.announcement-link-row'))
      .map(function(row){
        return {
          label: row.querySelector('.ann-link-label')?.value.trim() || '',
          url: row.querySelector('.ann-link-url')?.value.trim() || ''
        };
      })
      .filter(link => link.url)
      .slice(0, 10);
  }

  function base64ToFile(base64, fileName, mimeType){
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i += 1){
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], fileName || `announcement-${Date.now()}.png`, { type: mimeType || 'image/png' });
  }

  async function generateGraphic(){
    const titleEl = $('announcementTitle');
    const editor = $('announcementContent');
    const btn = $('annGenerateImageBtn');
    const title = titleEl?.value.trim() || '';
    const content = editor?.innerHTML.trim() || '';
    const plainText = editor?.innerText.trim() || '';

    if(!title || !plainText){
      alert('Add a title and announcement content before generating a picture.');
      return;
    }

    if(!window.ServerAPI?.generateAnnouncementImage){
      alert('AI image generation is not available in this build.');
      return;
    }

    try {
      if(btn) btn.disabled = true;
      setStatus('Creating picture from announcement content...');
      const result = await ServerAPI.generateAnnouncementImage({ title, content });
      const file = base64ToFile(result.imageBase64, result.fileName, result.mimeType);
      setGraphicFile(file, 'ai');
    } catch (error) {
      console.error('AI picture generation failed:', error);
      setStatus(error.message || 'AI picture generation failed.', 'error');
      alert(error.message || 'AI picture generation failed. Check your OpenAI API key on your profile AI Keys tab.');
    } finally {
      if(btn) btn.disabled = false;
    }
  }

  async function prepareContentForPublish(uploadFile){
    const editor = $('announcementContent');
    if(!editor) return '';

    const inlineImages = Array.from(state.inlineImages.values());
    for(const item of inlineImages){
      const el = editor.querySelector(`[data-ann-inline-id="${item.id}"]`);
      if(!el) continue;
      if(el.dataset.annS3Key) continue;

      const uploaded = await uploadFile(item.file);
      el.dataset.annS3Key = uploaded.file_s3_key;
      el.setAttribute('src', '');
      el.classList.add('announcement-inline-image');
    }

    return editor.innerHTML.trim();
  }

  function reset(){
    state.attachments.forEach(item => revokeUrl(item.previewUrl));
    state.attachments = [];
    revokeUrl(state.graphicPreviewUrl);
    state.graphicFile = null;
    state.graphicPreviewUrl = null;
    state.inlineImages.clear();
    state.nextInlineId = 1;

    renderAttachments();
    updateGraphicPreview();
    setStatus('');

    const list = $('announcementLinks');
    if(list){
      const rows = list.querySelectorAll('.announcement-link-row');
      rows.forEach((row, index) => { if(index > 0) row.remove(); });
      const first = list.querySelector('.announcement-link-row');
      if(first){
        const label = first.querySelector('.ann-link-label');
        const url = first.querySelector('.ann-link-url');
        if(label) label.value = '';
        if(url) url.value = '';
      }
    }
  }

  function bindToolbar(){
    const toolbar = $('announcementToolbar');
    const editor = $('announcementContent');
    const fontSize = $('annFontSize');
    const inlineInput = $('announcementInlineImageInput');

    if(!toolbar || !editor) return;

    toolbar.addEventListener('click',function(e){
      const btn = e.target.closest('.ann-tb-btn');
      if(!btn) return;
      e.preventDefault();

      if(btn.dataset.action === 'insert-inline-image'){
        inlineInput?.click();
        return;
      }

      const cmd = btn.dataset.cmd;
      if(cmd){
        document.execCommand(cmd, false, null);
        editor.focus();
        updateToolbarState();
      }
    });

    inlineInput?.addEventListener('change', function(){
      Array.from(this.files || []).forEach(insertInlineImage);
      this.value = '';
    });

    if(fontSize){
      fontSize.addEventListener('change',function(){
        if(this.value){
          document.execCommand('fontSize', false, this.value);
          editor.focus();
        }
        this.value = '';
      });
    }

    editor.addEventListener('input', updateCharCount);
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);
    editor.addEventListener('paste', function(e){
      const files = Array.from(e.clipboardData?.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(isImageFile);
      if(files.length === 0) return;
      e.preventDefault();
      files.forEach(insertInlineImage);
    });
    editor.addEventListener('dragover', function(e){
      e.preventDefault();
      editor.classList.add('drag-over');
    });
    editor.addEventListener('dragleave', function(){
      editor.classList.remove('drag-over');
    });
    editor.addEventListener('drop', function(e){
      const files = Array.from(e.dataTransfer?.files || []).filter(isImageFile);
      if(files.length === 0) return;
      e.preventDefault();
      editor.classList.remove('drag-over');
      files.forEach(insertInlineImage);
    });
  }

  function bindAttachments(){
    const dropzone = $('announcementDropzone');
    const input = $('announcementFile');
    const list = $('annAttachmentList');

    if(!dropzone || !input) return;

    dropzone.addEventListener('click', function(){
      input.click();
    });
    dropzone.addEventListener('dragover', function(e){
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', function(){
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', function(e){
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      addAttachments(e.dataTransfer.files);
    });
    input.addEventListener('change', function(){
      addAttachments(this.files);
      this.value = '';
    });
    list?.addEventListener('click', function(e){
      const btn = e.target.closest('.announcement-attachment-remove');
      if(!btn) return;
      removeAttachment(Number(btn.dataset.index));
    });
  }

  function bindLinks(){
    $('annAddLink')?.addEventListener('click', function(){
      addLinkRow();
    });

    $('announcementLinks')?.addEventListener('click', function(e){
      const btn = e.target.closest('.ann-link-remove');
      if(!btn) return;
      const rows = this.querySelectorAll('.announcement-link-row');
      const row = btn.closest('.announcement-link-row');
      if(rows.length === 1){
        row.querySelectorAll('input').forEach(input => { input.value = ''; });
      } else {
        row.remove();
      }
    });
  }

  function bindGraphic(){
    const input = $('announcementGraphicFile');
    $('annGraphicUploadBtn')?.addEventListener('click', function(){ input?.click(); });
    input?.addEventListener('change', function(){
      setGraphicFile(this.files?.[0] || null, 'upload');
      this.value = '';
    });
    $('annGraphicClearBtn')?.addEventListener('click', function(){
      setGraphicFile(null);
    });
    $('annGenerateImageBtn')?.addEventListener('click', generateGraphic);
  }

  function init(){
    bindToolbar();
    bindAttachments();
    bindLinks();
    bindGraphic();
    updateCharCount();
  }

  window.AnnouncementEditor = {
    init,
    reset,
    getLinks,
    getAttachmentFiles(){ return state.attachments.map(item => item.file); },
    getGraphicFile(){ return state.graphicFile || null; },
    prepareContentForPublish,
    setGraphicFile,
  };

  init();
})();
