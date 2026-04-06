/* ==========================================
   Programs Module
   Dynamic program cards with links + notes
========================================== */
const Programs = {
  _modal: null,
  _category: null,
  _editingLinkId: null,
  _data: {},

  init() {
    this._modal = document.getElementById('programsModal');
    if (!this._modal) return;

    // Close button
    const closeBtn = this._modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    this._modal.addEventListener('click', (e) => {
      if (e.target === this._modal) this.hide();
    });

    // Add Link button
    const addLinkBtn = this._modal.querySelector('.programs-add-link-btn');
    if (addLinkBtn) addLinkBtn.addEventListener('click', () => this._showLinkForm());

    // Link form cancel/save
    document.getElementById('programsLinkCancel')?.addEventListener('click', () => this._hideLinkForm());
    document.getElementById('programsLinkSave')?.addEventListener('click', () => this._saveLinkForm());
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
      conventional: 'Conventional',
      fha: 'FHA',
      va: 'VA',
      usda: 'USDA',
      'non-qm': 'Non-QM',
      other: 'Other',
    };

    document.getElementById('programsModalTitle').textContent = LABELS[category] || category;

    // Show/hide admin controls
    const canManageLinks = this._canManageLinks();
    const addLinkBtn = this._modal.querySelector('.programs-add-link-btn');
    if (addLinkBtn) addLinkBtn.style.display = canManageLinks ? '' : 'none';

    // Show modal immediately with loading state
    this._modal.classList.add('active');
    document.getElementById('programsLinksContainer').innerHTML = '<p class="text-muted">Loading...</p>';

    // Fetch data
    try {
      const data = await ServerAPI.getProgramCategory(category);
      this._data[category] = data;
      this._renderLinks(data.links || []);
    } catch (err) {
      console.error('Failed to load program data:', err);
      document.getElementById('programsLinksContainer').innerHTML = '<p class="text-muted">Failed to load data.</p>';
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
    const container = document.getElementById('programsLinksContainer');
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
        ${link.notes ? `<div class="program-link-notes"><i class="fas fa-sticky-note"></i> ${this._escHtml(link.notes)}</div>` : ''}
        ${canManage ? `
          <div class="program-link-actions">
            <button type="button" class="btn-icon" title="Edit" onclick="Programs._editLink(${link.id})"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn-icon btn-icon-danger" title="Delete" onclick="Programs._deleteLink(${link.id})"><i class="fas fa-trash"></i></button>
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
    document.getElementById('programsLinkFormTitle').textContent = link ? 'Edit Link' : 'Add Link';
    document.getElementById('programsLinkLabel').value = link?.label || '';
    document.getElementById('programsLinkUrl').value = link?.url || '';
    document.getElementById('programsLinkDesc').value = link?.description || '';
    document.getElementById('programsLinkNotes').value = link?.notes || '';
    document.getElementById('programsLinkForm').style.display = '';
  },

  _hideLinkForm() {
    document.getElementById('programsLinkForm').style.display = 'none';
    this._editingLinkId = null;
  },

  async _saveLinkForm() {
    const label = document.getElementById('programsLinkLabel').value.trim();
    const url = document.getElementById('programsLinkUrl').value.trim();
    const description = document.getElementById('programsLinkDesc').value.trim();
    const notes = document.getElementById('programsLinkNotes').value.trim();

    if (!label || !url) {
      Utils.showToast('Label and URL are required', 'error');
      return;
    }

    try {
      if (this._editingLinkId) {
        await ServerAPI.updateProgramLink(this._editingLinkId, { label, url, description, notes });
        Utils.showToast('Link updated');
      } else {
        await ServerAPI.createProgramLink({ category: this._category, label, url, description, notes });
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
      await ServerAPI.deleteProgramLink(id);
      Utils.showToast('Link deleted');
      await this._reload();
    } catch (err) {
      Utils.showToast('Failed to delete link', 'error');
    }
  },

  // =========================================================
  // Helpers
  // =========================================================
  async _reload() {
    if (!this._category) return;
    try {
      const data = await ServerAPI.getProgramCategory(this._category);
      this._data[this._category] = data;
      this._renderLinks(data.links || []);
    } catch (err) {
      console.error('Failed to reload programs:', err);
    }
  },

  _escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

window.Programs = Programs;
