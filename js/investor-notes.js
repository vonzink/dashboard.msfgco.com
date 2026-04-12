/* ============================================
   MSFG Dashboard - Investor Notes & Tags
   Notes CRUD, tag management, Manage Tags modal
============================================ */

const InvestorNotes = {
  // ========================================
  // TAG STATE
  // ========================================
  _selectedNoteTagIds: [],
  _activeTagPillsId: 'investorNoteTagPills',
  _selectedTagColor: '#4a90d9',

  /** Color ordering for tag categories */
  _tagColorOrder: ['#4a90d9', '#9b59b6', '#e67e22', '#27ae60', '#e74c3c', '#3498db', '#f39c12', '#1abc9c'],
  _tagColorLabels: {
    '#4a90d9': 'Agency', '#9b59b6': 'Non-Agency', '#e67e22': 'Specialty', '#27ae60': 'Services',
    '#e74c3c': 'Processing', '#3498db': 'News', '#f39c12': 'Pricing', '#1abc9c': 'Info'
  },

  init() {
    this.bindManageTagsModal();
  },

  // ========================================
  // TAG DATA LOADING
  // ========================================
  async loadTags() {
    try {
      Investors._investorTags = await ServerAPI.getInvestorTags();
      if (!Array.isArray(Investors._investorTags)) Investors._investorTags = [];
    } catch (err) {
      console.warn('Failed to load investor tags:', err);
      Investors._investorTags = [];
    }
  },

  async loadNoteTags() {
    try {
      const map = await ServerAPI.getInvestorNoteTags();
      Investors._investorNoteTagsMap = (map && typeof map === 'object') ? map : {};
      if (Investors._loaded) Investors._refreshDropdown();
    } catch (err) {
      console.warn('Failed to load investor note tags map:', err);
      Investors._investorNoteTagsMap = {};
    }
  },

  // ========================================
  // TAG HELPERS
  // ========================================
  _sortTagsByCategory(tags) {
    const order = this._tagColorOrder;
    return [...tags].sort((a, b) => {
      const ai = order.indexOf(a.color);
      const bi = order.indexOf(b.color);
      const ao = ai === -1 ? 999 : ai;
      const bo = bi === -1 ? 999 : bi;
      if (ao !== bo) return ao - bo;
      return (a.name || '').localeCompare(b.name || '');
    });
  },

  _getDefaultTags() {
    return Investors._investorTags.filter(t => !t.created_by);
  },

  // ========================================
  // MANAGE TAGS MODAL
  // ========================================
  bindManageTagsModal() {
    const closeBtn = document.getElementById('closeInvestorManageTagsModal');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeManageTagsModal());
    const modal = document.getElementById('investorManageTagsModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this.closeManageTagsModal(); });
    const createBtn = document.getElementById('investorCreateTagBtn');
    if (createBtn) createBtn.addEventListener('click', () => this.createTag());
    const nameInput = document.getElementById('investorNewTagNameInput');
    if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.createTag(); });
  },

  openManageTagsModal(pillsContainerId) {
    if (pillsContainerId) this._activeTagPillsId = pillsContainerId;
    const modal = document.getElementById('investorManageTagsModal');
    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      this.renderManageTagsList();
      const inp = document.getElementById('investorNewTagNameInput');
      if (inp) setTimeout(() => inp.focus(), 100);
    }
  },

  closeManageTagsModal() {
    const modal = document.getElementById('investorManageTagsModal');
    if (modal) { modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); }
    this.renderTagPills(this._activeTagPillsId);
  },

  renderManageTagsList() {
    const container = document.getElementById('investorManageTagsList');
    if (!container) return;
    const esc = Utils.escapeHtml;
    const defaultTags = this._sortTagsByCategory(this._getDefaultTags());
    const defaultIds = new Set(defaultTags.map(t => t.id));
    const customTags = Investors._investorTags.filter(t => !defaultIds.has(t.id));

    if (defaultTags.length === 0 && customTags.length === 0) {
      container.innerHTML = '<div class="manage-tags-empty"><i class="fas fa-tags"></i><p>No tags available.</p></div>';
      return;
    }

    let html = '';
    let lastColor = null;
    defaultTags.forEach(tag => {
      if (tag.color !== lastColor) {
        if (lastColor !== null) html += '</div></div>';
        const label = this._tagColorLabels[tag.color] || '';
        html += '<div class="manage-tags-group"><span class="manage-tags-group-label" style="color:' + esc(tag.color) + ';">' + esc(label) + '</span><div class="manage-tags-group-pills">';
        lastColor = tag.color;
      }
      const isSelected = this._selectedNoteTagIds.includes(tag.id);
      html += '<button type="button" class="chat-tag-pill' + (isSelected ? ' selected' : '') +
        '" data-modal-tag="' + tag.id + '" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' +
        esc(tag.name) + '</button>';
    });
    if (lastColor !== null) html += '</div></div>';

    if (customTags.length > 0) {
      html += '<div class="manage-tags-group"><span class="manage-tags-group-label" style="color:#FFD700;">Custom</span><div class="manage-tags-group-pills">';
      customTags.forEach(tag => {
        const isSelected = this._selectedNoteTagIds.includes(tag.id);
        const inUse = tag.usage_count > 0;
        html += '<span class="custom-tag-wrap">' +
          '<button type="button" class="chat-tag-pill' + (isSelected ? ' selected' : '') +
          '" data-modal-tag="' + tag.id + '" style="--tag-color: #FFD700;">' +
          esc(tag.name) + '</button>' +
          (inUse ? '' : '<button type="button" class="custom-tag-remove" data-remove-tag="' + tag.id + '" title="Delete tag"><i class="fas fa-times"></i></button>') +
          '</span>';
      });
      html += '</div></div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('[data-modal-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = parseInt(btn.dataset.modalTag);
        if (this._selectedNoteTagIds.includes(tid)) {
          this._selectedNoteTagIds = this._selectedNoteTagIds.filter(x => x !== tid);
          btn.classList.remove('selected');
        } else {
          this._selectedNoteTagIds.push(tid);
          btn.classList.add('selected');
        }
      });
    });

    container.querySelectorAll('[data-remove-tag]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tid = parseInt(btn.dataset.removeTag);
        const tag = Investors._investorTags.find(t => t.id === tid);
        if (!confirm('Delete custom tag "' + (tag?.name || '') + '"?')) return;
        try {
          await ServerAPI.deleteInvestorTag(tid);
          Investors._investorTags = Investors._investorTags.filter(t => t.id !== tid);
          this._selectedNoteTagIds = this._selectedNoteTagIds.filter(x => x !== tid);
          this.renderManageTagsList();
        } catch (err) {
          alert(err?.message || 'Failed to delete tag.');
        }
      });
    });
  },

  async createTag() {
    const nameInput = document.getElementById('investorNewTagNameInput');
    const name = nameInput?.value.trim();
    if (!name) { nameInput?.focus(); return; }
    const color = '#FFD700';

    try {
      const tag = await ServerAPI.createInvestorTag(name, color);
      if (tag && tag.id && !Investors._investorTags.find(t => t.id === tag.id)) {
        Investors._investorTags.push(tag);
      }
      if (tag && tag.id && !this._selectedNoteTagIds.includes(tag.id)) {
        this._selectedNoteTagIds.push(tag.id);
      }
      this.renderManageTagsList();
      if (nameInput) nameInput.value = '';
    } catch (err) { alert('Failed to create tag. It may already exist.'); }
  },

  /** Render read-only summary of selected tag pills */
  renderTagPills(containerId, selectedIds) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (selectedIds) this._selectedNoteTagIds = [...selectedIds];

    const esc = Utils.escapeHtml;
    const selectedTags = Investors._investorTags.filter(t => this._selectedNoteTagIds.includes(t.id));

    if (selectedTags.length === 0) {
      container.innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted);">None \u2014 click Manage Tags to select</span>';
      return;
    }

    const sorted = this._sortTagsByCategory(selectedTags);
    let html = '';
    sorted.forEach(tag => {
      const color = tag.created_by ? '#FFD700' : (tag.color || '#8cc63e');
      html += '<span class="chat-msg-tag" style="--tag-color: ' + esc(color) + ';">' + esc(tag.name) + '</span>';
    });
    container.innerHTML = html;
  },

  // ========================================
  // NOTES — bind from populateModal
  // ========================================
  bindNoteControls(investorId) {
    this._selectedNoteTagIds = [];
    this.renderTagPills('investorNoteTagPills');
    document.getElementById('investorAddNoteBtn')?.addEventListener('click', () => this._addNote(investorId));
    document.getElementById('investorNewNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._addNote(investorId);
    });
    document.getElementById('investorManageTagsBtn')?.addEventListener('click', () => this.openManageTagsModal('investorNoteTagPills'));
    this.loadNotes(investorId);
  },

  async loadNotes(investorId) {
    const container = document.getElementById('investorNotesContainer');
    if (!container) return;

    try {
      const notes = await ServerAPI.getInvestorNotes(investorId);
      if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="pa-notes-empty">No notes yet.</div>';
        return;
      }

      const esc = Utils.escapeHtml;
      const currentUserId = CONFIG.currentUser?.id;
      const isAdminUser = ['admin', 'manager'].includes((CONFIG.currentUser?.activeRole || '').toLowerCase());

      container.innerHTML = notes.map(note => {
        const canEdit = isAdminUser || note.author_id === currentUserId;
        const ts = new Date(note.created_at);
        const edited = note.updated_at && note.updated_at !== note.created_at;
        const timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        const initials = note.author_initials || (note.author_name || '').split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('');

        const tagsHtml = (note.tags && note.tags.length > 0)
          ? '<div class="pa-note-tags">' + note.tags.map(tag =>
              '<span class="chat-msg-tag" style="--tag-color: ' + esc(tag.color || '#8cc63e') + ';">' + esc(tag.name) + '</span>'
            ).join('') + '</div>'
          : '';

        const tagIdStr = (note.tags || []).map(t => t.id).join(',');

        return `<div class="pa-note" data-note-id="${note.id}" data-parent-id="${investorId}" data-tag-ids="${tagIdStr}">
          <div class="pa-note-header">
            <span class="pa-note-author"><i class="fas fa-user-circle"></i> ${esc(note.author_name || 'Unknown')}</span>
            <span class="pa-note-time">${esc(initials)} — ${esc(timeStr)}${edited ? ' (edited)' : ''}</span>
            ${canEdit ? `<div class="pa-note-actions">
              <button type="button" class="pa-note-edit-btn" title="Edit"><i class="fas fa-pencil-alt"></i></button>
              <button type="button" class="pa-note-delete-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>
            </div>` : ''}
          </div>
          <div class="pa-note-content">${esc(note.content)}</div>
          ${tagsHtml}
        </div>`;
      }).join('');

      container.querySelectorAll('.pa-note-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const noteEl = btn.closest('.pa-note');
          const tagIds = (noteEl.dataset.tagIds || '').split(',').filter(Boolean).map(Number);
          this._editNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId), tagIds);
        });
      });
      container.querySelectorAll('.pa-note-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const noteEl = btn.closest('.pa-note');
          this._deleteNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId));
        });
      });
    } catch (err) {
      console.error('Failed to load investor notes:', err);
      container.innerHTML = '<div class="pa-notes-empty" style="color:#e74c3c;">Failed to load notes.</div>';
    }
  },

  async _addNote(investorId) {
    const input = document.getElementById('investorNewNoteInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    try {
      const tagIds = [...this._selectedNoteTagIds];
      await ServerAPI.addInvestorNote(investorId, content, tagIds);
      input.value = '';
      this._selectedNoteTagIds = [];
      if (tagIds.length > 0) this.loadNoteTags();
      this.renderTagPills('investorNoteTagPills');
      this.loadNotes(investorId);
    } catch (err) {
      alert('Failed to add note: ' + (err.message || 'Unknown error'));
    }
  },

  async _editNote(investorId, noteId, currentTagIds) {
    const noteEl = document.querySelector(`.pa-note[data-note-id="${noteId}"][data-parent-id="${investorId}"]`);
    if (!noteEl) return;
    const contentEl = noteEl.querySelector('.pa-note-content');
    const tagsEl = noteEl.querySelector('.pa-note-tags');
    const currentContent = contentEl.textContent;

    const editPickerId = 'editTagPills_' + noteId;

    contentEl.innerHTML = `<textarea class="form-input pa-note-edit-input" rows="2">${Utils.escapeHtml(currentContent)}</textarea>
      <div class="inv-note-tag-bar">
        <span class="inv-note-tag-label"><i class="fas fa-tags"></i> Tags:</span>
        <div class="inv-note-tag-pills" id="${editPickerId}"></div>
        <button type="button" class="btn btn-sm btn-outline edit-manage-tags-btn" style="font-size:0.65rem;padding:0.1rem 0.4rem;margin-left:0.5rem;"><i class="fas fa-tags"></i> Manage Tags</button>
      </div>
      <div class="pa-note-edit-actions">
        <button type="button" class="btn btn-primary btn-sm pa-note-save-btn"><i class="fas fa-check"></i> Save</button>
        <button type="button" class="btn btn-secondary btn-sm pa-note-cancel-btn">Cancel</button>
      </div>`;

    if (tagsEl) tagsEl.style.display = 'none';

    const textarea = contentEl.querySelector('textarea');
    textarea.focus();

    const savedNewNoteTags = [...this._selectedNoteTagIds];
    this._selectedNoteTagIds = [...currentTagIds];
    this._activeTagPillsId = editPickerId;
    this.renderTagPills(editPickerId);

    contentEl.querySelector('.edit-manage-tags-btn')?.addEventListener('click', () => this.openManageTagsModal(editPickerId));

    contentEl.querySelector('.pa-note-save-btn').addEventListener('click', async () => {
      const newContent = textarea.value.trim();
      if (!newContent) return;
      try {
        await ServerAPI.updateInvestorNote(investorId, noteId, newContent, [...this._selectedNoteTagIds]);
        this._selectedNoteTagIds = savedNewNoteTags;
        this._activeTagPillsId = 'investorNoteTagPills';
        this.loadNoteTags();
        this.loadNotes(investorId);
      } catch (err) {
        alert('Failed to update note: ' + (err.message || 'Unknown error'));
      }
    });

    contentEl.querySelector('.pa-note-cancel-btn').addEventListener('click', () => {
      this._selectedNoteTagIds = savedNewNoteTags;
      this._activeTagPillsId = 'investorNoteTagPills';
      this.loadNotes(investorId);
    });
  },

  async _deleteNote(investorId, noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await ServerAPI.deleteInvestorNote(investorId, noteId);
      this.loadNotes(investorId);
    } catch (err) {
      alert('Failed to delete note: ' + (err.message || 'Unknown error'));
    }
  },
};

window.InvestorNotes = InvestorNotes;
