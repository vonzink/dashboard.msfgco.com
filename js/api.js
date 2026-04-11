/* ============================================
   MSFG Dashboard - Data & Views
   Slim orchestrator: delegates to PreApprovals, Pipeline modules.
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
    // PRE-APPROVALS — delegate to PreApprovals module
    // ========================================
    get preApprovalData() { return PreApprovals.data; },
    set preApprovalData(v) { PreApprovals.data = v; },

    loadPreApprovals()          { return PreApprovals.load(); },
    renderPreApprovals(data)    { return PreApprovals.render(data); },
    _openPreApprovalCreate()    { return PreApprovals.openCreate(); },
    _openPreApprovalEdit(id)    { return PreApprovals.openEdit(id); },
    _closePreApprovalDetail()   { return PreApprovals._closeDetail(); },
    _deletePreApproval(id)      { return PreApprovals.deleteItem(id); },

    // ========================================
    // PIPELINE — delegate to Pipeline module
    // ========================================
    get pipelineData() { return Pipeline.data; },
    set pipelineData(v) { Pipeline.data = v; },
    get pipelineColumns() { return Pipeline.columns; },

    loadPipeline()              { return Pipeline.load(); },
    loadPipelineConfig()        { return Pipeline.loadConfig(); },
    renderPipeline(data)        { return Pipeline.render(data); },
    renderPipelineHead()        { return Pipeline.renderHead(); },
    togglePipelineColumns()     { return Pipeline.toggleColumns(); },
    updatePipelineSummary(data) { return Pipeline.updateSummary(data); },
    populatePipelineFilters(d)  { return Pipeline.populateFilters(d); },
    loadSyncStatus()            { return Pipeline.loadSyncStatus(); },
    _closePipelineDetail()      { return Pipeline._closeDetail(); },
    _statusBadgeClass(val)      { return Utils.statusBadgeClass(val); },

    // ========================================
    // SHARED: Display Preferences (used by PreApprovals, Pipeline, FundedLoans)
    // ========================================
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

    // ========================================
    // GOALS
    // ========================================
    async loadGoals() {
        // TODO: Implement when /api/goals endpoint is live
    }
};

// Export to global scope
window.API = API;
