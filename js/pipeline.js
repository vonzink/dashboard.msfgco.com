/* ============================================
   MSFG Dashboard - Pipeline Module
   Data loading, rendering, detail view, notes
============================================ */

const Pipeline = {
  data: [],
  columns: [],
  _showAllColumns: false,
  _detailInit: false,

  PRIORITY_FIELDS: ['client_name', 'assigned_lo_name', 'lender', 'loan_amount', 'stage', 'closing_date', 'loan_number', 'subject_property'],

  STATUS_OPTIONS: {
    // ── Synced to Monday.com column labels ───────────────────────
    //   stage             ← status2  (Loan Status)
    //   title_status      ← status80 (Title)
    //   hoi_status        ← status8  (HOI)
    //   payoffs           ← status_1 (Payoffs)
    //   appraisal_status  ← status4  (Appraisal Status)
    // Order preserved from the Monday board (visual reading order).
    // If a label is ever updated on the Monday board, update it here too
    // so the dashboard dropdown shows the same option as a preset.
    stage: [
      'NEW LOAN', 'Registered', 'Submitted', 'Re-Submitted', 'Conditions Pending',
      'Conditions Sent to Borrower', 'Ready To Submit', 'Not Ready To Submit',
      'CTC', 'Balanced For Closing', 'Closing Docs Out', 'Closed', 'Funded',
      'Hold', 'Hold On Collection', 'Suspended', 'Waiting for B1 Reimbursement',
      'Not Active Loan',
      'DL - Denied', 'DL - Rescinded', 'DL - Not Accepted', 'DL - Withdrawn', 'DL - Incomplete',
    ],
    title_status: [
      'Please order', 'Ordered', 'Order Default Title', 'TRAC +',
      'Have Partial Title', 'Need Info', 'Title Issues', 'Hold',
      'Complete', 'Cancelled', 'Not Ordered Yet',
    ],
    hoi_status: [
      'Please order Binder', 'Wait to order', 'Requested', 'Quote provided',
      'HOI info provided', 'Need Policy #', 'Need Contact Info',
      'Contact Info in KSPs', 'Borrower needs to get quote', 'Borrower Shopping',
      'Insurance update needed', 'Insurance update received',
      'Going with MSI', 'Processor Assist', 'Complete', 'Not Ordered Yet',
    ],
    payoffs: [
      'Please order payoff', 'Ordered', 'Received', 'Borrower to obtain',
      'Missing Info', 'Processor Assist', 'TRAC', 'Expired',
      'Not Ordered Yet', 'NA',
    ],
    appraisal_status: [
      'Need To Order', 'Ordered', '1004D Ordered', 'Ordered 1007', 'Ordered CIR',
      'Ordered ACE+PDR', 'LP ACE+PDR', 'ACE+PDR Received', 'CDA Ordered', 'CDA Received',
      'CIR Received', '1004D Received', 'Inspection Scheduled',
      'PIW', 'FHA/VA Streamline', 'UWM Easy Valuation', 'DESKTOP REVIEW',
      'As Is', 'Subject To', 'Requested Revisions', 'Lender Ordered Field Review',
      'Requested Transfer', 'Transferred', 'Dispute', 'Waiting For Refund',
      'Hold', 'Hold Until Loan Approval', 'Hold Until Inspection', 'Canceled- No Fee',
    ],
    // ── Local dashboard fields (no Monday equivalent yet) ────────
    prelims_status: ['Not Ordered', 'Ordered', 'Received', 'Approved', 'Pending', 'Cleared', 'N/A'],
    mini_set_status: ['Not Sent', 'Sent', 'Received', 'Approved', 'Pending', 'N/A'],
    cd_status: ['Not Sent', 'Sent', 'Signed', 'Received', 'Approved', 'Pending', 'N/A'],
    // WVOE — must match Monday.com column status69 labels EXACTLY. Write-back sends
    // {label: value}; an unknown label makes change_multiple_column_values reject the
    // whole mutation, so the row silently fails to sync (warning only, DB still saves).
    wvoes: ['Please Order', 'Requested', 'Partially Complete', 'Need Info', 'Pending LO Approval', 'LO Approved', 'Done', 'NA'],
    vvoes: ['Needed', 'Done', 'NA'],  // matches Monday status46 (VVOE) labels
    hoa: ['Not Ordered', 'Ordered', 'Received', 'Pending', 'N/A'],
    dpa: ['Not Applied', 'Applied', 'Approved', 'Received', 'Pending', 'Denied', 'N/A'],
    closing_docs: ['Not Sent', 'Sent', 'Signed', 'Received', 'Pending', 'N/A'],
    closing_details: ['Not Sent', 'Sent', 'Confirmed', 'Pending', 'N/A'],
    cd_info: ['Not Sent', 'Sent', 'Signed', 'Received', 'Pending', 'N/A'],
    send_to_compliance: ['Not Sent', 'Sent', 'Approved', 'Pending', 'Returned', 'N/A'],
  },

  FALLBACK_COLUMNS: [
    { field: 'client_name', label: 'Client Name' },
    { field: 'loan_number', label: 'Loan #' },
    { field: 'assigned_lo_name', label: 'Loan Officer' },
    { field: 'subject_property', label: 'Subject Property' },
    { field: 'loan_amount', label: 'Loan Amount' },
    { field: 'rate', label: 'Rate' },
    { field: 'appraisal_status', label: 'Appraisal' },
    { field: 'prelims_status', label: 'Prelims' },
    { field: 'mini_set_status', label: 'Mini Set' },
    { field: 'cd_status', label: 'CD' },
    { field: 'occupancy', label: 'Occupancy' },
    { field: 'application_date', label: 'App Date' },
    { field: 'closing_date', label: 'Closing Date' },
    { field: 'lock_expiration_date', label: 'Lock Exp' },
    { field: 'funding_date', label: 'Funding Date' },
  ],

  DATE_FIELDS: ['application_date', 'lock_expiration_date', 'closing_date', 'funding_date', 'target_close_date',
    'appraisal_deadline', 'appraisal_due_date', 'payoff_date', 'estimated_fund_date'],
  CURRENCY_FIELDS: ['loan_amount', 'initial_loan_amount', 'purchase_price', 'appraised_value'],
  STATUS_FIELDS: ['stage', 'appraisal_status', 'prelims_status', 'mini_set_status', 'cd_status',
    'hoi_status', 'title_status', 'loan_status', 'status', 'payoffs', 'wvoes', 'vvoes',
    'closing_details', 'closing_docs', 'cd_info', 'dpa', 'hoa', 'send_to_compliance'],

  // Per-board live Monday status labels { board_id: { field: [labels] } }; overrides STATUS_OPTIONS per loan's board.
  _statusLabelsByBoard: null,

  // Fields rendered as Monday-style colored-pill dropdowns (rolled out one field at a time).
  PILL_FIELDS: ['stage', 'prelims_status', 'mini_set_status', 'appraisal_status', 'cd_status', 'cd_info', 'closing_details', 'hoi_status', 'payoffs', 'closing_docs', 'hoa', 'dpa', 'title_status', 'wvoes', 'vvoes'],

  // ========================================
  // COLUMN MANAGEMENT
  // ========================================
  _getVisibleColumns() {
    const cols = this.columns.length > 0 ? this.columns : this.FALLBACK_COLUMNS;
    if (this._showAllColumns || cols.length <= 8) return cols;
    return cols.filter(c => this.PRIORITY_FIELDS.includes(c.field));
  },

  toggleColumns() {
    this._showAllColumns = !this._showAllColumns;
    this.renderHead();
    this.render(this.data);
    const btn = document.getElementById('toggleColumnsBtn');
    if (btn) {
      const count = this.columns.length - this.PRIORITY_FIELDS.filter(f => this.columns.some(c => c.field === f)).length;
      btn.innerHTML = this._showAllColumns
        ? '<i class="fas fa-compress-alt"></i> Fewer Columns'
        : `<i class="fas fa-expand-alt"></i> +${count} Columns`;
    }
  },

  // ========================================
  // CONFIG & DATA LOADING
  // ========================================
  async _loadStatusLabels() {
    try {
      this._statusLabelsByBoard = await ServerAPI.getStatusLabels('pipeline');
    } catch (e) {
      this._statusLabelsByBoard = null; // fall back to STATUS_OPTIONS
    }
  },

  async loadConfig() {
    try {
      const [config, prefs] = await Promise.all([
        ServerAPI.getMondayViewConfig(),
        API._loadDisplayPrefs(),
        this._loadStatusLabels(),
      ]);
      let cols = (config.columns || []).filter(c => c.visible !== false);
      if (cols.length > 1) {
        this.columns = cols;
      } else {
        this.columns = this.FALLBACK_COLUMNS;
      }
      const userPref = prefs.display_columns_pipeline;
      if (Array.isArray(userPref) && userPref.length > 0) {
        const prefMap = {};
        userPref.forEach(p => { prefMap[p.field] = p; });
        this.columns = this.columns
          .filter(c => prefMap[c.field] === undefined || prefMap[c.field].visible !== false)
          .sort((a, b) => {
            const orderA = prefMap[a.field]?.order ?? Infinity;
            const orderB = prefMap[b.field]?.order ?? Infinity;
            return orderA - orderB;
          });
      }
    } catch (e) {
      console.warn('Failed to load pipeline view config, using defaults:', e.message || e);
      this.columns = this.FALLBACK_COLUMNS;
    }
    this.renderHead();
  },

  renderHead() {
    const thead = document.getElementById('pipelineHead');
    if (!thead) return;
    const cols = this._getVisibleColumns();
    thead.innerHTML = '<tr>' +
      cols.map(c => `<th class="sortable">${Utils.escapeHtml(Utils.toTitleCase(c.label || c.field))}</th>`).join('') +
      '</tr>';
    thead.querySelectorAll('.sortable').forEach(header => {
      header.addEventListener('click', (e) => TableManager.handleSort(e));
    });
  },

  async load() {
    try {
      if (this.columns.length === 0) {
        await this.loadConfig();
      }
      this.renderHead();

      const data = await ServerAPI.getPipeline();
      this.data = data || [];
      if (typeof Checklists !== 'undefined') await Checklists.loadStatusBadges('pipeline');
      this.render(data);
      this.populateFilters(data);
      this.updateSummary(data);
      this.loadSyncStatus();
    } catch (error) {
      console.error('Error loading pipeline:', error);
      if (this.columns.length === 0) {
        this.columns = this.FALLBACK_COLUMNS;
      }
      this.renderHead();
      const tbody = document.getElementById('pipelineBody');
      if (tbody && !this.data?.length) {
        tbody.innerHTML = `<tr><td colspan="${this.columns.length}" class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Failed to load pipeline data. <button type="button" class="btn btn-secondary btn-sm" onclick="Pipeline.load()" style="margin-top:0.5rem;"><i class="fas fa-redo"></i> Retry</button></p>
        </td></tr>`;
      }
    }
  },

  updateSummary(data) {
    const units = data?.length || 0;
    const totalVolume = (data || []).reduce((sum, item) => {
      const amount = parseFloat(item.loan_amount) || 0;
      return sum + amount;
    }, 0);

    const unitsEl = document.getElementById('pipelineTotalUnits');
    const volumeEl = document.getElementById('pipelineTotalVolume');
    if (unitsEl) unitsEl.textContent = Utils.formatNumber(units);
    if (volumeEl) volumeEl.textContent = Utils.formatCurrency(totalVolume);
  },

  // ========================================
  // RENDERING
  // ========================================
  _statusBadgeClass(val) { return Utils.statusBadgeClass(val); },

  _formatAddress(addr) {
    if (!addr) return '';
    return String(addr).replace(/([A-Za-z.'\- ]+?)([A-Z]{2})(\s+\d{5}(?:-\d{4})?)/g, (m, city, state, zip) => {
      const cityTrim = city.replace(/\s+$/, '');
      if (/,\s*$/.test(cityTrim)) return `${cityTrim} ${state}${zip}`;
      return `${cityTrim}, ${state}${zip}`;
    });
  },

  render(data) {
    const tbody = document.getElementById('pipelineBody');
    if (!tbody) return;
    const cols = this._getVisibleColumns();

    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length || 1}">
        <div class="empty-state-enhanced">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="15" y="30" width="90" height="65" rx="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <line x1="15" y1="48" x2="105" y2="48" stroke="currentColor" stroke-width="2" opacity="0.2"/>
            <rect x="22" y="38" width="25" height="5" rx="2" fill="currentColor" opacity="0.15"/>
            <rect x="52" y="38" width="20" height="5" rx="2" fill="currentColor" opacity="0.15"/>
            <rect x="77" y="38" width="22" height="5" rx="2" fill="currentColor" opacity="0.15"/>
            <rect x="22" y="56" width="30" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <rect x="22" y="66" width="25" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <rect x="22" y="76" width="28" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <rect x="52" y="56" width="18" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <rect x="52" y="66" width="22" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <rect x="77" y="56" width="20" height="4" rx="2" fill="currentColor" opacity="0.1"/>
            <circle cx="95" cy="25" r="18" stroke="var(--green-bright)" stroke-width="2" fill="none" opacity="0.4"/>
            <line x1="95" y1="18" x2="95" y2="32" stroke="var(--green-bright)" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
            <line x1="88" y1="25" x2="102" y2="25" stroke="var(--green-bright)" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
          </svg>
          <h4>No Pipeline Data Yet</h4>
          <p>Sync your Monday.com boards to see your active loans here.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="monday-sync"><i class="fas fa-sync-alt"></i> Sync Now</button>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(item => {
      const cells = cols.map(col => {
        const val = item[col.field];
        if (col.field === 'client_name') {
          const clBadge = typeof Checklists !== 'undefined'
            ? (Checklists.getStatusBadge('pipeline', item.id) || Checklists.getEmptyBadge('pipeline', item.id))
            : '';
          return `<td><div class="client-name-cell"><strong>${Utils.escapeHtml(val || '')}</strong>${clBadge}</div></td>`;
        }
        if (col.field === 'assigned_lo_name') {
          return `<td><div class="lo-cell"><span class="lo-avatar">${Utils.getInitials(val)}</span> ${Utils.escapeHtml(val || 'Unassigned')}</div></td>`;
        }
        if (this.CURRENCY_FIELDS.includes(col.field)) {
          return `<td class="currency">${val ? Utils.formatCurrency(val) : ''}</td>`;
        }
        if (this.DATE_FIELDS.includes(col.field)) {
          return `<td class="nowrap">${Utils.formatDate(val, 'short')}</td>`;
        }
        if (this.STATUS_FIELDS.includes(col.field) && val) {
          const cls = this._statusBadgeClass(val);
          return `<td><span class="pipeline-badge ${cls}">${Utils.escapeHtml(val)}</span></td>`;
        }
        if (col.field === 'subject_property' && val) {
          return `<td>${Utils.escapeHtml(this._formatAddress(val))}</td>`;
        }
        return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
      }).join('');

      return `<tr data-id="${item.id}" data-lo="${Utils.escapeHtml(item.assigned_lo_name || '')}" class="pa-clickable-row">${cells}</tr>`;
    }).join('');

    tbody.querySelectorAll('.pa-clickable-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.cl-icon-btn')) return;
        this._openDetail(parseInt(row.dataset.id));
      });
    });

    // Checklist badge clicks — each badge has either data-cl-checklist (open
    // that specific checklist) or data-cl-add (start the template-picker flow
    // for a new one).
    tbody.querySelectorAll('.cl-icon-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof Checklists === 'undefined') return;
        const sourceType = btn.dataset.clSource;
        const itemId = parseInt(btn.dataset.clItem);
        const row = btn.closest('tr');
        const clientName = row?.querySelector('strong')?.textContent || '';
        const checklistId = btn.dataset.clChecklist ? parseInt(btn.dataset.clChecklist) : null;
        if (checklistId) {
          Checklists.openById(checklistId, sourceType, itemId, clientName);
        } else {
          Checklists.openForNew(sourceType, itemId, clientName);
        }
      });
    });
  },

  // ========================================
  // FILTERS
  // ========================================
  async populateFilters(data) {
    if (!data?.length) return;

    const role = (CONFIG.currentUser?.activeRole || '').toLowerCase();
    const isLO = role === 'lo';

    const loSelect = document.getElementById('pipelineLO');
    if (loSelect) {
      if (isLO) {
        loSelect.style.display = 'none';
      } else {
        loSelect.style.display = '';
        const los = [...new Set(data.map(d => d.assigned_lo_name).filter(Boolean))].sort();

        const currentVal = loSelect.value || Utils.getStorage('pipeline_lo', '');
        loSelect.innerHTML = '<option value="">All Loan Officers</option>' +
          los.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('');
        loSelect.value = currentVal;
        if (currentVal && typeof MondaySettings !== 'undefined') {
          MondaySettings.filterPipeline();
        }
      }
    }
  },

  // ========================================
  // SYNC STATUS
  // ========================================
  async loadSyncStatus() {
    try {
      const result = await ServerAPI.getMondaySyncStatus();
      const bar = document.getElementById('syncStatusBar');
      const text = document.getElementById('syncStatusText');
      if (!bar || !text) return;

      if (result.lastSync) {
        const syncDate = new Date(result.lastSync.finished_at || result.lastSync.started_at);
        const ago = Utils.getRelativeTime ? Utils.getRelativeTime(syncDate) : syncDate.toLocaleString();
        text.textContent = `Last synced: ${ago} — ${result.lastSync.items_synced || 0} items (${result.lastSync.items_created || 0} new, ${result.lastSync.items_updated || 0} updated)`;
        bar.style.display = 'flex';
      }
    } catch (e) {
      // Sync status not critical — ignore silently
    }
  },

  // ========================================
  // DETAIL VIEW
  // ========================================
  _initDetail() {
    if (this._detailInit) return;
    this._detailInit = true;

    const modal = document.getElementById('pipelineDetailModal');
    if (modal) {
      modal.querySelectorAll('.pipeline-detail-close').forEach(btn => {
        btn.addEventListener('click', () => this._closeDetail());
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this._closeDetail();
      });
    }
  },

  _openDetail(id) {
    this._initDetail();
    const item = this.data?.find(p => p.id === id);
    if (!item) return;

    const modal = document.getElementById('pipelineDetailModal');
    if (!modal) return;

    const esc = Utils.escapeHtml;
    const fmtDate = (v) => v ? Utils.formatDate(v) : '--';
    const fmtCur = (v) => v != null && v !== '' ? Utils.formatCurrency(v) : '--';
    const statusCls = this._statusBadgeClass;

    const title = document.getElementById('pipelineDetailTitle');
    if (title) title.innerHTML = '<i class="fas fa-chart-line" style="color:var(--green-bright);margin-right:0.5rem;"></i> ' + esc(item.client_name || 'Pipeline Item');

    const body = document.getElementById('pipelineDetailBody');
    const detailRow = (label, value) => value && value !== '--'
      ? `<div class="pa-detail-row"><span class="pa-detail-label">${esc(label)}</span><span class="pa-detail-value">${value}</span></div>`
      : '';
    // Read-only timeline date row — always shown so the dates are viewable (not editable for now)
    const dateView = (label, val) => `<div class="pa-detail-row">
        <span class="pa-detail-label">${esc(label)}</span>
        <span class="pa-detail-value">${val ? esc(fmtDate(val)) : '<span style="opacity:.45">—</span>'}</span>
      </div>`;

    // Colored-pill helpers: render a status field as a Monday-style pill dropdown
    // when the board provides labels-with-colors; otherwise callers fall back to <select>.
    const boardLabelsFor = (field) => {
      const bl = this._statusLabelsByBoard && item.source_board_id ? this._statusLabelsByBoard[item.source_board_id] : null;
      const v = bl && bl[field];
      return (Array.isArray(v) && v.length && typeof v[0] === 'object') ? v : null;
    };
    const pillHtml = (field, currentVal) => {
      const labels = boardLabelsFor(field);
      if (!labels) return null;
      const colorOf = (name) => { const m = labels.find(l => l.name === name); return m ? m.color : '#c4c4c4'; };
      const opts = labels.map(l =>
        `<button type="button" class="status-pill-option" title="${esc(l.name)}" style="background:${l.color}" data-field="${field}" data-item-id="${item.id}" data-value="${esc(l.name)}">${esc(l.name)}</button>`
      ).join('');
      return `<div class="status-pill-wrap" data-field="${field}" data-item-id="${item.id}">
        <button type="button" class="status-pill ${currentVal ? '' : 'is-empty'}" ${currentVal ? `style="background:${colorOf(currentVal)}"` : ''} data-field="${field}" data-item-id="${item.id}">${currentVal ? esc(currentVal) : '— not set —'} <i class="fas fa-caret-down"></i></button>
        <div class="status-pill-panel" hidden>${opts}</div>
      </div>`;
    };

    const statusSelect = (field, label, currentVal) => {
      // Opted-in fields render as a colored-pill dropdown (when board labels exist)
      if (this.PILL_FIELDS.includes(field)) {
        const pill = pillHtml(field, currentVal);
        if (pill) {
          return `<div class="pa-detail-row">
            <span class="pa-detail-label">${esc(label)}</span>
            <span class="pa-detail-value">${pill}</span>
          </div>`;
        }
      }
      const boardLabels = this._statusLabelsByBoard && item.source_board_id
        ? this._statusLabelsByBoard[item.source_board_id] : null;
      const rawPresets = (boardLabels && boardLabels[field]) || this.STATUS_OPTIONS[field] || [];
      const presets = rawPresets.map(o => (typeof o === 'string' ? o : o.name));
      const hasCurrentInPresets = !currentVal || presets.includes(currentVal);
      const opts = presets.map(o =>
        `<option value="${esc(o)}" ${o === currentVal ? 'selected' : ''}>${esc(o)}</option>`
      ).join('');
      const customOpt = (!hasCurrentInPresets && currentVal)
        ? `<option value="${esc(currentVal)}" selected>${esc(currentVal)}</option>`
        : '';
      return `<div class="pa-detail-row">
        <span class="pa-detail-label">${esc(label)}</span>
        <span class="pa-detail-value">
          <select class="pipeline-status-select" data-field="${field}" data-item-id="${item.id}">
            <option value="">--</option>${customOpt}${opts}
          </select>
        </span>
      </div>`;
    };

    // Stage promoted to a prominent header pill above the grid (colored pill, or <select> fallback).
    const currentStage = item.stage || '';
    let stageControl = pillHtml('stage', currentStage);
    if (!stageControl) {
      const _bl = this._statusLabelsByBoard && item.source_board_id ? this._statusLabelsByBoard[item.source_board_id] : null;
      const sp = ((_bl && _bl.stage) || this.STATUS_OPTIONS.stage || []).map(o => (typeof o === 'string' ? o : o.name));
      const hasIn = !currentStage || sp.includes(currentStage);
      const sOpts = sp.map(o => `<option value="${esc(o)}" ${o === currentStage ? 'selected' : ''}>${esc(o)}</option>`).join('');
      const sCustom = (!hasIn && currentStage) ? `<option value="${esc(currentStage)}" selected>${esc(currentStage)}</option>` : '';
      stageControl = `<select class="pipeline-status-select pa-detail-stage-pill" id="pipelineStageSelect_${item.id}" data-field="stage" data-item-id="${item.id}"><option value="">-- not set --</option>${sCustom}${sOpts}</select>`;
    }

    body.innerHTML = `
      <div class="pa-detail-stage-bar">
        <label class="pa-detail-stage-label" for="pipelineStageSelect_${item.id}">
          <i class="fas fa-flag"></i> Current Stage
        </label>
        ${stageControl}
        ${item.loan_status ? `<span class="pipeline-badge ${statusCls(item.loan_status)} pa-detail-stage-loan-status">${esc(item.loan_status)}</span>` : ''}
      </div>
      <div class="pa-detail-grid">
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-user"></i> Borrower Info</h3>
          ${detailRow('Client Name', esc(item.client_name || '--'))}
          ${detailRow('Loan Officer', esc(item.assigned_lo_name || '--'))}
          ${detailRow('Loan Number', esc(item.loan_number || ''))}
          ${detailRow('Lender', esc(item.lender || ''))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-dollar-sign"></i> Loan Details</h3>
          ${detailRow('Loan Amount', fmtCur(item.loan_amount))}
          ${detailRow('Loan Type', esc(item.loan_type || ''))}
          ${detailRow('Rate', esc(item.rate || ''))}
          ${detailRow('Occupancy', esc(item.occupancy || ''))}
          ${detailRow('Purchase Price', fmtCur(item.purchase_price))}
          ${detailRow('Appraised Value', fmtCur(item.appraised_value))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-map-marker-alt"></i> Property</h3>
          ${detailRow('Subject Property', esc(item.subject_property || ''))}
          ${detailRow('Property Type', esc(item.property_type || ''))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-calendar-alt"></i> Timeline</h3>
          ${dateView('Application Date', item.application_date)}
          ${dateView('Target Close', item.target_close_date)}
          ${dateView('Closing Date', item.closing_date)}
          ${dateView('Funding Date', item.funding_date)}
          ${dateView('Lock Date', item.lock_expiration_date)}
          ${dateView('Payoff Date', item.payoff_date)}
          ${dateView('Appraisal Due Date', item.appraisal_due_date)}
          ${dateView('Appraisal Deadline', item.appraisal_deadline)}
          ${dateView('Est. Funding Date', item.estimated_fund_date)}
        </div>
        <div class="pa-detail-section full-width">
          <h3 class="pa-detail-section-title"><i class="fas fa-tasks"></i> Status Tracking</h3>
          <div class="pa-status-grid">
            ${statusSelect('appraisal_status', 'Appraisal', item.appraisal_status || '')}
            ${statusSelect('prelims_status', 'Prelims', item.prelims_status || '')}
            ${statusSelect('mini_set_status', 'Mini Set', item.mini_set_status || '')}
            ${statusSelect('cd_status', 'CD', item.cd_status || '')}
            ${statusSelect('title_status', 'Title', item.title_status || '')}
            ${statusSelect('hoi_status', 'Insurance', item.hoi_status || '')}
            ${statusSelect('payoffs', 'Payoffs', item.payoffs || '')}
            ${statusSelect('wvoes', 'WVOEs', item.wvoes || '')}
            ${statusSelect('vvoes', 'VVOEs', item.vvoes || '')}
            ${statusSelect('hoa', 'HOA', item.hoa || '')}
            ${statusSelect('dpa', 'DPA', item.dpa || '')}
            ${statusSelect('closing_docs', 'Closing Docs', item.closing_docs || '')}
            ${statusSelect('closing_details', 'Closing Details', item.closing_details || '')}
            ${statusSelect('cd_info', 'CD Info', item.cd_info || '')}
          </div>
        </div>
      </div>
      ${item.monday_item_id ? `<div class="pa-detail-section full-width">
        <h3 class="pa-detail-section-title"><i class="fab fa-monday"></i> Post Comment to Monday.com</h3>
        <textarea id="pipelineMondayComment" rows="2" class="form-input" placeholder="Write a comment — it will appear in the item's activity feed on Monday.com..."></textarea>
        <button type="button" class="btn btn-secondary btn-sm" id="pipelinePostMondayComment" style="margin-top:0.5rem;"><i class="fab fa-monday"></i> Post to Monday</button>
      </div>` : ''}
      <div class="pa-detail-section full-width">
        <h3 class="pa-detail-section-title">
          <i class="fas fa-comments"></i> Internal Notes
          <span class="pa-detail-section-hint">team-only, not synced</span>
        </h3>
        <div class="pa-notes-add">
          <textarea id="pipelineNewNoteInput" rows="2" placeholder="Add a note..." class="form-input"></textarea>
          <button type="button" class="btn btn-primary btn-sm" id="pipelineAddNoteBtn"><i class="fas fa-plus"></i> Add Note</button>
        </div>
        <div id="pipelineNotesContainer" class="pa-notes-list">
          <div style="text-align:center;padding:1rem;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Loading notes...</div>
        </div>
      </div>
      <div class="pa-detail-actions">
        <button type="button" class="btn btn-secondary" onclick="Pipeline._closeDetail();"><i class="fas fa-times"></i> Close</button>
      </div>
    `;

    modal.classList.add('active');

    // Status field change handlers — prompt for optional comment, then save
    modal.querySelectorAll('.pipeline-status-select').forEach(select => {
      select.addEventListener('change', () => this._onStatusChange(id, select));
    });

    // Colored-pill status dropdowns (e.g. Current Stage)
    modal.querySelectorAll('.status-pill-wrap').forEach(wrap => {
      const cell = wrap.querySelector('.status-pill');
      const panel = wrap.querySelector('.status-pill-panel');
      cell?.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = panel.hidden;
        modal.querySelectorAll('.status-pill-panel').forEach(p => { p.hidden = true; });
        if (willOpen) {
          panel.hidden = false;
          const r = cell.getBoundingClientRect();
          const pw = panel.offsetWidth || 380;
          const ph = panel.offsetHeight || 320;
          let top = r.bottom + 6;
          if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
          panel.style.top = top + 'px';
          panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
        }
      });
      panel?.querySelectorAll('.status-pill-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          panel.hidden = true;
          cell.innerHTML = `${esc(opt.dataset.value)} <i class="fas fa-caret-down"></i>`;
          cell.style.background = opt.style.background;
          cell.classList.remove('is-empty');
          this._onStatusPillPick(id, opt.dataset.field, opt.dataset.value, wrap);
        });
      });
    });
    if (!this._pillOutsideBound) {
      this._pillOutsideBound = true;
      const closeAllPills = () => document.querySelectorAll('.status-pill-panel').forEach(p => { p.hidden = true; });
      document.addEventListener('click', (e) => { if (!e.target.closest('.status-pill-wrap')) closeAllPills(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPills(); });
      document.addEventListener('scroll', closeAllPills, true);
    }

    // Post comment to Monday.com item
    document.getElementById('pipelinePostMondayComment')?.addEventListener('click', () => this._postMondayComment(id));

    document.getElementById('pipelineAddNoteBtn')?.addEventListener('click', () => this._addNote(id));
    document.getElementById('pipelineNewNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._addNote(id);
    });

    this._loadNotes(id);
  },

  _onStatusChange(itemId, select) {
    const field = select.dataset.field;
    const newValue = select.value;
    const label = select.closest('.pa-detail-row')?.querySelector('.pa-detail-label')?.textContent || field;
    this._promptCommentAndSave(itemId, field, newValue, label, select.parentElement);
  },

  _onStatusPillPick(itemId, field, newValue, wrapEl) {
    const row = wrapEl.closest('.pa-detail-row');
    const label = row?.querySelector('.pa-detail-label')?.textContent || (field === 'stage' ? 'Current Stage' : field);
    this._promptCommentAndSave(itemId, field, newValue, label, row || wrapEl.parentElement || wrapEl);
  },

  // Shared by the status <select>s and the colored-pill dropdown: optional inline
  // comment, then save the field (which write-throughs to Monday.com).
  _promptCommentAndSave(itemId, field, newValue, label, anchorEl) {
    const existing = anchorEl.querySelector('.status-comment-prompt');
    if (existing) existing.remove();

    const prompt = document.createElement('div');
    prompt.className = 'status-comment-prompt';
    prompt.innerHTML = `
      <input type="text" class="form-input status-comment-input" placeholder="Add a comment (optional)..." />
      <div class="status-comment-actions">
        <button type="button" class="btn btn-primary btn-sm status-comment-save"><i class="fas fa-check"></i> Save</button>
        <button type="button" class="btn btn-secondary btn-sm status-comment-skip">Skip Comment</button>
      </div>
    `;
    anchorEl.appendChild(prompt);

    const input = prompt.querySelector('.status-comment-input');
    input.focus();

    const save = async (comment) => {
      prompt.remove();
      await this._saveField(itemId, field, newValue);
      if (comment) {
        const item = this.data?.find(p => p.id === itemId);
        if (item?.monday_item_id) {
          const body = `${label} changed to "${newValue}"${comment ? ' — ' + comment : ''}`;
          try {
            await ServerAPI.postMondayComment(itemId, body);
          } catch (err) {
            Utils.showToast('Status saved but comment failed: ' + err.message, 'error');
          }
        }
      }
    };

    prompt.querySelector('.status-comment-save').addEventListener('click', () => save(input.value.trim()));
    prompt.querySelector('.status-comment-skip').addEventListener('click', () => save(''));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save(input.value.trim());
      if (e.key === 'Escape') save('');
    });
  },

  async _postMondayComment(itemId) {
    const textarea = document.getElementById('pipelineMondayComment');
    if (!textarea) return;
    const body = textarea.value.trim();
    if (!body) return;

    const btn = document.getElementById('pipelinePostMondayComment');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...'; }

    try {
      await ServerAPI.postMondayComment(itemId, body);
      textarea.value = '';
      Utils.showToast('Comment posted to Monday.com', 'success');
    } catch (err) {
      Utils.showToast('Failed to post: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fab fa-monday"></i> Post to Monday'; }
    }
  },

  async _saveField(itemId, field, value) {
    try {
      const updated = await ServerAPI.updatePipeline(itemId, { [field]: value });
      // Update local data so the table reflects the change on close
      const local = this.data?.find(p => p.id === itemId);
      if (local) local[field] = value;
      Utils.showToast('Saved', 'success');
    } catch (err) {
      Utils.showToast('Failed to save: ' + (err.message || 'Unknown error'), 'error');
    }
  },

  _closeDetail() {
    // Re-render the table to reflect any edits made in the detail view
    if (this.data?.length) {
      this.render(this.data);
      if (typeof MondaySettings !== 'undefined') MondaySettings.filterPipeline();
    }
    const modal = document.getElementById('pipelineDetailModal');
    if (modal) modal.classList.remove('active');
  },

  // ========================================
  // NOTES
  // ========================================
  async _loadNotes(pipelineId) {
    const container = document.getElementById('pipelineNotesContainer');
    if (!container) return;

    try {
      const notes = await ServerAPI.getPipelineNotes(pipelineId);
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

        return `<div class="pa-note" data-note-id="${note.id}" data-parent-id="${pipelineId}">
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
          this._editNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId));
        });
      });
      container.querySelectorAll('.pa-note-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const noteEl = btn.closest('.pa-note');
          this._deleteNote(parseInt(noteEl.dataset.parentId), parseInt(noteEl.dataset.noteId));
        });
      });
    } catch (err) {
      console.error('Failed to load pipeline notes:', err);
      container.innerHTML = '<div class="pa-notes-empty" style="color:#e74c3c;">Failed to load notes.</div>';
    }
  },

  async _addNote(pipelineId) {
    const input = document.getElementById('pipelineNewNoteInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    try {
      await ServerAPI.addPipelineNote(pipelineId, content);
      input.value = '';
      this._loadNotes(pipelineId);
    } catch (err) {
      alert('Failed to add note: ' + (err.message || 'Unknown error'));
    }
  },

  async _editNote(pipelineId, noteId) {
    const noteEl = document.querySelector(`.pa-note[data-note-id="${noteId}"][data-parent-id="${pipelineId}"]`);
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
        await ServerAPI.updatePipelineNote(pipelineId, noteId, newContent);
        this._loadNotes(pipelineId);
      } catch (err) {
        alert('Failed to update note: ' + (err.message || 'Unknown error'));
      }
    });

    contentEl.querySelector('.pa-note-cancel-btn').addEventListener('click', () => {
      this._loadNotes(pipelineId);
    });
  },

  async _deleteNote(pipelineId, noteId) {
    if (!await Utils.confirm('Delete this note?', { title: 'Delete Note' })) return;
    try {
      await ServerAPI.deletePipelineNote(pipelineId, noteId);
      this._loadNotes(pipelineId);
    } catch (err) {
      alert('Failed to delete note: ' + (err.message || 'Unknown error'));
    }
  },
};

window.Pipeline = Pipeline;
