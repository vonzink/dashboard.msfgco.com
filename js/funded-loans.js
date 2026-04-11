/* ============================================
   MSFG Dashboard - Funded Loans Module
   Displays funded loans table with board, group, and timeframe filters
   ============================================ */

const FundedLoans = {
  // ========================================
  // STATE
  // ========================================
  _period: 'monthly',
  _boardFilter: '',
  _groupFilter: '',
  _data: [],
  _summary: { count: 0, total_amount: 0 },
  _availableGroups: [],
  _availableBoards: [],
  _columnsLoaded: false,

  // ========================================
  // INITIALIZATION
  // ========================================
  async init() {
    this._bindEvents();
    await this._loadColumnConfig();
    this.load();
  },

  /** Load column config from Monday view-config endpoint */
  async _loadColumnConfig() {
    try {
      const [config, prefs] = await Promise.all([
        ServerAPI.getMondayViewConfig('funded_loans'),
        API._loadDisplayPrefs(),
      ]);
      let cols = (config.columns || []).filter(c => c.visible !== false);
      // Only use server config if it has more than just client_name
      if (cols.length > 1) {
        this.COLUMNS = cols.map(c => ({ field: c.field, label: c.label }));
      }
      // Apply user display preferences (hide unchecked columns + reorder)
      const userPref = prefs?.display_columns_funded_loans;
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
      console.warn('Failed to load funded loans view config, using defaults:', e.message || e);
    }
  },

  _bindEvents() {
    // Period select — restore saved preference
    const periodSelect = document.getElementById('fundedPeriodSelect');
    if (periodSelect) {
      const validValues = Array.from(periodSelect.options).map(o => o.value);
      let savedPeriod = Utils.getStorage('funded_period', 'monthly');
      if (!validValues.includes(savedPeriod)) savedPeriod = 'monthly';
      periodSelect.value = savedPeriod;
      // Verify the assignment took (some browsers ignore if option list changes)
      if (periodSelect.value !== savedPeriod) {
        const opt = Array.from(periodSelect.options).find(o => o.value === savedPeriod);
        if (opt) opt.selected = true;
      }
      this._period = periodSelect.value;

      periodSelect.addEventListener('change', () => {
        this._period = periodSelect.value;
        Utils.setStorage('funded_period', periodSelect.value);
        this.load();
      });
    }

    // Board filter — changing board reloads data (groups may change per board)
    const boardSelect = document.getElementById('fundedBoardSelect');
    if (boardSelect) {
      boardSelect.addEventListener('change', () => {
        this._boardFilter = boardSelect.value;
        // Reset group filter when board changes
        this._groupFilter = '';
        const groupSelect = document.getElementById('fundedGroupSelect');
        if (groupSelect) groupSelect.value = '';
        this.load();
      });
    }

    // Group filter
    const groupSelect = document.getElementById('fundedGroupSelect');
    if (groupSelect) {
      groupSelect.addEventListener('change', () => {
        this._groupFilter = groupSelect.value;
        this.load();
      });
    }
  },

  // ========================================
  // DATA LOADING
  // ========================================
  async load() {
    const tbody = document.getElementById('fundedLoansBody');

    // Show loading
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="' + this._getVisibleColumns().length + '" class="empty-state">' +
        '<i class="fas fa-spinner fa-spin"></i>' +
        '<p>Loading funded loans...</p>' +
        '</td></tr>';
    }

    try {
      const params = { period: this._period };
      if (this._boardFilter) params.board_id = this._boardFilter;
      if (this._groupFilter) params.group = this._groupFilter;

      const result = await ServerAPI.getFundedLoans(params);

      if (!result) return; // 401 handled by ServerAPI

      this._data = result.data || [];
      this._summary = result.summary || { count: 0, total_amount: 0 };
      this._availableGroups = result.groups || [];
      this._availableBoards = result.boards || [];

      this._renderTable();
      this._renderSummary();
      this._renderGroupFilter();
      this._renderBoardFilter();

      // GoalsManager now fetches its own data via _fetchAllGoalData()
    } catch (err) {
      console.error('Funded loans load error:', err);
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="' + this._getVisibleColumns().length + '" class="empty-state">' +
          '<i class="fas fa-exclamation-triangle"></i>' +
          '<p>Failed to load funded loans.</p>' +
          '</td></tr>';
      }
    }
  },

  // ========================================
  // COLUMN DEFINITIONS
  // ========================================
  COLUMNS: [
    { field: 'client_name', label: 'Borrower' },
    { field: 'loan_amount', label: 'Loan Amount' },
    { field: 'assigned_lo_name', label: 'Loan Officer' },
    { field: 'group_name', label: 'Group' },
    { field: 'loan_type', label: 'Product' },
    { field: 'funded_date', label: 'Funded Date' },
  ],

  _getVisibleColumns() {
    // Preferences are applied during _loadColumnConfig; just return COLUMNS
    return this.COLUMNS;
  },

  // Fields that should be formatted as currency
  CURRENCY_FIELDS: ['loan_amount', 'purchase_price', 'appraised_value', 'hazard_insurance_amount',
    'mortgage_payment', 'seller_comp', 'mortgage_insurance', 'broker_fee'],
  // Fields that should be formatted as dates
  DATE_FIELDS: ['funded_date', 'closing_date', 'first_payment_date', 'borrower_dob',
    'coborrower_dob', 'application_date'],
  // Fields that should get status badges
  STATUS_FIELDS: ['status', 'loan_status', 'stage'],

  _statusBadgeClass(val) { return Utils.statusBadgeClass(val); },

  _renderCell(loan, field) {
    const val = loan[field];
    // Special rendering per field type
    if (field === 'client_name') {
      return '<td><strong>' + Utils.escapeHtml(loan.client_name || loan.borrower_name || loan.borrower || '--') + '</strong></td>';
    }
    if (field === 'assigned_lo_name') {
      const name = loan.lo_name || loan.assigned_lo_name || '';
      return '<td><div class="lo-cell"><span class="lo-avatar">' + Utils.getInitials(name) + '</span> ' + Utils.escapeHtml(name || 'Unassigned') + '</div></td>';
    }
    if (field === 'loan_type') {
      return '<td>' + Utils.escapeHtml(loan.loan_type || loan.product_type || '--') + '</td>';
    }
    if (field === 'notes') {
      return '<td class="notes-cell" title="' + Utils.escapeHtml(loan.notes || '') + '">' + Utils.escapeHtml(loan.notes || '--') + '</td>';
    }
    if (this.STATUS_FIELDS.includes(field) && val) {
      var cls = this._statusBadgeClass(val);
      return '<td><span class="pipeline-badge ' + cls + '">' + Utils.escapeHtml(val) + '</span></td>';
    }
    if (this.CURRENCY_FIELDS.includes(field)) {
      return '<td class="currency">' + (val ? Utils.formatCurrency(val) : '--') + '</td>';
    }
    if (this.DATE_FIELDS.includes(field)) {
      return '<td>' + (val ? Utils.formatDate(val, 'short') : '--') + '</td>';
    }
    return '<td>' + Utils.escapeHtml(val != null ? String(val) : '--') + '</td>';
  },

  // ========================================
  // RENDERING
  // ========================================
  _renderTable() {
    const tbody = document.getElementById('fundedLoansBody');
    if (!tbody) return;

    const cols = this._getVisibleColumns();

    // Update thead
    const thead = document.getElementById('fundedLoansHead');
    if (thead) {
      thead.innerHTML = '<tr>' +
        cols.map(c => '<th>' + Utils.escapeHtml(c.label) + '</th>').join('') +
        '</tr>';
    }

    if (this._data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="' + cols.length + '">' +
        '<div class="empty-state-enhanced">' +
          '<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M35 85 L60 40 L85 85 Z" stroke="currentColor" stroke-width="2" fill="none" opacity="0.2"/>' +
            '<rect x="52" y="50" width="16" height="25" rx="2" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>' +
            '<rect x="56" y="60" width="3" height="6" rx="1" fill="currentColor" opacity="0.15"/>' +
            '<rect x="61" y="60" width="3" height="6" rx="1" fill="currentColor" opacity="0.15"/>' +
            '<rect x="25" y="85" width="70" height="6" rx="3" fill="currentColor" opacity="0.1"/>' +
            '<circle cx="90" cy="35" r="16" stroke="var(--green-bright)" stroke-width="2" fill="none" opacity="0.35"/>' +
            '<text x="90" y="40" text-anchor="middle" fill="var(--green-bright)" font-size="16" font-weight="bold" opacity="0.5">$</text>' +
          '</svg>' +
          '<h4>No Funded Loans This Period</h4>' +
          '<p>Funded loans will appear here as they close and sync.</p>' +
        '</div>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = this._data.map(loan =>
      '<tr data-id="' + loan.id + '" class="pa-clickable-row">' + cols.map(c => this._renderCell(loan, c.field)).join('') + '</tr>'
    ).join('');

    // Bind row click → open detail view
    tbody.querySelectorAll('.pa-clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        var id = parseInt(row.dataset.id);
        this._openDetail(id);
      });
    });
  },

  _renderSummary() {
    const countEl = document.getElementById('fundedTotalUnits');
    const amountEl = document.getElementById('fundedTotalAmount');

    if (countEl) countEl.textContent = Utils.formatNumber(this._summary.count);
    if (amountEl) amountEl.textContent = Utils.formatCurrency(this._summary.total_amount);
  },

  _renderGroupFilter() {
    const groupSelect = document.getElementById('fundedGroupSelect');
    if (!groupSelect) return;

    // Show filter if there are groups
    if (this._availableGroups.length > 0) {
      groupSelect.style.display = '';
    }

    // Preserve current selection
    const current = groupSelect.value;

    // Rebuild options
    groupSelect.innerHTML = '<option value="">All Groups</option>';
    this._availableGroups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === current) opt.selected = true;
      groupSelect.appendChild(opt);
    });
  },

  _renderBoardFilter() {
    const boardSelect = document.getElementById('fundedBoardSelect');
    if (!boardSelect) return;

    const role = (CONFIG.currentUser?.activeRole || '').toLowerCase();
    const isLO = role === 'lo';

    // Show board filter only if there are boards to choose from
    // For LOs with a single board, hide the dropdown (they only have one board)
    if (this._availableBoards.length > 1) {
      boardSelect.style.display = '';
    } else if (isLO && this._availableBoards.length === 1) {
      // Auto-select the single board and hide dropdown
      this._boardFilter = this._availableBoards[0].board_id;
      boardSelect.style.display = 'none';
    } else if (this._availableBoards.length > 0) {
      boardSelect.style.display = '';
    }

    const current = boardSelect.value;
    boardSelect.innerHTML = '<option value="">All Boards</option>';
    this._availableBoards.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.board_id;
      opt.textContent = b.board_name || b.board_id;
      if (b.board_id === current) opt.selected = true;
      boardSelect.appendChild(opt);
    });
  },

  /**
   * Get the current summary data (used by GoalsManager to pull data on period change)
   */
  getSummary() {
    return { ...this._summary };
  },

  getPeriod() {
    return this._period;
  },

  // ========================================
  // FUNDED LOAN DETAIL VIEW
  // ========================================
  _detailInit: false,

  _initDetail() {
    if (this._detailInit) return;
    this._detailInit = true;

    var modal = document.getElementById('fundedDetailModal');
    if (modal) {
      var self = this;
      modal.querySelectorAll('.funded-detail-close').forEach(function(btn) {
        btn.addEventListener('click', function() { self._closeDetail(); });
      });
      modal.addEventListener('click', function(e) {
        if (e.target === modal) self._closeDetail();
      });
    }
  },

  _openDetail(id) {
    this._initDetail();
    var item = this._data.find(function(l) { return l.id === id; });
    if (!item) return;

    var modal = document.getElementById('fundedDetailModal');
    if (!modal) return;

    var esc = Utils.escapeHtml;
    var fmtDate = function(v) { return v ? Utils.formatDate(v) : '--'; };
    var fmtCur = function(v) { return v != null && v !== '' ? Utils.formatCurrency(v) : '--'; };
    var statusCls = this._statusBadgeClass;

    var title = document.getElementById('fundedDetailTitle');
    if (title) title.innerHTML = '<i class="fas fa-hand-holding-usd" style="color:var(--green-bright);margin-right:0.5rem;"></i> ' + esc(item.client_name || item.borrower_name || 'Funded Loan');

    var body = document.getElementById('fundedDetailBody');
    var detailRow = function(label, value) {
      return value && value !== '--'
        ? '<div class="pa-detail-row"><span class="pa-detail-label">' + esc(label) + '</span><span class="pa-detail-value">' + value + '</span></div>'
        : '';
    };

    var loName = item.lo_name || item.assigned_lo_name || '';

    body.innerHTML =
      '<div class="pa-detail-grid">' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-user"></i> Borrower Info</h3>' +
          detailRow('Borrower', esc(item.client_name || item.borrower_name || '--')) +
          detailRow('Loan Officer', esc(loName || '--')) +
          detailRow('Group', esc(item.group_name || '')) +
          detailRow('Board', esc(item.source_board_name || '')) +
          detailRow('Borrower Email', esc(item.borrower_email || '')) +
          detailRow('Borrower Phone', esc(item.borrower_phone || '')) +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-dollar-sign"></i> Loan Details</h3>' +
          detailRow('Loan Amount', fmtCur(item.loan_amount)) +
          detailRow('Loan Type', esc(item.loan_type || item.product_type || '')) +
          detailRow('Loan Number', esc(item.loan_number || '')) +
          detailRow('Lender', esc(item.lender || '')) +
          detailRow('Rate', esc(item.rate || '')) +
          detailRow('Occupancy', esc(item.occupancy || '')) +
          detailRow('Loan Purpose', esc(item.loan_purpose || '')) +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-map-marker-alt"></i> Property</h3>' +
          detailRow('Subject Property', esc(item.subject_property || '')) +
          detailRow('Property Type', esc(item.property_type || '')) +
          detailRow('Purchase Price', fmtCur(item.purchase_price)) +
          detailRow('Appraised Value', fmtCur(item.appraised_value)) +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-calendar-alt"></i> Timeline</h3>' +
          detailRow('Application Date', fmtDate(item.application_date)) +
          detailRow('Closing Date', fmtDate(item.closing_date)) +
          detailRow('Funded Date', fmtDate(item.funded_date)) +
          detailRow('First Payment', fmtDate(item.first_payment_date)) +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-file-invoice-dollar"></i> Mortgage Details</h3>' +
          detailRow('Mortgage Payment', fmtCur(item.mortgage_payment)) +
          detailRow('Mortgage Insurance', fmtCur(item.mortgage_insurance)) +
          detailRow('Hazard Insurance', fmtCur(item.hazard_insurance_amount)) +
          detailRow('Seller Comp', fmtCur(item.seller_comp)) +
          detailRow('Broker Fee', fmtCur(item.broker_fee)) +
        '</div>' +
        '<div class="pa-detail-section">' +
          '<h3 class="pa-detail-section-title"><i class="fas fa-user-tie"></i> Referring Agent</h3>' +
          detailRow('Agent Name', esc(item.referring_agent || '')) +
          detailRow('Agent Email', item.referring_agent_email ? '<a href="mailto:' + esc(item.referring_agent_email) + '">' + esc(item.referring_agent_email) + '</a>' : '') +
          detailRow('Agent Phone', item.referring_agent_phone ? '<a href="tel:' + esc(item.referring_agent_phone) + '">' + esc(item.referring_agent_phone) + '</a>' : '') +
        '</div>' +
      '</div>' +
      (item.notes ? '<div class="pa-detail-section full-width"><h3 class="pa-detail-section-title"><i class="fas fa-sticky-note"></i> Monday Notes</h3><div class="pa-detail-monday-notes">' + esc(item.notes) + '</div></div>' : '') +
      '<div class="pa-detail-section full-width">' +
        '<h3 class="pa-detail-section-title"><i class="fas fa-comments"></i> Notes</h3>' +
        '<div class="pa-notes-add">' +
          '<textarea id="fundedNewNoteInput" rows="2" placeholder="Add a note..." class="form-input"></textarea>' +
          '<button type="button" class="btn btn-primary btn-sm" id="fundedAddNoteBtn"><i class="fas fa-plus"></i> Add Note</button>' +
        '</div>' +
        '<div id="fundedNotesContainer" class="pa-notes-list">' +
          '<div style="text-align:center;padding:1rem;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Loading notes...</div>' +
        '</div>' +
      '</div>' +
      '<div class="pa-detail-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="FundedLoans._closeDetail();"><i class="fas fa-times"></i> Close</button>' +
      '</div>';

    modal.classList.add('active');

    // Bind add note
    var self = this;
    document.getElementById('fundedAddNoteBtn')?.addEventListener('click', function() { self._addNote(id); });
    document.getElementById('fundedNewNoteInput')?.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) self._addNote(id);
    });

    this._loadNotes(id);
  },

  _closeDetail() {
    var modal = document.getElementById('fundedDetailModal');
    if (modal) modal.classList.remove('active');
  },

  _loadNotes(loanId) {
    var container = document.getElementById('fundedNotesContainer');
    if (!container) return;
    var self = this;

    ServerAPI.getFundedLoanNotes(loanId).then(function(notes) {
      if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="pa-notes-empty">No notes yet.</div>';
        return;
      }

      var esc = Utils.escapeHtml;
      var currentUserId = CONFIG.currentUser?.id;
      var isAdminUser = ['admin', 'manager'].includes((CONFIG.currentUser?.activeRole || '').toLowerCase());

      container.innerHTML = notes.map(function(note) {
        var canEdit = isAdminUser || note.author_id === currentUserId;
        var ts = new Date(note.created_at);
        var edited = note.updated_at && note.updated_at !== note.created_at;
        var timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

        return '<div class="pa-note" data-note-id="' + note.id + '" data-parent-id="' + loanId + '">' +
          '<div class="pa-note-header">' +
            '<span class="pa-note-author"><i class="fas fa-user-circle"></i> ' + esc(note.author_name || 'Unknown') + '</span>' +
            '<span class="pa-note-time">' + esc(timeStr) + (edited ? ' (edited)' : '') + '</span>' +
            (canEdit ? '<div class="pa-note-actions">' +
              '<button type="button" class="pa-note-edit-btn" title="Edit"><i class="fas fa-pencil-alt"></i></button>' +
              '<button type="button" class="pa-note-delete-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
            '</div>' : '') +
          '</div>' +
          '<div class="pa-note-content">' + esc(note.content) + '</div>' +
        '</div>';
      }).join('');

      container.querySelectorAll('.pa-note-edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var noteEl = btn.closest('.pa-note');
          self._editNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId));
        });
      });
      container.querySelectorAll('.pa-note-delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var noteEl = btn.closest('.pa-note');
          self._deleteNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId));
        });
      });
    }).catch(function(err) {
      console.error('Failed to load funded loan notes:', err);
      container.innerHTML = '<div class="pa-notes-empty" style="color:#e74c3c;">Failed to load notes.</div>';
    });
  },

  _addNote(loanId) {
    var input = document.getElementById('fundedNewNoteInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    var self = this;

    ServerAPI.addFundedLoanNote(loanId, content).then(function() {
      input.value = '';
      self._loadNotes(loanId);
    }).catch(function(err) {
      alert('Failed to add note: ' + (err.message || 'Unknown error'));
    });
  },

  _editNote(loanId, noteId) {
    var noteEl = document.querySelector('.pa-note[data-note-id="' + noteId + '"][data-parent-id="' + loanId + '"]');
    if (!noteEl) return;
    var contentEl = noteEl.querySelector('.pa-note-content');
    var currentContent = contentEl.textContent;
    var self = this;

    contentEl.innerHTML = '<textarea class="form-input pa-note-edit-input" rows="2">' + Utils.escapeHtml(currentContent) + '</textarea>' +
      '<div class="pa-note-edit-actions">' +
        '<button type="button" class="btn btn-primary btn-sm pa-note-save-btn"><i class="fas fa-check"></i> Save</button>' +
        '<button type="button" class="btn btn-secondary btn-sm pa-note-cancel-btn">Cancel</button>' +
      '</div>';

    var textarea = contentEl.querySelector('textarea');
    textarea.focus();

    contentEl.querySelector('.pa-note-save-btn').addEventListener('click', function() {
      var newContent = textarea.value.trim();
      if (!newContent) return;
      ServerAPI.updateFundedLoanNote(loanId, noteId, newContent).then(function() {
        self._loadNotes(loanId);
      }).catch(function(err) {
        alert('Failed to update note: ' + (err.message || 'Unknown error'));
      });
    });

    contentEl.querySelector('.pa-note-cancel-btn').addEventListener('click', function() {
      self._loadNotes(loanId);
    });
  },

  _deleteNote(loanId, noteId) {
    if (!confirm('Delete this note?')) return;
    var self = this;
    ServerAPI.deleteFundedLoanNote(loanId, noteId).then(function() {
      self._loadNotes(loanId);
    }).catch(function(err) {
      alert('Failed to delete note: ' + (err.message || 'Unknown error'));
    });
  },
};

// Export to global scope
window.FundedLoans = FundedLoans;
