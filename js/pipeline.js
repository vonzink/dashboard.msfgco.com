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
  async loadConfig() {
    try {
      const [config, prefs] = await Promise.all([
        ServerAPI.getMondayViewConfig(),
        API._loadDisplayPrefs(),
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
  _statusBadgeClass(val) {
    if (!val) return '';
    const v = val.toLowerCase();
    if (/complete|done|approved|cleared|received|ordered|signed|funded|ctc|clear/i.test(v)) return 'status-complete';
    if (/pending|in progress|working|submitted|waiting|conditional|review|open/i.test(v)) return 'status-pending';
    if (/not ready|missing|denied|rejected|expired|overdue|cancel|fail|stuck/i.test(v)) return 'status-danger';
    if (/n\/a|waived|exempt/i.test(v)) return 'status-neutral';
    return 'status-default';
  },

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
          return `<td><strong>${Utils.escapeHtml(val || '')}</strong></td>`;
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
      row.addEventListener('click', () => {
        this._openDetail(parseInt(row.dataset.id));
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

    body.innerHTML = `
      <div class="pa-detail-grid">
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-user"></i> Borrower Info</h3>
          ${detailRow('Client Name', esc(item.client_name || '--'))}
          ${detailRow('Loan Officer', esc(item.assigned_lo_name || '--'))}
          ${item.stage ? detailRow('Stage', `<span class="pipeline-badge ${statusCls(item.stage)}">${esc(item.stage)}</span>`) : ''}
          ${item.loan_status ? detailRow('Loan Status', `<span class="pipeline-badge ${statusCls(item.loan_status)}">${esc(item.loan_status)}</span>`) : ''}
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
          ${detailRow('Application Date', fmtDate(item.application_date))}
          ${detailRow('Target Close', fmtDate(item.target_close_date))}
          ${detailRow('Closing Date', fmtDate(item.closing_date))}
          ${detailRow('Funding Date', fmtDate(item.funding_date))}
          ${detailRow('Lock Expiration', fmtDate(item.lock_expiration_date))}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-tasks"></i> Status Tracking</h3>
          ${item.appraisal_status ? detailRow('Appraisal', `<span class="pipeline-badge ${statusCls(item.appraisal_status)}">${esc(item.appraisal_status)}</span>`) : ''}
          ${item.prelims_status ? detailRow('Prelims', `<span class="pipeline-badge ${statusCls(item.prelims_status)}">${esc(item.prelims_status)}</span>`) : ''}
          ${item.mini_set_status ? detailRow('Mini Set', `<span class="pipeline-badge ${statusCls(item.mini_set_status)}">${esc(item.mini_set_status)}</span>`) : ''}
          ${item.cd_status ? detailRow('CD', `<span class="pipeline-badge ${statusCls(item.cd_status)}">${esc(item.cd_status)}</span>`) : ''}
        </div>
        <div class="pa-detail-section">
          <h3 class="pa-detail-section-title"><i class="fas fa-user-tie"></i> Referring Agent</h3>
          ${detailRow('Agent Name', esc(item.referring_agent || ''))}
          ${detailRow('Agent Email', item.referring_agent_email ? `<a href="mailto:${esc(item.referring_agent_email)}">${esc(item.referring_agent_email)}</a>` : '')}
          ${detailRow('Agent Phone', item.referring_agent_phone ? `<a href="tel:${esc(item.referring_agent_phone)}">${esc(item.referring_agent_phone)}</a>` : '')}
        </div>
      </div>
      ${item.notes ? `<div class="pa-detail-section full-width"><h3 class="pa-detail-section-title"><i class="fas fa-sticky-note"></i> Monday Notes</h3><div class="pa-detail-monday-notes">${esc(item.notes)}</div></div>` : ''}
      <div class="pa-detail-section full-width">
        <h3 class="pa-detail-section-title"><i class="fas fa-comments"></i> Notes</h3>
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

    document.getElementById('pipelineAddNoteBtn')?.addEventListener('click', () => this._addNote(id));
    document.getElementById('pipelineNewNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._addNote(id);
    });

    this._loadNotes(id);
  },

  _closeDetail() {
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
    if (!confirm('Delete this note?')) return;
    try {
      await ServerAPI.deletePipelineNote(pipelineId, noteId);
      this._loadNotes(pipelineId);
    } catch (err) {
      alert('Failed to delete note: ' + (err.message || 'Unknown error'));
    }
  },
};

window.Pipeline = Pipeline;
