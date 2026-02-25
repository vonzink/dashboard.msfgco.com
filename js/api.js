/* ============================================
   MSFG Dashboard - API Module
   All API calls and data rendering
   ============================================ */

const API = {
    // ========================================
    // HTTP HELPERS
    // ========================================
    
    /**
     * Base fetch wrapper with error handling
     */
    async request(endpoint, options = {}) {
        const url = `${CONFIG.api.baseUrl}${endpoint}`;
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                // Add auth header if needed
                // 'Authorization': `Bearer ${token}`
            },
            timeout: CONFIG.api.timeout
        };
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.api.timeout);
            
            const response = await fetch(url, {
                ...defaultOptions,
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },

    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    },

    // ========================================
    // LOAD ALL DATA
    // ========================================
    async loadAllData() {
        console.log('Loading all dashboard data...');
        
        try {
            await Promise.allSettled([
                this.loadNews(),
                this.loadTasks(),
                this.loadPreApprovals(),
                this.loadPipeline(),
                this.loadGoals()
            ]);
            console.log('Dashboard data loaded');
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    },

    // ========================================
    // NEWS & ANNOUNCEMENTS
    // ========================================
    async loadNews() {
        // Uncomment when API is ready
        // const data = await this.get('/news');
        // this.renderNews(data);
        console.log('News: API endpoint ready at /api/news');
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
        // Uncomment when API is ready
        // const data = await this.get('/tasks');
        // this.renderTasks(data);
        console.log('Tasks: API endpoint ready at /api/tasks');
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
    async loadPreApprovals() {
        // Uncomment when API is ready
        // const data = await this.get('/pre-approvals');
        // this.renderPreApprovals(data);
        console.log('Pre-approvals: API endpoint ready at /api/pre-approvals');
    },

    renderPreApprovals(data) {
        const tbody = document.getElementById('preApprovalsBody');
        if (!tbody || !data?.length) return;

        tbody.innerHTML = data.map(item => `
            <tr data-id="${item.id}">
                <td><strong>${Utils.escapeHtml(item.clientName)}</strong></td>
                <td class="currency">${Utils.formatCurrency(item.loanAmount)}</td>
                <td>${Utils.formatDate(item.preApprovalDate)}</td>
                <td>${Utils.formatDate(item.expirationDate)}</td>
                <td>
                    <span class="status-badge ${item.status.toLowerCase()}">
                        ${Utils.capitalize(item.status)}
                    </span>
                </td>
                <td>
                    <div class="lo-cell">
                        <span class="lo-avatar">${Utils.getInitials(item.assignedLO)}</span>
                        ${Utils.escapeHtml(item.assignedLO)}
                    </div>
                </td>
                <td>${Utils.escapeHtml(item.propertyAddress || 'TBD')}</td>
                <td>${Utils.escapeHtml(item.loanType)}</td>
                <td class="notes-cell" title="${Utils.escapeHtml(item.notes || '')}">
                    ${Utils.escapeHtml(item.notes || '')}
                </td>
            </tr>
        `).join('');
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

    async loadPipelineConfig() {
        try {
            const config = await ServerAPI.getMondayViewConfig();
            const cols = (config.columns || []).filter(c => c.visible !== false);
            // Only use server config if it has more than just client_name
            if (cols.length > 1) {
                this.pipelineColumns = cols;
            } else {
                this.pipelineColumns = this.FALLBACK_PIPELINE_COLUMNS;
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
            cols.map(c => `<th class="sortable">${Utils.escapeHtml(c.label || c.field)}</th>`).join('') +
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

    populatePipelineFilters(data) {
        if (!data?.length) return;

        // Populate Loan Officer filter
        const loSelect = document.getElementById('pipelineLO');
        if (loSelect) {
            const los = [...new Set(data.map(d => d.assigned_lo_name).filter(Boolean))].sort();
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
        // Uncomment when API is ready
        // const data = await this.get('/goals');
        // this.renderGoals(data);
        console.log('Goals: API endpoint ready at /api/goals');
    },

    renderGoals(data) {
        if (!data) return;
        
        // Render company goals
        if (data.company) {
            this.renderCompanyGoals(data.company);
        }
        
        // Render individual LO goals
        if (data.loanOfficers) {
            this.renderLOGoals(data.loanOfficers);
        }
    },

    renderCompanyGoals(goals) {
        // Update goal cards dynamically
        // This would update the values in the existing goal cards
    },

    renderLOGoals(loGoals) {
        // Update LO performance table
        // This would update the individual performance rows
    },

    // ========================================
    // CRUD OPERATIONS
    // ========================================
    
    // Pre-Approvals
    async createPreApproval(data) {
        return this.post('/pre-approvals', data);
    },

    async updatePreApproval(id, data) {
        return this.put(`/pre-approvals/${id}`, data);
    },

    async deletePreApproval(id) {
        return this.delete(`/pre-approvals/${id}`);
    },

    // Tasks
    async createTask(data) {
        return this.post('/tasks', data);
    },

    async updateTask(id, data) {
        return this.put(`/tasks/${id}`, data);
    },

    async deleteTask(id) {
        return this.delete(`/tasks/${id}`);
    },

    // News
    async createAnnouncement(data) {
        return this.post('/news', data);
    }
};

// ========================================
// MONDAY.COM SETTINGS (SLIM)
// Modal moved to Admin Settings. Only toolbar sync + pipeline filter remain.
// ========================================
const MondaySettings = {
    init() {
        // Pipeline filter handler
        document.getElementById('pipelineLO')?.addEventListener('change', () => this.filterPipeline());
    },

    async triggerSyncFromToolbar() {
        const btn = document.getElementById('mondaySyncBtn');
        if (!btn) return;
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const result = await ServerAPI.syncMonday();
            await API.loadPipeline();
            // Brief success flash
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 2000);
        } catch (err) {
            alert('Sync failed: ' + err.message);
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    filterPipeline() {
        const loVal = (document.getElementById('pipelineLO')?.value || '').toLowerCase();
        const rows = document.querySelectorAll('#pipelineTable tbody tr');

        rows.forEach(row => {
            if (row.querySelector('.empty-state')) return;
            const rowLO = (row.getAttribute('data-lo') || '').toLowerCase();

            let show = true;
            if (loVal && rowLO !== loVal) show = false;
            row.style.display = show ? '' : 'none';
        });
    },
};

// ========================================
// DATA REFRESHER
// ========================================
const DataRefresher = {
    intervals: {},

    start() {
        if (!CONFIG.features.autoRefresh) return;

        this.intervals.news = setInterval(() => API.loadNews(), CONFIG.refresh.news);
        this.intervals.tasks = setInterval(() => API.loadTasks(), CONFIG.refresh.tasks);
        this.intervals.preApprovals = setInterval(() => API.loadPreApprovals(), CONFIG.refresh.preApprovals);
        this.intervals.pipeline = setInterval(() => API.loadPipeline(), CONFIG.refresh.pipeline);
        this.intervals.goals = setInterval(() => API.loadGoals(), CONFIG.refresh.goals);

        console.log('Auto-refresh started');
    },

    stop() {
        Object.values(this.intervals).forEach(id => clearInterval(id));
        this.intervals = {};
        console.log('Auto-refresh stopped');
    },

    restart() {
        this.stop();
        this.start();
    }
};

// Export to global scope
window.API = API;
window.DataRefresher = DataRefresher;
