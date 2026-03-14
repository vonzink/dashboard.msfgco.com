/* ============================================
   MSFG Dashboard - Goals Management
   Displays performance goals on the main dashboard.
   Goal TARGETS are set only in individual user settings.

   Timeframe behavior:
   - Loans Closed + Volume Closed: match Funded Loans period
   - Pipeline: always shows all active pipeline (no date filter)
   - Pre-Approvals: always shows all active pre-approvals (no date filter)

   Admin/Manager: LO picker to view any LO's performance.
   LO: Can only see their own data.
   ============================================ */

const GoalsManager = {
    // ========================================
    // PROPERTIES
    // ========================================
    currentPeriod: 'monthly',   // driven by Funded Loans period
    selectedLOId: null,
    selectedLOName: null,
    _loList: [],
    goals: {
        'loans-closed': {
            current: 0,
            target: 0,
            type: 'number',
            format: (val) => Math.round(val).toString()
        },
        'volume-closed': {
            current: 0,
            target: 0,
            type: 'currency',
            format: (val) => `$${val.toFixed(1)}M`
        },
        'pipeline': {
            current: 0,
            target: 0,
            type: 'currency',
            format: (val) => `$${val.toFixed(1)}M`
        },
        'pre-approvals': {
            current: 0,
            target: 0,
            type: 'number',
            format: (val) => Math.round(val).toString()
        }
    },

    // ========================================
    // INITIALIZATION
    // ========================================
    async init() {
        this._listenForFundedLoansPeriod();
        await this._initLOPicker();
        await this._fetchAllGoalData();
    },

    // ========================================
    // FUNDED LOANS PERIOD SYNC
    // Listen for Funded Loans period changes and update goals accordingly
    // ========================================
    _listenForFundedLoansPeriod() {
        const fundedPeriodSelect = document.getElementById('fundedPeriodSelect');
        if (fundedPeriodSelect) {
            // Initialize from current funded loans period
            this.currentPeriod = fundedPeriodSelect.value || 'monthly';
            this._updatePeriodLabel();

            fundedPeriodSelect.addEventListener('change', async () => {
                this.currentPeriod = fundedPeriodSelect.value || 'monthly';
                this._updatePeriodLabel();
                await this._fetchAllGoalData();
            });
        }
    },

    /** Show which period is active in the Goals header */
    _updatePeriodLabel() {
        const label = document.getElementById('goalsPeriodLabel');
        if (!label) return;
        const names = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', all: 'All Time' };
        label.textContent = names[this.currentPeriod] || this.currentPeriod;
    },

    // ========================================
    // LO PICKER (Admin/Manager only)
    // ========================================
    _isAdminOrManager() {
        const role = String(CONFIG.currentUser?.role || '').toLowerCase();
        return role === 'admin' || role === 'manager';
    },

    async _initLOPicker() {
        const loSelect = document.getElementById('goalLOSelect');
        if (!loSelect) return;

        if (!this._isAdminOrManager()) {
            loSelect.style.display = 'none';
            this.selectedLOId = CONFIG.currentUser?.id || null;
            return;
        }

        loSelect.style.display = '';

        try {
            const users = await ServerAPI.get('/users/directory');
            if (Array.isArray(users)) {
                this._loList = users.filter(u => u.name).sort((a, b) => a.name.localeCompare(b.name));
                loSelect.innerHTML = '<option value="">All Loan Officers</option>' +
                    this._loList.map(u =>
                        `<option value="${u.id}">${Utils.escapeHtml(u.name)}</option>`
                    ).join('');
            }
        } catch (err) {
            console.warn('Failed to load user list for LO picker:', err.message);
        }

        const savedLO = Utils.getStorage('goal_selected_lo', '');
        if (savedLO) {
            loSelect.value = savedLO;
            this.selectedLOId = savedLO || null;
            const opt = loSelect.options[loSelect.selectedIndex];
            this.selectedLOName = opt && opt.value ? opt.textContent : null;
        }

        loSelect.addEventListener('change', async () => {
            this.selectedLOId = loSelect.value || null;
            const opt = loSelect.options[loSelect.selectedIndex];
            this.selectedLOName = opt && opt.value ? opt.textContent : null;
            Utils.setStorage('goal_selected_lo', loSelect.value);
            await this._fetchAllGoalData();
        });
    },

    _getTargetUserId() {
        if (this._isAdminOrManager()) {
            return this.selectedLOId || null;
        }
        return CONFIG.currentUser?.id || null;
    },

    // ========================================
    // DATA FETCHING
    // ========================================

    /**
     * Fetch all goal-related data in parallel:
     * - Funded loans summary (uses currentPeriod) -> loans-closed + volume-closed
     * - Pipeline summary (all active, no period) -> pipeline + unit count
     * - Pre-approvals summary (all active, no period) -> pre-approvals
     * - Saved goal targets from DB (uses currentPeriod for target lookup)
     */
    async _fetchAllGoalData() {
        try {
            const targetUserId = this._getTargetUserId();
            const periodValue = this.getPeriodValue();
            const loParams = targetUserId ? { lo_id: targetUserId } : {};

            const [fundedResult, pipelineResult, preApprovalsResult, goalsResult] = await Promise.allSettled([
                // Loans Closed + Volume Closed: match Funded Loans period
                ServerAPI.getFundedLoansSummary({ period: this.currentPeriod, ...loParams }),
                // Pipeline: always all active (no period filter)
                ServerAPI.getPipelineSummary(loParams),
                // Pre-Approvals: always all active (no period filter)
                ServerAPI.getPreApprovalsSummary(loParams),
                // Goal targets: use the current period so targets match
                ServerAPI.getGoals(targetUserId, this.currentPeriod, periodValue)
            ]);

            // --- Funded Loans -> Loans Closed + Volume Closed ---
            if (fundedResult.status === 'fulfilled' && fundedResult.value) {
                const summary = fundedResult.value;
                const units = parseInt(summary.units || summary.count || 0);
                const volume = parseFloat(summary.total_amount || 0) / 1000000;
                this.goals['loans-closed'].current = units;
                this.goals['volume-closed'].current = volume;
            }

            // --- Pipeline -> Pipeline value + unit count ---
            if (pipelineResult.status === 'fulfilled' && pipelineResult.value) {
                const summary = pipelineResult.value;
                const units = parseInt(summary.units || 0);
                const volume = parseFloat(summary.total_amount || 0) / 1000000;
                this.goals['pipeline'].current = volume;

                const unitCountEl = document.getElementById('pipelineUnitCount');
                if (unitCountEl) {
                    unitCountEl.textContent = `${units} loan${units !== 1 ? 's' : ''}`;
                }
            }

            // --- Pre-Approvals (active count) ---
            if (preApprovalsResult.status === 'fulfilled' && preApprovalsResult.value) {
                const summary = preApprovalsResult.value;
                const units = parseInt(summary.active_count || summary.units || 0);
                this.goals['pre-approvals'].current = units;
            }

            // --- Saved Goal Targets ---
            Object.keys(this.goals).forEach(goalId => {
                this.goals[goalId].target = 0;
            });

            if (goalsResult.status === 'fulfilled' && Array.isArray(goalsResult.value)) {
                goalsResult.value.forEach(apiGoal => {
                    const goalId = apiGoal.goal_type;
                    if (this.goals[goalId]) {
                        this.goals[goalId].target = parseFloat(apiGoal.target_value) || 0;
                    }
                });
            }
        } catch (error) {
            console.error('Failed to fetch goal data:', error);
            Object.keys(this.goals).forEach(goalId => {
                const key = `goal_${goalId}_${this.currentPeriod}`;
                const saved = Utils.getStorage(key);
                if (saved) {
                    this.goals[goalId].target = saved.target;
                }
            });
        }

        this.updateAllGoals();
    },

    // ========================================
    // GOAL UPDATES (display-only on main page)
    // ========================================
    updateAllGoals() {
        Object.keys(this.goals).forEach(goalId => {
            this.updateGoalCard(goalId);
        });
    },

    updateGoalCard(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        const valueEl = document.getElementById(this.getValueId(goalId));
        if (valueEl) {
            valueEl.textContent = goal.format(goal.current);
        }

        const targetEl = document.getElementById(this.getTargetId(goalId));
        if (targetEl) {
            if (goal.type === 'currency') {
                targetEl.textContent = goal.target.toFixed(1);
            } else {
                targetEl.textContent = Math.round(goal.target);
            }
        }

        const progress = this.calculateProgress(goalId);
        this.updateProgressBar(goalId, progress);
        this.updateProgressText(goalId, progress);
    },

    getValueId(goalId) {
        const map = {
            'loans-closed': 'loansClosedValue',
            'volume-closed': 'volumeClosedValue',
            'pipeline': 'pipelineValue',
            'pre-approvals': 'preApprovalsValue'
        };
        return map[goalId];
    },

    getTargetId(goalId) {
        const map = {
            'loans-closed': 'loansClosedTarget',
            'volume-closed': 'volumeClosedTarget',
            'pipeline': 'pipelineTarget',
            'pre-approvals': 'preApprovalsTarget'
        };
        return map[goalId];
    },

    calculateProgress(goalId) {
        const goal = this.goals[goalId];
        if (!goal || goal.target === 0) return 0;

        if (goalId === 'pipeline') {
            return goal.current >= goal.target ? 100 : (goal.current / goal.target) * 100;
        }

        return Math.min(100, (goal.current / goal.target) * 100);
    },

    updateProgressBar(goalId, progress) {
        const progressBar = document.getElementById(this.getProgressId(goalId));
        if (!progressBar) return;

        progressBar.style.width = `${progress}%`;
        progressBar.className = 'progress-fill';
        if (progress >= 100) {
            progressBar.classList.add('exceeded');
        } else if (progress >= 50) {
            progressBar.classList.add('on-track');
        } else {
            progressBar.classList.add('behind');
        }
    },

    getProgressId(goalId) {
        const map = {
            'loans-closed': 'loansClosedProgress',
            'volume-closed': 'volumeClosedProgress',
            'pipeline': 'pipelineProgress',
            'pre-approvals': 'preApprovalsProgress'
        };
        return map[goalId];
    },

    updateProgressText(goalId, progress) {
        const textEl = document.getElementById(this.getProgressTextId(goalId));
        if (!textEl) return;

        let text = '';
        if (goalId === 'pipeline') {
            text = progress >= 100 ? 'Strong pipeline' : `${Math.round(progress)}% of target`;
        } else if (goalId === 'pre-approvals') {
            text = progress >= 100 ? 'Exceeding goal!' : `${Math.round(progress)}% complete`;
        } else {
            text = `${Math.round(progress)}% complete`;
        }

        textEl.textContent = text;
    },

    getProgressTextId(goalId) {
        const map = {
            'loans-closed': 'loansClosedProgressText',
            'volume-closed': 'volumeClosedProgressText',
            'pipeline': 'pipelineProgressText',
            'pre-approvals': 'preApprovalsProgressText'
        };
        return map[goalId];
    },

    // ========================================
    // PERIOD FORMATTING
    // ========================================
    getPeriodValue() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');

        switch(this.currentPeriod) {
            case 'weekly': {
                const week = this.getWeekNumber(now);
                return `${year}-W${String(week).padStart(2, '0')}`;
            }
            case 'monthly':
                return `${year}-${month}`;
            case 'quarterly': {
                const quarter = Math.ceil((now.getMonth() + 1) / 3);
                return `${year}-Q${quarter}`;
            }
            case 'yearly':
                return String(year);
            case 'all':
                return 'all-time';
            default:
                return `${year}-${month}`;
        }
    },

    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
        return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    },

    // ========================================
    // PUBLIC API
    // ========================================
    updateGoalValue(goalId, value) {
        if (this.goals[goalId]) {
            this.goals[goalId].current = value;
            this.updateGoalCard(goalId);
        }
    },

    getGoal(goalId) {
        return this.goals[goalId] ? { ...this.goals[goalId] } : null;
    }
};

// Export to global scope
window.GoalsManager = GoalsManager;
