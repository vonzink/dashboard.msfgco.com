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
        const isLO = (CONFIG.currentUser?.activeRole || '').toLowerCase() === 'lo';

        if (boardSelect && this.preApprovalBoards.length > 0) {
            const currentVal = boardSelect.value;

            // LOs with only their assigned boards — hide "All Boards" if only 1 board
            if (isLO && this.preApprovalBoards.length === 1) {
                boardSelect.innerHTML = this.preApprovalBoards.map(b =>
                    `<option value="${Utils.escapeHtml(b.board_id)}">${Utils.escapeHtml(b.board_name || b.board_id)}</option>`
                ).join('');
                boardSelect.value = this.preApprovalBoards[0].board_id;
                boardSelect.style.display = '';
            } else {
                boardSelect.innerHTML = '<option value="">All Boards</option>' +
                    this.preApprovalBoards.map(b =>
                        `<option value="${Utils.escapeHtml(b.board_id)}">${Utils.escapeHtml(b.board_name || b.board_id)}</option>`
                    ).join('');
                boardSelect.value = currentVal;
                boardSelect.style.display = '';
            }
            if (!this._paFiltersInitialized) {
                boardSelect.addEventListener('change', () => {
                    const gs = document.getElementById('preApprovalGroupSelect');
                    if (gs) gs.value = '';
                    this.loadPreApprovals();
                });
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
        { field: 'loan_number', label: 'Loan Number' },
        { field: 'lender', label: 'Lender' },
        { field: 'subject_property', label: 'Subject Property' },
        { field: 'loan_purpose', label: 'Loan Purpose' },
        { field: 'occupancy', label: 'Occupancy' },
        { field: 'rate', label: 'Rate' },
        { field: 'credit_score', label: 'Credit Score' },
        { field: 'income', label: 'Income' },
        { field: 'property_type', label: 'Property Type' },
        { field: 'referring_agent', label: 'Referring Agent' },
        { field: 'referring_agent_email', label: 'Agent Email' },
        { field: 'referring_agent_phone', label: 'Agent Phone' },
        { field: 'contact_date', label: 'Contact Date' },
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
            // Apply user display preferences (hide unchecked columns + reorder)
            const userPref = prefs?.display_columns_pre_approvals;
            if (Array.isArray(userPref) && userPref.length > 0) {
                const prefMap = {};
                userPref.forEach(p => { prefMap[p.field] = p; });
                this.PRE_APPROVAL_COLUMNS = this.PRE_APPROVAL_COLUMNS
                    .filter(c => prefMap[c.field] === undefined || prefMap[c.field].visible !== false)
                    .sort((a, b) => {
                        const orderA = prefMap[a.field]?.order ?? Infinity;
                        const orderB = prefMap[b.field]?.order ?? Infinity;
                        return orderA - orderB;
                    });
            }
            this._preApprovalColumnsLoaded = true;
        } catch (e) {
            console.warn('Failed to load pre-approval view config, using defaults:', e.message || e);
        }
    },

    _getVisiblePreApprovalColumns() {
        // Preferences are applied during loadPreApprovalConfig; dedupe by field
        const seen = new Set();
        return (this.PRE_APPROVAL_COLUMNS || []).filter(c => {
            if (!c || !c.field || seen.has(c.field)) return false;
            seen.add(c.field);
            return true;
        });
    },

    PA_DATE_FIELDS: ['pre_approval_date', 'expiration_date', 'contact_date', 'borrower_dob',
        'coborrower_dob', 'credit_report_date'],
    PA_CURRENCY_FIELDS: ['loan_amount', 'income'],

    _renderPreApprovalCell(item, field) {
        const val = item[field];
        if (field === 'client_name') {
            return `<td><strong>${Utils.escapeHtml(val || '')}</strong></td>`;
        }
        if (field === 'status') {
            const cls = this._statusBadgeClass(val);
            return `<td><span class="pipeline-badge ${cls}">${Utils.escapeHtml(val || 'Unknown')}</span></td>`;
        }
        if (field === 'assigned_lo_name') {
            return `<td><div class="lo-cell"><span class="lo-avatar">${Utils.getInitials(val)}</span> ${Utils.escapeHtml(val || 'Unassigned')}</div></td>`;
        }
        if (field === 'notes' || field === 'next_steps' || field === 'special_request') {
            return `<td class="notes-cell" title="${Utils.escapeHtml(val || '')}">${Utils.escapeHtml(val || '')}</td>`;
        }
        if (this.PA_CURRENCY_FIELDS.includes(field)) {
            return `<td class="currency">${val != null ? Utils.formatCurrency(val) : ''}</td>`;
        }
        if (this.PA_DATE_FIELDS.includes(field)) {
            return `<td>${val ? Utils.formatDate(val) : ''}</td>`;
        }
        return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
    },

    renderPreApprovals(data) {
        const tbody = document.getElementById('preApprovalsBody');
        if (!tbody) return;

        const cols = this._getVisiblePreApprovalColumns();

        // Update thead
        const thead = document.getElementById('preApprovalsHead');
        if (thead) {
            thead.innerHTML = '<tr>' +
                cols.map(c => `<th class="sortable">${Utils.escapeHtml(c.label)}</th>`).join('') +
                '</tr>';
            thead.querySelectorAll('.sortable').forEach(header => {
                header.addEventListener('click', (e) => TableManager.handleSort(e));
            });
        }

        if (!data?.length) {
            tbody.innerHTML = `<tr><td colspan="${cols.length}">
                <div class="empty-state-enhanced">
                    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="20" y="25" width="55" height="70" rx="4" stroke="currentColor" stroke-width="2" opacity="0.3"/>
                        <rect x="28" y="35" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.15"/>
                        <rect x="28" y="43" width="38" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
                        <rect x="28" y="51" width="25" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
                        <rect x="28" y="59" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.1"/>
                        <circle cx="85" cy="70" r="25" stroke="var(--green-bright)" stroke-width="2" fill="none" opacity="0.35"/>
                        <path d="M76 70 L82 76 L94 64" stroke="var(--green-bright)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
                    </svg>
                    <h4>No Pre-Approvals Yet</h4>
                    <p>Sync from Monday.com to see your pre-approval pipeline.</p>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="monday-sync"><i class="fas fa-sync-alt"></i> Sync Now</button>
                </div>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item =>
            `<tr data-id="${item.id}" class="pa-clickable-row">
                ${cols.map(c => this._renderPreApprovalCell(item, c.field)).join('')}
            </tr>`
        ).join('');

        // Bind row click → open detail view (edit/delete available inside detail modal)
        tbody.querySelectorAll('.pa-clickable-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = parseInt(row.dataset.id);
                this._openPreApprovalDetail(id);
            });
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

        // Detail modal close
        const detailModal = document.getElementById('paDetailModal');
        if (detailModal) {
            detailModal.querySelectorAll('.pa-detail-close').forEach(btn => {
                btn.addEventListener('click', () => this._closePreApprovalDetail());
            });
            detailModal.addEventListener('click', (e) => {
                if (e.target === detailModal) this._closePreApprovalDetail();
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
        document.getElementById('paLoanNumber').value = item.loan_number || '';
        document.getElementById('paLender').value = item.lender || '';
        document.getElementById('paLoanPurpose').value = item.loan_purpose || '';
        document.getElementById('paOccupancy').value = item.occupancy || '';
        document.getElementById('paPropertyType').value = item.property_type || '';
        document.getElementById('paRate').value = item.rate || '';
        document.getElementById('paCreditScore').value = item.credit_score || '';
        document.getElementById('paIncome').value = item.income || '';
        document.getElementById('paReferringAgent').value = item.referring_agent || '';
        document.getElementById('paReferringAgentEmail').value = item.referring_agent_email || '';
        document.getElementById('paReferringAgentPhone').value = item.referring_agent_phone || '';
        document.getElementById('paContactDate').value = toDateStr(item.contact_date);
        document.getElementById('paSubjectProperty').value = item.subject_property || '';
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
            const creditScoreVal = document.getElementById('paCreditScore').value;
            const incomeVal = document.getElementById('paIncome').value;

            const data = {
                client_name: document.getElementById('paClientName').value.trim(),
                loan_amount: document.getElementById('paLoanAmount').value ? parseFloat(document.getElementById('paLoanAmount').value) : null,
                pre_approval_date: document.getElementById('paPreApprovalDate').value || null,
                expiration_date: document.getElementById('paExpirationDate').value || null,
                status: document.getElementById('paStatus').value,
                loan_type: document.getElementById('paLoanType').value.trim() || null,
                loan_number: document.getElementById('paLoanNumber').value.trim() || null,
                lender: document.getElementById('paLender').value.trim() || null,
                loan_purpose: document.getElementById('paLoanPurpose').value.trim() || null,
                occupancy: document.getElementById('paOccupancy').value.trim() || null,
                property_type: document.getElementById('paPropertyType').value.trim() || null,
                rate: document.getElementById('paRate').value.trim() || null,
                credit_score: creditScoreVal ? parseInt(creditScoreVal, 10) : null,
                income: incomeVal ? parseFloat(incomeVal) : null,
                referring_agent: document.getElementById('paReferringAgent').value.trim() || null,
                referring_agent_email: document.getElementById('paReferringAgentEmail').value.trim() || null,
                referring_agent_phone: document.getElementById('paReferringAgentPhone').value.trim() || null,
                contact_date: document.getElementById('paContactDate').value || null,
                subject_property: document.getElementById('paSubjectProperty').value.trim() || null,
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
    // PRE-APPROVAL DETAIL VIEW
    // ========================================
    async _openPreApprovalDetail(id) {
        const item = this.preApprovalData?.find(pa => pa.id === id);
        if (!item) return;

        const modal = document.getElementById('paDetailModal');
        if (!modal) return;

        const esc = Utils.escapeHtml;
        const fmtDate = (v) => v ? Utils.formatDate(v) : '--';
        const fmtCur = (v) => v != null ? Utils.formatCurrency(v) : '--';
        const statusCls = this._statusBadgeClass(item.status);

        const title = document.getElementById('paDetailTitle');
        if (title) title.innerHTML = '<i class="fas fa-clipboard-check" style="color:var(--green-bright);margin-right:0.5rem;"></i> ' + esc(item.client_name || 'Pre-Approval');

        const body = document.getElementById('paDetailBody');

        const detailRow = (label, value) => value && value !== '--'
            ? `<div class="pa-detail-row"><span class="pa-detail-label">${esc(label)}</span><span class="pa-detail-value">${value}</span></div>`
            : '';

        body.innerHTML = `
            <div class="pa-detail-grid">
                <div class="pa-detail-section">
                    <h3 class="pa-detail-section-title"><i class="fas fa-user"></i> Client Info</h3>
                    ${detailRow('Client Name', esc(item.client_name || '--'))}
                    ${detailRow('Status', `<span class="pipeline-badge ${statusCls}">${esc(item.status || 'Unknown')}</span>`)}
                    ${detailRow('Loan Officer', esc(item.assigned_lo_name || '--'))}
                    ${detailRow('Contact Date', fmtDate(item.contact_date))}
                    ${detailRow('Borrower Email', esc(item.borrower_email || ''))}
                    ${detailRow('Borrower Phone', esc(item.borrower_phone || ''))}
                </div>
                <div class="pa-detail-section">
                    <h3 class="pa-detail-section-title"><i class="fas fa-dollar-sign"></i> Loan Details</h3>
                    ${detailRow('Loan Amount', fmtCur(item.loan_amount))}
                    ${detailRow('Pre-Approval Date', fmtDate(item.pre_approval_date))}
                    ${detailRow('Expiration Date', fmtDate(item.expiration_date))}
                    ${detailRow('Loan Type', esc(item.loan_type || ''))}
                    ${detailRow('Loan Number', esc(item.loan_number || ''))}
                    ${detailRow('Lender', esc(item.lender || ''))}
                    ${detailRow('Loan Purpose', esc(item.loan_purpose || ''))}
                    ${detailRow('Occupancy', esc(item.occupancy || ''))}
                    ${detailRow('Rate', esc(item.rate || ''))}
                    ${detailRow('Credit Score', item.credit_score ? String(item.credit_score) : '')}
                    ${detailRow('Income', fmtCur(item.income))}
                    ${detailRow('Property Type', esc(item.property_type || ''))}
                </div>
                <div class="pa-detail-section">
                    <h3 class="pa-detail-section-title"><i class="fas fa-user-tie"></i> Referring Agent</h3>
                    ${detailRow('Agent Name', esc(item.referring_agent || '--'))}
                    ${detailRow('Agent Email', item.referring_agent_email ? `<a href="mailto:${esc(item.referring_agent_email)}">${esc(item.referring_agent_email)}</a>` : '')}
                    ${detailRow('Agent Phone', item.referring_agent_phone ? `<a href="tel:${esc(item.referring_agent_phone)}">${esc(item.referring_agent_phone)}</a>` : '')}
                </div>
                <div class="pa-detail-section">
                    <h3 class="pa-detail-section-title"><i class="fas fa-map-marker-alt"></i> Property</h3>
                    ${detailRow('Subject Property', esc(item.subject_property || ''))}
                    ${detailRow('Property Address', esc(item.property_address || ''))}
                </div>
            </div>
            ${item.notes ? `<div class="pa-detail-section full-width"><h3 class="pa-detail-section-title"><i class="fas fa-sticky-note"></i> Monday Notes</h3><div class="pa-detail-monday-notes">${esc(item.notes)}</div></div>` : ''}
            <div class="pa-detail-section full-width">
                <h3 class="pa-detail-section-title"><i class="fas fa-comments"></i> Notes</h3>
                <div class="pa-notes-add">
                    <textarea id="paNewNoteInput" rows="2" placeholder="Add a note..." class="form-input"></textarea>
                    <button type="button" class="btn btn-primary btn-sm" id="paAddNoteBtn"><i class="fas fa-plus"></i> Add Note</button>
                </div>
                <div id="paNotesContainer" class="pa-notes-list">
                    <div style="text-align:center;padding:1rem;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Loading notes...</div>
                </div>
            </div>
            <div class="pa-detail-actions">
                <button type="button" class="btn btn-secondary" onclick="API._closePreApprovalDetail(); API._openPreApprovalEdit(${item.id});"><i class="fas fa-pencil-alt"></i> Edit</button>
                <button type="button" class="btn btn-danger" onclick="API._closePreApprovalDetail(); API._deletePreApproval(${item.id});"><i class="fas fa-trash-alt"></i> Delete</button>
            </div>
        `;

        modal.classList.add('active');

        // Bind add note
        document.getElementById('paAddNoteBtn')?.addEventListener('click', () => this._addPreApprovalNote(id));
        document.getElementById('paNewNoteInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._addPreApprovalNote(id);
        });

        // Load notes
        this._loadPreApprovalNotes(id);
    },

    _closePreApprovalDetail() {
        const modal = document.getElementById('paDetailModal');
        if (modal) modal.classList.remove('active');
    },

    async _loadPreApprovalNotes(paId) {
        const container = document.getElementById('paNotesContainer');
        if (!container) return;

        try {
            const notes = await ServerAPI.getPreApprovalNotes(paId);
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

                return `<div class="pa-note" data-note-id="${note.id}" data-pa-id="${paId}">
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

            // Bind edit/delete on notes
            container.querySelectorAll('.pa-note-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const noteEl = btn.closest('.pa-note');
                    this._editPreApprovalNote(parseInt(noteEl.dataset.paId), parseInt(noteEl.dataset.noteId));
                });
            });
            container.querySelectorAll('.pa-note-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const noteEl = btn.closest('.pa-note');
                    this._deletePreApprovalNote(parseInt(noteEl.dataset.paId), parseInt(noteEl.dataset.noteId));
                });
            });
        } catch (err) {
            console.error('Failed to load notes:', err);
            container.innerHTML = '<div class="pa-notes-empty" style="color:#e74c3c;">Failed to load notes.</div>';
        }
    },

    async _addPreApprovalNote(paId) {
        const input = document.getElementById('paNewNoteInput');
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;

        try {
            await ServerAPI.addPreApprovalNote(paId, content);
            input.value = '';
            this._loadPreApprovalNotes(paId);
        } catch (err) {
            alert('Failed to add note: ' + (err.message || 'Unknown error'));
        }
    },

    async _editPreApprovalNote(paId, noteId) {
        const noteEl = document.querySelector(`.pa-note[data-note-id="${noteId}"]`);
        if (!noteEl) return;
        const contentEl = noteEl.querySelector('.pa-note-content');
        const currentContent = contentEl.textContent;

        // Replace content with editable textarea
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
                await ServerAPI.updatePreApprovalNote(paId, noteId, newContent);
                this._loadPreApprovalNotes(paId);
            } catch (err) {
                alert('Failed to update note: ' + (err.message || 'Unknown error'));
            }
        });

        contentEl.querySelector('.pa-note-cancel-btn').addEventListener('click', () => {
            this._loadPreApprovalNotes(paId);
        });
    },

    async _deletePreApprovalNote(paId, noteId) {
        if (!confirm('Delete this note?')) return;
        try {
            await ServerAPI.deletePreApprovalNote(paId, noteId);
            this._loadPreApprovalNotes(paId);
        } catch (err) {
            alert('Failed to delete note: ' + (err.message || 'Unknown error'));
        }
    },

    // ========================================
    // PIPELINE (Monday.com sync) — dynamic columns
    // ========================================
    pipelineColumns: [],   // loaded from /monday/view-config

    PRIORITY_FIELDS: ['client_name', 'assigned_lo_name', 'lender', 'loan_amount', 'stage', 'closing_date', 'loan_number', 'subject_property'],
    _showAllColumns: false,

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

    _getVisibleColumns() {
        const cols = this.pipelineColumns.length > 0 ? this.pipelineColumns : this.FALLBACK_PIPELINE_COLUMNS;
        if (this._showAllColumns || cols.length <= 8) return cols;
        return cols.filter(c => this.PRIORITY_FIELDS.includes(c.field));
    },

    togglePipelineColumns() {
        this._showAllColumns = !this._showAllColumns;
        this.renderPipelineHead();
        this.renderPipeline(this.pipelineData);
        const btn = document.getElementById('toggleColumnsBtn');
        if (btn) {
            const count = this.pipelineColumns.length - this.PRIORITY_FIELDS.filter(f => this.pipelineColumns.some(c => c.field === f)).length;
            btn.innerHTML = this._showAllColumns
                ? '<i class="fas fa-compress-alt"></i> Fewer Columns'
                : `<i class="fas fa-expand-alt"></i> +${count} Columns`;
        }
    },

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
            // Apply user display preferences (hide unchecked columns + reorder)
            const userPref = prefs.display_columns_pipeline;
            if (Array.isArray(userPref) && userPref.length > 0) {
                const prefMap = {};
                userPref.forEach(p => { prefMap[p.field] = p; });
                this.pipelineColumns = this.pipelineColumns
                    .filter(c => prefMap[c.field] === undefined || prefMap[c.field].visible !== false)
                    .sort((a, b) => {
                        const orderA = prefMap[a.field]?.order ?? Infinity;
                        const orderB = prefMap[b.field]?.order ?? Infinity;
                        return orderA - orderB;
                    });
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
        const cols = this._getVisibleColumns();
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
    DATE_FIELDS: ['application_date', 'lock_expiration_date', 'closing_date', 'funding_date', 'target_close_date',
        'appraisal_deadline', 'appraisal_due_date', 'payoff_date', 'estimated_fund_date'],
    CURRENCY_FIELDS: ['loan_amount', 'initial_loan_amount', 'purchase_price', 'appraised_value'],
    STATUS_FIELDS: ['stage', 'appraisal_status', 'prelims_status', 'mini_set_status', 'cd_status',
        'hoi_status', 'title_status', 'loan_status', 'status', 'payoffs', 'wvoes', 'vvoes',
        'closing_details', 'closing_docs', 'cd_info', 'dpa', 'hoa', 'send_to_compliance'],

    /**
     * Insert a comma+space between a city name and a 2-letter US state when
     * Monday.com data smushes them together (e.g. "FargoND 58102" → "Fargo, ND 58102").
     */
    _formatAddress(addr) {
        if (!addr) return '';
        // Match city followed by 2 uppercase letters then space+zip, no comma between
        return String(addr).replace(/([A-Za-z.'\- ]+?)([A-Z]{2})(\s+\d{5}(?:-\d{4})?)/g, (m, city, state, zip) => {
            const cityTrim = city.replace(/\s+$/, '');
            // Avoid double comma if already present
            if (/,\s*$/.test(cityTrim)) return `${cityTrim} ${state}${zip}`;
            return `${cityTrim}, ${state}${zip}`;
        });
    },

    _statusBadgeClass(val) {
        if (!val) return '';
        const v = val.toLowerCase();
        if (/complete|done|approved|cleared|received|ordered|signed|funded|ctc|clear/i.test(v)) return 'status-complete';
        if (/pending|in progress|working|submitted|waiting|conditional|review|open/i.test(v)) return 'status-pending';
        if (/not ready|missing|denied|rejected|expired|overdue|cancel|fail|stuck/i.test(v)) return 'status-danger';
        if (/n\/a|waived|exempt/i.test(v)) return 'status-neutral';
        return 'status-default';
    },

    renderPipeline(data) {
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
                if (this.STATUS_FIELDS.includes(col.field) && val) {
                    const cls = this._statusBadgeClass(val);
                    return `<td><span class="pipeline-badge ${cls}">${Utils.escapeHtml(val)}</span></td>`;
                }
                if (col.field === 'subject_property' && val) {
                    return `<td>${Utils.escapeHtml(this._formatAddress(val))}</td>`;
                }
                return `<td>${Utils.escapeHtml(val != null ? String(val) : '')}</td>`;
            }).join('');

            return `<tr data-id="${item.id}" data-lo="${Utils.escapeHtml(item.assigned_lo_name || '')}">${cells}</tr>`;
        }).join('');
    },

    async populatePipelineFilters(data) {
        if (!data?.length) return;

        const role = (CONFIG.currentUser?.activeRole || '').toLowerCase();
        const isLO = role === 'lo';

        // Populate Loan Officer filter — hide for LOs (they only see their own loans)
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
                // Apply restored filter
                if (currentVal && typeof MondaySettings !== 'undefined') {
                    MondaySettings.filterPipeline();
                }
            }
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

// Export to global scope
window.API = API;
