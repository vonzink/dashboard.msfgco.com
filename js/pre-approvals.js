/* ============================================
   MSFG Dashboard - Pre-Approvals Module
   Data loading, rendering, CRUD modal, detail view, notes
============================================ */

const PreApprovals = {
  data: [],
  boards: [],
  groups: [],
  _filtersInitialized: false,
  _modalInitialized: false,

  COLUMNS: [
    { field: 'client_name', label: 'Client Name' },
    { field: 'loan_amount', label: 'Loan Amount' },
    { field: 'pre_approval_date', label: 'Pre-Approval Date' },
    { field: 'expiration_date', label: 'Expiration Date' },
    { field: 'status', label: 'Status' },
    { field: 'assigned_lo_name', label: 'Loan Officer' },
    { field: 'property_address', label: 'Property' },
    { field: 'loan_type', label: 'Loan Type' },
    { field: 'loan_number', label: 'Loan Number' },
    { field: 'lender', label: 'Lender' },
    { field: 'subject_property', label: 'Subject Property' },
    { field: 'loan_purpose', label: 'Loan Purpose' },
    { field: 'occupancy', label: 'Occupancy' },
    { field: 'rate', label: 'Rate' },
    { field: 'credit_score', label: 'Credit Score' },
    { field: 'income', label: 'Income' },
    { field: 'property_type', label: 'Property Type' },
    { field: 'purchase_price', label: 'Purchase Price' },
    { field: 'ltv', label: 'LTV' },
    { field: 'dti', label: 'DTI' },
    { field: 'lp_loan_number', label: 'LP Loan #' },
    { field: 'investor_loan_number', label: 'Loan # (Investor)' },
    { field: 'referring_agent', label: 'Referring Agent' },
    { field: 'referring_agent_email', label: 'Agent Email' },
    { field: 'referring_agent_phone', label: 'Agent Phone' },
    { field: 'contact_date', label: 'Contact Date' },
    { field: 'notes', label: 'Notes' },
  ],

  _columnsLoaded: false,

  DATE_FIELDS: ['pre_approval_date', 'expiration_date', 'contact_date', 'borrower_dob',
    'coborrower_dob', 'credit_report_date'],
  CURRENCY_FIELDS: ['loan_amount', 'income', 'purchase_price'],

  // ========================================
  // DATA LOADING
  // ========================================
  async load() {
    try {
      if (!this._columnsLoaded) {
        await this.loadConfig();
      }

      const boardSelect = document.getElementById('preApprovalBoardSelect');
      const groupSelect = document.getElementById('preApprovalGroupSelect');
      const params = new URLSearchParams();
      if (boardSelect?.value) params.set('board_id', boardSelect.value);
      if (groupSelect?.value) params.set('group', groupSelect.value);
      const qs = params.toString() ? '?' + params.toString() : '';

      const result = await ServerAPI.get('/pre-approvals' + qs);
      if (result && !Array.isArray(result)) {
        this.data = result.data || [];
        this.boards = result.boards || [];
        this.groups = result.groups || [];
      } else {
        this.data = Array.isArray(result) ? result : [];
      }
      this.render(this.data);
      this._populateFilters();
      this._initModal();
    } catch (err) {
      console.warn('Pre-approvals load failed:', err.message);
    }
  },

  async loadConfig() {
    try {
      const [config, prefs] = await Promise.all([
        ServerAPI.getMondayViewConfig('pre_approvals'),
        API._loadDisplayPrefs(),
      ]);
      let cols = (config.columns || []).filter(c => c.visible !== false);
      if (cols.length > 1) {
        this.COLUMNS = cols.map(c => ({ field: c.field, label: c.label }));
      }
      const userPref = prefs?.display_columns_pre_approvals;
      if (Array.isArray(userPref) && userPref.length > 0) {
        const prefMap = {};
        userPref.forEach(p => { prefMap[p.field] = p; });
        this.COLUMNS = this.COLUMNS
          .filter(c => prefMap[c.field] === undefined || prefMap[c.field].visible !== false)
          .sort((a, b) => {
            const orderA = prefMap[a.field]?.order ?? Infinity;
            const orderB = prefMap[b.field]?.order ?? Infinity;
            return orderA - orderB;
          });
      }
      this._columnsLoaded = true;
    } catch (e) {
      console.warn('Failed to load pre-approval view config, using defaults:', e.message || e);
    }
  },

  // ========================================
  // FILTERS
  // ========================================
  _getVisibleColumns() {
    const seen = new Set();
    return (this.COLUMNS || []).filter(c => {
      if (!c || !c.field || seen.has(c.field)) return false;
      seen.add(c.field);
      return true;
    });
  },

  _populateFilters() {
    const boardSelect = document.getElementById('preApprovalBoardSelect');
    const groupSelect = document.getElementById('preApprovalGroupSelect');
    const isLO = (CONFIG.currentUser?.activeRole || '').toLowerCase() === 'lo';

    if (boardSelect && this.boards.length > 0) {
      const currentVal = boardSelect.value;
      if (isLO && this.boards.length === 1) {
        boardSelect.innerHTML = this.boards.map(b =>
          `<option value="${Utils.escapeHtml(b.board_id)}">${Utils.escapeHtml(b.board_name || b.board_id)}</option>`
        ).join('');
        boardSelect.value = this.boards[0].board_id;
        boardSelect.style.display = '';
      } else {
        boardSelect.innerHTML = '<option value="">All Boards</option>' +
          this.boards.map(b =>
            `<option value="${Utils.escapeHtml(b.board_id)}">${Utils.escapeHtml(b.board_name || b.board_id)}</option>`
          ).join('');
        boardSelect.value = currentVal;
        boardSelect.style.display = '';
      }
      if (!this._filtersInitialized) {
        boardSelect.addEventListener('change', () => {
          const gs = document.getElementById('preApprovalGroupSelect');
          if (gs) gs.value = '';
          this.load();
        });
      }
    }

    if (groupSelect && this.groups.length > 0) {
      const currentVal = groupSelect.value;
      groupSelect.innerHTML = '<option value="">All Groups</option>' +
        this.groups.map(g =>
          `<option value="${Utils.escapeHtml(g)}">${Utils.escapeHtml(g)}</option>`
        ).join('');
      groupSelect.value = currentVal;
      groupSelect.style.display = '';
      if (!this._filtersInitialized) {
        groupSelect.addEventListener('change', () => this.load());
      }
    }

    this._filtersInitialized = true;
  },

  // ========================================
  // RENDERING
  // ========================================
  _statusBadgeClass(val) { return Utils.statusBadgeClass(val); },

  _renderCell(item, field) {
    const val = item[field];
    if (field === 'client_name') {
      return `<td><strong>${Utils.escapeHtml(val || '')}</strong></td>`;
    }
    if (field === 'status') {
      const cls = this._statusBadgeClass(val);
      return `<td><span class="pipeline-badge ${cls}">${Utils.escapeHtml(val || 'Unknown')}</span></td>`;
    }
    if (field === 'assigned_lo_name') {
      return `<td><div class="lo-cell"><span class="lo-avatar">${Utils.getInitials(val)}</span> ${Utils.escapeHtml(val || 'Unassigned')}</div></td>`;
    }
    if (field === 'notes' || field === 'next_steps' || field === 'special_request') {
      return `<td class="notes-cell" title="${Utils.escapeHtml(val || '')}">${Utils.escapeHtml(val || '')}</td>`;
    }
    if (this.CURRENCY_FIELDS.includes(field)) {
      return `<td class="currency">${val != null ? Utils.formatCurrency(val) : ''}</td>`;
    }
    if (this.DATE_FIELDS.includes(field)) {
      return `<td>${val ? Utils.formatDate(val) : ''}</td>`;
    }
    return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
  },

  render(data) {
    const tbody = document.getElementById('preApprovalsBody');
    if (!tbody) return;

    const cols = this._getVisibleColumns();

    const thead = document.getElementById('preApprovalsHead');
    if (thead) {
      thead.innerHTML = '<tr>' +
        cols.map(c => `<th class="sortable">${Utils.escapeHtml(c.label)}</th>`).join('') +
        '</tr>';
      thead.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', (e) => TableManager.handleSort(e));
      });
    }

    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}">
        <div class="empty-state-enhanced">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="25" width="55" height="70" rx="4" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <rect x="28" y="35" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.15"/>
            <rect x="28" y="43" width="38" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
            <rect x="28" y="51" width="25" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
            <rect x="28" y="59" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
            <circle cx="85" cy="70" r="25" stroke="var(--green-bright)" stroke-width="2" fill="none" opacity="0.35"/>
            <path d="M76 70 L82 76 L94 64" stroke="var(--green-bright)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
          </svg>
          <h4>No Pre-Approvals Yet</h4>
          <p>Sync from Monday.com to see your pre-approval pipeline.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="monday-sync"><i class="fas fa-sync-alt"></i> Sync Now</button>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(item =>
      `<tr data-id="${item.id}" class="pa-clickable-row">
        ${cols.map(c => this._renderCell(item, c.field)).join('')}
      </tr>`
    ).join('');

    tbody.querySelectorAll('.pa-clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        this._openDetail(parseInt(row.dataset.id));
      });
    });
  },

  // ========================================
  // CRUD MODAL
  // ========================================
  _initModal() {
    if (this._modalInitialized) return;
    this._modalInitialized = true;

    const modal = document.getElementById('preApprovalModal');
    if (!modal) return;

    modal.querySelectorAll('.pa-modal-close').forEach(btn => {
      btn.addEventListener('click', () => this._closeModal());
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this._closeModal();
    });

    const form = document.getElementById('preApprovalForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this._submit();
      });
    }

    const detailModal = document.getElementById('paDetailModal');
    if (detailModal) {
      detailModal.querySelectorAll('.pa-detail-close').forEach(btn => {
        btn.addEventListener('click', () => this._closeDetail());
      });
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) this._closeDetail();
      });
    }
  },

  openCreate() {
    this._initModal();
    const modal = document.getElementById('preApprovalModal');
    const title = document.getElementById('paModalTitle');
    const form = document.getElementById('preApprovalForm');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('paFormId').value = '';
    document.getElementById('paStatus').value = 'active';

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('paPreApprovalDate').value = today;
    const exp = new Date();
    exp.setDate(exp.getDate() + 90);
    document.getElementById('paExpirationDate').value = exp.toISOString().split('T')[0];

    if (title) title.innerHTML = '<i class="fas fa-clipboard-check" style="color:var(--green-bright);margin-right:0.5rem;"></i> New Pre-Approval';
    document.getElementById('paFormSubmit').innerHTML = '<i class="fas fa-save"></i> Create';

    modal.classList.add('active');
    document.getElementById('paClientName').focus();
  },

  openEdit(id) {
    this._initModal();
    const item = this.data?.find(pa => pa.id === id);
    if (!item) return;

    const modal = document.getElementById('preApprovalModal');
    const title = document.getElementById('paModalTitle');
    if (!modal) return;

    const toDateStr = (v) => {
      if (!v) return '';
      if (v instanceof Date) return v.toISOString().substring(0, 10);
      return String(v).substring(0, 10);
    };

    document.getElementById('paFormId').value = id;
    document.getElementById('paClientName').value = item.client_name || '';
    document.getElementById('paLoanAmount').value = item.loan_amount || '';
    document.getElementById('paPreApprovalDate').value = toDateStr(item.pre_approval_date);
    document.getElementById('paExpirationDate').value = toDateStr(item.expiration_date);
    document.getElementById('paStatus').value = item.status || 'active';
    document.getElementById('paLoanType').value = item.loan_type || '';
    document.getElementById('paLoanNumber').value = item.loan_number || '';
    document.getElementById('paLender').value = item.lender || '';
    document.getElementById('paLoanPurpose').value = item.loan_purpose || '';
    document.getElementById('paOccupancy').value = item.occupancy || '';
    document.getElementById('paPropertyType').value = item.property_type || '';
    document.getElementById('paRate').value = item.rate || '';
    document.getElementById('paPurchasePrice').value = item.purchase_price || '';
    document.getElementById('paLTV').value = item.ltv || '';
    document.getElementById('paDTI').value = item.dti || '';
    document.getElementById('paLPLoanNumber').value = item.lp_loan_number || '';
    document.getElementById('paInvestorLoanNumber').value = item.investor_loan_number || '';
    document.getElementById('paCreditScore').value = item.credit_score || '';
    document.getElementById('paIncome').value = item.income || '';
    document.getElementById('paReferringAgent').value = item.referring_agent || '';
    document.getElementById('paReferringAgentEmail').value = item.referring_agent_email || '';
    document.getElementById('paReferringAgentPhone').value = item.referring_agent_phone || '';
    document.getElementById('paContactDate').value = toDateStr(item.contact_date);
    document.getElementById('paSubjectProperty').value = item.subject_property || '';
    document.getElementById('paPropertyAddress').value = item.property_address || '';
    document.getElementById('paNotes').value = item.notes || '';

    if (title) title.innerHTML = '<i class="fas fa-pencil-alt" style="color:var(--green-bright);margin-right:0.5rem;"></i> Edit Pre-Approval';
    document.getElementById('paFormSubmit').innerHTML = '<i class="fas fa-save"></i> Update';

    modal.classList.add('active');
    document.getElementById('paClientName').focus();
  },

  _closeModal() {
    const modal = document.getElementById('preApprovalModal');
    if (modal) modal.classList.remove('active');
  },

  async _submit() {
    const submitBtn = document.getElementById('paFormSubmit');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const id = document.getElementById('paFormId').value;
      const creditScoreVal = document.getElementById('paCreditScore').value;
      const incomeVal = document.getElementById('paIncome').value;
      const purchasePriceVal = document.getElementById('paPurchasePrice').value;

      const data = {
        client_name: document.getElementById('paClientName').value.trim(),
        loan_amount: document.getElementById('paLoanAmount').value ? parseFloat(document.getElementById('paLoanAmount').value) : null,
        pre_approval_date: document.getElementById('paPreApprovalDate').value || null,
        expiration_date: document.getElementById('paExpirationDate').value || null,
        status: document.getElementById('paStatus').value,
        loan_type: document.getElementById('paLoanType').value.trim() || null,
        loan_number: document.getElementById('paLoanNumber').value.trim() || null,
        lender: document.getElementById('paLender').value.trim() || null,
        loan_purpose: document.getElementById('paLoanPurpose').value.trim() || null,
        occupancy: document.getElementById('paOccupancy').value.trim() || null,
        property_type: document.getElementById('paPropertyType').value.trim() || null,
        rate: document.getElementById('paRate').value.trim() || null,
        purchase_price: purchasePriceVal ? parseFloat(purchasePriceVal) : null,
        ltv: document.getElementById('paLTV').value.trim() || null,
        dti: document.getElementById('paDTI').value.trim() || null,
        lp_loan_number: document.getElementById('paLPLoanNumber').value.trim() || null,
        investor_loan_number: document.getElementById('paInvestorLoanNumber').value.trim() || null,
        credit_score: creditScoreVal ? parseInt(creditScoreVal, 10) : null,
        income: incomeVal ? parseFloat(incomeVal) : null,
        referring_agent: document.getElementById('paReferringAgent').value.trim() || null,
        referring_agent_email: document.getElementById('paReferringAgentEmail').value.trim() || null,
        referring_agent_phone: document.getElementById('paReferringAgentPhone').value.trim() || null,
        contact_date: document.getElementById('paContactDate').value || null,
        subject_property: document.getElementById('paSubjectProperty').value.trim() || null,
        property_address: document.getElementById('paPropertyAddress').value.trim() || null,
        notes: document.getElementById('paNotes').value.trim() || null,
      };

      if (id) {
        await ServerAPI.updatePreApproval(id, data);
      } else {
        await ServerAPI.createPreApproval(data);
      }

      this._closeModal();
      await this.load();
    } catch (err) {
      console.error('Pre-approval save error:', err);
      alert('Failed to save pre-approval: ' + (err.message || 'Unknown error'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
    }
  },

  async deleteItem(id) {
    const item = this.data?.find(pa => pa.id === id);
    const name = item?.client_name || 'this pre-approval';
    if (!confirm(`Delete "${name}"? This will also archive it on Monday.com.`)) return;
    try {
      await ServerAPI.deletePreApproval(id);
      await this.load();
    } catch (err) {
      console.error('Pre-approval delete error:', err);
      alert('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  },

  // ========================================
  // DETAIL VIEW
  // ========================================
  async _openDetail(id) {
    const item = this.data?.find(pa => pa.id === id);
    if (!item) return;

    const modal = document.getElementById('paDetailModal');
    if (!modal) return;

    const esc = Utils.escapeHtml;
    const fmtDate = (v) => v ? Utils.formatDate(v) : '--';
    const fmtCur = (v) => v != null ? Utils.formatCurrency(v) : '--';
    const statusCls = this._statusBadgeClass(item.status);

    const title = document.getElementById('paDetailTitle');
    if (title) title.innerHTML = '<i class="fas fa-clipboard-check" style="color:var(--green-bright);margin-right:0.5rem;"></i> ' + esc(item.client_name || 'Pre-Approval');

    const body = document.getElementById('paDetailBody');
    const detailRow = (label, value) => value && value !== '--'
      ? `<div class="pa-detail-row"><span class="pa-detail-label">${esc(label)}</span><span class="pa-detail-value">${value}</span></div>`
      : '';

    body.innerHTML = `
      <div class="pa-detail-grid">
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-user"></i> Client Info</h3>
          ${detailRow('Client Name', esc(item.client_name || '--'))}
          ${detailRow('Status', `<span class="pipeline-badge ${statusCls}">${esc(item.status || 'Unknown')}</span>`)}
          ${detailRow('Loan Officer', esc(item.assigned_lo_name || '--'))}
          ${detailRow('Contact Date', fmtDate(item.contact_date))}
          ${detailRow('Borrower Email', esc(item.borrower_email || ''))}
          ${detailRow('Borrower Phone', esc(item.borrower_phone || ''))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-dollar-sign"></i> Loan Details</h3>
          ${detailRow('Loan Amount', fmtCur(item.loan_amount))}
          ${detailRow('Purchase Price', fmtCur(item.purchase_price))}
          ${detailRow('Pre-Approval Date', fmtDate(item.pre_approval_date))}
          ${detailRow('Expiration Date', fmtDate(item.expiration_date))}
          ${detailRow('Loan Type', esc(item.loan_type || ''))}
          <div class="pa-detail-row"><span class="pa-detail-label">${esc('LP Loan #')}</span><span class="pa-detail-value">${esc(item.lp_loan_number || '--')}</span></div>
          ${detailRow('Loan # (Investor)', esc(item.investor_loan_number || ''))}
          ${detailRow('Loan Number', esc(item.loan_number || ''))}
          ${detailRow('Lender', esc(item.lender || ''))}
          ${detailRow('Loan Purpose', esc(item.loan_purpose || ''))}
          ${detailRow('Occupancy', esc(item.occupancy || ''))}
          ${detailRow('Rate', esc(item.rate || ''))}
          ${detailRow('LTV', esc(item.ltv || ''))}
          ${detailRow('DTI', esc(item.dti || ''))}
          ${detailRow('Credit Score', item.credit_score ? String(item.credit_score) : '')}
          ${detailRow('Income', fmtCur(item.income))}
          ${detailRow('Property Type', esc(item.property_type || ''))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-user-tie"></i> Referring Agent</h3>
          ${detailRow('Agent Name', esc(item.referring_agent || '--'))}
          ${detailRow('Agent Email', item.referring_agent_email ? `<a href="mailto:${esc(item.referring_agent_email)}">${esc(item.referring_agent_email)}</a>` : '')}
          ${detailRow('Agent Phone', item.referring_agent_phone ? `<a href="tel:${esc(item.referring_agent_phone)}">${esc(item.referring_agent_phone)}</a>` : '')}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-map-marker-alt"></i> Property</h3>
          ${detailRow('Subject Property', esc(item.subject_property || ''))}
          ${detailRow('Property Address', esc(item.property_address || ''))}
        </div>
      </div>
      ${item.notes ? `<div class="pa-detail-section full-width"><h3 class="pa-detail-section-title"><i class="fas fa-sticky-note"></i> Monday Notes</h3><div class="pa-detail-monday-notes">${esc(item.notes)}</div></div>` : ''}
      <div class="pa-detail-section full-width">
        <h3 class="pa-detail-section-title"><i class="fas fa-comments"></i> Notes</h3>
        <div class="pa-notes-add">
          <textarea id="paNewNoteInput" rows="2" placeholder="Add a note..." class="form-input"></textarea>
          <button type="button" class="btn btn-primary btn-sm" id="paAddNoteBtn"><i class="fas fa-plus"></i> Add Note</button>
        </div>
        <div id="paNotesContainer" class="pa-notes-list">
          <div style="text-align:center;padding:1rem;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Loading notes...</div>
        </div>
      </div>
      <div class="pa-detail-actions">
        <button type="button" class="btn btn-secondary" onclick="PreApprovals._closeDetail(); PreApprovals.openEdit(${item.id});"><i class="fas fa-pencil-alt"></i> Edit</button>
        <button type="button" class="btn btn-danger" onclick="PreApprovals._closeDetail(); PreApprovals.deleteItem(${item.id});"><i class="fas fa-trash-alt"></i> Delete</button>
      </div>`;

    modal.classList.add('active');

    document.getElementById('paAddNoteBtn')?.addEventListener('click', () => this._addNote(id));
    document.getElementById('paNewNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._addNote(id);
    });
    this._loadNotes(id);
  },

  _closeDetail() {
    const modal = document.getElementById('paDetailModal');
    if (modal) modal.classList.remove('active');
  },

  // ========================================
  // NOTES
  // ========================================
  async _loadNotes(paId) {
    const container = document.getElementById('paNotesContainer');
    if (!container) return;

    try {
      const notes = await ServerAPI.getPreApprovalNotes(paId);
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

        return `<div class="pa-note" data-note-id="${note.id}" data-pa-id="${paId}">
          <div class="pa-note-header">
            <span class="pa-note-author"><i class="fas fa-user-circle"></i> ${esc(note.author_name || 'Unknown')}</span>
            <span class="pa-note-time">${esc(timeStr)}${edited ? ' (edited)' : ''}</span>
            ${canEdit ? `<div class="pa-note-actions">
              <button type="button" class="pa-note-edit-btn" title="Edit"><i class="fas fa-pencil-alt"></i></button>
              <button type="button" class="pa-note-delete-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>
            </div>` : ''}
          </div>
          <div class="pa-note-content">${esc(note.content)}</div>
        </div>`;
      }).join('');

      container.querySelectorAll('.pa-note-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const noteEl = btn.closest('.pa-note');
          this._editNote(parseInt(noteEl.dataset.paId), parseInt(noteEl.dataset.noteId));
        });
      });
      container.querySelectorAll('.pa-note-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const noteEl = btn.closest('.pa-note');
          this._deleteNote(parseInt(noteEl.dataset.paId), parseInt(noteEl.dataset.noteId));
        });
      });
    } catch (err) {
      console.error('Failed to load notes:', err);
      container.innerHTML = '<div class="pa-notes-empty" style="color:#e74c3c;">Failed to load notes.</div>';
    }
  },

  async _addNote(paId) {
    const input = document.getElementById('paNewNoteInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;
    try {
      await ServerAPI.addPreApprovalNote(paId, content);
      input.value = '';
      this._loadNotes(paId);
    } catch (err) {
      alert('Failed to add note: ' + (err.message || 'Unknown error'));
    }
  },

  async _editNote(paId, noteId) {
    const noteEl = document.querySelector(`.pa-note[data-note-id="${noteId}"]`);
    if (!noteEl) return;
    const contentEl = noteEl.querySelector('.pa-note-content');
    const currentContent = contentEl.textContent;

    contentEl.innerHTML = `<textarea class="form-input pa-note-edit-input" rows="2">${Utils.escapeHtml(currentContent)}</textarea>
      <div class="pa-note-edit-actions">
        <button type="button" class="btn btn-primary btn-sm pa-note-save-btn"><i class="fas fa-check"></i> Save</button>
        <button type="button" class="btn btn-secondary btn-sm pa-note-cancel-btn">Cancel</button>
      </div>`;

    const textarea = contentEl.querySelector('textarea');
    textarea.focus();

    contentEl.querySelector('.pa-note-save-btn').addEventListener('click', async () => {
      const newContent = textarea.value.trim();
      if (!newContent) return;
      try {
        await ServerAPI.updatePreApprovalNote(paId, noteId, newContent);
        this._loadNotes(paId);
      } catch (err) {
        alert('Failed to update note: ' + (err.message || 'Unknown error'));
      }
    });

    contentEl.querySelector('.pa-note-cancel-btn').addEventListener('click', () => {
      this._loadNotes(paId);
    });
  },

  async _deleteNote(paId, noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await ServerAPI.deletePreApprovalNote(paId, noteId);
      this._loadNotes(paId);
    } catch (err) {
      alert('Failed to delete note: ' + (err.message || 'Unknown error'));
    }
  },
};

window.PreApprovals = PreApprovals;
