/* ============================================
   MSFG Dashboard - User Settings Modal
   Self-serve profile editing, column display preferences,
   document viewing, and goals management.
   ============================================ */

const UserSettings = {
  _profile: null,
  _documents: [],
  _displayPrefs: {},
  _activeTab: 'profile',
  _avatarFile: null,

  // ========================================
  // OPEN / CLOSE
  // ========================================
  async open() {
    const modal = document.getElementById('userSettingsModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
    document.body.classList.add('modal-open');

    this._switchTab('profile');
    await this._loadProfile();
  },

  close() {
    const modal = document.getElementById('userSettingsModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
  },

  // ========================================
  // TABS
  // ========================================
  _switchTab(tabId) {
    this._activeTab = tabId;

    // Update tab buttons
    document.querySelectorAll('#userSettingsModal .settings-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab panels
    document.querySelectorAll('#userSettingsModal .settings-panel').forEach(panel => {
      panel.classList.toggle('u-hidden', panel.id !== `settingsPanel-${tabId}`);
    });

    // Load data for the tab
    if (tabId === 'profile' && !this._profile) this._loadProfile();
    if (tabId === 'display') this._loadDisplayPreferences();
    if (tabId === 'documents') this._loadDocuments();
    if (tabId === 'goals') SettingsGoals.loadGoalsTab();
  },

  // ========================================
  // PROFILE TAB
  // ========================================
  async _loadProfile() {
    const container = document.getElementById('settingsProfileContent');
    if (!container) return;

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading profile...</div>';

    try {
      this._profile = await ServerAPI.get('/me/profile');
      this._renderProfile();
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load profile.</div>';
    }
  },

  _renderProfile() {
    const container = document.getElementById('settingsProfileContent');
    if (!container || !this._profile) return;

    const p = this._profile;
    const esc = Utils.escapeHtml;

    container.innerHTML = `
      <div class="settings-profile-layout">
        <!-- Avatar -->
        <div class="settings-avatar-section">
          <div class="settings-avatar" id="settingsAvatarPreview">
            ${p.avatar_url
              ? `<img src="${esc(p.avatar_url)}" alt="Avatar" />`
              : `<span class="avatar-initials">${esc(CONFIG.currentUser?.initials || '?')}</span>`
            }
          </div>
          <div class="settings-avatar-actions">
            <label class="btn btn-sm btn-secondary" for="settingsAvatarInput">
              <i class="fas fa-camera"></i> Change Photo
            </label>
            <input type="file" id="settingsAvatarInput" accept="image/*" style="display:none;" />
            ${p.avatar_url ? '<button type="button" class="btn btn-sm btn-danger" id="settingsAvatarRemove"><i class="fas fa-trash"></i></button>' : ''}
          </div>
          <div class="settings-user-info">
            <strong>${esc(p.user?.name || CONFIG.currentUser?.name || '')}</strong>
            <span>${esc(p.user?.email || CONFIG.currentUser?.email || '')}</span>
            <span class="badge">${esc(p.user?.role || CONFIG.currentUser?.role || '')}</span>
          </div>
        </div>

        <!-- Business Card & QR Codes -->
        <div class="settings-media-row">
          <div class="settings-media-card">
            <label class="settings-media-label">Business Card</label>
            <div class="settings-media-preview" id="settingsBusinessCard" title="Click to upload">
              ${p.business_card_url
                ? `<img src="${esc(p.business_card_url)}" alt="Business Card" />`
                : `<div class="settings-media-placeholder"><i class="fas fa-id-card"></i><span>No business card</span></div>`
              }
            </div>
            <div class="settings-media-actions">
              <label class="btn btn-sm btn-secondary" for="settingsBusinessCardInput"><i class="fas fa-upload"></i> Upload</label>
              <input type="file" id="settingsBusinessCardInput" accept="image/*" style="display:none;" />
              ${p.business_card_url ? '<button type="button" class="btn btn-sm btn-danger" id="settingsBusinessCardRemove"><i class="fas fa-trash"></i></button>' : ''}
            </div>
          </div>
          <div class="settings-media-card">
            <label class="settings-media-label">QR Code 1</label>
            <div class="settings-media-preview settings-media-qr" id="settingsQr1" title="Click to upload">
              ${p.qr_code_1_url
                ? `<img src="${esc(p.qr_code_1_url)}" alt="QR Code 1" />`
                : `<div class="settings-media-placeholder"><i class="fas fa-qrcode"></i><span>No QR code</span></div>`
              }
            </div>
            <input type="text" name="qr_code_1_label" value="${esc(p.qr_code_1_label || '')}" placeholder="Label (optional)" class="settings-media-label-input" />
            <div class="settings-media-actions">
              <label class="btn btn-sm btn-secondary" for="settingsQr1Input"><i class="fas fa-upload"></i></label>
              <input type="file" id="settingsQr1Input" accept="image/*" style="display:none;" />
              ${p.qr_code_1_url ? '<button type="button" class="btn btn-sm btn-danger" id="settingsQr1Remove"><i class="fas fa-trash"></i></button>' : ''}
            </div>
          </div>
          <div class="settings-media-card">
            <label class="settings-media-label">QR Code 2</label>
            <div class="settings-media-preview settings-media-qr" id="settingsQr2" title="Click to upload">
              ${p.qr_code_2_url
                ? `<img src="${esc(p.qr_code_2_url)}" alt="QR Code 2" />`
                : `<div class="settings-media-placeholder"><i class="fas fa-qrcode"></i><span>No QR code</span></div>`
              }
            </div>
            <input type="text" name="qr_code_2_label" value="${esc(p.qr_code_2_label || '')}" placeholder="Label (optional)" class="settings-media-label-input" />
            <div class="settings-media-actions">
              <label class="btn btn-sm btn-secondary" for="settingsQr2Input"><i class="fas fa-upload"></i></label>
              <input type="file" id="settingsQr2Input" accept="image/*" style="display:none;" />
              ${p.qr_code_2_url ? '<button type="button" class="btn btn-sm btn-danger" id="settingsQr2Remove"><i class="fas fa-trash"></i></button>' : ''}
            </div>
          </div>
        </div>

        <!-- Profile Form -->
        <form id="settingsProfileForm" class="settings-form">
          <h4><i class="fas fa-address-card"></i> Contact Info</h4>
          <div class="settings-form-grid">
            <div class="form-field">
              <label>Phone</label>
              <input type="tel" name="phone" value="${esc(p.phone || '')}" placeholder="(555) 123-4567" />
            </div>
            <div class="form-field">
              <label>Display Email</label>
              <input type="email" name="display_email" value="${esc(p.display_email || '')}" placeholder="your.name@company.com" />
            </div>
            <div class="form-field">
              <label>Website</label>
              <input type="url" name="website" value="${esc(p.website || '')}" placeholder="https://..." />
            </div>
            <div class="form-field">
              <label>Online App URL</label>
              <input type="url" name="online_app_url" value="${esc(p.online_app_url || '')}" placeholder="https://..." />
            </div>
            <div class="form-field">
              <label>NMLS #</label>
              <input type="text" name="nmls_number" value="${esc(p.nmls_number || '')}" placeholder="1234567" />
            </div>
          </div>

          <h4><i class="fas fa-share-alt"></i> Social Media</h4>
          <div class="settings-form-grid">
            <div class="form-field">
              <label><i class="fab fa-facebook"></i> Facebook</label>
              <input type="url" name="facebook_url" value="${esc(p.facebook_url || '')}" placeholder="https://facebook.com/..." />
            </div>
            <div class="form-field">
              <label><i class="fab fa-instagram"></i> Instagram</label>
              <input type="url" name="instagram_url" value="${esc(p.instagram_url || '')}" placeholder="https://instagram.com/..." />
            </div>
            <div class="form-field">
              <label><i class="fab fa-linkedin"></i> LinkedIn</label>
              <input type="url" name="linkedin_url" value="${esc(p.linkedin_url || '')}" placeholder="https://linkedin.com/in/..." />
            </div>
            <div class="form-field">
              <label><i class="fab fa-tiktok"></i> TikTok</label>
              <input type="url" name="tiktok_url" value="${esc(p.tiktok_url || '')}" placeholder="https://tiktok.com/@..." />
            </div>
            <div class="form-field">
              <label><i class="fab fa-youtube"></i> YouTube</label>
              <input type="url" name="youtube_url" value="${esc(p.youtube_url || '')}" placeholder="https://youtube.com/..." />
            </div>
            <div class="form-field">
              <label><i class="fab fa-twitter"></i> Twitter / X</label>
              <input type="url" name="twitter_url" value="${esc(p.twitter_url || '')}" placeholder="https://x.com/..." />
            </div>
          </div>

          <h4><i class="fas fa-building"></i> Business Social</h4>
          <div class="settings-form-grid">
            <div class="form-field">
              <label>Facebook Business</label>
              <input type="url" name="facebook_business_url" value="${esc(p.facebook_business_url || '')}" />
            </div>
            <div class="form-field">
              <label>Google My Business</label>
              <input type="url" name="google_my_business_url" value="${esc(p.google_my_business_url || '')}" />
            </div>
            <div class="form-field">
              <label>Nextdoor</label>
              <input type="url" name="nextdoor_url" value="${esc(p.nextdoor_url || '')}" />
            </div>
          </div>

          <h4><i class="fas fa-signature"></i> Email Signature</h4>
          <div class="form-field">
            <textarea name="email_signature" rows="5" placeholder="Paste your HTML email signature here...">${esc(p.email_signature || '')}</textarea>
          </div>

          <div class="settings-form-actions">
            <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Profile</button>
          </div>
        </form>
      </div>
    `;

    // Bind events
    document.getElementById('settingsProfileForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveProfile();
    });

    document.getElementById('settingsAvatarInput')?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._uploadAvatar(e.target.files[0]);
    });

    document.getElementById('settingsAvatarRemove')?.addEventListener('click', () => {
      this._removeAvatar();
    });

    // Business card upload
    document.getElementById('settingsBusinessCardInput')?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._uploadMedia(e.target.files[0], 'business_card');
    });
    document.getElementById('settingsBusinessCardRemove')?.addEventListener('click', () => {
      this._removeMedia('business_card');
    });

    // QR code uploads
    document.getElementById('settingsQr1Input')?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._uploadMedia(e.target.files[0], 'qr_code_1');
    });
    document.getElementById('settingsQr1Remove')?.addEventListener('click', () => {
      this._removeMedia('qr_code_1');
    });
    document.getElementById('settingsQr2Input')?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._uploadMedia(e.target.files[0], 'qr_code_2');
    });
    document.getElementById('settingsQr2Remove')?.addEventListener('click', () => {
      this._removeMedia('qr_code_2');
    });
  },

  async _saveProfile() {
    const form = document.getElementById('settingsProfileForm');
    if (!form) return;

    const data = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    const btn = form.querySelector('button[type="submit"]');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
      await ServerAPI.put('/me/profile', data);
      btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
      setTimeout(() => { btn.innerHTML = origHtml; btn.disabled = false; }, 2000);
    } catch (err) {
      Utils.showToast('Failed to save profile: ' + err.message, 'error');
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  },

  async _uploadAvatar(file) {
    try {
      const { uploadUrl, fileKey } = await ServerAPI.post('/me/profile/avatar/upload-url', {
        fileName: file.name,
        fileType: file.type,
      });

      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      await ServerAPI.put('/me/profile/avatar/confirm', { fileKey });

      Utils.showToast('Avatar updated!', 'success');
      this._profile = null;
      await this._loadProfile();
    } catch (err) {
      Utils.showToast('Failed to upload avatar: ' + err.message, 'error');
    }
  },

  async _removeAvatar() {
    try {
      await ServerAPI.delete('/me/profile/avatar');
      Utils.showToast('Avatar removed', 'success');
      this._profile = null;
      await this._loadProfile();
    } catch (err) {
      Utils.showToast('Failed to remove avatar: ' + err.message, 'error');
    }
  },

  async _uploadMedia(file, purpose) {
    try {
      const { uploadUrl, fileKey } = await ServerAPI.post('/me/profile/media/upload-url', {
        fileName: file.name, fileType: file.type, purpose,
      });
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      await ServerAPI.put('/me/profile/media/confirm', { fileKey, purpose });
      Utils.showToast(`${purpose.replace(/_/g, ' ')} updated!`, 'success');
      this._profile = null;
      await this._loadProfile();
    } catch (err) {
      Utils.showToast('Upload failed: ' + err.message, 'error');
    }
  },

  async _removeMedia(purpose) {
    try {
      await ServerAPI.delete(`/me/profile/media/${purpose}`);
      Utils.showToast(`${purpose.replace(/_/g, ' ')} removed`, 'success');
      this._profile = null;
      await this._loadProfile();
    } catch (err) {
      Utils.showToast('Failed to remove: ' + err.message, 'error');
    }
  },

  // ========================================
  // DISPLAY PREFERENCES TAB
  // ========================================
  _sectionConfigs: {},

  async _loadDisplayPreferences() {
    const container = document.getElementById('settingsDisplayContent');
    if (!container) return;

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading column configuration...</div>';

    try {
      // Fetch view-config for all three sections + saved preferences in parallel
      const [pipelineResult, preAppResult, fundedResult, prefsResult] = await Promise.allSettled([
        ServerAPI.getMondayViewConfig('pipeline'),
        ServerAPI.getMondayViewConfig('pre_approvals'),
        ServerAPI.getMondayViewConfig('funded_loans'),
        ServerAPI.get('/me/profile/display-preferences'),
      ]);

      this._sectionConfigs = {
        pipeline: (pipelineResult.status === 'fulfilled' ? pipelineResult.value?.columns : null) || [],
        pre_approvals: (preAppResult.status === 'fulfilled' ? preAppResult.value?.columns : null) || [],
        funded_loans: (fundedResult.status === 'fulfilled' ? fundedResult.value?.columns : null) || [],
      };
      this._displayPrefs = prefsResult.status === 'fulfilled' ? prefsResult.value : {};

      this._renderDisplayPreferences();
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load column data.</div>';
    }
  },

  _renderDisplayPreferences() {
    const container = document.getElementById('settingsDisplayContent');
    if (!container) return;

    const esc = Utils.escapeHtml;
    const SECTION_ICONS = { pipeline: 'fa-tasks', pre_approvals: 'fa-clipboard-check', funded_loans: 'fa-check-circle' };
    const SECTION_LABELS = { pipeline: 'Active Pipeline', pre_approvals: 'Pre-Approvals', funded_loans: 'Funded Loans' };

    const sectionKeys = ['pipeline', 'pre_approvals', 'funded_loans'].filter(k =>
      this._sectionConfigs[k] && this._sectionConfigs[k].length > 0
    );

    if (sectionKeys.length === 0) {
      container.innerHTML = `
        <div class="settings-empty">
          <i class="fas fa-columns"></i>
          <p>No column configurations available yet.</p>
          <p class="settings-hint">Contact your admin to set up Monday.com board mappings.</p>
        </div>`;
      return;
    }

    container.innerHTML = sectionKeys.map(sectionKey => {
      const globalColumns = this._sectionConfigs[sectionKey] || [];
      const icon = SECTION_ICONS[sectionKey] || 'fa-table';
      const sectionLabel = SECTION_LABELS[sectionKey] || sectionKey;

      const savedPref = this._displayPrefs[`display_columns_${sectionKey}`] || [];
      const savedMap = {};
      savedPref.forEach(col => { savedMap[col.field] = col; });

      // Build ordered column list: saved order first, then any new columns
      const orderedColumns = [];
      if (savedPref.length > 0) {
        const sortedSaved = [...savedPref].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        const globalMap = {};
        globalColumns.forEach(c => { globalMap[c.field] = c; });

        sortedSaved.forEach(saved => {
          const gc = globalMap[saved.field];
          if (gc) {
            orderedColumns.push({
              field: saved.field,
              label: gc.label || saved.field,
              locked: gc.locked || false,
              visible: saved.visible !== false,
            });
          }
        });
        // Add any new columns not in saved prefs
        globalColumns.forEach(gc => {
          if (!savedMap[gc.field]) {
            orderedColumns.push({
              field: gc.field,
              label: gc.label || gc.field,
              locked: gc.locked || false,
              visible: gc.visible !== false,
            });
          }
        });
      } else {
        // No saved prefs — show all in global order
        globalColumns.forEach(gc => {
          orderedColumns.push({
            field: gc.field,
            label: gc.label || gc.field,
            locked: gc.locked || false,
            visible: gc.visible !== false,
          });
        });
      }

      const tableId = `displayConfigTable_${sectionKey}`;

      return `
        <div class="settings-display-section" data-section="${sectionKey}">
          <h4><i class="fas ${icon}"></i> ${esc(sectionLabel)}</h4>
          <p class="settings-hint">Toggle visibility and use arrows to reorder columns.</p>
          ${orderedColumns.length <= 1
            ? '<p class="settings-hint" style="color:var(--status-warning);">No column mappings configured yet. Contact your admin.</p>'
            : `<div class="settings-column-table-wrap">
              <table class="settings-column-table" id="${tableId}">
                <thead>
                  <tr>
                    <th class="sct-show">Show</th>
                    <th class="sct-name">Column</th>
                    <th class="sct-order">Order</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderedColumns.map((col, idx) => `
                    <tr data-field="${col.field}" class="${col.locked ? 'sct-locked' : ''}">
                      <td class="sct-show">
                        <label class="sct-toggle">
                          <input type="checkbox" class="sct-visible" ${col.visible ? 'checked' : ''} ${col.locked ? 'disabled' : ''} />
                          <span class="sct-toggle-slider"></span>
                        </label>
                      </td>
                      <td class="sct-name">${esc(col.label)}</td>
                      <td class="sct-order">
                        ${col.locked ? '' : `
                          <button type="button" class="sct-move-btn sct-move-up" ${idx === 0 ? 'disabled' : ''} title="Move up">
                            <i class="fas fa-chevron-up"></i>
                          </button>
                          <button type="button" class="sct-move-btn sct-move-down" ${idx === orderedColumns.length - 1 ? 'disabled' : ''} title="Move down">
                            <i class="fas fa-chevron-down"></i>
                          </button>
                        `}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <button type="button" class="btn btn-sm btn-primary settings-save-columns-btn" data-section="${sectionKey}">
              <i class="fas fa-save"></i> Save ${esc(sectionLabel)} Columns
            </button>`
          }
        </div>
      `;
    }).join('<hr class="settings-divider" />');

    // Bind save buttons
    container.querySelectorAll('.settings-save-columns-btn').forEach(btn => {
      btn.addEventListener('click', () => this._saveDisplayPreference(btn.dataset.section));
    });

    // Bind move-up / move-down buttons for each section
    sectionKeys.forEach(sectionKey => {
      const tableId = `displayConfigTable_${sectionKey}`;
      this._bindColumnReorderButtons(tableId);
    });
  },

  /** Wire up ▲/▼ buttons inside a column-config table */
  _bindColumnReorderButtons(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    table.querySelectorAll('.sct-move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        const prev = row.previousElementSibling;
        if (prev) row.parentNode.insertBefore(row, prev);
        this._updateMoveButtons(tableId);
      });
    });

    table.querySelectorAll('.sct-move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        const next = row.nextElementSibling;
        if (next) row.parentNode.insertBefore(next, row);
        this._updateMoveButtons(tableId);
      });
    });
  },

  /** Refresh disabled state on ▲/▼ buttons after reorder */
  _updateMoveButtons(tableId) {
    const rows = document.querySelectorAll(`#${tableId} tbody tr`);
    rows.forEach((row, idx) => {
      const up = row.querySelector('.sct-move-up');
      const down = row.querySelector('.sct-move-down');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === rows.length - 1;
    });
  },

  async _saveDisplayPreference(section) {
    const sectionEl = document.querySelector(`.settings-display-section[data-section="${section}"]`);
    if (!sectionEl) return;

    const tableId = `displayConfigTable_${section}`;
    const rows = document.querySelectorAll(`#${tableId} tbody tr`);
    const columns = [];
    rows.forEach((row, index) => {
      columns.push({
        field: row.dataset.field,
        visible: row.querySelector('.sct-visible')?.checked ?? true,
        order: index,
      });
    });

    const btn = sectionEl.querySelector('.settings-save-columns-btn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
      await ServerAPI.put('/me/profile/display-preferences', { section, columns });
      // Invalidate cached prefs so tables re-render with new visibility
      if (API._displayPrefs) API._displayPrefs = null;
      btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
      setTimeout(() => { btn.innerHTML = origHtml; btn.disabled = false; }, 2000);
      Utils.showToast(`${section.replace(/_/g, ' ')} columns updated — refresh to see changes`, 'success');
    } catch (err) {
      Utils.showToast('Failed to save: ' + err.message, 'error');
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  },

  // ========================================
  // DOCUMENTS TAB
  // ========================================
  async _loadDocuments() {
    const container = document.getElementById('settingsDocumentsContent');
    if (!container) return;

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading documents...</div>';

    try {
      this._documents = await ServerAPI.get('/me/profile/documents');
      this._renderDocuments();
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load documents.</div>';
    }
  },

  _renderDocuments() {
    const container = document.getElementById('settingsDocumentsContent');
    if (!container) return;

    const esc = Utils.escapeHtml;

    if (!this._documents?.length) {
      container.innerHTML = `
        <div class="settings-empty">
          <i class="fas fa-folder-open"></i>
          <p>No documents have been uploaded to your profile yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="settings-docs-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Category</th>
            <th>Uploaded By</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._documents.map(doc => `
            <tr>
              <td>
                <div class="doc-file-name">
                  <i class="fas ${this._getFileIcon(doc.file_name)}"></i>
                  ${esc(doc.file_name)}
                </div>
                ${doc.description ? `<div class="doc-description">${esc(doc.description)}</div>` : ''}
              </td>
              <td>${esc(doc.category || '--')}</td>
              <td>${esc(doc.uploader_name || '--')}</td>
              <td class="nowrap">${Utils.formatDate(doc.created_at, 'short')}</td>
              <td>
                <button type="button" class="btn btn-sm btn-secondary settings-doc-download" data-doc-id="${doc.id}" title="Download">
                  <i class="fas fa-download"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Bind download buttons
    container.querySelectorAll('.settings-doc-download').forEach(btn => {
      btn.addEventListener('click', () => this._downloadDocument(btn.dataset.docId));
    });
  },

  _getFileIcon(fileName) {
    if (!fileName) return 'fa-file';
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
      pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word',
      xls: 'fa-file-excel', xlsx: 'fa-file-excel', csv: 'fa-file-csv',
      png: 'fa-file-image', jpg: 'fa-file-image', jpeg: 'fa-file-image', gif: 'fa-file-image',
      zip: 'fa-file-archive', rar: 'fa-file-archive',
      txt: 'fa-file-alt',
    };
    return iconMap[ext] || 'fa-file';
  },

  async _downloadDocument(docId) {
    try {
      const result = await ServerAPI.get(`/me/profile/documents/${docId}/download-url`);
      if (result?.downloadUrl) {
        const a = document.createElement('a');
        a.href = result.downloadUrl;
        a.download = result.fileName || 'download';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      Utils.showToast('Failed to download: ' + err.message, 'error');
    }
  },

  // ========================================
  // INIT
  // ========================================
  init() {
    // Tab switching
    document.querySelectorAll('#userSettingsModal .settings-tab').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    // Close button
    document.querySelector('#userSettingsModal .modal-close')?.addEventListener('click', () => this.close());

    // Close on backdrop click
    document.getElementById('userSettingsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'userSettingsModal') this.close();
    });
  },
};

window.UserSettings = UserSettings;
