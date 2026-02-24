/* ============================================
   MSFG Dashboard - Funded Loans Module
   Displays funded loans table with YTD/MTD filters
   ============================================ */

const FundedLoans = {
  // ========================================
  // STATE
  // ========================================
  _period: 'ytd',
  _loFilter: '',
  _data: [],
  _summary: { count: 0, total_amount: 0 },

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

    // LO filter (admin/manager only)
    const loSelect = document.getElementById('fundedLOSelect');
    if (loSelect) {
      loSelect.addEventListener('change', () => {
        this._loFilter = loSelect.value;
        this.load();
      });
    }
  },

  // ========================================
  // DATA LOADING
  // ========================================
  async load() {
    const tbody = document.getElementById('fundedLoansBody');
    const summaryBar = document.getElementById('fundedSummaryBar');

    // Show loading
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="empty-state">' +
        '<i class="fas fa-spinner fa-spin"></i>' +
        '<p>Loading funded loans...</p>' +
        '</td></tr>';
    }

    try {
      const params = { period: this._period };
      if (this._loFilter) params.lo_id = this._loFilter;

      const result = await ServerAPI.getFundedLoans(params);

      if (!result) return; // 401 handled by ServerAPI

      this._data = result.data || [];
      this._summary = result.summary || { count: 0, total_amount: 0 };

      this._renderTable();
      this._renderSummary();
    } catch (err) {
      console.error('Funded loans load error:', err);
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="empty-state">' +
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
        '<tr><td colspan="5" class="empty-state">' +
        '<i class="fas fa-check-circle"></i>' +
        '<p>No funded loans for this period.</p>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = this._data.map(loan => {
      const borrower = Utils.escapeHtml(loan.borrower_name || loan.borrower || '--');
      const amount = Utils.formatCurrency(loan.loan_amount);
      const lo = Utils.escapeHtml(loan.lo_name || loan.assigned_lo_name || '--');
      const date = loan.funded_date ? Utils.formatDate(loan.funded_date, 'short') : '--';
      const loanType = Utils.escapeHtml(loan.loan_type || loan.product_type || '--');

      return (
        '<tr>' +
        '<td>' + borrower + '</td>' +
        '<td class="text-right">' + amount + '</td>' +
        '<td>' + lo + '</td>' +
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
};

// Export to global scope
window.FundedLoans = FundedLoans;
