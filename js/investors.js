/* ============================================
   MSFG Dashboard - Investors Module
   Investor information, modal, and admin management
   Step 4/5 compatible (dispatcher + a11y)
============================================ */

const Investors = {
  currentInvestorId: null,
  editMode: false,

  // =========================================================
  // INVESTOR DATA — loaded from API at runtime
  // Keys match the data-investor="" attributes (investor_key column).
  // =========================================================
  data: {},
  _loaded: false,

  // =========================================================
  // FIELD DEFINITIONS (ordered as requested)
  // =========================================================
  fieldDefs: [
    { key: 'name',                    label: 'Investor',                   type: 'text',     required: true },
    { key: 'ae_name',                 label: 'Account Exec',               type: 'text' },
    { key: 'ae_email',                label: 'AE Email',                   type: 'email' },
    { key: 'ae_phone',                label: 'AE Phone',                   type: 'tel' },
    { key: 'states',                  label: 'States',                     type: 'text' },
    { key: 'bestPrograms',            label: 'Best Programs',              type: 'text' },
    { key: 'minimumFico',             label: 'Minimum FICO',               type: 'text' },
    { key: 'inHouseDpa',              label: 'In-house DPA',               type: 'text' },
    { key: 'epo',                     label: 'EPO',                        type: 'text' },
    { key: 'maxComp',                 label: 'Max Comp',                   type: 'number' },
    { key: 'docReviewForWireRelease', label: 'Doc Review for Wire Release',type: 'text' },
    { key: 'remoteClosingReview',     label: 'Remote Closing Review',      type: 'text' },
    { key: 'websiteUrl',              label: 'Link to Website',            type: 'url' },
    { key: 'notes',                   label: 'Notes',                      type: 'textarea' }
  ],

  // Track pending logo state for the manage form
  _pendingLogoFile: null,    // File object awaiting upload
  _pendingLogoRemoved: false, // true if user clicked remove

  init() {
    this.bindModalClose();
    this.bindCompanyContactsModalClose();
    this.bindGlobalEscapeClose();
    this._bindLogoUpload();
    // Load investor data from API, then build the dropdown
    this.loadFromAPI();
    console.log('Investors module initializing...');
  },

  /** Fetch investors from API and populate this.data */
  async loadFromAPI() {
    try {
      const rows = await ServerAPI.getInvestors();
      if (!Array.isArray(rows)) return;

      this.data = {};
      rows.forEach(row => {
        const key = row.investor_key;
        if (!key) return;
        this.data[key] = {
          id:                      row.id,
          name:                    row.name || key,
          accountExecutive: {
            name:   row.account_executive_name || null,
            email:  row.account_executive_email || null,
            mobile: row.account_executive_mobile || null
          },
          states:                  row.states || null,
          bestPrograms:            row.best_programs || null,
          minimumFico:             row.minimum_fico || null,
          inHouseDpa:              row.in_house_dpa || null,
          epo:                     row.epo || null,
          maxComp:                 row.max_comp != null ? Number(row.max_comp) : null,
          docReviewForWireRelease: row.doc_review_wire || null,
          remoteClosingReview:     row.remote_closing_review || null,
          websiteUrl:              row.website_url || null,
          logoUrl:                 row.logo_url || null,
          notes:                   row.notes || ''
        };
      });

      this._loaded = true;
      this._refreshDropdown();
      console.log('Investors loaded from API (' + Object.keys(this.data).length + ' investors)');
    } catch (err) {
      console.error('Failed to load investors from API:', err);
      // Show an error in the dropdown
      const container = document.getElementById('investorDropdownList');
      if (container) {
        container.innerHTML = '<div class="dropdown-header">Wholesale Partners</div>' +
          '<span class="text-muted" style="padding: 0.5rem 1rem; font-size: 0.8rem;">Failed to load investors</span>';
      }
    }
  },

  // =========================================================
  // HELPERS
  // =========================================================

  /** Generate a URL-safe slug from an investor name */
  slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  },

  /** Return a flat form-ready object for a given investor key (or blank for new) */
  getFormValues(key) {
    const inv = key ? this.data[key] : null;
    const ae = inv?.accountExecutive || {};
    return {
      name:                    inv?.name || '',
      ae_name:                 ae.name || '',
      ae_email:                ae.email || '',
      ae_phone:                ae.mobile || '',
      states:                  inv?.states || '',
      bestPrograms:            inv?.bestPrograms || '',
      minimumFico:             inv?.minimumFico || '',
      inHouseDpa:              inv?.inHouseDpa || '',
      epo:                     inv?.epo || '',
      maxComp:                 inv?.maxComp ?? '',
      docReviewForWireRelease: inv?.docReviewForWireRelease || '',
      remoteClosingReview:     inv?.remoteClosingReview || '',
      websiteUrl:              inv?.websiteUrl || '',
      notes:                   inv?.notes || ''
    };
  },

  /** Apply form values back to local data */
  applyFormValues(key, vals) {
    if (!this.data[key]) {
      this.data[key] = {};
    }
    const inv = this.data[key];
    inv.name                    = vals.name;
    inv.accountExecutive        = {
      name:   vals.ae_name   || null,
      email:  vals.ae_email  || null,
      mobile: vals.ae_phone  || null
    };
    inv.states                  = vals.states || null;
    inv.bestPrograms            = vals.bestPrograms || null;
    inv.minimumFico             = vals.minimumFico || null;
    inv.inHouseDpa              = vals.inHouseDpa || null;
    inv.epo                     = vals.epo || null;
    inv.maxComp                 = vals.maxComp ? Number(vals.maxComp) : null;
    inv.docReviewForWireRelease = vals.docReviewForWireRelease || null;
    inv.remoteClosingReview     = vals.remoteClosingReview || null;
    inv.websiteUrl              = vals.websiteUrl || null;
    inv.notes                   = vals.notes || '';
  },

  // =========================================================
  // Global ESC handler
  // =========================================================
  bindGlobalEscapeClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      // Close manage modal first if open
      const manage = document.getElementById('manageInvestorsModal');
      if (manage && manage.classList.contains('active')) {
        this.hideManageModal();
        return;
      }

      // Close contacts first if open
      const contacts = document.getElementById('companyContactsModal');
      if (contacts && contacts.classList.contains('active')) {
        this.hideCompanyContactsModal();
        return;
      }

      // Then investor modal
      const investorModal = document.getElementById('investorModal');
      if (investorModal && investorModal.classList.contains('active')) {
        this.hideModal();
      }
    });
  },

  // =========================================================
  // Investor detail modal open/close
  // =========================================================
  bindModalClose() {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideModal();
    });
  },

  showModal(investorId) {
    const investor = this.data[investorId];
    if (!investor) {
      console.warn('Investor not found:', investorId);
      return;
    }

    const modal = document.getElementById('investorModal');
    if (!modal) {
      console.error('Investor modal element not found (id="investorModal")');
      return;
    }

    this.currentInvestorId = investorId;
    this.editMode = false;

    this.populateModal(investor);
    this.bindSettingsButton();
    this.bindEditFunctionality();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideModal() {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  populateModal(investor) {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const esc = typeof Utils !== 'undefined' && Utils.escapeHtml
      ? Utils.escapeHtml.bind(Utils)
      : (s) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    // Name
    const nameEl = modal.querySelector('.investor-name');
    if (nameEl) nameEl.textContent = investor.name || 'Investor';

    // Logo
    const logoEl = modal.querySelector('.investor-logo');
    if (logoEl) {
      const logoSrc = investor.logoUrl || '';
      logoEl.src = logoSrc;
      logoEl.alt = investor.name ? investor.name + ' Logo' : 'Investor Logo';
      logoEl.style.display = logoSrc ? '' : 'none';
    }

    if (!investor.notes) investor.notes = '';

    // Account Executive
    const aeSection = modal.querySelector('.account-executive');
    if (aeSection) {
      const ae = investor.accountExecutive || {};
      if (ae.name && ae.name !== 'TBD') {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive' +
          '  <button type="button" class="section-edit-btn" data-section="accountExecutive"><i class="fas fa-edit"></i></button>' +
          '</h4>' +
          '<div class="contact-info editable-content">' +
            (ae.name ? '<div contenteditable="true" data-field="name"><strong>' + esc(ae.name) + '</strong></div>' : '') +
            (ae.mobile ? '<div contenteditable="true" data-field="mobile"><i class="fas fa-phone"></i> <a href="tel:' + ae.mobile.replace(/\D/g, '') + '">' + esc(ae.mobile) + '</a></div>' : '') +
            (ae.email ? '<div contenteditable="true" data-field="email"><i class="fas fa-envelope"></i> <a href="mailto:' + ae.email + '">' + esc(ae.email) + '</a></div>' : '') +
            (ae.address ? '<div contenteditable="true" data-field="address"><i class="fas fa-map-marker-alt"></i> ' + esc(ae.address) + '</div>' : '') +
          '</div>';
      } else {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive' +
          '  <button type="button" class="section-edit-btn" data-section="accountExecutive"><i class="fas fa-edit"></i></button>' +
          '</h4>' +
          '<p class="tbd">Information coming soon</p>';
      }
    }

    // Investor details grid (new fields)
    const detailsSection = modal.querySelector('.investor-details');
    if (detailsSection) {
      let html = '<h4><i class="fas fa-info-circle"></i> Investor Details</h4><div class="details-grid">';
      const details = [
        { label: 'States',                    value: investor.states },
        { label: 'Best Programs',             value: investor.bestPrograms },
        { label: 'Minimum FICO',              value: investor.minimumFico },
        { label: 'In-house DPA',              value: investor.inHouseDpa },
        { label: 'EPO',                       value: investor.epo },
        { label: 'Max Comp',                  value: investor.maxComp ? '$' + Number(investor.maxComp).toLocaleString() : null },
        { label: 'Doc Review for Wire Release', value: investor.docReviewForWireRelease },
        { label: 'Remote Closing Review',     value: investor.remoteClosingReview }
      ];
      details.forEach(d => {
        html += '<div class="detail-row">' +
          '<span class="detail-label">' + esc(d.label) + '</span>' +
          '<span class="detail-value">' + (d.value ? esc(String(d.value)) : '<em class="tbd">—</em>') + '</span>' +
        '</div>';
      });
      html += '</div>';
      detailsSection.innerHTML = html;
    }

    // Team
    const teamSection = modal.querySelector('.investor-team');
    if (teamSection) {
      if (Array.isArray(investor.team) && investor.team.length > 0) {
        let teamHtml =
          '<h4><i class="fas fa-users"></i> Meet My Team:' +
          '  <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="team-list editable-content">';
        investor.team.forEach((member) => {
          teamHtml += '<div class="team-member" contenteditable="true">';
          if (member.role) teamHtml += '<strong>' + esc(member.role) + '</strong> / ';
          if (member.name) teamHtml += esc(member.name);
          if (member.phone) teamHtml += ' / <a href="tel:' + member.phone.replace(/\D/g, '') + '">' + esc(member.phone) + '</a>';
          if (member.email) teamHtml += ' / <a href="mailto:' + member.email + '">' + esc(member.email) + '</a>';
          teamHtml += '</div>';
        });
        teamHtml += '</div>';
        teamSection.innerHTML = teamHtml;
      } else {
        teamSection.innerHTML =
          '<h4><i class="fas fa-users"></i> Team' +
          '  <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Lender IDs
    const lenderSection = modal.querySelector('.lender-ids');
    if (lenderSection) {
      const ids = investor.lenderIds || {};
      if (ids.fha || ids.va) {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs' +
          '  <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="lender-ids-list editable-content">' +
            (ids.fha ? '<div contenteditable="true" data-field="fha"><strong>FHA:</strong> ' + esc(ids.fha) + '</div>' : '') +
            (ids.va ? '<div contenteditable="true" data-field="va"><strong>VA:</strong> ' + esc(ids.va) + '</div>' : '') +
          '</div>';
      } else {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs' +
          '  <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Mortgagee Clause
    const clauseSection = modal.querySelector('.mortgagee-clause');
    if (clauseSection) {
      const mc = investor.mortgageeClause || {};
      if (mc.name) {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses' +
          '  <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="clause-info editable-content">' +
            '<div contenteditable="true" data-field="name"><strong>' + esc(mc.name) + '</strong></div>' +
            (mc.isaoa ? '<div contenteditable="true" data-field="isaoa">' + esc(mc.isaoa) + '</div>' : '') +
            (mc.address ? '<div contenteditable="true" data-field="address">' + esc(mc.address) + '</div>' : '') +
          '</div>';
      } else {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses' +
          '  <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Links
    const linksSection = modal.querySelector('.investor-links');
    if (linksSection) {
      const links = investor.links || {};
      let linksHtml =
        '<h4><i class="fas fa-link"></i> Resources' +
        '  <button type="button" class="section-edit-btn" data-section="links"><i class="fas fa-edit"></i></button>' +
        '</h4><div class="links-list">';

      if (investor.websiteUrl && investor.websiteUrl !== '#') {
        linksHtml += '<a href="' + investor.websiteUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Website</a>';
      }
      if (investor.loginUrl && investor.loginUrl !== '#') {
        linksHtml += '<a href="' + investor.loginUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login</a>';
      }
      if (links.website) linksHtml += '<a href="' + links.website + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Main Website</a>';
      if (links.flexSite) linksHtml += '<a href="' + links.flexSite + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-laptop"></i> Flex Site</a>';
      if (links.faq) linksHtml += '<a href="' + links.faq + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-question-circle"></i> FAQs</a>';
      if (links.appraisalVideo) linksHtml += '<a href="' + links.appraisalVideo + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-video"></i> Ordering Appraisals</a>';
      if (links.newScenarios) linksHtml += '<a href="' + links.newScenarios + '" class="link-item"><i class="fas fa-envelope"></i> New Scenarios</a>';
      if (links.login && links.login !== investor.loginUrl) linksHtml += '<a href="' + links.login + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login Portal</a>';

      linksHtml += '</div>';
      linksSection.innerHTML = linksHtml;
    }

    // Notes
    const notesSection = modal.querySelector('.investor-notes .notes-content');
    if (notesSection) {
      notesSection.textContent = investor.notes || '';
      if (!investor.notes) notesSection.classList.add('empty');
      else notesSection.classList.remove('empty');
    }
  },

  // =========================================================
  // Settings / edit hooks
  // =========================================================
  bindSettingsButton() {
    const settingsBtn = document.querySelector('.investor-settings-btn');
    if (!settingsBtn) return;

    settingsBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleEditMode();

      const editBtns = document.querySelectorAll('.section-edit-btn');
      editBtns.forEach((btn) => {
        btn.style.opacity = this.editMode ? '1' : '';
      });
    };
  },

  bindEditFunctionality() {
    document.querySelectorAll('.section-edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const section = e.target.closest('[data-section]');
        if (section) this.editSection(section.dataset.section);
      });
    });

    const notesContent = document.querySelector('.notes-content');
    if (notesContent) {
      notesContent.addEventListener('blur', () => this.saveNotes());
      notesContent.addEventListener('input', () => notesContent.classList.remove('empty'));
      notesContent.addEventListener('focus', (e) => {
        if (e.target.classList.contains('empty')) {
          e.target.textContent = '';
          e.target.classList.remove('empty');
        }
      });
    }
  },

  toggleEditMode() {
    this.editMode = !this.editMode;
    const modal = document.getElementById('investorModal');
    if (modal) modal.classList.toggle('edit-mode', this.editMode);
  },

  editSection(sectionName) {
    const section = document.querySelector('[data-section="' + sectionName + '"]');
    if (!section) return;

    const content = section.querySelector('.editable-content, .contact-info, .team-list, .lender-ids-list, .clause-info, .links-list');
    if (!content) return;

    content.contentEditable = true;
    content.focus();

    content.addEventListener('blur', () => {
      this.saveSection(sectionName);
    }, { once: true });
  },

  async saveNotes() {
    if (!this.currentInvestorId) return;

    const notesContent = document.querySelector('.notes-content');
    if (!notesContent) return;

    const notes = notesContent.textContent.trim();

    try {
      await ServerAPI.updateInvestor(this.currentInvestorId, { notes });

      if (this.data[this.currentInvestorId]) {
        this.data[this.currentInvestorId].notes = notes;
      }
    } catch (error) {
      console.error('Failed to save notes:', error);
      if (Utils.setStorage) Utils.setStorage('investor_notes_' + this.currentInvestorId, notes);
    }
  },

  saveSection(sectionName) {
    console.log('Saving section: ' + sectionName);
  },

  // =========================================================
  // Company Contacts modal
  // =========================================================
  bindCompanyContactsModalClose() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.contacts-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideCompanyContactsModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideCompanyContactsModal();
    });
  },

  showCompanyContactsModal() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) {
      console.error('Company contacts modal element not found (id="companyContactsModal")');
      return;
    }

    this.hideModal();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideCompanyContactsModal() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  // =========================================================
  // LOGO UPLOAD (manage form)
  // =========================================================

  /** Bind click, drag-drop, and remove for logo upload area */
  _bindLogoUpload() {
    const area = document.getElementById('invLogoUploadArea');
    const fileInput = document.getElementById('invLogoFileInput');
    const removeBtn = document.getElementById('invLogoRemoveBtn');
    if (!area || !fileInput) return;

    // Click to select file
    area.addEventListener('click', (e) => {
      if (e.target.closest('#invLogoRemoveBtn')) return; // don't trigger on remove
      fileInput.click();
    });

    // File selected via input
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        this._setLogoPending(fileInput.files[0]);
      }
    });

    // Drag & drop
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => { area.classList.remove('drag-over'); });
    area.addEventListener('drop', (e) => {
      e.preventDefault();
      area.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        this._setLogoPending(file);
      }
    });

    // Remove button
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._pendingLogoFile = null;
        this._pendingLogoRemoved = true;
        this._updateLogoPreview(null);
      });
    }
  },

  /** Set a file as the pending logo and show preview */
  _setLogoPending(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, SVG, etc.)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Logo must be under 5 MB.');
      return;
    }
    this._pendingLogoFile = file;
    this._pendingLogoRemoved = false;

    // Show local preview
    const reader = new FileReader();
    reader.onload = (e) => this._updateLogoPreview(e.target.result);
    reader.readAsDataURL(file);
  },

  /** Update the logo preview UI in the manage form */
  _updateLogoPreview(src) {
    const preview = document.getElementById('invLogoPreview');
    const placeholder = document.getElementById('invLogoPlaceholder');
    const removeBtn = document.getElementById('invLogoRemoveBtn');

    if (src) {
      if (preview) { preview.src = src; preview.style.display = ''; }
      if (placeholder) placeholder.style.display = 'none';
      if (removeBtn) removeBtn.style.display = '';
    } else {
      if (preview) { preview.src = ''; preview.style.display = 'none'; }
      if (placeholder) placeholder.style.display = '';
      if (removeBtn) removeBtn.style.display = 'none';
    }
  },

  /**
   * Upload a logo file to S3 for a given investor ID.
   * Uses the 2-step presigned URL flow.
   * Returns the presigned download URL on success.
   */
  async _uploadLogo(investorId, file) {
    // Step 1: Get presigned upload URL
    const { uploadUrl, fileKey } = await ServerAPI.getInvestorLogoUploadUrl(
      investorId, file.name, file.type
    );

    // Step 2: PUT file directly to S3
    await ServerAPI.uploadToS3(uploadUrl, file);

    // Step 3: Confirm — saves S3 key in DB
    const result = await ServerAPI.confirmInvestorLogo(investorId, fileKey);
    return result.logoUrl; // presigned download URL
  },

  // =========================================================
  // ADMIN: Manage Investors Modal
  // =========================================================
  _manageSearchTerm: '',
  _editingKey: null,       // null = new investor, string = editing existing

  showManageModal() {
    const modal = document.getElementById('manageInvestorsModal');
    if (!modal) { console.error('manageInvestorsModal not found'); return; }

    this._manageSearchTerm = '';
    this._editingKey = null;
    this._renderManageList();
    this._showManageView('list');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const c = modal.querySelector('.modal-content');
      if (c) c.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideManageModal() {
    const modal = document.getElementById('manageInvestorsModal');
    if (!modal) return;
    const c = modal.querySelector('.modal-content');
    if (c) c.style.transform = 'scale(0.95) translateY(20px)';
    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  /** Toggle between 'list' and 'form' views inside the manage modal */
  _showManageView(view) {
    const listView = document.getElementById('manageInvestorsList');
    const formView = document.getElementById('manageInvestorForm');
    if (!listView || !formView) return;

    if (view === 'form') {
      listView.style.display = 'none';
      formView.style.display = 'block';
    } else {
      listView.style.display = 'block';
      formView.style.display = 'none';
    }
  },

  /** Render the investor list table inside the manage modal */
  _renderManageList() {
    const container = document.getElementById('manageInvestorsTableBody');
    if (!container) return;

    const search = this._manageSearchTerm.toLowerCase();
    const sorted = Object.entries(this.data)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    let html = '';
    let count = 0;
    sorted.forEach(([key, inv]) => {
      const name = inv.name || key;
      const ae = inv.accountExecutive || {};
      if (search && !name.toLowerCase().includes(search) && !(ae.name || '').toLowerCase().includes(search)) {
        return;
      }
      count++;
      const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
      html +=
        '<tr>' +
          '<td>' + esc(name) + '</td>' +
          '<td>' + esc(ae.name || '—') + '</td>' +
          '<td>' + esc(ae.email || '—') + '</td>' +
          '<td>' + esc(ae.mobile || '—') + '</td>' +
          '<td class="manage-actions-cell">' +
            '<button type="button" class="btn btn-sm btn-secondary manage-edit-btn" data-key="' + key + '"><i class="fas fa-edit"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-danger manage-delete-btn" data-key="' + key + '"><i class="fas fa-trash"></i></button>' +
          '</td>' +
        '</tr>';
    });

    if (count === 0) {
      html = '<tr><td colspan="5" class="empty-state">No investors found.</td></tr>';
    }

    container.innerHTML = html;

    // Update count
    const countEl = document.getElementById('manageInvestorCount');
    if (countEl) countEl.textContent = count + ' investor' + (count !== 1 ? 's' : '');

    // Bind edit/delete
    container.querySelectorAll('.manage-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._openForm(btn.dataset.key));
    });
    container.querySelectorAll('.manage-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this._deleteInvestor(btn.dataset.key));
    });
  },

  /** Open the add/edit form for an investor */
  _openForm(key) {
    this._editingKey = key || null;
    this._pendingLogoFile = null;
    this._pendingLogoRemoved = false;

    const vals = this.getFormValues(key);
    const title = document.getElementById('manageFormTitle');
    if (title) title.textContent = key ? 'Edit Investor' : 'Add Investor';

    this.fieldDefs.forEach(def => {
      const input = document.getElementById('inv_' + def.key);
      if (input) input.value = vals[def.key] ?? '';
    });

    // Reset file input
    const fileInput = document.getElementById('invLogoFileInput');
    if (fileInput) fileInput.value = '';

    // Show current logo or placeholder
    const inv = key ? this.data[key] : null;
    this._updateLogoPreview(inv?.logoUrl || null);

    this._showManageView('form');
  },

  /** Save the form (create or update) */
  async _saveForm() {
    const vals = {};
    this.fieldDefs.forEach(def => {
      const input = document.getElementById('inv_' + def.key);
      if (input) vals[def.key] = input.value.trim();
    });

    if (!vals.name) {
      alert('Investor name is required.');
      return;
    }

    const key = this._editingKey || this.slugify(vals.name);

    // Apply locally
    this.applyFormValues(key, vals);

    // Persist to backend
    let savedInvestor;
    try {
      const payload = {
        investor_key:               key,
        name:                       vals.name,
        account_executive_name:     vals.ae_name || null,
        account_executive_email:    vals.ae_email || null,
        account_executive_mobile:   vals.ae_phone || null,
        states:                     vals.states || null,
        best_programs:              vals.bestPrograms || null,
        minimum_fico:               vals.minimumFico || null,
        in_house_dpa:               vals.inHouseDpa || null,
        epo:                        vals.epo || null,
        max_comp:                   vals.maxComp ? Number(vals.maxComp) : null,
        doc_review_wire:            vals.docReviewForWireRelease || null,
        remote_closing_review:      vals.remoteClosingReview || null,
        website_url:                vals.websiteUrl || null,
        notes:                      vals.notes || null
      };

      if (this._editingKey) {
        savedInvestor = await ServerAPI.updateInvestor(key, payload);
      } else {
        savedInvestor = await ServerAPI.createInvestor(payload);
      }
      console.log('Investor saved:', key);
    } catch (err) {
      console.error('Failed to persist investor to backend:', err);
    }

    // Handle logo upload / removal (needs investor ID from DB)
    const investorId = savedInvestor?.id || this.data[key]?.id;
    if (investorId) {
      try {
        if (this._pendingLogoFile) {
          // Upload new logo
          const area = document.getElementById('invLogoUploadArea');
          if (area) area.classList.add('uploading');

          const logoUrl = await this._uploadLogo(investorId, this._pendingLogoFile);
          if (this.data[key]) this.data[key].logoUrl = logoUrl;

          if (area) area.classList.remove('uploading');
          console.log('Investor logo uploaded:', key);
        } else if (this._pendingLogoRemoved) {
          // Remove existing logo
          await ServerAPI.deleteInvestorLogo(investorId);
          if (this.data[key]) this.data[key].logoUrl = null;
          console.log('Investor logo removed:', key);
        }
      } catch (err) {
        console.error('Logo upload/remove failed:', err);
        alert('Investor saved, but logo upload failed. Please try again.');
      }
    }

    this._pendingLogoFile = null;
    this._pendingLogoRemoved = false;

    // Refresh list & go back
    this._renderManageList();
    this._showManageView('list');
    this._refreshDropdown();
  },

  /** Delete an investor (with confirmation) */
  async _deleteInvestor(key) {
    const inv = this.data[key];
    if (!inv) return;

    if (!confirm('Delete investor "' + (inv.name || key) + '"? This cannot be undone.')) return;

    delete this.data[key];

    try {
      await ServerAPI.deleteInvestor(key);
    } catch (err) {
      console.error('Failed to delete investor on backend:', err);
    }

    this._renderManageList();
    this._refreshDropdown();
  },

  /** Refresh the investor dropdown in the nav */
  _refreshDropdown() {
    const container = document.getElementById('investorDropdownList');
    if (!container) return;

    const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    const sorted = Object.entries(this.data)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    let html = '<div class="dropdown-header">Wholesale Partners (' + sorted.length + ')</div>' +
      '<div class="investor-dropdown-search">' +
        '<input type="text" id="investorDropdownSearch" class="form-input form-input-sm" placeholder="Search investors..." autocomplete="off" />' +
      '</div>' +
      '<div class="investor-dropdown-items" id="investorDropdownItems">';

    sorted.forEach(([key, inv]) => {
      html += '<button type="button" class="dropdown-item" data-action="open-investor" data-investor="' + key + '">' +
        '<i class="fas fa-building"></i> ' + esc(inv.name || key) +
      '</button>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Bind search
    const searchInput = document.getElementById('investorDropdownSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const items = document.querySelectorAll('#investorDropdownItems .dropdown-item');
        items.forEach(btn => {
          const name = (btn.textContent || '').toLowerCase();
          btn.style.display = name.includes(q) ? '' : 'none';
        });
      });
      // Prevent dropdown from closing when clicking into search
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
  }
};

window.Investors = Investors;
