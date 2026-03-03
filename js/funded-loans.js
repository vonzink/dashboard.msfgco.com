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

  // ========================================
  // INITIALIZATION
  // ========================================
  init() {
    this._bindEvents();
    this.load();
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
        '<tr><td colspan="6" class="empty-state">' +
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

      // Update goals with funded loans data
      this._updateGoalsFromFunded();
    } catch (err) {
      console.error('Funded loans load error:', err);
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="empty-state">' +
          '<i class="fas fa-exclamation-triangle"></i>' +
          '<p>Failed to load funded loans.</p>' +
          '</td></tr>';
      }
    }
  },

  // ========================================
  // RENDERING
  // ========================================
  _renderTable() {
    const tbody = document.getElementById('fundedLoansBody');
    if (!tbody) return;

    if (this._data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="empty-state">' +
        '<i class="fas fa-check-circle"></i>' +
        '<p>No funded loans for this period.</p>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = this._data.map(loan => {
      const borrower = Utils.escapeHtml(loan.client_name || loan.borrower_name || loan.borrower || '--');
      const amount = Utils.formatCurrency(loan.loan_amount);
      const lo = Utils.escapeHtml(loan.lo_name || loan.assigned_lo_name || '--');
      const group = Utils.escapeHtml(loan.group_name || '--');
      const date = loan.funded_date ? Utils.formatDate(loan.funded_date, 'short') : '--';
      const loanType = Utils.escapeHtml(loan.loan_type || loan.product_type || '--');

      return (
        '<tr>' +
        '<td>' + borrower + '</td>' +
        '<td class="text-right">' + amount + '</td>' +
        '<td>' + lo + '</td>' +
        '<td>' + group + '</td>' +
        '<td>' + loanType + '</td>' +
        '<td>' + date + '</td>' +
        '</tr>'
      );
    }).join('');
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

  // ========================================
  // GOALS INTEGRATION
  // ========================================
  _updateGoalsFromFunded() {
    if (typeof GoalsManager === 'undefined') return;

    // Only update goals if the Goals period matches the funded loans period
    const goalPeriod = GoalsManager.currentPeriod;
    if (goalPeriod !== this._period) return;

    // Loans Closed = unit count from funded loans
    const units = this._summary.count || 0;
    const loansGoal = GoalsManager.goals['loans-closed'];
    if (loansGoal) {
      loansGoal.current = units;
      GoalsManager.updateGoalCard('loans-closed');
    }

    // Volume Closed = total amount from funded loans (in millions)
    const volumeM = (this._summary.total_amount || 0) / 1000000;
    const volumeGoal = GoalsManager.goals['volume-closed'];
    if (volumeGoal) {
      volumeGoal.current = parseFloat(volumeM.toFixed(2));
      GoalsManager.updateGoalCard('volume-closed');
    }
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
