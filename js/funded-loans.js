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
    // Period select
    const periodSelect = document.getElementById('fundedPeriodSelect');
    if (periodSelect) {
      periodSelect.addEventListener('change', () => {
        this._period = periodSelect.value;
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

  _renderCell(loan, field) {
    const val = loan[field];
    // Special rendering per field type
    if (field === 'client_name') {
      return '<td>' + Utils.escapeHtml(loan.client_name || loan.borrower_name || loan.borrower || '--') + '</td>';
    }
    if (field === 'assigned_lo_name') {
      return '<td>' + Utils.escapeHtml(loan.lo_name || loan.assigned_lo_name || '--') + '</td>';
    }
    if (field === 'loan_type') {
      return '<td>' + Utils.escapeHtml(loan.loan_type || loan.product_type || '--') + '</td>';
    }
    if (field === 'notes') {
      return '<td class="notes-cell" title="' + Utils.escapeHtml(loan.notes || '') + '">' + Utils.escapeHtml(loan.notes || '--') + '</td>';
    }
    if (this.CURRENCY_FIELDS.includes(field)) {
      return '<td class="text-right">' + (val ? Utils.formatCurrency(val) : '--') + '</td>';
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
      '<tr>' + cols.map(c => this._renderCell(loan, c.field)).join('') + '</tr>'
    ).join('');
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

    if (this._availableBoards.length > 0) {
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
};

// Export to global scope
window.FundedLoans = FundedLoans;
