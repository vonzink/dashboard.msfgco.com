/* ==========================================
   HR Resources Module
   Dynamic HR resource cards with links + notes
   (mirrors Programs module pattern)
========================================== */
const HRResources = {
  _modal: null,
  _category: null,
  _editingLinkId: null,
  _data: {},

  init() {
    this._modal = document.getElementById('hrResourcesModal');
    if (!this._modal) return;

    // Close button
    const closeBtn = this._modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    this._modal.addEventListener('click', (e) => {
      if (e.target === this._modal) this.hide();
    });

    // Add Link button
    const addLinkBtn = this._modal.querySelector('.hr-add-link-btn');
    if (addLinkBtn) addLinkBtn.addEventListener('click', () => this._showLinkForm());

    // Link form cancel/save
    document.getElementById('hrLinkCancel')?.addEventListener('click', () => this._hideLinkForm());
    document.getElementById('hrLinkSave')?.addEventListener('click', () => this._saveLinkForm());

    // Note submit
    document.getElementById('hrNoteSubmit')?.addEventListener('click', () => this._submitNote());

    // Enter key on note textarea
    const noteInput = document.getElementById('hrNoteInput');
    if (noteInput) {
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._submitNote();
        }
      });
    }
  },

  // =========================================================
  // Open / Close
  // =========================================================
  async open(category) {
    if (!this._modal) return;
    this._category = category;
    this._editingLinkId = null;
    this._hideLinkForm();

    const LABELS = {
      famli: 'FAMLI',
      general: 'General',
    };

    document.getElementById('hrModalTitle').textContent = LABELS[category] || category;

    // Show/hide admin controls
    const canManageLinks = this._canManageLinks();
    const addLinkBtn = this._modal.querySelector('.hr-add-link-btn');
    if (addLinkBtn) addLinkBtn.style.display = canManageLinks ? '' : 'none';

    // Show modal immediately with loading state
    this._modal.classList.add('active');
    document.getElementById('hrLinksContainer').innerHTML = '<p class="text-muted">Loading...</p>';
    document.getElementById('hrNotesContainer').innerHTML = '<p class="text-muted">Loading...</p>';

    // Fetch data
    try {
      const data = await ServerAPI.getHRCategory(category);
      this._data[category] = data;
      this._renderLinks(data.links || []);
      this._renderNotes(data.notes || []);
    } catch (err) {
      console.error('Failed to load HR resource data:', err);
      document.getElementById('hrLinksContainer').innerHTML = '<p class="text-muted">Failed to load data.</p>';
      document.getElementById('hrNotesContainer').innerHTML = '';
    }
  },

  hide() {
    if (this._modal) this._modal.classList.remove('active');
    this._category = null;
  },

  // =========================================================
  // Permissions
  // =========================================================
  _canManageLinks() {
    const role = (CONFIG.currentUser?.activeRole || CONFIG.currentUser?.role || '').toLowerCase();
    return role === 'admin' || role === 'manager';
  },

  _canDeleteNote(note) {
    const role = (CONFIG.currentUser?.activeRole || CONFIG.currentUser?.role || '').toLowerCase();
    if (role === 'admin') return true;
    return note.created_by === CONFIG.currentUser?.id;
  },

  _canEditNote(note) {
    const role = (CONFIG.currentUser?.activeRole || CONFIG.currentUser?.role || '').toLowerCase();
    if (role === 'admin') return true;
    return note.created_by === CONFIG.currentUser?.id;
  },

  // =========================================================
  // Render Links
  // =========================================================
  _renderLinks(links) {
    const container = document.getElementById('hrLinksContainer');
    if (!links.length) {
      container.innerHTML = '<p class="text-muted">No links yet.</p>';
      return;
    }

    const canManage = this._canManageLinks();
    container.innerHTML = links.map(link => `
      <div class="program-link-card" data-link-id="${link.id}">
        <a href="${this._escHtml(link.url)}" target="_blank" rel="noopener" class="program-link-title">
          <i class="fas fa-external-link-alt"></i> ${this._escHtml(link.label)}
        </a>
        ${link.description ? `<p class="program-link-desc">${this._escHtml(link.description)}</p>` : ''}
        ${canManage ? `
          <div class="program-link-actions">
            <button type="button" class="btn-icon" title="Edit" onclick="HRResources._editLink(${link.id})"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn-icon btn-icon-danger" title="Delete" onclick="HRResources._deleteLink(${link.id})"><i class="fas fa-trash"></i></button>
          </div>
        ` : ''}
      </div>
    `).join('');
  },

  // =========================================================
  // Link Form
  // =========================================================
  _showLinkForm(link) {
    this._editingLinkId = link?.id || null;
    document.getElementById('hrLinkFormTitle').textContent = link ? 'Edit Link' : 'Add Link';
    document.getElementById('hrLinkLabel').value = link?.label || '';
    document.getElementById('hrLinkUrl').value = link?.url || '';
    document.getElementById('hrLinkDesc').value = link?.description || '';
    document.getElementById('hrLinkForm').style.display = '';
  },

  _hideLinkForm() {
    const form = document.getElementById('hrLinkForm');
    if (form) form.style.display = 'none';
    this._editingLinkId = null;
  },

  async _saveLinkForm() {
    const label = document.getElementById('hrLinkLabel').value.trim();
    const url = document.getElementById('hrLinkUrl').value.trim();
    const description = document.getElementById('hrLinkDesc').value.trim();

    if (!label || !url) {
      Utils.showToast('Label and URL are required', 'error');
      return;
    }

    try {
      if (this._editingLinkId) {
        await ServerAPI.updateHRLink(this._editingLinkId, { label, url, description });
        Utils.showToast('Link updated');
      } else {
        await ServerAPI.createHRLink({ category: this._category, label, url, description });
        Utils.showToast('Link added');
      }
      this._hideLinkForm();
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to save link', 'error');
    }
  },

  _editLink(id) {
    const data = this._data[this._category];
    const link = (data?.links || []).find(l => l.id === id);
    if (link) this._showLinkForm(link);
  },

  async _deleteLink(id) {
    if (!confirm('Delete this link?')) return;
    try {
      await ServerAPI.deleteHRLink(id);
      Utils.showToast('Link deleted');
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to delete link', 'error');
    }
  },

  // =========================================================
  // Render Notes
  // =========================================================
  _renderNotes(notes) {
    const container = document.getElementById('hrNotesContainer');
    if (!notes.length) {
      container.innerHTML = '<p class="text-muted">No notes yet.</p>';
      return;
    }

    container.innerHTML = notes.map(note => {
      const canEdit = this._canEditNote(note);
      const canDelete = this._canDeleteNote(note);
      const date = new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const time = new Date(note.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      return `
        <div class="program-note" data-note-id="${note.id}">
          <div class="program-note-header">
            <span class="program-note-author">${this._escHtml(note.user_name || 'Unknown')}</span>
            <span class="program-note-date">${date} at ${time}</span>
          </div>
          <div class="program-note-content" id="hrNoteContent-${note.id}">${this._escHtml(note.content)}</div>
          ${canEdit || canDelete ? `
            <div class="program-note-actions">
              ${canEdit ? `<button type="button" class="btn-icon" title="Edit" onclick="HRResources._editNote(${note.id})"><i class="fas fa-pen"></i></button>` : ''}
              ${canDelete ? `<button type="button" class="btn-icon btn-icon-danger" title="Delete" onclick="HRResources._deleteNote(${note.id})"><i class="fas fa-trash"></i></button>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  // =========================================================
  // Note Actions
  // =========================================================
  async _submitNote() {
    const input = document.getElementById('hrNoteInput');
    const content = input.value.trim();
    if (!content) return;

    try {
      await ServerAPI.createHRNote({ category: this._category, content });
      input.value = '';
      Utils.showToast('Note added');
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to add note', 'error');
    }
  },

  async _editNote(id) {
    const data = this._data[this._category];
    const note = (data?.notes || []).find(n => n.id === id);
    if (!note) return;

    const contentEl = document.getElementById(`hrNoteContent-${id}`);
    if (!contentEl) return;

    const current = note.content;
    contentEl.innerHTML = `
      <textarea class="form-control program-note-edit" rows="3">${this._escHtml(current)}</textarea>
      <div class="program-note-edit-actions">
        <button type="button" class="btn btn-sm btn-secondary" onclick="HRResources._cancelEditNote(${id})">Cancel</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="HRResources._saveEditNote(${id})">Save</button>
      </div>
    `;
  },

  _cancelEditNote(id) {
    const data = this._data[this._category];
    const note = (data?.notes || []).find(n => n.id === id);
    if (!note) return;
    const contentEl = document.getElementById(`hrNoteContent-${id}`);
    if (contentEl) contentEl.textContent = note.content;
  },

  async _saveEditNote(id) {
    const contentEl = document.getElementById(`hrNoteContent-${id}`);
    const textarea = contentEl?.querySelector('textarea');
    if (!textarea) return;

    const content = textarea.value.trim();
    if (!content) {
      Utils.showToast('Note content is required', 'error');
      return;
    }

    try {
      await ServerAPI.updateHRNote(id, { content });
      Utils.showToast('Note updated');
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to update note', 'error');
    }
  },

  async _deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    try {
      await ServerAPI.deleteHRNote(id);
      Utils.showToast('Note deleted');
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to delete note', 'error');
    }
  },

  // =========================================================
  // Helpers
  // =========================================================
  async _reload() {
    if (!this._category) return;
    try {
      const data = await ServerAPI.getHRCategory(this._category);
      this._data[this._category] = data;
      this._renderLinks(data.links || []);
      this._renderNotes(data.notes || []);
    } catch (err) {
      console.error('Failed to reload HR resources:', err);
    }
  },

  _escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

window.HRResources = HRResources;
