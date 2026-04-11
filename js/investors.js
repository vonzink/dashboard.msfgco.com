/* ============================================
   MSFG Dashboard - Investors Module
   Investor data, modal (read-only except notes),
   contact cards. Tags/notes delegated to InvestorNotes,
   dropdown/directory delegated to InvestorDropdown.
============================================ */

const Investors = {
  currentInvestorId: null,

  // =========================================================
  // INVESTOR DATA — loaded from API at runtime
  // Keys match the data-investor="" attributes (investor_key column).
  // =========================================================
  data: {},
  _loaded: false,
  _investorTags: [],  // managed tags from DB (shared with InvestorNotes)
  _investorNoteTagsMap: {},  // { investor_id: [tag_name, ...] } for search (shared with InvestorNotes/Dropdown)

  init() {
    this.bindModalClose();
    this.bindCompanyContactsModalClose();
    InvestorNotes.init();
    // Load investor data + tags from API, then build the dropdown
    this.loadFromAPI();
    InvestorNotes.loadTags();
    InvestorNotes.loadNoteTags();
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
          inHouseServicing:        row.in_house_servicing || null,
          maxComp:                 row.max_comp != null ? Number(row.max_comp) : null,
          underwritingFee:         row.underwriting_fee || null,
          // Toggle fields
          servicing:               row.servicing,
          manualUnderwriting:      row.manual_underwriting,
          nonQm:                   row.non_qm,
          jumbo:                   row.jumbo,
          subordinateFinancing:    row.subordinate_financing,
          reviewWireRelease:       row.review_wire_release,
          usda:                    row.usda,
          landLoans:               row.land_loans,
          vaLoans:                 row.va_loans,
          bridgeLoans:             row.bridge_loans,
          dscr:                    row.dscr,
          conventional:            row.conventional,
          fha:                     row.fha,
          bankStatement:           row.bank_statement,
          assetDepletion:          row.asset_depletion,
          interestOnly:            row.interest_only,
          itinForeignNational:     row.itin_foreign_national,
          construction:            row.construction,
          renovation:              row.renovation,
          manufactured:            row.manufactured,
          doctor:                  row.doctor,
          condoNonWarrantable:     row.condo_non_warrantable,
          helocSecond:             row.heloc_second,
          scenarioDesk:            row.scenario_desk,
          condoReview:             row.condo_review,
          exceptionDesk:           row.exception_desk,
          websiteUrl:              row.website_url || null,
          logoUrl:                 row.logo_url || null,
          notes:                   row.notes || '',
          customToggles:           Array.isArray(row.customToggles) ? row.customToggles : []
        };
      });

      this._loaded = true;
      this._refreshDropdown();
    } catch (err) {
      console.error('Failed to load investors from API:', err);
      const container = document.getElementById('investorDropdownList');
      if (container) {
        container.innerHTML = '<div class="dropdown-header">Wholesale Partners</div>' +
          '<span class="text-muted" style="padding: 0.5rem 1rem; font-size: 0.8rem;">Failed to load investors</span>';
      }
    }
  },

  /** Delegate dropdown rendering to InvestorDropdown */
  _refreshDropdown() {
    InvestorDropdown.refresh();
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

  /** Show investor modal — fetches full detail from API */
  async showModal(investorId) {
    const modal = document.getElementById('investorModal');
    if (!modal) {
      console.error('Investor modal element not found (id="investorModal")');
      return;
    }

    this.currentInvestorId = investorId;

    const basicInvestor = this.data[investorId];
    if (basicInvestor) {
      // Show modal with basic data first (fast)
      this.populateModal(basicInvestor);
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);

    // Fetch full detail from API for sub-resources
    try {
      const full = await ServerAPI.getInvestor(investorId);
      if (full) {
        this.populateModal(full);
      }
    } catch (err) {
      console.warn('Could not load full investor detail:', err);
    }
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

    const esc = Utils.escapeHtml;
    const detailRow = (label, value) => value
      ? '<div class="pa-detail-row"><span class="pa-detail-label">' + esc(label) + '</span><span class="pa-detail-value">' + value + '</span></div>'
      : '';

    // Name
    const nameEl = modal.querySelector('.investor-name');
    if (nameEl) nameEl.textContent = investor.name || 'Investor';

    // Logo
    const logoEl = modal.querySelector('.investor-logo');
    if (logoEl) {
      const logoSrc = investor.logoUrl || investor.logo_url || '';
      const fallback = (CONFIG && CONFIG.assets && CONFIG.assets.logoFallback) || '/assets/msfg-logo-fallback.svg';
      logoEl.src = logoSrc || fallback;
      logoEl.alt = investor.name ? investor.name + ' Logo' : 'Investor Logo';
      logoEl.style.display = '';
      logoEl.onerror = function() { this.onerror = null; this.src = fallback; };
    }

    const body = document.getElementById('investorDetailBody');
    if (!body) return;

    // --- Build AE section ---
    const ae = investor.accountExecutive || {};
    const aeName = ae.name || investor.account_executive_name;
    const aeEmail = ae.email || investor.account_executive_email;
    const aePhone = ae.mobile || investor.account_executive_mobile;
    const aePhoto = investor.account_executive_photo_url;

    let aeHtml = '';
    if (aeName && aeName !== 'TBD') {
      const photoHtml = aePhoto
        ? '<img src="' + aePhoto + '" alt="' + esc(aeName) + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--green-bright);flex-shrink:0;" />'
        : '';
      aeHtml = (photoHtml ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem;">' + photoHtml + '<strong style="color:var(--text-primary);">' + esc(aeName) + '</strong></div>' : detailRow('Name', esc(aeName))) +
        detailRow('Phone', aePhone ? '<a href="tel:' + aePhone.replace(/\D/g, '') + '">' + esc(aePhone) + '</a>' : '') +
        detailRow('Email', aeEmail ? '<a href="mailto:' + aeEmail + '">' + esc(aeEmail) + '</a>' : '');
    }

    // --- Build products & services pills ---
    const toggleCategories = [
      { name: 'Agency / Gov', toggles: [
        { label: 'Conventional', val: investor.conventional ?? investor.conventional },
        { label: 'FHA',          val: investor.fha ?? investor.fha },
        { label: 'VA',           val: investor.vaLoans ?? investor.va_loans },
        { label: 'USDA',         val: investor.usda ?? investor.usda },
        { label: 'Jumbo',        val: investor.jumbo ?? investor.jumbo },
      ]},
      { name: 'Non-Agency', toggles: [
        { label: 'Non-QM',              val: investor.nonQm ?? investor.non_qm },
        { label: 'DSCR',                val: investor.dscr ?? investor.dscr },
        { label: 'Bank Statement',       val: investor.bankStatement ?? investor.bank_statement },
        { label: 'Asset Depletion',      val: investor.assetDepletion ?? investor.asset_depletion },
        { label: 'Interest Only',        val: investor.interestOnly ?? investor.interest_only },
        { label: 'ITIN / Foreign Nat\'l', val: investor.itinForeignNational ?? investor.itin_foreign_national },
      ]},
      { name: 'Specialty', toggles: [
        { label: 'Bridge',              val: investor.bridgeLoans ?? investor.bridge_loans },
        { label: 'Land',                val: investor.landLoans ?? investor.land_loans },
        { label: 'Construction',         val: investor.construction ?? investor.construction },
        { label: 'Renovation',           val: investor.renovation ?? investor.renovation },
        { label: 'Manufactured',         val: investor.manufactured ?? investor.manufactured },
        { label: 'Doctor',               val: investor.doctor ?? investor.doctor },
        { label: 'Condo / Non-Warr.',    val: investor.condoNonWarrantable ?? investor.condo_non_warrantable },
        { label: 'Sub. Financing',       val: investor.subordinateFinancing ?? investor.subordinate_financing },
        { label: 'HELOC / 2nd',          val: investor.helocSecond ?? investor.heloc_second },
      ]},
      { name: 'Services', toggles: [
        { label: 'Manual UW',            val: investor.manualUnderwriting ?? investor.manual_underwriting },
        { label: 'Servicing',            val: investor.servicing ?? investor.servicing },
        { label: 'Scenario Desk',        val: investor.scenarioDesk ?? investor.scenario_desk },
        { label: 'Condo Review',         val: investor.condoReview ?? investor.condo_review },
        { label: 'Exception Desk',       val: investor.exceptionDesk ?? investor.exception_desk },
        { label: 'Wire / Funding Review', val: investor.reviewWireRelease ?? investor.review_wire_release },
      ]},
    ];
    const customToggles = (investor.customToggles || []).filter(t => Number(t.enabled) === 1);
    if (customToggles.length) {
      toggleCategories.push({ name: 'Custom', toggles: customToggles.map(t => ({ label: t.label, val: 1 })) });
    }

    const CAT_SLUG = { 'Agency / Gov': 'agency', 'Non-Agency': 'nonagency', 'Specialty': 'specialty', 'Services': 'services', 'Custom': 'custom' };
    let pillsHtml = '';
    toggleCategories.forEach(cat => {
      const catToggles = cat.toggles.filter(t => Number(t.val) === 1);
      if (catToggles.length === 0) return;
      const slug = CAT_SLUG[cat.name] || 'other';
      pillsHtml += '<div class="pill-category pill-cat-' + slug + '" style="margin-bottom:0.5rem;">' +
        '<span class="pill-category-label">' + esc(cat.name) + '</span>' +
        '<div class="investor-pills">' +
        catToggles.map(t => '<span class="investor-pill pill-yes pill-' + slug + '"><i class="fas fa-check"></i> ' + esc(t.label) + '</span>').join('') +
        '</div></div>';
    });

    // --- Investor details ---
    const maxComp = (investor.maxComp || investor.max_comp) ? '$' + Number(investor.maxComp || investor.max_comp).toLocaleString() : '';
    const uwFee = investor.underwritingFee || investor.underwriting_fee || '';

    // --- Team ---
    const team = investor.team || [];
    let teamHtml = '';
    if (team.length > 0) {
      teamHtml = '<div class="team-list">';
      team.forEach(member => {
        const photoHtml = member.photo_url
          ? '<img src="' + member.photo_url + '" alt="' + esc(member.name || '') + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--border-color);flex-shrink:0;" />'
          : '<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid var(--border-color);"><i class="fas fa-user" style="font-size:12px;color:var(--text-muted);"></i></div>';
        teamHtml += '<div class="team-member" style="display:flex;align-items:center;gap:10px;">' + photoHtml + '<div>';
        if (member.role) teamHtml += '<strong>' + esc(member.role) + '</strong><br/>';
        if (member.name) teamHtml += esc(member.name);
        if (member.phone) teamHtml += '<br/><a href="tel:' + member.phone.replace(/\D/g, '') + '">' + esc(member.phone) + '</a>';
        if (member.email) teamHtml += '<br/><a href="mailto:' + member.email + '">' + esc(member.email) + '</a>';
        teamHtml += '</div></div>';
      });
      teamHtml += '</div>';
    } else {
      teamHtml = '<p style="color:var(--text-secondary);font-size:0.88rem;">No team members listed</p>';
    }

    // --- Lender IDs ---
    const ids = investor.lenderIds || {};
    let lenderHtml = '';
    if (ids.fha_id || ids.va_id || ids.rd_id || ids.fha || ids.va || ids.rd) {
      lenderHtml = detailRow('FHA', esc(ids.fha_id || ids.fha || '')) +
        detailRow('VA', esc(ids.va_id || ids.va || '')) +
        detailRow('RD', esc(ids.rd_id || ids.rd || ''));
    } else {
      lenderHtml = '<p style="color:var(--text-secondary);font-size:0.88rem;">No lender IDs on file</p>';
    }

    // --- Mortgagee Clauses ---
    const clauses = investor.mortgageeClauses || [];
    const mc = investor.mortgageeClause || {};
    let clauseHtml = '';
    if (clauses.length > 0) {
      clauses.forEach(c => {
        clauseHtml += '<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border-color,rgba(255,255,255,0.05));">';
        if (c.label) clauseHtml += '<span style="display:inline-block;background:var(--green-dark,#0d3b3d);color:var(--green-bright,#8cc63e);font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:4px;margin-bottom:4px;text-transform:uppercase;">' + esc(c.label) + '</span>';
        clauseHtml += '<div style="font-weight:600;color:var(--text-primary);">' + esc(c.name) + '</div>';
        if (c.isaoa) clauseHtml += '<div style="font-size:0.85rem;color:var(--text-secondary);">' + esc(c.isaoa) + '</div>';
        if (c.address) clauseHtml += '<div style="font-size:0.85rem;color:var(--text-muted);">' + esc(c.address) + '</div>';
        clauseHtml += '</div>';
      });
    } else if (mc.name) {
      clauseHtml = '<div style="font-weight:600;color:var(--text-primary);">' + esc(mc.name) + '</div>' +
        (mc.isaoa ? '<div style="font-size:0.85rem;color:var(--text-secondary);">' + esc(mc.isaoa) + '</div>' : '') +
        (mc.address ? '<div style="font-size:0.85rem;color:var(--text-muted);">' + esc(mc.address) + '</div>' : '');
    } else {
      clauseHtml = '<p style="color:var(--text-secondary);font-size:0.88rem;">No mortgagee clauses on file</p>';
    }

    // --- Links ---
    const links = investor.links || [];
    const websiteUrl = investor.websiteUrl || investor.website_url;
    let linksHtml = '<div class="links-list">';
    if (websiteUrl && websiteUrl !== '#') {
      linksHtml += '<a href="' + websiteUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Website</a>';
    }
    if (Array.isArray(links)) {
      const LINK_ICONS = { website: 'fas fa-globe', login: 'fas fa-sign-in-alt', flex_site: 'fas fa-laptop', faq: 'fas fa-question-circle', appraisal_video: 'fas fa-video', new_scenarios: 'fas fa-envelope' };
      const LINK_LABELS = { website: 'Website', login: 'Login Portal', flex_site: 'Flex Site', faq: 'FAQs', appraisal_video: 'Ordering Appraisals', new_scenarios: 'New Scenarios' };
      links.forEach(link => {
        if (!link.url) return;
        const icon = LINK_ICONS[link.link_type] || 'fas fa-external-link-alt';
        const label = link.label || LINK_LABELS[link.link_type] || link.link_type;
        const isEmail = link.url.startsWith('mailto:');
        linksHtml += '<a href="' + link.url + '"' + (isEmail ? '' : ' target="_blank" rel="noopener noreferrer"') + ' class="link-item"><i class="' + icon + '"></i> ' + esc(label) + '</a>';
      });
    } else if (typeof links === 'object') {
      if (links.website) linksHtml += '<a href="' + links.website + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Main Website</a>';
      if (links.flexSite) linksHtml += '<a href="' + links.flexSite + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-laptop"></i> Flex Site</a>';
      if (links.faq) linksHtml += '<a href="' + links.faq + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-question-circle"></i> FAQs</a>';
      if (links.appraisalVideo) linksHtml += '<a href="' + links.appraisalVideo + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-video"></i> Ordering Appraisals</a>';
      if (links.newScenarios) linksHtml += '<a href="' + links.newScenarios + '" class="link-item"><i class="fas fa-envelope"></i> New Scenarios</a>';
      if (links.login) linksHtml += '<a href="' + links.login + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login Portal</a>';
    }
    linksHtml += '</div>';

    // --- Documents ---
    const docs = investor.documents || [];
    let docsHtml = '';
    if (docs.length > 0) {
      const DOC_ICONS = {
        'application/pdf': 'fas fa-file-pdf', 'text/plain': 'fas fa-file-alt', 'text/csv': 'fas fa-file-csv',
        'application/msword': 'fas fa-file-word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'fas fa-file-word',
        'application/vnd.ms-excel': 'fas fa-file-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'fas fa-file-excel',
        'image/png': 'fas fa-file-image', 'image/jpeg': 'fas fa-file-image',
      };
      docsHtml = '<div class="investor-doc-list">';
      docs.forEach(doc => {
        const icon = DOC_ICONS[doc.file_type] || 'fas fa-file';
        const sizeStr = doc.file_size ? this._formatFileSize(doc.file_size) : '';
        docsHtml += '<div class="investor-doc-item">' +
          '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
            '<i class="' + icon + '" style="color:var(--green-bright);flex-shrink:0;"></i>' +
            '<div style="min-width:0;"><div class="investor-doc-name">' + esc(doc.file_name) + '</div>' +
              (sizeStr ? '<div class="investor-doc-meta">' + sizeStr + '</div>' : '') +
            '</div></div>' +
          (doc.download_url ? '<a href="' + doc.download_url + '" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="flex-shrink:0;"><i class="fas fa-download"></i></a>' : '') +
        '</div>';
      });
      docsHtml += '</div>';
    } else {
      docsHtml = '<p style="color:var(--text-secondary);font-size:0.88rem;">No documents on file</p>';
    }

    // --- Turn Times ---
    const turnTimes = investor.turnTimes || [];
    let turnTimesHtml = '';
    if (turnTimes.length > 0) {
      turnTimesHtml = '<div class="pa-detail-section full-width">' +
        '<h3 class="pa-detail-section-title"><i class="fas fa-clock"></i> Turn Times</h3>' +
        '<div class="turn-times-list">';
      turnTimes.forEach(t => {
        turnTimesHtml += '<div class="pa-detail-row"><span class="pa-detail-label">' + esc(t.label) + '</span><span class="pa-detail-value">' + esc(String(t.value)) + ' ' + esc(t.unit || 'days') + '</span></div>';
      });
      turnTimesHtml += '</div></div>';
    }

    // --- Build full body ---
    body.innerHTML =
      '<div class="pa-detail-grid">' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-user-tie"></i> Account Executive</h3>' +
          aeHtml +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-info-circle"></i> Investor Details</h3>' +
          detailRow('States', esc(investor.states || '')) +
          detailRow('Best Programs', esc(investor.bestPrograms || investor.best_programs || '')) +
          detailRow('Minimum FICO', esc(investor.minimumFico || investor.min_fico || '')) +
          detailRow('In-house DPA', esc(investor.inHouseDpa || investor.in_house_dpa || '')) +
          detailRow('EPO', esc(investor.epo || '')) +
          detailRow('Max Comp', esc(maxComp)) +
          detailRow('Underwriting Fee', esc(uwFee)) +
        '</div>' +
      '</div>' +
      // Team (full width, under AE)
      '<div class="pa-detail-section full-width">' +
        '<h3 class="pa-detail-section-title"><i class="fas fa-users"></i> Team</h3>' +
        teamHtml +
      '</div>' +
      // Products & Services + Lender IDs side by side
      '<div class="pa-detail-grid">' +
        (pillsHtml ? '<div class="pa-detail-section"><h3 class="pa-detail-section-title"><i class="fas fa-tags"></i> Products &amp; Services</h3>' + pillsHtml + '</div>' : '') +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-id-card"></i> Lender IDs</h3>' +
          lenderHtml +
        '</div>' +
      '</div>' +
      '<div class="pa-detail-grid">' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-file-contract"></i> Mortgagee Clauses</h3>' +
          clauseHtml +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-link"></i> Resources</h3>' +
          linksHtml +
        '</div>' +
      '</div>' +
      // Documents (full width)
      '<div class="pa-detail-section full-width">' +
        '<h3 class="pa-detail-section-title"><i class="fas fa-folder-open"></i> Documents</h3>' +
        docsHtml +
      '</div>' +
      // Turn Times
      turnTimesHtml +
      // Legacy notes from investor record
      (investor.notes ? '<div class="pa-detail-section full-width"><h3 class="pa-detail-section-title"><i class="fas fa-sticky-note"></i> Investor Notes</h3><div class="pa-detail-monday-notes">' + esc(investor.notes) + '</div></div>' : '') +
      // Notes system
      '<div class="pa-detail-section full-width">' +
        '<h3 class="pa-detail-section-title"><i class="fas fa-comments"></i> Notes' +
          '<button type="button" class="btn btn-sm btn-outline" id="investorManageTagsBtn" style="margin-left:auto;font-size:0.7rem;padding:0.15rem 0.5rem;"><i class="fas fa-tags"></i> Manage Tags</button>' +
        '</h3>' +
        '<div class="pa-notes-add" style="flex-direction:column;">' +
          '<textarea id="investorNewNoteInput" rows="4" placeholder="Add a note..." class="form-input"></textarea>' +
          '<div class="inv-note-tag-bar">' +
            '<span class="inv-note-tag-label"><i class="fas fa-tags"></i> Tags:</span>' +
            '<div class="inv-note-tag-pills" id="investorNoteTagPills"><span style="font-size:0.72rem;color:var(--text-muted);">None — click Manage Tags to select</span></div>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-sm" id="investorAddNoteBtn" style="align-self:flex-end;"><i class="fas fa-plus"></i> Add Note</button>' +
        '</div>' +
        '<div id="investorNotesContainer" class="pa-notes-list">' +
          '<div style="text-align:center;padding:1rem;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Loading notes...</div>' +
        '</div>' +
      '</div>';

    // Delegate note binding to InvestorNotes
    const investorId = investor.id || this.currentInvestorId;
    InvestorNotes.bindNoteControls(investorId);
  },

  _formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  // =========================================================
  // All Investors Directory — delegate to InvestorDropdown
  // =========================================================
  showAllInvestors() {
    InvestorDropdown.showAll();
  },

  _hideAllInvestors() {
    InvestorDropdown._hideAll();
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
  // MSFG Contact Card — in-page modal
  // =========================================================
  async showContactCard(userId) {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const esc = Utils.escapeHtml;

    // Show modal with loading state
    const content = modal.querySelector('.modal-content') || modal;
    content.innerHTML =
      '<button type="button" class="contacts-modal-close">&times;</button>' +
      '<div style="text-align:center; padding:40px; color:#999;"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i><p>Loading contact...</p></div>';

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { content.style.transform = 'scale(1) translateY(0)'; }, 10);

    // Re-bind close
    const closeBtn = content.querySelector('.contacts-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideCompanyContactsModal());

    try {
      const user = await ServerAPI.getEmployeeContactCard(userId);
      if (!user) throw new Error('Not found');

      const initials = user.initials || (user.name || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

      // Build social icons
      const socials = [
        { url: user.facebook_url, icon: 'fab fa-facebook-f', color: '#1877F2', label: 'Facebook' },
        { url: user.instagram_url, icon: 'fab fa-instagram', color: '#E4405F', label: 'Instagram' },
        { url: user.twitter_url, icon: 'fab fa-x-twitter', color: '#000', label: 'X' },
        { url: user.linkedin_url, icon: 'fab fa-linkedin-in', color: '#0A66C2', label: 'LinkedIn' },
        { url: user.tiktok_url, icon: 'fab fa-tiktok', color: '#000', label: 'TikTok' },
        { url: user.youtube_url, icon: 'fab fa-youtube', color: '#FF0000', label: 'YouTube' },
      ].filter(s => s.url);

      let socialHtml = '';
      if (socials.length > 0) {
        socialHtml = '<div class="contact-card-social">';
        socials.forEach(s => {
          socialHtml += '<a href="' + s.url + '" target="_blank" rel="noopener noreferrer" class="social-icon-link" title="' + s.label + '" style="color:' + s.color + '"><i class="' + s.icon + '"></i></a>';
        });
        socialHtml += '</div>';
      }

      // Build info grid
      let infoHtml = '<div class="contact-card-grid">';
      if (user.phone) infoHtml += '<div class="contact-card-item"><i class="fas fa-phone"></i><a href="tel:' + user.phone.replace(/\D/g, '') + '">' + esc(user.phone) + '</a></div>';
      const email = user.display_email || user.email;
      if (email) infoHtml += '<div class="contact-card-item"><i class="fas fa-envelope"></i><a href="mailto:' + email + '">' + esc(email) + '</a></div>';
      if (user.website) infoHtml += '<div class="contact-card-item"><i class="fas fa-globe"></i><a href="' + user.website + '" target="_blank" rel="noopener noreferrer">' + esc(user.website.replace(/^https?:\/\//, '')) + '</a></div>';
      if (user.online_app_url) infoHtml += '<div class="contact-card-item"><i class="fas fa-file-alt"></i><a href="' + user.online_app_url + '" target="_blank" rel="noopener noreferrer">Online Application</a></div>';
      if (user.nmls_number) infoHtml += '<div class="contact-card-item"><i class="fas fa-id-badge"></i><span>NMLS# ' + esc(user.nmls_number) + '</span></div>';
      infoHtml += '</div>';

      // Business card download
      let businessCardHtml = '';
      if (user.business_card_url) {
        businessCardHtml =
          '<div class="contact-card-section" style="text-align:center;">' +
            '<h4 style="font-size:12px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin:0 0 8px;">Business Card</h4>' +
            '<img src="' + user.business_card_url + '" alt="Business Card" style="max-width:100%; max-height:180px; border-radius:8px; border:1px solid #eee; object-fit:contain;" />' +
            '<div style="margin-top:8px;">' +
              '<a href="' + user.business_card_url + '" download="business-card.png" target="_blank" class="btn btn-sm btn-secondary" style="display:inline-flex; align-items:center; gap:4px; font-size:12px;">' +
                '<i class="fas fa-download"></i> Download Business Card' +
              '</a>' +
            '</div>' +
          '</div>';
      }

      // Custom links
      let customLinksHtml = '';
      if (user.custom_links && user.custom_links.length > 0) {
        customLinksHtml = '<div class="contact-card-section"><h4 style="font-size:12px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin:0 0 8px;">Links</h4><div style="display:flex; flex-wrap:wrap; gap:8px;">';
        user.custom_links.forEach(link => {
          customLinksHtml += '<a href="' + link.url + '" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="display:inline-flex; align-items:center; gap:4px; font-size:12px;">' +
            '<i class="fas fa-link"></i> ' + esc(link.label) +
          '</a>';
        });
        customLinksHtml += '</div></div>';
      }

      // QR Codes
      let qrHtml = '';
      const qrItems = [];
      if (user.qr_code_1_url) qrItems.push({ url: user.qr_code_1_url, label: user.qr_code_1_label || 'QR Code 1' });
      if (user.qr_code_2_url) qrItems.push({ url: user.qr_code_2_url, label: user.qr_code_2_label || 'QR Code 2' });
      if (qrItems.length > 0) {
        qrHtml = '<div class="contact-card-section"><h4 style="font-size:12px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin:0 0 8px;">QR Codes</h4><div style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap;">';
        qrItems.forEach(qr => {
          qrHtml +=
            '<div style="text-align:center;">' +
              '<img src="' + qr.url + '" alt="' + esc(qr.label) + '" style="width:120px; height:120px; object-fit:contain; border:1px solid #eee; border-radius:8px;" />' +
              '<p style="font-size:12px; color:#666; margin:6px 0 4px;">' + esc(qr.label) + '</p>' +
              '<a href="' + qr.url + '" download="' + esc(qr.label) + '.png" target="_blank" class="btn btn-sm btn-secondary" style="font-size:11px;"><i class="fas fa-download"></i> Download</a>' +
            '</div>';
        });
        qrHtml += '</div></div>';
      }

      // Email signature
      let sigHtml = '';
      if (user.email_signature) {
        sigHtml =
          '<div class="contact-card-section">' +
            '<h4 style="font-size:12px; color:#999; text-transform:uppercase; letter-spacing:.5px; margin:0 0 8px;">Email Signature</h4>' +
            '<div class="signature-preview">' + user.email_signature + '</div>' +
          '</div>';
      }

      content.innerHTML =
        '<button type="button" class="contacts-modal-close">&times;</button>' +
        '<div class="contact-card-header">' +
          (user.avatar_url
            ? '<img class="contact-card-avatar" src="' + user.avatar_url + '" alt="' + esc(user.name) + '" />'
            : '<div class="contact-card-avatar-initials">' + esc(initials) + '</div>') +
          '<h3 class="contact-card-name">' + esc(user.name) + '</h3>' +
          '<p class="contact-card-role">' + esc(user.role || '') + (user.team ? ' \u2022 ' + esc(user.team) : '') + '</p>' +
        '</div>' +
        infoHtml +
        socialHtml +
        customLinksHtml +
        businessCardHtml +
        qrHtml +
        sigHtml;

      // Re-bind close
      const newCloseBtn = content.querySelector('.contacts-modal-close');
      if (newCloseBtn) newCloseBtn.addEventListener('click', () => this.hideCompanyContactsModal());
    } catch (err) {
      content.innerHTML =
        '<button type="button" class="contacts-modal-close">&times;</button>' +
        '<div style="text-align:center; padding:40px; color:#e74c3c;"><i class="fas fa-exclamation-circle" style="font-size:24px; margin-bottom:8px; display:block;"></i><p>Could not load contact information.</p></div>';
      const errCloseBtn = content.querySelector('.contacts-modal-close');
      if (errCloseBtn) errCloseBtn.addEventListener('click', () => this.hideCompanyContactsModal());
    }
  },
};

window.Investors = Investors;
