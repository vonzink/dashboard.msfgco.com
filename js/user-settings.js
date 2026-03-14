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
    if (tabId === 'goals') this._loadGoalsTab();
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
  _myBoards: [],
  _boardMappings: {},

  async _loadDisplayPreferences() {
    const container = document.getElementById('settingsDisplayContent');
    if (!container) return;

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading your boards...</div>';

    try {
      // Fetch boards assigned to this user + saved preferences in parallel
      const [boardsResult, prefsResult] = await Promise.allSettled([
        ServerAPI.getMondayMyBoards(),
        ServerAPI.get('/me/profile/display-preferences'),
      ]);

      const boardsData = boardsResult.status === 'fulfilled' ? boardsResult.value : {};
      this._myBoards = boardsData.boards || [];
      this._displayPrefs = prefsResult.status === 'fulfilled' ? prefsResult.value : {};

      if (this._myBoards.length === 0) {
        container.innerHTML = `
          <div class="settings-empty">
            <i class="fas fa-columns"></i>
            <p>No Monday.com boards are assigned to you yet.</p>
            <p class="settings-hint">Contact your admin to assign boards to your account.</p>
          </div>`;
        return;
      }

      // Fetch mappings for each board in parallel
      const mappingPromises = this._myBoards.map(b =>
        ServerAPI.getMondayMappings(b.board_id).then(mappings => ({ boardId: b.board_id, mappings })).catch(() => ({ boardId: b.board_id, mappings: [] }))
      );
      const mappingResults = await Promise.all(mappingPromises);
      this._boardMappings = {};
      mappingResults.forEach(r => { this._boardMappings[r.boardId] = r.mappings; });

      this._renderDisplayPreferences();
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load board data.</div>';
    }
  },

  _renderDisplayPreferences() {
    const container = document.getElementById('settingsDisplayContent');
    if (!container) return;

    const esc = Utils.escapeHtml;
    const SECTION_ICONS = { pipeline: 'fa-tasks', pre_approvals: 'fa-clipboard-check', funded_loans: 'fa-check-circle' };
    const SECTION_LABELS = { pipeline: 'Active Pipeline', pre_approvals: 'Pre-Approvals', funded_loans: 'Funded Loans' };

    // Group boards by target_section
    const bySection = {};
    this._myBoards.forEach(b => {
      const sec = b.target_section;
      if (!bySection[sec]) bySection[sec] = [];
      bySection[sec].push(b);
    });

    const sectionKeys = ['pipeline', 'pre_approvals', 'funded_loans'].filter(k => bySection[k]);

    container.innerHTML = sectionKeys.map(sectionKey => {
      const boards = bySection[sectionKey];
      const icon = SECTION_ICONS[sectionKey] || 'fa-table';
      const sectionLabel = SECTION_LABELS[sectionKey] || sectionKey;

      // Collect all unique mapped columns across this user's boards for this section
      const columnMap = new Map(); // field → { label, visible }
      columnMap.set('client_name', { label: sectionKey === 'funded_loans' ? 'Borrower' : 'Client Name', locked: true });

      boards.forEach(b => {
        const mappings = this._boardMappings[b.board_id] || [];
        mappings.forEach(m => {
          if (m.pipeline_field && m.pipeline_field !== 'client_name') {
            if (!columnMap.has(m.pipeline_field)) {
              columnMap.set(m.pipeline_field, {
                label: m.display_label || m.monday_column_title || m.pipeline_field,
                locked: false,
              });
            }
          }
        });
      });

      const savedPref = this._displayPrefs[`display_columns_${sectionKey}`] || [];
      const savedMap = {};
      savedPref.forEach(col => { savedMap[col.field] = col; });

      const boardNames = boards.map(b => esc(b.board_name)).join(', ');

      return `
        <div class="settings-display-section" data-section="${sectionKey}">
          <h4><i class="fas ${icon}"></i> ${esc(sectionLabel)}</h4>
          <p class="settings-hint">Boards: ${boardNames}</p>
          <p class="settings-hint">Check the columns you want to display.</p>
          ${columnMap.size <= 1
            ? '<p class="settings-hint" style="color:var(--status-warning);">No column mappings configured for your boards yet. Contact your admin.</p>'
            : `<div class="settings-columns-list">
              ${Array.from(columnMap.entries()).map(([field, col]) => {
                const saved = savedMap[field];
                const isVisible = saved ? saved.visible !== false : true;
                return `
                  <label class="settings-column-item ${col.locked ? 'locked' : ''}">
                    <input type="checkbox" data-field="${field}" ${isVisible ? 'checked' : ''} ${col.locked ? 'disabled' : ''} />
                    <span>${esc(col.label)}</span>
                  </label>
                `;
              }).join('')}
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
  },

  async _saveDisplayPreference(section) {
    const sectionEl = document.querySelector(`.settings-display-section[data-section="${section}"]`);
    if (!sectionEl) return;

    const columns = [];
    sectionEl.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => {
      columns.push({
        field: cb.dataset.field,
        visible: cb.checked,
        order: index,
      });
    });

    const btn = sectionEl.querySelector('.settings-save-columns-btn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
      await ServerAPI.put('/me/profile/display-preferences', { section, columns });
      btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
      setTimeout(() => { btn.innerHTML = origHtml; btn.disabled = false; }, 2000);
      Utils.showToast(`${section.replace(/_/g, ' ')} columns updated`, 'success');
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
  // GOALS TAB
  // ========================================
  _goalsPeriod: null,

  _getGoalsPeriodValue(period) {
    const now = new Date();
    switch (period) {
      case 'weekly': {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        return start.toISOString().slice(0, 10);
      }
      case 'monthly':
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      case 'quarterly': {
        const q = Math.ceil((now.getMonth() + 1) / 3);
        return `${now.getFullYear()}-Q${q}`;
      }
      case 'yearly':
        return `${now.getFullYear()}`;
      default:
        return '';
    }
  },

  async _loadGoalsTab() {
    const container = document.getElementById('settingsGoalsContent');
    if (!container) return;

    // Default to GoalsManager period or monthly
    if (!this._goalsPeriod) {
      this._goalsPeriod = GoalsManager?.currentPeriod || 'monthly';
    }

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading goals...</div>';

    try {
      const userId = CONFIG.currentUser?.id;
      const period = this._goalsPeriod;
      const periodValue = this._getGoalsPeriodValue(period);

      const [fundedResult, pipelineResult, preApprovalsResult, goalsResult] = await Promise.allSettled([
        ServerAPI.getFundedLoansSummary({ period, lo_id: userId }),
        ServerAPI.getPipelineSummary({ lo_id: userId }),
        ServerAPI.getPreApprovalsSummary({ lo_id: userId }),
        ServerAPI.getGoals(userId, period, periodValue),
      ]);

      // Parse current values
      const funded = fundedResult.status === 'fulfilled' ? fundedResult.value : {};
      const pipeline = pipelineResult.status === 'fulfilled' ? pipelineResult.value : {};
      const preApprovals = preApprovalsResult.status === 'fulfilled' ? preApprovalsResult.value : {};
      const savedGoals = goalsResult.status === 'fulfilled' && Array.isArray(goalsResult.value) ? goalsResult.value : [];

      const targetMap = {};
      savedGoals.forEach(g => { targetMap[g.goal_type] = parseFloat(g.target_value) || 0; });

      const goalDefs = [
        {
          id: 'loans-closed', label: 'Loans Closed', icon: 'fa-file-signature',
          current: parseInt(funded.units || funded.count || 0),
          target: targetMap['loans-closed'] || 0,
          type: 'number', max: 100, step: 1, suffix: '',
        },
        {
          id: 'volume-closed', label: 'Volume Closed', icon: 'fa-dollar-sign',
          current: parseFloat(funded.total_amount || 0) / 1000000,
          target: targetMap['volume-closed'] || 0,
          type: 'currency', max: 50, step: 0.5, prefix: '$', suffix: 'M',
        },
        {
          id: 'pipeline', label: 'Pipeline', icon: 'fa-chart-line',
          current: parseFloat(pipeline.total_amount || 0) / 1000000,
          target: targetMap['pipeline'] || 0,
          type: 'currency', max: 50, step: 0.5, prefix: '$', suffix: 'M',
        },
        {
          id: 'pre-approvals', label: 'Pre-Approvals', icon: 'fa-clipboard-check',
          current: parseInt(preApprovals.active_count || preApprovals.units || 0),
          target: targetMap['pre-approvals'] || 0,
          type: 'number', max: 200, step: 5, suffix: '',
        },
      ];

      this._renderGoalsTab(goalDefs, period);
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load goals.</div>';
    }
  },

  _renderGoalsTab(goalDefs, period) {
    const container = document.getElementById('settingsGoalsContent');
    if (!container) return;

    const esc = Utils.escapeHtml;

    container.innerHTML = `
      <div class="settings-goals-header">
        <h4><i class="fas fa-trophy"></i> Goals</h4>
        <select class="settings-goals-period-select" id="settingsGoalsPeriodSelect">
          <option value="weekly" ${period === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="monthly" ${period === 'monthly' ? 'selected' : ''}>Monthly</option>
          <option value="quarterly" ${period === 'quarterly' ? 'selected' : ''}>Quarterly</option>
          <option value="yearly" ${period === 'yearly' ? 'selected' : ''}>Yearly</option>
        </select>
      </div>
      <p class="settings-hint" style="margin-top:-8px;margin-bottom:12px;">Set your targets. Changes save automatically when you adjust the slider.</p>
      <div class="settings-goals-grid">
        ${goalDefs.map(g => {
          const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
          const currentDisplay = g.type === 'currency' ? `$${g.current.toFixed(1)}M` : Math.round(g.current);
          const targetDisplay = g.type === 'currency' ? `$${g.target.toFixed(1)}M` : Math.round(g.target);

          return `
            <div class="settings-goal-card" data-goal-id="${g.id}">
              <div class="settings-goal-header">
                <i class="fas ${g.icon}"></i>
                <span class="settings-goal-label">${esc(g.label)}</span>
              </div>
              <div class="settings-goal-current">
                <span class="settings-goal-value">${currentDisplay}</span>
                <span class="settings-goal-of">of ${targetDisplay} target</span>
              </div>
              <div class="progress-bar"><div class="progress-fill ${pct >= 100 ? 'exceeded' : pct >= 50 ? 'on-track' : 'behind'}" style="width:${pct}%"></div></div>
              <div class="settings-goal-slider">
                <label>Target:</label>
                <input type="range" min="0" max="${g.max}" step="${g.step}" value="${g.target}"
                       data-goal-id="${g.id}" data-goal-type="${g.type}" class="settings-goal-range" />
                <span class="settings-goal-slider-val">${g.type === 'currency' ? `${(g.prefix || '')}${g.target.toFixed(1)}${g.suffix}` : Math.round(g.target)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind sliders
    container.querySelectorAll('.settings-goal-range').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const card = slider.closest('.settings-goal-card');
        const display = card.querySelector('.settings-goal-slider-val');
        const goalType = slider.dataset.goalType;
        display.textContent = goalType === 'currency' ? `$${val.toFixed(1)}M` : Math.round(val);
      });

      slider.addEventListener('change', (e) => {
        const goalId = slider.dataset.goalId;
        const val = parseFloat(e.target.value);
        this._saveGoalTarget(goalId, val);
      });
    });

    // Period selector
    document.getElementById('settingsGoalsPeriodSelect')?.addEventListener('change', (e) => {
      this._goalsPeriod = e.target.value;
      this._loadGoalsTab();
    });
  },

  async _saveGoalTarget(goalId, targetValue) {
    try {
      const userId = CONFIG.currentUser?.id;
      const period = this._goalsPeriod || 'monthly';
      const periodValue = this._getGoalsPeriodValue(period);

      await ServerAPI.updateGoals({
        user_id: userId,
        period_type: period,
        period_value: periodValue,
        goal_type: goalId,
        target_value: targetValue,
      });

      // Update the main dashboard goals display too
      if (GoalsManager?.goals?.[goalId]) {
        GoalsManager.goals[goalId].target = targetValue;
        GoalsManager.updateGoalCard(goalId);
      }
    } catch (err) {
      Utils.showToast('Failed to save goal: ' + err.message, 'error');
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
