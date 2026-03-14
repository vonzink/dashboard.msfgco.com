/**
 * Announcement Editor - Rich Text Toolbar & Dropzone Logic
 * Handles the announcement creation form's formatting toolbar,
 * character counting, and file upload dropzone.
 */
(function(){
  // ---- Rich Text Toolbar ----
  const toolbar = document.getElementById('announcementToolbar');
  const editor = document.getElementById('announcementContent');
  const fontSize = document.getElementById('annFontSize');
  const charCount = document.getElementById('annCharCount');

  if(toolbar && editor){
    toolbar.addEventListener('click',function(e){
      const btn = e.target.closest('.ann-tb-btn');
      if(!btn) return;
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if(cmd){
        document.execCommand(cmd, false, null);
        editor.focus();
        updateToolbarState();
      }
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

    function updateToolbarState(){
      toolbar.querySelectorAll('.ann-tb-btn[data-cmd]').forEach(function(btn){
        const cmd = btn.dataset.cmd;
        if(cmd === 'removeFormat') return;
        try{ btn.classList.toggle('active', document.queryCommandState(cmd)); }catch(e){}
      });
    }

    function updateCharCount(){
      const text = editor.innerText || '';
      const len = text.length;
      if(charCount) charCount.textContent = len.toLocaleString() + ' / 5,000';
      if(len > 5000 && charCount) charCount.style.color = '#e74c3c';
      else if(charCount) charCount.style.color = '';
    }
  }

  // ---- Dropzone ----
  const dropzone = document.getElementById('announcementDropzone');
  const fileInput = document.getElementById('announcementFile');
  const dropContent = document.getElementById('annDropzoneContent');
  const filePreview = document.getElementById('annFilePreview');
  const fileNameEl = document.getElementById('annFileName');
  const fileSizeEl = document.getElementById('annFileSize');
  const fileThumbnail = document.getElementById('annFileThumbnail');
  const fileRemove = document.getElementById('annFileRemove');

  if(dropzone && fileInput){
    dropzone.addEventListener('click',function(e){
      if(e.target.closest('#annFileRemove')) return;
      fileInput.click();
    });

    dropzone.addEventListener('dragover',function(e){ e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave',function(){ dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop',function(e){
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if(e.dataTransfer.files.length){ fileInput.files = e.dataTransfer.files; showFilePreview(e.dataTransfer.files[0]); }
    });

    fileInput.addEventListener('change',function(){ if(this.files[0]) showFilePreview(this.files[0]); });

    if(fileRemove) fileRemove.addEventListener('click',function(e){
      e.stopPropagation();
      fileInput.value = '';
      dropContent.style.display = '';
      filePreview.style.display = 'none';
    });

    function showFilePreview(file){
      dropContent.style.display = 'none';
      filePreview.style.display = 'flex';
      fileNameEl.textContent = file.name;
      fileSizeEl.textContent = (file.size/1024).toFixed(1) + ' KB';

      if(file.type && file.type.startsWith('image/')){
        const reader = new FileReader();
        reader.onload = function(e){ fileThumbnail.innerHTML = '<img src="'+e.target.result+'" style="width:100%;height:100%;object-fit:cover;">'; };
        reader.readAsDataURL(file);
      } else {
        const iconMap = {'application/pdf':'fa-file-pdf','application/msword':'fa-file-word','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'fa-file-word','application/vnd.ms-excel':'fa-file-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'fa-file-excel'};
        const ic = iconMap[file.type] || 'fa-file';
        fileThumbnail.innerHTML = '<i class="fas '+ic+'" style="font-size:1.2rem;color:var(--text-muted);"></i>';
      }
    }
  }
})();
