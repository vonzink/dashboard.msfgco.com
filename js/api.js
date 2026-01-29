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
    // PIPELINE
    // ========================================
    async loadPipeline() {
        try {
            const data = await ServerAPI.getPipeline();
            // Transform snake_case to camelCase for rendering
            const transformedData = data.map(item => ({
                id: item.id,
                clientName: item.client_name,
                loanAmount: item.loan_amount,
                loanType: item.loan_type,
                stage: item.stage,
                targetCloseDate: item.target_close_date,
                assignedLO: item.assigned_lo_name || 'Unassigned',
                investor: item.investor,
                status: item.status || 'On Track',
                statusClass: item.status === 'On Track' ? 'active' : (item.status?.toLowerCase().replace(/\s+/g, '') || 'active')
            }));
            this.renderPipeline(transformedData);
        } catch (error) {
            console.error('Error loading pipeline:', error);
        }
    },

    renderPipeline(data) {
        const tbody = document.getElementById('pipelineBody');
        if (!tbody || !data?.length) return;

        tbody.innerHTML = data.map(item => {
            const stageClass = item.stage.toLowerCase().replace(/\s+/g, '');
            
            return `
                <tr data-id="${item.id}">
                    <td><strong>${Utils.escapeHtml(item.clientName)}</strong></td>
                    <td class="currency">${Utils.formatCurrency(item.loanAmount)}</td>
                    <td>${Utils.escapeHtml(item.loanType)}</td>
                    <td>
                        <span class="status-badge ${stageClass}">
                            ${Utils.escapeHtml(item.stage)}
                        </span>
                    </td>
                    <td>${Utils.formatDate(item.targetCloseDate)}</td>
                    <td>
                        <div class="lo-cell">
                            <span class="lo-avatar">${Utils.getInitials(item.assignedLO)}</span>
                            ${Utils.escapeHtml(item.assignedLO)}
                        </div>
                    </td>
                    <td>${Utils.escapeHtml(item.investor)}</td>
                    <td>
                        <span class="status-badge ${item.statusClass || 'active'}">
                            ${Utils.escapeHtml(item.status)}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');
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
