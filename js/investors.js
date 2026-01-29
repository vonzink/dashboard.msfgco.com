/* ============================================
   MSFG Dashboard - Investors Module
   Investor information and modal management
   Step 4/5 compatible (dispatcher + a11y)
============================================ */

const Investors = {
  currentInvestorId: null,
  editMode: false,

  // INVESTOR DATA (still your same object — keep editing as you replace placeholders)
  data: {
    // ... KEEP YOUR EXISTING investor data object exactly as-is ...
    // (paste your current data block here unchanged)
  },

  init() {
    this.bindModalClose();
    this.bindCompanyContactsModalClose();
    this.bindGlobalEscapeClose(); // single ESC handler (no duplicates)
    console.log('Investors module initialized');
  },

  // -------------------------
  // Global ESC handler
  // -------------------------
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

  // -------------------------
  // Investor modal open/close
  // -------------------------
  bindModalClose() {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideModal();
    });

    // NOTE: No per-modal ESC here (global handler owns ESC)
    // NOTE: a11y.js handles ARIA + focus trapping when .active toggles
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

    // Name
    const nameEl = modal.querySelector('.investor-name');
    if (nameEl) nameEl.textContent = investor.name || 'Investor';

    // Logo
    const logoEl = modal.querySelector('.investor-logo');
    if (logoEl) {
      logoEl.src = investor.logo || '';
      logoEl.alt = investor.name ? `${investor.name} Logo` : 'Investor Logo';
    }

    if (!investor.notes) investor.notes = '';

    // Account Executive
    const aeSection = modal.querySelector('.account-executive');
    if (aeSection) {
      const ae = investor.accountExecutive || {};
      if (ae.name && ae.name !== 'TBD') {
        aeSection.innerHTML = `
          <h4>
            <i class="fas fa-user-tie"></i> Account Executive
            <button type="button" class="section-edit-btn" data-section="accountExecutive">
              <i class="fas fa-edit"></i>
            </button>
          </h4>
          <div class="contact-info editable-content">
            ${ae.name ? `<div contenteditable="true" data-field="name"><strong>${Utils.escapeHtml(ae.name)}</strong></div>` : ''}
            ${ae.mobile ? `<div contenteditable="true" data-field="mobile"><i class="fas fa-phone"></i> <a href="tel:${ae.mobile.replace(/\D/g, '')}">${Utils.escapeHtml(ae.mobile)}</a></div>` : ''}
            ${ae.email ? `<div contenteditable="true" data-field="email"><i class="fas fa-envelope"></i> <a href="mailto:${ae.email}">${Utils.escapeHtml(ae.email)}</a></div>` : ''}
            ${ae.address ? `<div contenteditable="true" data-field="address"><i class="fas fa-map-marker-alt"></i> ${Utils.escapeHtml(ae.address)}</div>` : ''}
          </div>
        `;
      } else {
        aeSection.innerHTML = `
          <h4>
            <i class="fas fa-user-tie"></i> Account Executive
            <button type="button" class="section-edit-btn" data-section="accountExecutive">
              <i class="fas fa-edit"></i>
            </button>
          </h4>
          <p class="tbd">Information coming soon</p>
        `;
      }
    }

    // Team
    const teamSection = modal.querySelector('.investor-team');
    if (teamSection) {
      if (Array.isArray(investor.team) && investor.team.length > 0) {
        let teamHtml = `
          <h4>
            <i class="fas fa-users"></i> Meet My Team:
            <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>
          </h4>
          <div class="team-list editable-content">
        `;

        investor.team.forEach((member) => {
          teamHtml += `<div class="team-member" contenteditable="true">`;
          if (member.role) teamHtml += `<strong>${Utils.escapeHtml(member.role)}</strong> / `;
          if (member.name) teamHtml += `${Utils.escapeHtml(member.name)}`;
          if (member.phone) teamHtml += ` / <a href="tel:${member.phone.replace(/\D/g, '')}">${Utils.escapeHtml(member.phone)}</a>`;
          if (member.email) teamHtml += ` / <a href="mailto:${member.email}">${Utils.escapeHtml(member.email)}</a>`;
          teamHtml += `</div>`;
        });

        teamHtml += `</div>`;
        teamSection.innerHTML = teamHtml;
      } else {
        teamSection.innerHTML = `
          <h4>
            <i class="fas fa-users"></i> Team
            <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>
          </h4>
          <p class="tbd">Information coming soon</p>
        `;
      }
    }

    // Lender IDs
    const lenderSection = modal.querySelector('.lender-ids');
    if (lenderSection) {
      const ids = investor.lenderIds || {};
      if (ids.fha || ids.va) {
        lenderSection.innerHTML = `
          <h4>
            <i class="fas fa-id-card"></i> Lender IDs
            <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>
          </h4>
          <div class="lender-ids-list editable-content">
            ${ids.fha ? `<div contenteditable="true" data-field="fha"><strong>FHA:</strong> ${Utils.escapeHtml(ids.fha)}</div>` : ''}
            ${ids.va ? `<div contenteditable="true" data-field="va"><strong>VA:</strong> ${Utils.escapeHtml(ids.va)}</div>` : ''}
          </div>
        `;
      } else {
        lenderSection.innerHTML = `
          <h4>
            <i class="fas fa-id-card"></i> Lender IDs
            <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>
          </h4>
          <p class="tbd">Information coming soon</p>
        `;
      }
    }

    // Mortgagee Clause
    const clauseSection = modal.querySelector('.mortgagee-clause');
    if (clauseSection) {
      const mc = investor.mortgageeClause || {};
      if (mc.name) {
        clauseSection.innerHTML = `
          <h4>
            <i class="fas fa-file-contract"></i> Mortgagee Clauses
            <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>
          </h4>
          <div class="clause-info editable-content">
            <div contenteditable="true" data-field="name"><strong>${Utils.escapeHtml(mc.name)}</strong></div>
            ${mc.isaoa ? `<div contenteditable="true" data-field="isaoa">${Utils.escapeHtml(mc.isaoa)}</div>` : ''}
            ${mc.address ? `<div contenteditable="true" data-field="address">${Utils.escapeHtml(mc.address)}</div>` : ''}
          </div>
        `;
      } else {
        clauseSection.innerHTML = `
          <h4>
            <i class="fas fa-file-contract"></i> Mortgagee Clauses
            <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>
          </h4>
          <p class="tbd">Information coming soon</p>
        `;
      }
    }

    // Links (add rel for target blank)
    const linksSection = modal.querySelector('.investor-links');
    if (linksSection) {
      const links = investor.links || {};
      let linksHtml = `
        <h4>
          <i class="fas fa-link"></i> Resources
          <button type="button" class="section-edit-btn" data-section="links"><i class="fas fa-edit"></i></button>
        </h4>
        <div class="links-list">
      `;

      if (investor.loginUrl && investor.loginUrl !== '#') {
        linksHtml += `<a href="${investor.loginUrl}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login</a>`;
      }

      if (links.website) linksHtml += `<a href="${links.website}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Main Website</a>`;
      if (links.flexSite) linksHtml += `<a href="${links.flexSite}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-laptop"></i> Flex Site</a>`;
      if (links.faq) linksHtml += `<a href="${links.faq}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-question-circle"></i> FAQs</a>`;
      if (links.appraisalVideo) linksHtml += `<a href="${links.appraisalVideo}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-video"></i> Ordering Appraisals</a>`;
      if (links.newScenarios) linksHtml += `<a href="${links.newScenarios}" class="link-item"><i class="fas fa-envelope"></i> New Scenarios</a>`;
      if (links.login && links.login !== investor.loginUrl) linksHtml += `<a href="${links.login}" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login Portal</a>`;

      linksHtml += `</div>`;
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

  // -------------------------
  // Settings/edit hooks (kept as you had them)
  // -------------------------
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
    const section = document.querySelector(`[data-section="${sectionName}"]`);
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
      if (Utils.setStorage) Utils.setStorage(`investor_notes_${this.currentInvestorId}`, notes);
    }
  },

  saveSection(sectionName) {
    console.log(`Saving section: ${sectionName}`);
    // TODO: wire to backend when ready
  },

  // -------------------------
  // Company Contacts modal
  // -------------------------
  bindCompanyContactsModalClose() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.contacts-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideCompanyContactsModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideCompanyContactsModal();
    });

    // NOTE: no per-modal ESC here (global handler owns ESC)
  },

  showCompanyContactsModal() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) {
      console.error('Company contacts modal element not found (id="companyContactsModal")');
      return;
    }

    // Hide investor modal if open
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
  }
};

window.Investors = Investors;
