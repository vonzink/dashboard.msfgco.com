/* ============================================
   MSFG Dashboard - Data & Views
   Data loading orchestration + DOM rendering.
   All HTTP goes through ServerAPI (js/api-server.js).
   ============================================ */

const API = {
    // ========================================
    // LOAD ALL DATA
    // ========================================
    async loadAllData() {
        try {
            await Promise.allSettled([
                this.loadNews(),
                this.loadTasks(),
                this.loadPreApprovals(),
                this.loadPipeline(),
                this.loadGoals()
            ]);
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    },

    // ========================================
    // NEWS & ANNOUNCEMENTS
    // ========================================
    async loadNews() {
        // TODO: Implement when /api/news endpoint is live
    },

    renderNews(data) {
        const container = document.getElementById('newsFeed');
        if (!container || !data?.length) return;

        container.innerHTML = data.map(item => `
            <div class="news-item">
                <div class="news-icon">
                    <i class="fas ${item.icon || 'fa-bullhorn'}"></i>
                </div>
                <div class="news-content">
                    <h4>${Utils.escapeHtml(item.title)}</h4>
                    <p>${Utils.escapeHtml(item.content)}</p>
                    <div class="news-meta">
                        <span><i class="fas fa-user"></i> ${Utils.escapeHtml(item.author)}</span>
                        <span><i class="fas fa-clock"></i> ${Utils.getRelativeTime(item.createdAt)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // ========================================
    // TASKS
    // ========================================
    async loadTasks() {
        // TODO: Implement when /api/tasks endpoint is live
    },

    renderTasks(data) {
        if (!data?.length) return;

        const grouped = {
            todo: data.filter(t => t.status === 'todo'),
            inProgress: data.filter(t => t.status === 'in-progress'),
            completed: data.filter(t => t.status === 'completed')
        };

        // Render each column
        Object.entries(grouped).forEach(([status, tasks]) => {
            const column = document.querySelector(`[data-status="${status}"] .task-list`);
            if (column) {
                column.innerHTML = tasks.map(task => this.renderTaskItem(task)).join('');
            }
        });
    },

    renderTaskItem(task) {
        const priorityClass = `priority-${task.priority || 'medium'}`;
        const overdueClass = Utils.isExpired(task.dueDate) ? 'overdue' : '';
        
        return `
            <div class="task-item ${priorityClass}" data-id="${task.id}">
                <div class="task-title">${Utils.escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="task-due ${overdueClass}">
                        <i class="fas fa-clock"></i> 
                        ${Utils.formatDate(task.dueDate, 'short')}
                    </span>
                    <span>${Utils.capitalize(task.priority)}</span>
                </div>
            </div>
        `;
    },

    // ========================================
    // PRE-APPROVALS
    // ========================================
    preApprovalData: [],
    preApprovalBoards: [],
    preApprovalGroups: [],
    _paFiltersInitialized: false,

    async loadPreApprovals() {
        try {
            // Load column config from Monday view-config on first call
            if (!this._preApprovalColumnsLoaded) {
                await this.loadPreApprovalConfig();
            }

            // Build query params from filters
            const boardSelect = document.getElementById('preApprovalBoardSelect');
            const groupSelect = document.getElementById('preApprovalGroupSelect');
            const params = new URLSearchParams();
            if (boardSelect?.value) params.set('board_id', boardSelect.value);
            if (groupSelect?.value) params.set('group', groupSelect.value);
            const qs = params.toString() ? '?' + params.toString() : '';

            const result = await ServerAPI.get('/pre-approvals' + qs);
            // Backend returns { data, boards, groups }
            if (result && !Array.isArray(result)) {
                this.preApprovalData = result.data || [];
                this.preApprovalBoards = result.boards || [];
                this.preApprovalGroups = result.groups || [];
            } else {
                this.preApprovalData = Array.isArray(result) ? result : [];
            }
            this.renderPreApprovals(this.preApprovalData);
            this._populatePreApprovalFilters();
            this._initPreApprovalModal();
        } catch (err) {
            console.warn('Pre-approvals load failed:', err.message);
        }
    },

    _populatePreApprovalFilters() {
        const boardSelect = document.getElementById('preApprovalBoardSelect');
        const groupSelect = document.getElementById('preApprovalGroupSelect');

        if (boardSelect && this.preApprovalBoards.length > 0) {
            const currentVal = boardSelect.value;
            boardSelect.innerHTML = '<option value="">All Boards</option>' +
                this.preApprovalBoards.map(b =>
                    `<option value="${Utils.escapeHtml(b.board_id)}">${Utils.escapeHtml(b.board_name || b.board_id)}</option>`
                ).join('');
            boardSelect.value = currentVal;
            boardSelect.style.display = '';
            if (!this._paFiltersInitialized) {
                boardSelect.addEventListener('change', () => this.loadPreApprovals());
            }
        }

        if (groupSelect && this.preApprovalGroups.length > 0) {
            const currentVal = groupSelect.value;
            groupSelect.innerHTML = '<option value="">All Groups</option>' +
                this.preApprovalGroups.map(g =>
                    `<option value="${Utils.escapeHtml(g)}">${Utils.escapeHtml(g)}</option>`
                ).join('');
            groupSelect.value = currentVal;
            groupSelect.style.display = '';
            if (!this._paFiltersInitialized) {
                groupSelect.addEventListener('change', () => this.loadPreApprovals());
            }
        }

        this._paFiltersInitialized = true;
    },

    PRE_APPROVAL_COLUMNS: [
        { field: 'client_name', label: 'Client Name' },
        { field: 'loan_amount', label: 'Loan Amount' },
        { field: 'pre_approval_date', label: 'Pre-Approval Date' },
        { field: 'expiration_date', label: 'Expiration Date' },
        { field: 'status', label: 'Status' },
        { field: 'assigned_lo_name', label: 'Loan Officer' },
        { field: 'property_address', label: 'Property' },
        { field: 'loan_type', label: 'Loan Type' },
        { field: 'notes', label: 'Notes' },
    ],

    _preApprovalColumnsLoaded: false,

    async loadPreApprovalConfig() {
        try {
            const [config, prefs] = await Promise.all([
                ServerAPI.getMondayViewConfig('pre_approvals'),
                this._loadDisplayPrefs(),
            ]);
            let cols = (config.columns || []).filter(c => c.visible !== false);
            // Only use server config if it has more than just client_name
            if (cols.length > 1) {
                this.PRE_APPROVAL_COLUMNS = cols.map(c => ({ field: c.field, label: c.label }));
            }
            // Apply user display preferences (hide unchecked columns)
            const userPref = prefs?.display_columns_pre_approvals;
            if (Array.isArray(userPref) && userPref.length > 0) {
                const prefMap = {};
                userPref.forEach(p => { prefMap[p.field] = p; });
                this.PRE_APPROVAL_COLUMNS = this.PRE_APPROVAL_COLUMNS.filter(c =>
                    prefMap[c.field] === undefined || prefMap[c.field].visible !== false
                );
            }
            this._preApprovalColumnsLoaded = true;
        } catch (e) {
            console.warn('Failed to load pre-approval view config, using defaults:', e.message || e);
        }
    },

    _getVisiblePreApprovalColumns() {
        // Preferences are applied during loadPreApprovalConfig; just return columns
        return this.PRE_APPROVAL_COLUMNS;
    },

    _renderPreApprovalCell(item, field) {
        const val = item[field];
        switch (field) {
            case 'client_name':
                return `<td><strong>${Utils.escapeHtml(val || '')}</strong></td>`;
            case 'loan_amount':
                return `<td class="currency">${Utils.formatCurrency(val)}</td>`;
            case 'pre_approval_date':
            case 'expiration_date':
                return `<td>${Utils.formatDate(val)}</td>`;
            case 'status':
                return `<td><span class="status-badge ${(val || '').toLowerCase().replace(/[^a-z]/g, '-')}">${Utils.escapeHtml(val || 'Unknown')}</span></td>`;
            case 'assigned_lo_name':
                return `<td><div class="lo-cell"><span class="lo-avatar">${Utils.getInitials(val)}</span> ${Utils.escapeHtml(val || 'Unassigned')}</div></td>`;
            case 'property_address':
                return `<td>${Utils.escapeHtml(val || 'TBD')}</td>`;
            case 'notes':
                return `<td class="notes-cell" title="${Utils.escapeHtml(val || '')}">${Utils.escapeHtml(val || '')}</td>`;
            default:
                return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
        }
    },

    renderPreApprovals(data) {
        const tbody = document.getElementById('preApprovalsBody');
        if (!tbody) return;

        const cols = this._getVisiblePreApprovalColumns();

        // Update thead — add Actions column
        const thead = document.getElementById('preApprovalsHead');
        if (thead) {
            thead.innerHTML = '<tr>' +
                cols.map(c => `<th class="sortable">${Utils.escapeHtml(c.label)}</th>`).join('') +
                '<th style="width:70px;text-align:center;">Actions</th>' +
                '</tr>';
            thead.querySelectorAll('.sortable').forEach(header => {
                header.addEventListener('click', (e) => TableManager.handleSort(e));
            });
        }

        if (!data?.length) {
            tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-state">
                <i class="fas fa-database"></i>
                <p>No pre-approval data yet. Sync from Monday.com to populate.</p>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item =>
            `<tr data-id="${item.id}">
                ${cols.map(c => this._renderPreApprovalCell(item, c.field)).join('')}
                <td class="pa-row-actions">
                    <button type="button" class="pa-edit-btn" data-id="${item.id}" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                    <button type="button" class="pa-delete-btn" data-id="${item.id}" title="Delete"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>`
        ).join('');

        // Bind row action buttons
        tbody.querySelectorAll('.pa-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => this._openPreApprovalEdit(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.pa-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => this._deletePreApproval(parseInt(btn.dataset.id)));
        });
    },

    // ========================================
    // PRE-APPROVAL CRUD
    // ========================================
    _paModalInitialized: false,

    _initPreApprovalModal() {
        if (this._paModalInitialized) return;
        this._paModalInitialized = true;

        const modal = document.getElementById('preApprovalModal');
        if (!modal) return;

        // Close buttons
        modal.querySelectorAll('.pa-modal-close').forEach(btn => {
            btn.addEventListener('click', () => this._closePreApprovalModal());
        });

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this._closePreApprovalModal();
        });

        // Form submit
        const form = document.getElementById('preApprovalForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this._submitPreApproval();
            });
        }
    },

    _openPreApprovalCreate() {
        this._initPreApprovalModal();
        const modal = document.getElementById('preApprovalModal');
        const title = document.getElementById('paModalTitle');
        const form = document.getElementById('preApprovalForm');
        if (!modal || !form) return;

        // Reset form
        form.reset();
        document.getElementById('paFormId').value = '';
        document.getElementById('paStatus').value = 'active';

        // Default dates
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('paPreApprovalDate').value = today;
        // Default expiration: 90 days from now
        const exp = new Date();
        exp.setDate(exp.getDate() + 90);
        document.getElementById('paExpirationDate').value = exp.toISOString().split('T')[0];

        if (title) title.innerHTML = '<i class="fas fa-clipboard-check" style="color:var(--green-bright);margin-right:0.5rem;"></i> New Pre-Approval';
        document.getElementById('paFormSubmit').innerHTML = '<i class="fas fa-save"></i> Create';

        modal.classList.add('active');
        document.getElementById('paClientName').focus();
    },

    _openPreApprovalEdit(id) {
        this._initPreApprovalModal();
        const item = this.preApprovalData?.find(pa => pa.id === id);
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
        document.getElementById('paPropertyAddress').value = item.property_address || '';
        document.getElementById('paNotes').value = item.notes || '';

        if (title) title.innerHTML = '<i class="fas fa-pencil-alt" style="color:var(--green-bright);margin-right:0.5rem;"></i> Edit Pre-Approval';
        document.getElementById('paFormSubmit').innerHTML = '<i class="fas fa-save"></i> Update';

        modal.classList.add('active');
        document.getElementById('paClientName').focus();
    },

    _closePreApprovalModal() {
        const modal = document.getElementById('preApprovalModal');
        if (modal) {
            modal.classList.remove('active');
        }
    },

    async _submitPreApproval() {
        const submitBtn = document.getElementById('paFormSubmit');
        const originalHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            const id = document.getElementById('paFormId').value;
            const data = {
                client_name: document.getElementById('paClientName').value.trim(),
                loan_amount: parseFloat(document.getElementById('paLoanAmount').value),
                pre_approval_date: document.getElementById('paPreApprovalDate').value,
                expiration_date: document.getElementById('paExpirationDate').value,
                status: document.getElementById('paStatus').value,
                loan_type: document.getElementById('paLoanType').value.trim() || null,
                property_address: document.getElementById('paPropertyAddress').value.trim() || null,
                notes: document.getElementById('paNotes').value.trim() || null,
            };

            if (id) {
                await ServerAPI.updatePreApproval(id, data);
            } else {
                await ServerAPI.createPreApproval(data);
            }

            this._closePreApprovalModal();
            await this.loadPreApprovals();
        } catch (err) {
            console.error('Pre-approval save error:', err);
            alert('Failed to save pre-approval: ' + (err.message || 'Unknown error'));
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHtml;
        }
    },

    async _deletePreApproval(id) {
        const item = this.preApprovalData?.find(pa => pa.id === id);
        const name = item?.client_name || 'this pre-approval';

        if (!confirm(`Delete "${name}"? This will also archive it on Monday.com.`)) return;

        try {
            await ServerAPI.deletePreApproval(id);
            await this.loadPreApprovals();
        } catch (err) {
            console.error('Pre-approval delete error:', err);
            alert('Failed to delete: ' + (err.message || 'Unknown error'));
        }
    },

    // ========================================
    // PIPELINE (Monday.com sync) — dynamic columns
    // ========================================
    pipelineColumns: [],   // loaded from /monday/view-config

    FALLBACK_PIPELINE_COLUMNS: [
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

    _displayPrefs: null,

    async _loadDisplayPrefs() {
        if (this._displayPrefs) return this._displayPrefs;
        try {
            this._displayPrefs = await ServerAPI.get('/me/profile/display-preferences');
        } catch {
            this._displayPrefs = {};
        }
        return this._displayPrefs;
    },

    async loadPipelineConfig() {
        try {
            const [config, prefs] = await Promise.all([
                ServerAPI.getMondayViewConfig(),
                this._loadDisplayPrefs(),
            ]);
            let cols = (config.columns || []).filter(c => c.visible !== false);
            // Only use server config if it has more than just client_name
            if (cols.length > 1) {
                this.pipelineColumns = cols;
            } else {
                this.pipelineColumns = this.FALLBACK_PIPELINE_COLUMNS;
            }
            // Apply user display preferences (hide unchecked columns)
            const userPref = prefs.display_columns_pipeline;
            if (Array.isArray(userPref) && userPref.length > 0) {
                const prefMap = {};
                userPref.forEach(p => { prefMap[p.field] = p; });
                this.pipelineColumns = this.pipelineColumns.filter(c =>
                    prefMap[c.field] === undefined || prefMap[c.field].visible !== false
                );
            }
        } catch (e) {
            console.warn('Failed to load pipeline view config, using defaults:', e.message || e);
            this.pipelineColumns = this.FALLBACK_PIPELINE_COLUMNS;
        }
        this.renderPipelineHead();
    },

    renderPipelineHead() {
        const thead = document.getElementById('pipelineHead');
        if (!thead) return;
        // Use current columns, or fallback if somehow empty
        const cols = this.pipelineColumns.length > 0
            ? this.pipelineColumns
            : this.FALLBACK_PIPELINE_COLUMNS;
        thead.innerHTML = '<tr>' +
            cols.map(c => `<th class="sortable">${Utils.escapeHtml(Utils.toTitleCase(c.label || c.field))}</th>`).join('') +
            '</tr>';
        // Re-bind sorting after head rebuild
        thead.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', (e) => TableManager.handleSort(e));
        });
    },

    async loadPipeline() {
        try {
            // Load column config first if not loaded yet
            if (this.pipelineColumns.length === 0) {
                await this.loadPipelineConfig();
            }
            // Safety: always ensure head is rendered (clears "Loading..." placeholder)
            this.renderPipelineHead();

            const data = await ServerAPI.getPipeline();
            this.pipelineData = data || [];
            this.renderPipeline(data);
            this.populatePipelineFilters(data);
            this.updatePipelineSummary(data);
            this.loadSyncStatus();
        } catch (error) {
            console.error('Error loading pipeline:', error);
            // Even on error, ensure the header is not stuck on "Loading..."
            if (this.pipelineColumns.length === 0) {
                this.pipelineColumns = this.FALLBACK_PIPELINE_COLUMNS;
            }
            this.renderPipelineHead();
            // Show error state in the table body
            const tbody = document.getElementById('pipelineBody');
            if (tbody && !this.pipelineData?.length) {
                tbody.innerHTML = `<tr><td colspan="${this.pipelineColumns.length}" class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Failed to load pipeline data. <button type="button" class="btn btn-secondary btn-sm" onclick="API.loadPipeline()" style="margin-top:0.5rem;"><i class="fas fa-redo"></i> Retry</button></p>
                </td></tr>`;
            }
        }
    },

    updatePipelineSummary(data) {
        const units = data?.length || 0;
        const totalVolume = (data || []).reduce((sum, item) => {
            const amount = parseFloat(item.loan_amount) || 0;
            return sum + amount;
        }, 0);

        const unitsEl = document.getElementById('pipelineTotalUnits');
        const volumeEl = document.getElementById('pipelineTotalVolume');
        if (unitsEl) unitsEl.textContent = Utils.formatNumber(units);
        if (volumeEl) volumeEl.textContent = Utils.formatCurrency(totalVolume);

        // GoalsManager now fetches its own data via _fetchAllGoalData()
    },

    // Date fields that need formatting
    DATE_FIELDS: ['application_date', 'lock_expiration_date', 'closing_date', 'funding_date', 'target_close_date'],
    CURRENCY_FIELDS: ['loan_amount'],

    renderPipeline(data) {
        const tbody = document.getElementById('pipelineBody');
        if (!tbody) return;
        const cols = this.pipelineColumns;

        if (!data?.length) {
            tbody.innerHTML = `<tr><td colspan="${cols.length || 1}" class="empty-state">
                <i class="fas fa-database"></i>
                <p>No pipeline data yet. Sync from Monday.com to populate.</p>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => {
            const cells = cols.map(col => {
                const val = item[col.field];
                // Special rendering per field type
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
                return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
            }).join('');

            return `<tr data-id="${item.id}" data-lo="${Utils.escapeHtml(item.assigned_lo_name || '')}">${cells}</tr>`;
        }).join('');
    },

    async populatePipelineFilters(data) {
        if (!data?.length) return;

        // Populate Loan Officer filter — only show active employees
        const loSelect = document.getElementById('pipelineLO');
        if (loSelect) {
            let activeNames = null;
            try {
                const activeUsers = await ServerAPI.get('/users/directory');
                if (Array.isArray(activeUsers)) {
                    activeNames = new Set(activeUsers.map(u => u.name));
                }
            } catch { /* fall back to unfiltered list */ }

            const allLOs = [...new Set(data.map(d => d.assigned_lo_name).filter(Boolean))].sort();
            const los = activeNames ? allLOs.filter(name => activeNames.has(name)) : allLOs;

            const currentVal = loSelect.value;
            loSelect.innerHTML = '<option value="">All Loan Officers</option>' +
                los.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('');
            loSelect.value = currentVal;
        }
    },

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
    // GOALS
    // ========================================
    async loadGoals() {
        // TODO: Implement when /api/goals endpoint is live
    },

    // ========================================
    // CRUD OPERATIONS (delegate to ServerAPI)
    // ========================================

    // Pre-Approvals
    createPreApproval(data) {
        return ServerAPI.post('/pre-approvals', data);
    },

    updatePreApproval(id, data) {
        return ServerAPI.put(`/pre-approvals/${id}`, data);
    },

    deletePreApproval(id) {
        return ServerAPI.delete(`/pre-approvals/${id}`);
    },

    // Tasks
    createTask(data) {
        return ServerAPI.post('/tasks', data);
    },

    updateTask(id, data) {
        return ServerAPI.put(`/tasks/${id}`, data);
    },

    deleteTask(id) {
        return ServerAPI.delete(`/tasks/${id}`);
    },

    // News
    createAnnouncement(data) {
        return ServerAPI.post('/news', data);
    }
};

// ========================================
// MONDAY.COM SETTINGS (SLIM)
// Modal moved to Admin Settings. Only toolbar sync + pipeline filter remain.
// ========================================
const MondaySettings = {
    init() {
        // Pipeline filter handlers — both LO dropdown and search update summary
        document.getElementById('pipelineLO')?.addEventListener('change', () => this.filterPipeline());
        const searchInput = document.getElementById('pipelineSearch');
        if (searchInput) {
            const debounced = Utils.debounce(() => this.filterPipeline(), 200);
            searchInput.addEventListener('input', debounced);
        }
    },

    async triggerSyncFromToolbar(clickedBtn) {
        // Disable ALL sync buttons while syncing
        const allBtns = document.querySelectorAll('.monday-sync-btn');
        const originals = new Map();
        allBtns.forEach(btn => {
            originals.set(btn, btn.innerHTML);
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        });

        try {
            // POST /sync now returns immediately — sync runs in background
            await ServerAPI.syncMonday();

            // Poll for sync completion (check every 3s, up to 2 minutes)
            const maxWait = 120000;
            const interval = 3000;
            const start = Date.now();
            let completed = false;

            while (Date.now() - start < maxWait) {
                await new Promise(r => setTimeout(r, interval));
                try {
                    const status = await ServerAPI.getMondaySyncStatus();
                    if (status.lastSync) {
                        const syncStatus = status.lastSync.status;
                        if (syncStatus === 'success' || syncStatus === 'error') {
                            completed = true;
                            if (syncStatus === 'error') {
                                Utils.showToast('Sync completed with errors: ' + (status.lastSync.error_message || 'Unknown'), 'error');
                            }
                            break;
                        }
                    }
                } catch { /* ignore polling errors */ }
            }

            // Reload all three synced sections
            await Promise.allSettled([
                API.loadPreApprovals(),
                API.loadPipeline(),
                typeof FundedLoans !== 'undefined' ? FundedLoans.load() : Promise.resolve(),
            ]);

            // Brief success flash
            allBtns.forEach(btn => {
                btn.innerHTML = '<i class="fas fa-check"></i> Done';
            });
            if (completed) {
                Utils.showToast('Monday.com sync completed successfully!', 'success');
            }
            setTimeout(() => {
                allBtns.forEach(btn => {
                    btn.innerHTML = originals.get(btn);
                    btn.disabled = false;
                });
            }, 2000);
        } catch (err) {
            Utils.showToast('Sync failed: ' + err.message, 'error');
            allBtns.forEach(btn => {
                btn.innerHTML = originals.get(btn);
                btn.disabled = false;
            });
        }
    },

    filterPipeline() {
        const loVal = (document.getElementById('pipelineLO')?.value || '').toLowerCase();
        const searchVal = (document.getElementById('pipelineSearch')?.value || '').toLowerCase();
        const rows = document.querySelectorAll('#pipelineTable tbody tr');

        rows.forEach(row => {
            if (row.querySelector('.empty-state')) return;
            const rowLO = (row.getAttribute('data-lo') || '').toLowerCase();
            const rowText = row.textContent.toLowerCase();

            let show = true;
            if (loVal && rowLO !== loVal) show = false;
            if (searchVal && !rowText.includes(searchVal)) show = false;
            row.style.display = show ? '' : 'none';
        });

        // Recalculate summary from visible rows
        this._updatePipelineSummaryFromVisible();
    },

    /** Recalculate pipeline summary from currently visible table rows */
    _updatePipelineSummaryFromVisible() {
        if (!API.pipelineData) return;

        const loVal = (document.getElementById('pipelineLO')?.value || '').toLowerCase();
        const searchVal = (document.getElementById('pipelineSearch')?.value || '').toLowerCase();
        const hasFilters = loVal || searchVal;

        if (!hasFilters) {
            // No filters active — show full summary
            API.updatePipelineSummary(API.pipelineData);
            return;
        }

        // Build filtered dataset from the original data
        const filtered = API.pipelineData.filter(item => {
            if (loVal) {
                const itemLO = (item.assigned_lo_name || '').toLowerCase();
                if (itemLO !== loVal) return false;
            }
            if (searchVal) {
                const text = Object.values(item).join(' ').toLowerCase();
                if (!text.includes(searchVal)) return false;
            }
            return true;
        });

        API.updatePipelineSummary(filtered);
    },
};

// ========================================
// DATA REFRESHER — pauses when tab is hidden
// ========================================
const DataRefresher = {
    intervals: {},
    _visibilityBound: false,

    start() {
        if (!CONFIG.features.autoRefresh) return;

        this.intervals.news = setInterval(() => API.loadNews(), CONFIG.refresh.news);
        this.intervals.tasks = setInterval(() => API.loadTasks(), CONFIG.refresh.tasks);
        this.intervals.preApprovals = setInterval(() => API.loadPreApprovals(), CONFIG.refresh.preApprovals);
        this.intervals.pipeline = setInterval(() => API.loadPipeline(), CONFIG.refresh.pipeline);
        this.intervals.goals = setInterval(() => API.loadGoals(), CONFIG.refresh.goals);

        // Pause refreshes when tab is hidden, resume when visible
        if (!this._visibilityBound) {
            this._visibilityBound = true;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this._pause();
                } else {
                    // Refresh immediately on return, then resume intervals
                    API.loadAllData();
                    this._resume();
                }
            });
        }

    },

    /** Clear intervals without removing the visibility listener */
    _pause() {
        Object.values(this.intervals).forEach(id => clearInterval(id));
        this.intervals = {};
    },

    /** Re-create intervals (called when tab becomes visible) */
    _resume() {
        if (!CONFIG.features.autoRefresh) return;
        // Avoid duplicate intervals
        this._pause();
        this.intervals.news = setInterval(() => API.loadNews(), CONFIG.refresh.news);
        this.intervals.tasks = setInterval(() => API.loadTasks(), CONFIG.refresh.tasks);
        this.intervals.preApprovals = setInterval(() => API.loadPreApprovals(), CONFIG.refresh.preApprovals);
        this.intervals.pipeline = setInterval(() => API.loadPipeline(), CONFIG.refresh.pipeline);
        this.intervals.goals = setInterval(() => API.loadGoals(), CONFIG.refresh.goals);
    },

    stop() {
        this._pause();
    },

    restart() {
        this.stop();
        this.start();
    }
};

// Export to global scope
window.API = API;
window.DataRefresher = DataRefresher;
