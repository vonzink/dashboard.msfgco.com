/* ============================================
   MSFG Dashboard - Chat Module
   Company chat with tag-based filtering
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

  tags: [],                // All available tags [{id, name, color}]
  activeFilterTagId: null, // Currently filtering by this tag (null = show all)
  selectedTagIds: [],      // Tags selected for the NEXT message being composed
  messages: [],            // Local message cache
  _refreshTimer: null,

  // ========================================
  // INITIALIZATION
  // ========================================
  init() {
    if (!CONFIG.features.chat) {
      console.log('Chat feature disabled');
      return;
    }

    this.bindEvents();
    this.loadTags().then(() => this.loadMessages());

    // Auto-refresh messages every 15 seconds
    this._refreshTimer = setInterval(() => this.loadMessages(), CONFIG.refresh?.chat || 15000);

    console.log('Chat initialized');
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

    // Allow Enter key in the tag name input
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
  // MANAGE TAGS MODAL
  // ========================================
  openManageTagsModal() {
    const modal = document.getElementById('manageTagsModal');
    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      this.renderManageTagsList();
      // Focus the input
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

    // Bind delete buttons
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
        // Clear input
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

    // Bind filter clicks
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

    // Bind toggle
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
      const tagsHtml = (msg.tags && msg.tags.length > 0)
        ? '<div class="chat-msg-tags">' +
          msg.tags.map(t =>
            '<span class="chat-msg-tag" style="--tag-color: ' + esc(t.color || '#8cc63e') + ';">' + esc(t.name) + '</span>'
          ).join('') +
          '</div>'
        : '';

      return '<div class="chat-message' + (isOwn ? ' own' : '') + '" data-msg-id="' + msg.id + '">' +
        '<div class="chat-avatar">' + esc(msg.sender_initials || '??') + '</div>' +
        '<div class="chat-bubble">' +
          '<div class="chat-sender">' + (isOwn ? 'You' : esc(msg.sender_name)) + '</div>' +
          '<div class="chat-text">' + esc(msg.message) + '</div>' +
          tagsHtml +
          '<div class="chat-meta">' +
            '<span class="chat-time">' + this.formatTime(msg.created_at) + '</span>' +
            '<button type="button" class="chat-tag-edit-btn" title="Edit tags"><i class="fas fa-tag"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind tag edit buttons
    container.querySelectorAll('.chat-tag-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgEl = btn.closest('[data-msg-id]');
        if (msgEl) this.showTagEditor(parseInt(msgEl.dataset.msgId), btn);
      });
    });

    this.scrollToBottom();
  },

  showTagEditor(msgId, anchorEl) {
    // Remove existing popover
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

    // Position near the anchor
    const bubble = anchorEl.closest('.chat-bubble');
    if (bubble) {
      bubble.style.position = 'relative';
      bubble.appendChild(popover);
    } else {
      document.body.appendChild(popover);
    }

    // Save handler
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

    // Cancel handler
    popover.querySelector('.chat-tag-popover-cancel').addEventListener('click', () => {
      popover.remove();
    });

    // Close on outside click
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
  // SEND MESSAGE
  // ========================================
  async sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input?.value.trim();
    if (!message) return;

    input.value = '';
    input.focus();

    try {
      const newMsg = await ServerAPI.sendChatMessage(message, this.selectedTagIds);
      // Clear selected tags after send
      this.selectedTagIds = [];
      this.renderTagPicker();

      // Add to local cache and re-render
      if (newMsg && newMsg.id) {
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
