/* ============================================
   MSFG Dashboard - Investors Module
   Investor information, modal (read-only except notes),
   and dropdown management
============================================ */

const Investors = {
  currentInvestorId: null,

  // =========================================================
  // INVESTOR DATA — loaded from API at runtime
  // Keys match the data-investor="" attributes (investor_key column).
  // =========================================================
  data: {},
  _loaded: false,

  init() {
    this.bindModalClose();
    this.bindCompanyContactsModalClose();
    this.bindGlobalEscapeClose();
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
  _esc(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  },

  // =========================================================
  // Global ESC handler
  // =========================================================
  bindGlobalEscapeClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

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

  /** Show investor modal — fetches full detail from API */
  async showModal(investorId) {
    const basicInvestor = this.data[investorId];
    if (!basicInvestor) {
      console.warn('Investor not found:', investorId);
      return;
    }

    const modal = document.getElementById('investorModal');
    if (!modal) {
      console.error('Investor modal element not found (id="investorModal")');
      return;
    }

    this.currentInvestorId = investorId;

    // Show modal with basic data first (fast)
    this.populateModal(basicInvestor);
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
        this.bindNotesEditing();
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

    const esc = this._esc;

    // Name
    const nameEl = modal.querySelector('.investor-name');
    if (nameEl) nameEl.textContent = investor.name || 'Investor';

    // Logo
    const logoEl = modal.querySelector('.investor-logo');
    if (logoEl) {
      const logoSrc = investor.logoUrl || investor.logo_url || '';
      logoEl.src = logoSrc;
      logoEl.alt = investor.name ? investor.name + ' Logo' : 'Investor Logo';
      logoEl.style.display = logoSrc ? '' : 'none';
    }

    // Account Executive (read-only)
    const aeSection = modal.querySelector('.account-executive');
    if (aeSection) {
      const ae = investor.accountExecutive || {};
      // Also check flat API response fields
      const aeName = ae.name || investor.account_executive_name;
      const aeEmail = ae.email || investor.account_executive_email;
      const aePhone = ae.mobile || investor.account_executive_phone;

      if (aeName && aeName !== 'TBD') {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive</h4>' +
          '<div class="contact-info">' +
            (aeName ? '<div><strong>' + esc(aeName) + '</strong></div>' : '') +
            (aePhone ? '<div><i class="fas fa-phone"></i> <a href="tel:' + aePhone.replace(/\D/g, '') + '">' + esc(aePhone) + '</a></div>' : '') +
            (aeEmail ? '<div><i class="fas fa-envelope"></i> <a href="mailto:' + aeEmail + '">' + esc(aeEmail) + '</a></div>' : '') +
          '</div>';
      } else {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive</h4>' +
          '<p class="tbd">Information coming soon</p>';
      }
    }

    // Investor details grid (read-only)
    const detailsSection = modal.querySelector('.investor-details');
    if (detailsSection) {
      let html = '<h4><i class="fas fa-info-circle"></i> Investor Details</h4><div class="details-grid">';
      const details = [
        { label: 'States',                    value: investor.states },
        { label: 'Best Programs',             value: investor.bestPrograms || investor.best_programs },
        { label: 'Minimum FICO',              value: investor.minimumFico || investor.min_fico },
        { label: 'In-house DPA',              value: investor.inHouseDpa || investor.in_house_dpa },
        { label: 'EPO',                       value: investor.epo },
        { label: 'Max Comp',                  value: (investor.maxComp || investor.max_comp) ? '$' + Number(investor.maxComp || investor.max_comp).toLocaleString() : null },
        { label: 'Doc Review for Wire Release', value: investor.docReviewForWireRelease || investor.doc_review_for_wire_release },
        { label: 'Remote Closing Review',     value: investor.remoteClosingReview || investor.remote_closing_review }
      ];
      details.forEach(d => {
        html += '<div class="detail-row">' +
          '<span class="detail-label">' + esc(d.label) + '</span>' +
          '<span class="detail-value">' + (d.value ? esc(String(d.value)) : '<em class="tbd">\u2014</em>') + '</span>' +
        '</div>';
      });
      html += '</div>';
      detailsSection.innerHTML = html;
    }

    // Team (read-only)
    const teamSection = modal.querySelector('.investor-team');
    if (teamSection) {
      const team = investor.team || [];
      if (team.length > 0) {
        let teamHtml = '<h4><i class="fas fa-users"></i> Team</h4><div class="team-list">';
        team.forEach(member => {
          teamHtml += '<div class="team-member">';
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
          '<h4><i class="fas fa-users"></i> Team</h4>' +
          '<p class="tbd">No team members listed</p>';
      }
    }

    // Lender IDs (read-only)
    const lenderSection = modal.querySelector('.lender-ids');
    if (lenderSection) {
      const ids = investor.lenderIds || {};
      if (ids.fha_id || ids.va_id || ids.fha || ids.va) {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs</h4>' +
          '<div class="lender-ids-list">' +
            ((ids.fha_id || ids.fha) ? '<div><strong>FHA:</strong> ' + esc(ids.fha_id || ids.fha) + '</div>' : '') +
            ((ids.va_id || ids.va) ? '<div><strong>VA:</strong> ' + esc(ids.va_id || ids.va) + '</div>' : '') +
          '</div>';
      } else {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs</h4>' +
          '<p class="tbd">No lender IDs on file</p>';
      }
    }

    // Mortgagee Clauses (read-only — now supports array)
    const clauseSection = modal.querySelector('.mortgagee-clause');
    if (clauseSection) {
      const clauses = investor.mortgageeClauses || [];
      // Legacy single-object format fallback
      const mc = investor.mortgageeClause || {};
      if (clauses.length > 0) {
        let html = '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses</h4><div class="clause-info">';
        clauses.forEach(c => {
          html += '<div class="clause-item" style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">';
          html += '<div><strong>' + esc(c.name) + '</strong></div>';
          if (c.isaoa) html += '<div>' + esc(c.isaoa) + '</div>';
          if (c.address) html += '<div style="color:#666;">' + esc(c.address) + '</div>';
          html += '</div>';
        });
        html += '</div>';
        clauseSection.innerHTML = html;
      } else if (mc.name) {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses</h4>' +
          '<div class="clause-info">' +
            '<div><strong>' + esc(mc.name) + '</strong></div>' +
            (mc.isaoa ? '<div>' + esc(mc.isaoa) + '</div>' : '') +
            (mc.address ? '<div style="color:#666;">' + esc(mc.address) + '</div>' : '') +
          '</div>';
      } else {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses</h4>' +
          '<p class="tbd">No mortgagee clauses on file</p>';
      }
    }

    // Links (read-only)
    const linksSection = modal.querySelector('.investor-links');
    if (linksSection) {
      const links = investor.links || [];
      const websiteUrl = investor.websiteUrl || investor.website_url;
      let linksHtml = '<h4><i class="fas fa-link"></i> Resources</h4><div class="links-list">';

      // Legacy top-level websiteUrl
      if (websiteUrl && websiteUrl !== '#') {
        linksHtml += '<a href="' + websiteUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Website</a>';
      }

      // Links from sub-table (array format from full detail)
      if (Array.isArray(links)) {
        const LINK_ICONS = {
          website: 'fas fa-globe', login: 'fas fa-sign-in-alt', flex_site: 'fas fa-laptop',
          faq: 'fas fa-question-circle', appraisal_video: 'fas fa-video', new_scenarios: 'fas fa-envelope'
        };
        const LINK_LABELS = {
          website: 'Website', login: 'Login Portal', flex_site: 'Flex Site',
          faq: 'FAQs', appraisal_video: 'Ordering Appraisals', new_scenarios: 'New Scenarios'
        };
        links.forEach(link => {
          if (!link.url) return;
          const icon = LINK_ICONS[link.link_type] || 'fas fa-external-link-alt';
          const label = link.label || LINK_LABELS[link.link_type] || link.link_type;
          const isEmail = link.url.startsWith('mailto:');
          linksHtml += '<a href="' + link.url + '"' + (isEmail ? '' : ' target="_blank" rel="noopener noreferrer"') + ' class="link-item"><i class="' + icon + '"></i> ' + esc(label) + '</a>';
        });
      } else if (typeof links === 'object') {
        // Legacy object format fallback
        if (links.website) linksHtml += '<a href="' + links.website + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Main Website</a>';
        if (links.flexSite) linksHtml += '<a href="' + links.flexSite + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-laptop"></i> Flex Site</a>';
        if (links.faq) linksHtml += '<a href="' + links.faq + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-question-circle"></i> FAQs</a>';
        if (links.appraisalVideo) linksHtml += '<a href="' + links.appraisalVideo + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-video"></i> Ordering Appraisals</a>';
        if (links.newScenarios) linksHtml += '<a href="' + links.newScenarios + '" class="link-item"><i class="fas fa-envelope"></i> New Scenarios</a>';
        if (links.login) linksHtml += '<a href="' + links.login + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login Portal</a>';
      }

      linksHtml += '</div>';
      linksSection.innerHTML = linksHtml;
    }

    // Notes (editable)
    const notesSection = modal.querySelector('.investor-notes .notes-content');
    if (notesSection) {
      notesSection.textContent = investor.notes || '';
      if (!investor.notes) notesSection.classList.add('empty');
      else notesSection.classList.remove('empty');
    }
  },

  /** Bind notes editing — save on blur */
  bindNotesEditing() {
    const notesContent = document.querySelector('#investorModal .notes-content');
    if (!notesContent || notesContent._notesBound) return;
    notesContent._notesBound = true;

    notesContent.addEventListener('blur', () => this.saveNotes());
    notesContent.addEventListener('input', () => notesContent.classList.remove('empty'));
    notesContent.addEventListener('focus', (e) => {
      if (e.target.classList.contains('empty')) {
        e.target.textContent = '';
        e.target.classList.remove('empty');
      }
    });
  },

  async saveNotes() {
    if (!this.currentInvestorId) return;

    const notesContent = document.querySelector('#investorModal .notes-content');
    if (!notesContent) return;

    const notes = notesContent.textContent.trim();

    try {
      await ServerAPI.updateInvestor(this.currentInvestorId, { notes });

      if (this.data[this.currentInvestorId]) {
        this.data[this.currentInvestorId].notes = notes;
      }
    } catch (error) {
      console.error('Failed to save notes:', error);
    }
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

    const esc = this._esc;

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
      infoHtml += '</div>';

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

  // =========================================================
  // Investor dropdown in nav
  // =========================================================
  _refreshDropdown() {
    const container = document.getElementById('investorDropdownList');
    if (!container) return;

    const esc = this._esc;

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
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
  }
};

window.Investors = Investors;
