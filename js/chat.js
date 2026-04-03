/* ============================================
   MSFG Dashboard - Chat Module
   Company chat with tag-based filtering,
   message editing, deletion, and file attachments
   ============================================ */

var CONFIG = window.CONFIG || window.MSFG_CONFIG;
if (!CONFIG) { throw new Error('CONFIG not loaded. js/config.js must load before chat.js'); }

const Chat = {
  // ========================================
  // PROPERTIES
  // ========================================
  currentUser: CONFIG.currentUser,
  maxMessages: CONFIG.chat.maxMessages,
  isConnected: false,
  websocket: null,
  _wsRetryCount: 0,
  _wsRetryTimer: null,
  _wsMaxRetries: 10,

  tags: [],                // All available tags [{id, name, color}]
  activeFilterTagId: null, // Currently filtering by this tag (null = show all)
  selectedTagIds: [],      // Tags selected for the NEXT message being composed
  messages: [],            // Local message cache
  _refreshTimer: null,
  _editingMsgId: null,     // Currently editing this message ID
  _pendingFiles: [],       // Files pending attachment to next message

  // ========================================
  // INITIALIZATION
  // ========================================
  init() {
    if (!CONFIG.features.chat) return;

    // Clear existing timers (prevents leak on re-init)
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._wsRetryTimer) { clearTimeout(this._wsRetryTimer); this._wsRetryTimer = null; }

    this.bindEvents();
    this.bindFloatPanel();
    this.loadTags().then(() => this.loadMessages());

    // Try WebSocket for real-time updates; fall back to polling
    this._connectWebSocket();
  },

  destroy() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._wsRetryTimer) { clearTimeout(this._wsRetryTimer); this._wsRetryTimer = null; }
    if (this.websocket) {
      this.websocket.close(1000, 'destroy');
      this.websocket = null;
    }
  },

  // ========================================
  // WEBSOCKET (real-time updates)
  // ========================================
  _connectWebSocket() {
    const apiBase = CONFIG.api.baseUrl.replace(/\/api$/, '');
    const wsProtocol = apiBase.startsWith('https') ? 'wss' : 'ws';
    const wsHost = apiBase.replace(/^https?:\/\//, '');
    const token = ServerAPI.getAuthToken();

    if (!token) {
      this._startPolling();
      return;
    }

    try {
      const wsUrl = wsProtocol + '://' + wsHost + '/ws?token=' + encodeURIComponent(token);
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        this.isConnected = true;
        this._wsRetryCount = 0;
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        console.log('Chat WebSocket connected');
      };

      this.websocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleWsMessage(msg);
        } catch (err) {
          // Ignore malformed messages
        }
      };

      this.websocket.onclose = (event) => {
        this.isConnected = false;
        this.websocket = null;

        if (event.code === 1000) return;

        if (this._wsRetryCount < this._wsMaxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this._wsRetryCount), 30000);
          this._wsRetryCount++;
          this._wsRetryTimer = setTimeout(() => this._connectWebSocket(), delay);
        } else {
          console.warn('WebSocket max retries reached, falling back to polling');
          this._startPolling();
        }
      };

      this.websocket.onerror = () => {};
    } catch (err) {
      console.warn('WebSocket connection failed, using polling:', err.message);
      this._startPolling();
    }
  },

  _startPolling() {
    if (this._refreshTimer) return;
    this._refreshTimer = setInterval(() => this.loadMessages(), CONFIG.refresh?.chat || 30000);
  },

  _handleWsMessage(msg) {
    switch (msg.type) {
      case 'chat:message': {
        const data = msg.data;
        if (!this.messages.find(m => m.id === data.id)) {
          this.messages.push(data);
          if (this.messages.length > (this.maxMessages || 200)) {
            this.messages = this.messages.slice(-100);
          }
          if (!this.activeFilterTagId ||
              (data.tags && data.tags.some(t => t.id === this.activeFilterTagId))) {
            this.renderMessages(this.messages);
          }
        }
        break;
      }

      case 'chat:edit': {
        const data = msg.data;
        const idx = this.messages.findIndex(m => m.id === data.id);
        if (idx !== -1) {
          this.messages[idx] = { ...this.messages[idx], ...data };
          this.renderMessages(this.messages);
        }
        break;
      }

      case 'chat:delete': {
        const deleteId = msg.data.id;
        this.messages = this.messages.filter(m => m.id !== deleteId);
        this.renderMessages(this.messages);
        break;
      }

      case 'chat:tags': {
        const { id, tag_ids } = msg.data;
        const existing = this.messages.find(m => m.id === id);
        if (existing) {
          existing.tags = (tag_ids || []).map(tid => this.tags.find(t => t.id === tid)).filter(Boolean);
          this.renderMessages(this.messages);
        }
        break;
      }

      case 'chat:attachment': {
        const { message_id, attachment } = msg.data;
        const existing = this.messages.find(m => m.id === message_id);
        if (existing) {
          if (!existing.attachments) existing.attachments = [];
          existing.attachments.push(attachment);
          this.renderMessages(this.messages);
        }
        break;
      }

      case 'chat:attachment:delete': {
        const { message_id, attachment_id } = msg.data;
        const existing = this.messages.find(m => m.id === message_id);
        if (existing && existing.attachments) {
          existing.attachments = existing.attachments.filter(a => a.id !== attachment_id);
          this.renderMessages(this.messages);
        }
        break;
      }
    }
  },

  bindEvents() {
    // Form submit
    const form = document.getElementById('chatForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    const input = document.getElementById('chatInput');
    if (input) {
      input.addEventListener('input', (e) => {
        if (e.target.value.length > CONFIG.chat.maxMessageLength) {
          e.target.value = e.target.value.slice(0, CONFIG.chat.maxMessageLength);
        }
      });
      // Escape to cancel edit mode
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._editingMsgId) {
          this._cancelEdit();
        }
      });
    }

    // File attach button
    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        document.getElementById('chatFileInput')?.click();
      });
    }

    // File input change
    const fileInput = document.getElementById('chatFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach(f => {
          if (f.size > 10 * 1024 * 1024) {
            alert('File "' + f.name + '" exceeds 10MB limit.');
            return;
          }
          this._pendingFiles.push(f);
        });
        this._renderPendingFiles();
        fileInput.value = '';
      });
    }

    // Manage Tags button in section header
    const manageBtn = document.getElementById('chatManageTagsBtn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => this.openManageTagsModal());
    }

    // Manage Tags modal — close button
    const closeBtn = document.getElementById('closeManageTagsModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeManageTagsModal());
    }

    // Manage Tags modal — overlay click to close
    const modal = document.getElementById('manageTagsModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeManageTagsModal();
      });
    }

    // Manage Tags modal — create tag button
    const createBtn = document.getElementById('createTagSaveBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.createTagFromModal());
    }

    const tagInput = document.getElementById('newTagNameInput');
    if (tagInput) {
      tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.createTagFromModal();
        }
      });
    }
  },

  // ========================================
  // FLOATING PANEL CONTROLS
  // ========================================
  bindFloatPanel() {
    const fab = document.getElementById('chatFab');
    const panel = document.getElementById('chatFloatPanel');
    const closeBtn = document.getElementById('chatFloatClose');

    if (!fab || !panel) return;

    if (Utils.getStorage('msfg_chat_open', false) === true) {
      this._openPanel();
    }

    fab.addEventListener('click', () => {
      if (panel.classList.contains('is-open')) {
        this._closePanel();
      } else {
        this._openPanel();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._closePanel());
    }
  },

  _openPanel() {
    const fab = document.getElementById('chatFab');
    const panel = document.getElementById('chatFloatPanel');
    if (!panel) return;

    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    if (fab) fab.classList.add('is-open');

    Utils.setStorage('msfg_chat_open', true);
    this.scrollToBottom();
  },

  _closePanel() {
    const fab = document.getElementById('chatFab');
    const panel = document.getElementById('chatFloatPanel');
    if (!panel) return;

    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    if (fab) fab.classList.remove('is-open');

    Utils.setStorage('msfg_chat_open', false);
  },

  // ========================================
  // MANAGE TAGS MODAL
  // ========================================
  openManageTagsModal() {
    const modal = document.getElementById('manageTagsModal');
    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      this.renderManageTagsList();
      const inp = document.getElementById('newTagNameInput');
      if (inp) setTimeout(() => inp.focus(), 100);
    }
  },

  closeManageTagsModal() {
    const modal = document.getElementById('manageTagsModal');
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }
  },

  renderManageTagsList() {
    const container = document.getElementById('manageTagsList');
    if (!container) return;

    const esc = Utils.escapeHtml.bind(Utils);

    if (this.tags.length === 0) {
      container.innerHTML = '<div class="manage-tags-empty">' +
        '<i class="fas fa-tags"></i>' +
        '<p>No tags yet. Create your first tag above!</p>' +
      '</div>';
      return;
    }

    let html = '<table class="manage-tags-table"><tbody>';
    this.tags.forEach(tag => {
      html += '<tr class="manage-tags-row" data-tag-id="' + tag.id + '">' +
        '<td>' +
          '<span class="chat-msg-tag" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' + esc(tag.name) + '</span>' +
        '</td>' +
        '<td class="manage-tags-actions-cell">' +
          '<button type="button" class="btn btn-sm btn-danger manage-tag-delete-btn" data-tag-id="' + tag.id + '" title="Delete tag">' +
            '<i class="fas fa-trash"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';

    container.innerHTML = html;

    container.querySelectorAll('.manage-tag-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tagId = parseInt(btn.dataset.tagId);
        const tag = this.tags.find(t => t.id === tagId);
        if (!tag) return;
        if (!confirm('Delete tag "' + tag.name + '"? It will be removed from all messages.')) return;

        try {
          await ServerAPI.deleteChatTag(tagId);
          this.tags = this.tags.filter(t => t.id !== tagId);
          this.selectedTagIds = this.selectedTagIds.filter(id => id !== tagId);
          this.renderManageTagsList();
          this.renderTagFilter();
          this.renderTagPicker();
        } catch (err) {
          console.error('Failed to delete tag:', err);
          alert('Failed to delete tag.');
        }
      });
    });
  },

  async createTagFromModal() {
    const nameInput = document.getElementById('newTagNameInput');
    const colorInput = document.getElementById('newTagColorInput');
    const name = nameInput?.value.trim();
    if (!name) {
      nameInput?.focus();
      return;
    }

    const color = colorInput?.value || '#8cc63e';

    try {
      const tag = await ServerAPI.createChatTag(name, color);
      if (tag && tag.id) {
        if (!this.tags.find(t => t.id === tag.id)) {
          this.tags.push(tag);
        }
        this.renderManageTagsList();
        this.renderTagFilter();
        this.renderTagPicker();
        if (nameInput) nameInput.value = '';
      }
    } catch (err) {
      console.error('Failed to create tag:', err);
      alert('Failed to create tag. It may already exist.');
    }
  },

  // ========================================
  // LOAD TAGS FROM API
  // ========================================
  async loadTags() {
    try {
      const tags = await ServerAPI.getChatTags();
      this.tags = Array.isArray(tags) ? tags : [];
      this.renderTagFilter();
      this.renderTagPicker();
    } catch (err) {
      console.warn('Failed to load chat tags:', err);
      this.tags = [];
    }
  },

  // ========================================
  // TAG FILTER BAR (top of chat)
  // ========================================
  renderTagFilter() {
    const container = document.getElementById('chatTagFilter');
    if (!container) return;

    const esc = Utils.escapeHtml.bind(Utils);

    if (this.tags.length === 0) {
      container.innerHTML = '<span class="chat-tag-filter-hint"><i class="fas fa-info-circle"></i> Click "Manage Tags" to create tags for organizing conversations</span>';
      return;
    }

    let html = '<span class="chat-tag-filter-label">Filter:</span>' +
      '<button type="button" class="chat-tag-btn chat-tag-all' +
      (this.activeFilterTagId === null ? ' active' : '') +
      '" data-tag-filter="all">All</button>';

    this.tags.forEach(tag => {
      const isActive = this.activeFilterTagId === tag.id;
      html += '<button type="button" class="chat-tag-btn' + (isActive ? ' active' : '') +
        '" data-tag-filter="' + tag.id + '" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' +
        esc(tag.name) + '</button>';
    });

    container.innerHTML = html;

    container.querySelectorAll('[data-tag-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.tagFilter;
        this.activeFilterTagId = val === 'all' ? null : parseInt(val);
        this.renderTagFilter();
        this.loadMessages();
      });
    });
  },

  // ========================================
  // TAG PICKER (above input)
  // ========================================
  renderTagPicker() {
    const container = document.getElementById('chatTagPicker');
    if (!container) return;

    const esc = Utils.escapeHtml.bind(Utils);
    if (this.tags.length === 0) {
      container.innerHTML = '<span class="chat-tag-picker-empty">No tags yet — use "Manage Tags" to create some</span>';
      return;
    }

    let html = '';
    this.tags.forEach(tag => {
      const isSelected = this.selectedTagIds.includes(tag.id);
      html += '<button type="button" class="chat-tag-pill' + (isSelected ? ' selected' : '') +
        '" data-tag-pick="' + tag.id + '" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' +
        esc(tag.name) + '</button>';
    });
    container.innerHTML = html;

    container.querySelectorAll('[data-tag-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = parseInt(btn.dataset.tagPick);
        if (this.selectedTagIds.includes(tid)) {
          this.selectedTagIds = this.selectedTagIds.filter(x => x !== tid);
          btn.classList.remove('selected');
        } else {
          this.selectedTagIds.push(tid);
          btn.classList.add('selected');
        }
      });
    });
  },

  // ========================================
  // MESSAGES
  // ========================================
  async loadMessages() {
    try {
      const params = { limit: 50 };
      if (this.activeFilterTagId) params.tag = this.activeFilterTagId;

      const messages = await ServerAPI.getChatMessages(params);
      this.messages = messages;
      this.renderMessages(messages);
    } catch (err) {
      console.warn('Failed to load chat messages:', err);
    }
  },

  renderMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const userId = CONFIG.currentUser?.id;
    const isAdmin = String(CONFIG.currentUser?.role || '').toLowerCase() === 'admin';
    const esc = Utils.escapeHtml.bind(Utils);

    if (!messages || messages.length === 0) {
      const filterMsg = this.activeFilterTagId
        ? 'No messages with this tag.'
        : 'No messages yet. Start the conversation!';
      container.innerHTML = '<div class="chat-empty"><i class="fas fa-comments"></i><p>' + filterMsg + '</p></div>';
      return;
    }

    container.innerHTML = messages.map(msg => {
      const isOwn = msg.user_id === userId;
      const canEdit = isOwn;
      const canDelete = isOwn || isAdmin;

      // Tags
      const tagsHtml = (msg.tags && msg.tags.length > 0)
        ? '<div class="chat-msg-tags">' +
          msg.tags.map(t =>
            '<span class="chat-msg-tag" style="--tag-color: ' + esc(t.color || '#8cc63e') + ';">' + esc(t.name) + '</span>'
          ).join('') +
          '</div>'
        : '';

      // Attachments
      const attachHtml = (msg.attachments && msg.attachments.length > 0)
        ? '<div class="chat-attachments">' +
          msg.attachments.map(a => {
            const icon = this._fileIcon(a.file_type);
            const size = this._formatFileSize(a.file_size);
            const deleteBtn = canDelete
              ? ' <button type="button" class="chat-attach-delete" data-attach-id="' + a.id + '" title="Delete file"><i class="fas fa-times"></i></button>'
              : '';
            return '<div class="chat-attachment-card" data-attach-id="' + a.id + '">' +
              '<i class="fas ' + icon + ' chat-attach-icon"></i>' +
              '<div class="chat-attach-info">' +
                '<span class="chat-attach-name" title="' + esc(a.file_name) + '">' + esc(a.file_name) + '</span>' +
                '<span class="chat-attach-size">' + size + '</span>' +
              '</div>' +
              '<button type="button" class="chat-attach-download" data-attach-id="' + a.id + '" title="Download"><i class="fas fa-download"></i></button>' +
              deleteBtn +
            '</div>';
          }).join('') +
          '</div>'
        : '';

      // Action buttons (hover)
      let actionsHtml = '<div class="chat-msg-actions">';
      if (canEdit) {
        actionsHtml += '<button type="button" class="chat-action-btn chat-edit-btn" data-msg-id="' + msg.id + '" title="Edit"><i class="fas fa-pencil-alt"></i></button>';
      }
      if (canDelete) {
        actionsHtml += '<button type="button" class="chat-action-btn chat-delete-btn" data-msg-id="' + msg.id + '" title="Delete"><i class="fas fa-trash"></i></button>';
      }
      actionsHtml += '<button type="button" class="chat-action-btn chat-tag-edit-btn" data-msg-id="' + msg.id + '" title="Edit tags"><i class="fas fa-tag"></i></button>';
      actionsHtml += '</div>';

      const editedLabel = msg.is_edited ? '<span class="chat-edited">(edited)</span>' : '';

      return '<div class="chat-message' + (isOwn ? ' own' : '') + '" data-msg-id="' + msg.id + '">' +
        '<div class="chat-avatar">' + esc(msg.sender_initials || '??') + '</div>' +
        '<div class="chat-bubble">' +
          actionsHtml +
          '<div class="chat-sender">' + (isOwn ? 'You' : esc(msg.sender_name)) + '</div>' +
          '<div class="chat-text">' + esc(msg.message) + '</div>' +
          attachHtml +
          tagsHtml +
          '<div class="chat-meta">' +
            '<span class="chat-time">' + this.formatTime(msg.created_at) + '</span>' +
            editedLabel +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind action buttons
    container.querySelectorAll('.chat-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startEdit(parseInt(btn.dataset.msgId));
      });
    });

    container.querySelectorAll('.chat-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteMessage(parseInt(btn.dataset.msgId));
      });
    });

    container.querySelectorAll('.chat-tag-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTagEditor(parseInt(btn.dataset.msgId), btn);
      });
    });

    // Bind attachment download/delete buttons
    container.querySelectorAll('.chat-attach-download').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._downloadAttachment(parseInt(btn.dataset.attachId));
      });
    });

    container.querySelectorAll('.chat-attach-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteAttachment(parseInt(btn.dataset.attachId));
      });
    });

    this.scrollToBottom();
  },

  // ========================================
  // EDIT MESSAGE
  // ========================================
  _startEdit(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    this._editingMsgId = msgId;
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    if (input) {
      input.value = msg.message;
      input.focus();
      input.dataset.editId = msgId;
    }
    // Show edit indicator
    this._showEditIndicator(msg);
    if (sendBtn) {
      sendBtn.innerHTML = '<i class="fas fa-check"></i> Save';
    }
  },

  _cancelEdit() {
    this._editingMsgId = null;
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    if (input) {
      input.value = '';
      delete input.dataset.editId;
    }
    this._hideEditIndicator();
    if (sendBtn) {
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
    }
  },

  _showEditIndicator(msg) {
    const bar = document.getElementById('chatEditBar');
    if (bar) {
      bar.innerHTML = '<i class="fas fa-pencil-alt"></i> Editing message <button type="button" class="chat-edit-cancel" id="chatEditCancel"><i class="fas fa-times"></i> Cancel</button>';
      bar.style.display = 'flex';
      document.getElementById('chatEditCancel')?.addEventListener('click', () => this._cancelEdit());
    }
  },

  _hideEditIndicator() {
    const bar = document.getElementById('chatEditBar');
    if (bar) {
      bar.style.display = 'none';
      bar.innerHTML = '';
    }
  },

  // ========================================
  // DELETE MESSAGE
  // ========================================
  async _deleteMessage(msgId) {
    if (!confirm('Delete this message?')) return;
    try {
      await ServerAPI.deleteChatMessage(msgId);
      // If WebSocket is connected, broadcast will handle removal.
      // Otherwise remove locally.
      if (!this.isConnected) {
        this.messages = this.messages.filter(m => m.id !== msgId);
        this.renderMessages(this.messages);
      }
    } catch (err) {
      console.error('Failed to delete message:', err);
      alert('Failed to delete message.');
    }
  },

  // ========================================
  // FILE ATTACHMENTS
  // ========================================
  _renderPendingFiles() {
    const container = document.getElementById('chatPendingFiles');
    if (!container) return;

    if (this._pendingFiles.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const esc = Utils.escapeHtml.bind(Utils);
    container.innerHTML = this._pendingFiles.map((f, i) =>
      '<div class="chat-pending-file">' +
        '<i class="fas ' + this._fileIcon(f.type) + '"></i> ' +
        '<span>' + esc(f.name) + '</span>' +
        '<button type="button" class="chat-pending-remove" data-idx="' + i + '"><i class="fas fa-times"></i></button>' +
      '</div>'
    ).join('');

    container.querySelectorAll('.chat-pending-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        this._pendingFiles.splice(idx, 1);
        this._renderPendingFiles();
      });
    });
  },

  async _uploadAttachments(msgId) {
    if (this._pendingFiles.length === 0) return;

    const files = [...this._pendingFiles];
    this._pendingFiles = [];
    this._renderPendingFiles();

    for (const file of files) {
      try {
        // 1. Get presigned upload URL
        const { uploadUrl, s3Key } = await ServerAPI.getChatAttachmentUploadUrl(
          msgId, file.name, file.type, file.size
        );

        // 2. Upload file directly to S3
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });

        // 3. Save attachment record
        await ServerAPI.saveChatAttachment(msgId, {
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream',
          s3_key: s3Key,
          s3_bucket: 'msfg-media',
        });
      } catch (err) {
        console.error('Failed to upload attachment:', file.name, err);
      }
    }
  },

  async _downloadAttachment(attachId) {
    try {
      const { downloadUrl } = await ServerAPI.getChatAttachmentDownloadUrl(attachId);
      window.open(downloadUrl, '_blank');
    } catch (err) {
      console.error('Failed to download attachment:', err);
      alert('Failed to download file.');
    }
  },

  async _deleteAttachment(attachId) {
    if (!confirm('Delete this file?')) return;
    try {
      await ServerAPI.deleteChatAttachment(attachId);
      if (!this.isConnected) {
        // Remove locally
        for (const msg of this.messages) {
          if (msg.attachments) {
            msg.attachments = msg.attachments.filter(a => a.id !== attachId);
          }
        }
        this.renderMessages(this.messages);
      }
    } catch (err) {
      console.error('Failed to delete attachment:', err);
      alert('Failed to delete file.');
    }
  },

  _fileIcon(mimeType) {
    if (!mimeType) return 'fa-file';
    if (mimeType.startsWith('image/')) return 'fa-file-image';
    if (mimeType.startsWith('video/')) return 'fa-file-video';
    if (mimeType.startsWith('audio/')) return 'fa-file-audio';
    if (mimeType.includes('pdf')) return 'fa-file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'fa-file-excel';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'fa-file-powerpoint';
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return 'fa-file-archive';
    return 'fa-file';
  },

  _formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  },

  // ========================================
  // TAG EDITOR POPOVER
  // ========================================
  showTagEditor(msgId, anchorEl) {
    document.querySelectorAll('.chat-tag-popover').forEach(el => el.remove());

    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    const currentTagIds = (msg.tags || []).map(t => t.id);
    const esc = Utils.escapeHtml.bind(Utils);

    const popover = document.createElement('div');
    popover.className = 'chat-tag-popover';

    let html = '<div class="chat-tag-popover-title">Tags</div><div class="chat-tag-popover-list">';
    this.tags.forEach(tag => {
      const checked = currentTagIds.includes(tag.id) ? ' checked' : '';
      html += '<label class="chat-tag-popover-item">' +
        '<input type="checkbox" value="' + tag.id + '"' + checked + ' /> ' +
        '<span class="chat-tag-pill" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' + esc(tag.name) + '</span>' +
      '</label>';
    });
    if (this.tags.length === 0) {
      html += '<p class="chat-tag-popover-empty">No tags yet. Use "Manage Tags" to create some.</p>';
    }
    html += '</div>';
    html += '<div class="chat-tag-popover-actions">' +
      '<button type="button" class="btn btn-sm btn-primary chat-tag-popover-save">Save</button>' +
      '<button type="button" class="btn btn-sm btn-secondary chat-tag-popover-cancel">Cancel</button>' +
    '</div>';

    popover.innerHTML = html;

    const bubble = anchorEl.closest('.chat-bubble');
    if (bubble) {
      bubble.style.position = 'relative';
      bubble.appendChild(popover);
    } else {
      document.body.appendChild(popover);
    }

    popover.querySelector('.chat-tag-popover-save').addEventListener('click', async () => {
      const selected = Array.from(popover.querySelectorAll('input[type=checkbox]:checked'))
        .map(cb => parseInt(cb.value));

      try {
        await ServerAPI.updateMessageTags(msgId, selected);
        msg.tags = selected.map(tid => this.tags.find(t => t.id === tid)).filter(Boolean);
        this.renderMessages(this.messages);
      } catch (err) {
        console.error('Failed to update tags:', err);
      }

      popover.remove();
    });

    popover.querySelector('.chat-tag-popover-cancel').addEventListener('click', () => {
      popover.remove();
    });

    setTimeout(() => {
      const closeHandler = (e) => {
        if (!popover.contains(e.target)) {
          popover.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 0);
  },

  // ========================================
  // SEND MESSAGE (or save edit)
  // ========================================
  async sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input?.value.trim();
    if (!message && this._pendingFiles.length === 0) return;

    // If editing, save the edit
    if (this._editingMsgId) {
      if (!message) return;
      try {
        const updated = await ServerAPI.editChatMessage(this._editingMsgId, message);
        if (!this.isConnected && updated) {
          const idx = this.messages.findIndex(m => m.id === this._editingMsgId);
          if (idx !== -1) {
            this.messages[idx] = { ...this.messages[idx], ...updated };
            this.renderMessages(this.messages);
          }
        }
      } catch (err) {
        console.error('Failed to edit message:', err);
        alert('Failed to save edit.');
        return;
      }
      this._cancelEdit();
      return;
    }

    // New message
    input.value = '';
    input.focus();

    try {
      const newMsg = await ServerAPI.sendChatMessage(message || '', this.selectedTagIds);
      this.selectedTagIds = [];
      this.renderTagPicker();

      // Upload any pending files
      if (newMsg && newMsg.id && this._pendingFiles.length > 0) {
        await this._uploadAttachments(newMsg.id);
      }

      if (!this.isConnected && newMsg && newMsg.id) {
        this.messages.push(newMsg);
        this.renderMessages(this.messages);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      if (input) input.value = message;
    }
  },

  // ========================================
  // HELPERS
  // ========================================
  scrollToBottom() {
    const container = document.getElementById('chatMessages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
};

window.sendMessage = () => Chat.sendMessage();
window.Chat = Chat;
