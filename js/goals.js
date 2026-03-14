/* ============================================
   MSFG Dashboard - Goals Management
   Time period selection and editable goal sliders.
   Loans Closed + Volume Closed from Funded Loans.
   Pipeline from Pipeline data.
   Pre-Approvals from Pre-Approval pipeline.

   Admin/Manager: LO picker to view any LO's performance + set goals.
   LO: Can only see and edit their own goals.
   ============================================ */

const GoalsManager = {
    // ========================================
    // PROPERTIES
    // ========================================
    currentPeriod: 'monthly',
    selectedLOId: null,       // null = all (admin/manager aggregate), or specific LO id
    selectedLOName: null,     // display name of selected LO
    _loList: [],              // cached list of LOs for the picker
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
        this.bindPeriodSelector();
        this.bindEditButtons();
        this.bindSliders();
        await this._initLOPicker();
        await this._fetchAllGoalData();
    },

    // ========================================
    // LO PICKER (Admin/Manager only)
    // ========================================

    /**
     * Check if the current user is admin or manager
     */
    _isAdminOrManager() {
        const role = String(CONFIG.currentUser?.role || '').toLowerCase();
        return role === 'admin' || role === 'manager';
    },

    /**
     * Initialize the LO picker dropdown for admin/manager users.
     * LOs only see their own data — no picker shown.
     */
    async _initLOPicker() {
        const loSelect = document.getElementById('goalLOSelect');
        if (!loSelect) return;

        if (!this._isAdminOrManager()) {
            // LO/processor: hide the picker, always use own ID
            loSelect.style.display = 'none';
            this.selectedLOId = CONFIG.currentUser?.id || null;
            return;
        }

        // Admin/Manager: show the picker and load LO list
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

        // Restore saved selection
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

    /**
     * Get the user ID to use for goals data fetching.
     * Admin/Manager with no LO selected → null (aggregate).
     * Admin/Manager with LO selected → that LO's id.
     * LO → own id.
     */
    _getTargetUserId() {
        if (this._isAdminOrManager()) {
            return this.selectedLOId || null;
        }
        return CONFIG.currentUser?.id || null;
    },

    // ========================================
    // PERIOD SELECTOR
    // ========================================
    bindPeriodSelector() {
        const selector = document.getElementById('goalPeriodSelect');
        if (!selector) return;

        // Load saved period
        const savedPeriod = Utils.getStorage('goal_period', 'monthly');
        selector.value = savedPeriod;
        this.currentPeriod = savedPeriod;

        selector.addEventListener('change', async (e) => {
            this.currentPeriod = e.target.value;
            Utils.setStorage('goal_period', this.currentPeriod);

            // Sync the funded loans period to match and reload table
            this._syncFundedLoansPeriod();

            // Fetch all goal data for the new period
            await this._fetchAllGoalData();
        });
    },

    /**
     * Sync the funded loans dropdown + data to match the goals period.
     * This ensures the funded loans table reflects the same timeframe.
     */
    _syncFundedLoansPeriod() {
        if (typeof FundedLoans === 'undefined') return;

        // Update the funded loans period select dropdown to match
        const fundedPeriodSelect = document.getElementById('fundedPeriodSelect');
        if (fundedPeriodSelect && fundedPeriodSelect.value !== this.currentPeriod) {
            fundedPeriodSelect.value = this.currentPeriod;
            FundedLoans._period = this.currentPeriod;
            FundedLoans.load(); // Reload table with new period
        }
    },

    // ========================================
    // DATA FETCHING
    // ========================================

    /**
     * Fetch all goal-related data in parallel:
     * - Funded loans summary -> loans-closed + volume-closed
     * - Pipeline summary -> pipeline + unit count
     * - Pre-approvals summary -> pre-approvals
     * - Saved goal targets from DB
     *
     * When admin/manager has an LO selected, all summaries
     * are scoped to that LO via lo_id query param.
     */
    async _fetchAllGoalData() {
        try {
            const targetUserId = this._getTargetUserId();
            const periodValue = this.getPeriodValue();

            // Build params for summary endpoints
            const loParams = targetUserId ? { lo_id: targetUserId } : {};

            const [fundedResult, pipelineResult, preApprovalsResult, goalsResult] = await Promise.allSettled([
                ServerAPI.getFundedLoansSummary({ period: this.currentPeriod, ...loParams }),
                ServerAPI.getPipelineSummary(loParams),
                ServerAPI.getPreApprovalsSummary(loParams),
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

                // Update pipeline unit count display
                const unitCountEl = document.getElementById('pipelineUnitCount');
                if (unitCountEl) {
                    unitCountEl.textContent = `${units} loan${units !== 1 ? 's' : ''}`;
                }
            }

            // --- Pre-Approvals (use active count, not total) ---
            if (preApprovalsResult.status === 'fulfilled' && preApprovalsResult.value) {
                const summary = preApprovalsResult.value;
                const units = parseInt(summary.active_count || summary.units || 0);
                this.goals['pre-approvals'].current = units;
            }

            // --- Saved Goal Targets ---
            // Reset targets before applying saved values
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
            // Fallback: load targets from localStorage
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
    // EDIT BUTTONS
    // ========================================
    bindEditButtons() {
        document.querySelectorAll('.goal-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const goalId = btn.dataset.goal;
                this.toggleSlider(goalId);
            });
        });
    },

    toggleSlider(goalId) {
        const card = document.querySelector(`.goal-card[data-goal="${goalId}"]`);
        if (!card) return;

        const sliderContainer = card.querySelector('.goal-slider-container');
        const editBtn = card.querySelector('.goal-edit-btn');
        if (!sliderContainer) return;

        // Use classList for visibility (u-hidden has !important)
        const isVisible = !sliderContainer.classList.contains('u-hidden');

        if (isVisible) {
            // Hide slider and save
            sliderContainer.classList.add('u-hidden');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            this.saveGoal(goalId);
        } else {
            // Show slider
            sliderContainer.classList.remove('u-hidden');
            editBtn.innerHTML = '<i class="fas fa-check"></i>';
            this.updateSlider(goalId);
        }
    },

    // ========================================
    // SLIDERS
    // ========================================
    bindSliders() {
        document.querySelectorAll('.goal-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const goalId = this.getGoalIdFromSlider(slider.id);
                if (goalId) {
                    this.handleSliderChange(goalId, parseFloat(e.target.value));
                }
            });
        });
    },

    getGoalIdFromSlider(sliderId) {
        const map = {
            'loansClosedSlider': 'loans-closed',
            'volumeClosedSlider': 'volume-closed',
            'pipelineSlider': 'pipeline',
            'preApprovalsSlider': 'pre-approvals'
        };
        return map[sliderId];
    },

    handleSliderChange(goalId, value) {
        const goal = this.goals[goalId];
        if (!goal) return;

        goal.target = value;
        this.updateSliderDisplay(goalId, value);
        this.updateGoalCard(goalId);
    },

    updateSlider(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        const slider = document.getElementById(this.getSliderId(goalId));
        if (slider) {
            slider.value = goal.target;
            this.updateSliderDisplay(goalId, goal.target);
        }
    },

    getSliderId(goalId) {
        const map = {
            'loans-closed': 'loansClosedSlider',
            'volume-closed': 'volumeClosedSlider',
            'pipeline': 'pipelineSlider',
            'pre-approvals': 'preApprovalsSlider'
        };
        return map[goalId];
    },

    updateSliderDisplay(goalId, value) {
        const slider = document.getElementById(this.getSliderId(goalId));
        if (!slider) return;

        const display = slider.closest('.goal-slider-container').querySelector('.slider-value');
        if (display) {
            const goal = this.goals[goalId];
            if (goal.type === 'currency') {
                display.textContent = value.toFixed(1);
            } else {
                display.textContent = Math.round(value);
            }
        }
    },

    // ========================================
    // GOAL UPDATES
    // ========================================
    updateAllGoals() {
        Object.keys(this.goals).forEach(goalId => {
            this.updateGoalCard(goalId);
        });
    },

    updateGoalCard(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        // Update current value display
        const valueEl = document.getElementById(this.getValueId(goalId));
        if (valueEl) {
            valueEl.textContent = goal.format(goal.current);
        }

        // Update target display
        const targetEl = document.getElementById(this.getTargetId(goalId));
        if (targetEl) {
            if (goal.type === 'currency') {
                targetEl.textContent = goal.target.toFixed(1);
            } else {
                targetEl.textContent = Math.round(goal.target);
            }
        }

        // Calculate and update progress
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

        // Standard progress: current / target capped at 100
        return Math.min(100, (goal.current / goal.target) * 100);
    },

    updateProgressBar(goalId, progress) {
        const progressBar = document.getElementById(this.getProgressId(goalId));
        if (!progressBar) return;

        progressBar.style.width = `${progress}%`;

        // Update progress bar class based on status
        progressBar.className = 'progress-fill';
        if (progress >= 100) {
            progressBar.classList.add('exceeded');
        } else if (progress >= 75) {
            progressBar.classList.add('on-track');
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
            case 'weekly':
                // Week number (ISO week)
                const week = this.getWeekNumber(now);
                return `${year}-W${String(week).padStart(2, '0')}`;
            case 'monthly':
                return `${year}-${month}`;
            case 'quarterly':
                const quarter = Math.ceil((now.getMonth() + 1) / 3);
                return `${year}-Q${quarter}`;
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
    // STORAGE
    // ========================================
    async saveGoal(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        try {
            // Save to the target user (selected LO or self)
            const targetUserId = this._getTargetUserId() || CONFIG.currentUser?.id || null;
            const periodValue = this.getPeriodValue();

            const goalData = {
                user_id: targetUserId,
                period_type: this.currentPeriod,
                period_value: periodValue,
                goal_type: goalId,
                current_value: goal.current,
                target_value: goal.target
            };

            await ServerAPI.updateGoals(goalData);
        } catch (error) {
            console.error('Failed to save goal:', error);
            // Fallback to localStorage
            const key = `goal_${goalId}_${this.currentPeriod}`;
            Utils.setStorage(key, {
                target: goal.target,
                current: goal.current
            });
        }
    },

    // ========================================
    // PUBLIC API
    // ========================================
    setGoal(goalId, current, target) {
        if (this.goals[goalId]) {
            this.goals[goalId].current = current;
            if (target !== undefined) this.goals[goalId].target = target;
            this.updateGoalCard(goalId);
            this.saveGoal(goalId);
        }
    },

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
