/* ============================================
   MSFG Dashboard - Goals & Performance (Phase 1 Rebuild)

   Key improvements:
   - Own period selector (decoupled from Funded Loans)
   - Click-to-edit goal targets (simple modal, not sliders)
   - Pace tracking ("At this pace you'll close X by end of month")
   - YTD summary bar
   - Celebration toasts when hitting milestones
   - User-friendly for non-technical users
   ============================================ */

const GoalsManager = {
    // ========================================
    // PROPERTIES
    // ========================================
    currentPeriod: 'monthly',
    selectedLOId: null,
    selectedLOName: null,
    _loList: [],
    _previousProgress: {},  // Track previous progress for celebrations
    _ytdData: { units: 0, volume: 0 },

    goals: {
        'loans-closed': {
            current: 0,
            target: 0,
            type: 'number',
            label: 'Loans Closed',
            icon: 'fa-file-signature',
            format: (val) => Math.round(val).toString(),
            inputLabel: 'How many loans do you want to close?',
            hint: 'This is the number of loans you want to fund this period.',
            prefix: '',
            suffix: '',
            step: 1,
        },
        'volume-closed': {
            current: 0,
            target: 0,
            type: 'currency',
            label: 'Volume Closed',
            icon: 'fa-dollar-sign',
            format: (val) => {
                if (val >= 1) return `$${val.toFixed(1)}M`;
                if (val > 0) return `$${Math.round(val * 1000)}K`;
                return '$0';
            },
            inputLabel: 'What is your volume target? (in millions)',
            hint: 'Example: Enter 5 for $5 million.',
            prefix: '$',
            suffix: 'M',
            step: 0.5,
        },
        'pipeline': {
            current: 0,
            target: 0,
            type: 'currency',
            label: 'Pipeline',
            icon: 'fa-chart-line',
            format: (val) => {
                if (val >= 1) return `$${val.toFixed(1)}M`;
                if (val > 0) return `$${Math.round(val * 1000)}K`;
                return '$0';
            },
            inputLabel: 'What is your pipeline target? (in millions)',
            hint: 'Total value of loans you want in your active pipeline.',
            prefix: '$',
            suffix: 'M',
            step: 0.5,
        },
        'pre-approvals': {
            current: 0,
            target: 0,
            type: 'number',
            label: 'Pre-Approvals',
            icon: 'fa-clipboard-check',
            format: (val) => Math.round(val).toString(),
            inputLabel: 'How many active pre-approvals is your target?',
            hint: 'Number of active pre-approval letters you want to maintain.',
            prefix: '',
            suffix: '',
            step: 1,
        }
    },

    // ========================================
    // INITIALIZATION
    // ========================================
    async init() {
        this._bindPeriodSelector();
        this._bindCardClicks();
        this._bindModalEvents();
        await this._initLOPicker();
        await this._fetchAllGoalData();
        this._fetchYTDData();
    },

    // ========================================
    // PERIOD SELECTOR (own, decoupled from Funded Loans)
    // ========================================
    _bindPeriodSelector() {
        const select = document.getElementById('goalPeriodSelect');
        if (!select) return;

        // Restore saved preference
        const saved = Utils.getStorage('goal_period', 'monthly');
        select.value = saved;
        this.currentPeriod = saved;

        select.addEventListener('change', async () => {
            this.currentPeriod = select.value;
            Utils.setStorage('goal_period', select.value);
            await this._fetchAllGoalData();
        });
    },

    // ========================================
    // CLICK-TO-EDIT TARGETS
    // ========================================
    _bindCardClicks() {
        document.querySelectorAll('.goal-card-interactive').forEach(card => {
            card.addEventListener('click', (e) => {
                const goalId = card.dataset.goal;
                if (goalId) this._openEditModal(goalId);
            });
        });
    },

    _openEditModal(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        const overlay = document.getElementById('goalEditModal');
        if (!overlay) return;

        // Populate
        document.getElementById('goalEditTitle').textContent = `Set ${goal.label} Target`;
        document.getElementById('goalEditCurrentValue').textContent = goal.format(goal.current);
        document.getElementById('goalEditInputLabel').textContent = goal.inputLabel;
        document.getElementById('goalEditHint').textContent = goal.hint;
        document.getElementById('goalEditPrefix').textContent = goal.prefix;
        document.getElementById('goalEditSuffix').textContent = goal.suffix;

        const input = document.getElementById('goalEditInput');
        input.value = goal.target > 0 ? goal.target : '';
        input.step = goal.step;
        input.placeholder = goal.type === 'currency' ? '5.0' : '10';

        overlay.dataset.goalId = goalId;
        overlay.style.display = 'flex';

        setTimeout(() => input.focus(), 100);
    },

    _bindModalEvents() {
        const overlay = document.getElementById('goalEditModal');
        if (!overlay) return;

        const close = () => { overlay.style.display = 'none'; };

        document.getElementById('goalEditClose')?.addEventListener('click', close);
        document.getElementById('goalEditCancel')?.addEventListener('click', close);

        // Close on overlay background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display !== 'none') close();
        });

        // Save
        document.getElementById('goalEditSave')?.addEventListener('click', () => {
            const goalId = overlay.dataset.goalId;
            const input = document.getElementById('goalEditInput');
            const value = parseFloat(input.value) || 0;
            this._saveGoalTarget(goalId, value);
            close();
        });

        // Enter key saves
        document.getElementById('goalEditInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('goalEditSave')?.click();
            }
        });
    },

    async _saveGoalTarget(goalId, targetValue) {
        try {
            const userId = this._getTargetUserId() || CONFIG.currentUser?.id;
            const periodValue = this.getPeriodValue();

            await ServerAPI.updateGoals({
                user_id: userId,
                period_type: this.currentPeriod,
                period_value: periodValue,
                goal_type: goalId,
                target_value: targetValue,
            });

            if (this.goals[goalId]) {
                this.goals[goalId].target = targetValue;
                this.updateGoalCard(goalId);
            }

            Utils.showToast('Target saved!', 'success');
        } catch (err) {
            Utils.showToast('Failed to save target: ' + err.message, 'error');
        }
    },

    // ========================================
    // LO PICKER (Admin/Manager only)
    // ========================================
    _isAdminOrManager() {
        const role = String(CONFIG.currentUser?.activeRole || CONFIG.currentUser?.role || '').toLowerCase();
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
            this._fetchYTDData();
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
    async _fetchAllGoalData() {
        try {
            const targetUserId = this._getTargetUserId();
            const periodValue = this.getPeriodValue();
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
                this.goals['loans-closed'].current = parseInt(summary.units || summary.count || 0);
                this.goals['volume-closed'].current = parseFloat(summary.total_amount || 0) / 1000000;
            }

            // --- Pipeline ---
            if (pipelineResult.status === 'fulfilled' && pipelineResult.value) {
                const summary = pipelineResult.value;
                this.goals['pipeline'].current = parseFloat(summary.total_amount || 0) / 1000000;
                const units = parseInt(summary.units || 0);
                const unitCountEl = document.getElementById('pipelineUnitCount');
                if (unitCountEl) {
                    unitCountEl.textContent = `${units} loan${units !== 1 ? 's' : ''}`;
                }
            }

            // --- Pre-Approvals ---
            if (preApprovalsResult.status === 'fulfilled' && preApprovalsResult.value) {
                const summary = preApprovalsResult.value;
                this.goals['pre-approvals'].current = parseInt(summary.active_count || summary.units || 0);
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
        }

        this.updateAllGoals();
        this._updatePaceBanner();
    },

    /** Fetch YTD totals (always yearly, independent of selected period) */
    async _fetchYTDData() {
        try {
            const targetUserId = this._getTargetUserId();
            const loParams = targetUserId ? { lo_id: targetUserId } : {};
            const [fundedResult, pipelineResult] = await Promise.allSettled([
                ServerAPI.getFundedLoansSummary({ period: 'yearly', ...loParams }),
                ServerAPI.getPipelineSummary(loParams),
            ]);

            let ytdUnits = 0, ytdVolume = 0, pipelineUnits = 0;

            if (fundedResult.status === 'fulfilled' && fundedResult.value) {
                ytdUnits = parseInt(fundedResult.value.units || fundedResult.value.count || 0);
                ytdVolume = parseFloat(fundedResult.value.total_amount || 0);
            }
            if (pipelineResult.status === 'fulfilled' && pipelineResult.value) {
                pipelineUnits = parseInt(pipelineResult.value.units || 0);
            }

            this._ytdData = { units: ytdUnits, volume: ytdVolume };

            // Update YTD bar
            const unitsEl = document.getElementById('ytdUnits');
            const volEl = document.getElementById('ytdVolume');
            const ptEl = document.getElementById('ytdPullThrough');

            if (unitsEl) unitsEl.textContent = ytdUnits;
            if (volEl) volEl.textContent = this._formatDollar(ytdVolume);
            if (ptEl) {
                const pt = pipelineUnits > 0 ? Math.round((ytdUnits / pipelineUnits) * 100) : 0;
                ptEl.textContent = pt + '%';
            }

            // Render mini bar chart from recent months
            this._renderMiniChart();
        } catch (err) {
            console.warn('Failed to fetch YTD data:', err);
        }
    },

    async _renderMiniChart() {
        const container = document.getElementById('ribbonMiniChart');
        if (!container) return;

        try {
            const targetUserId = this._getTargetUserId();
            const loParams = targetUserId ? { lo_id: targetUserId } : {};

            // Fetch YTD funded loans and bucket by month
            const result = await ServerAPI.getFundedLoans({ period: 'yearly', limit: 500, ...loParams });
            const loans = result?.data || (Array.isArray(result) ? result : []);

            const now = new Date();
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const buckets = {};

            // Last 8 months
            for (let i = 7; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                buckets[key] = { label: monthNames[d.getMonth()], units: 0 };
            }

            for (const loan of loans) {
                const fd = loan.funded_date || loan.closing_date;
                if (!fd) continue;
                const d = new Date(fd);
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                if (buckets[key]) buckets[key].units++;
            }

            const data = Object.values(buckets);
            const maxVal = Math.max(...data.map(d => d.units), 1);

            container.innerHTML = data.map(d => {
                const h = Math.max(3, (d.units / maxVal) * 44);
                return '<div class="ribbon-chart-bar" style="height:' + h + 'px" data-label="' + d.label + '" title="' + d.label + ': ' + d.units + ' loans"></div>';
            }).join('');
        } catch (err) {
            console.warn('Failed to render mini chart:', err);
        }
    },

    // ========================================
    // PACE TRACKING
    // ========================================
    _updatePaceBanner() {
        const banner = document.getElementById('goalPaceBanner');
        const textEl = document.getElementById('goalPaceText');
        if (!banner || !textEl) return;

        // Only show pace for loans-closed with a target set, on monthly/quarterly/yearly
        const loansGoal = this.goals['loans-closed'];
        if (!loansGoal || loansGoal.target <= 0 || this.currentPeriod === 'all') {
            banner.style.display = 'none';
            return;
        }

        const now = new Date();
        let daysElapsed, totalDays, periodLabel;

        switch (this.currentPeriod) {
            case 'weekly':
                daysElapsed = now.getDay() || 7; // 1=Mon ... 7=Sun
                totalDays = 7;
                periodLabel = 'this week';
                break;
            case 'monthly':
                daysElapsed = now.getDate();
                totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                periodLabel = 'this month';
                break;
            case 'quarterly': {
                const qMonth = Math.floor(now.getMonth() / 3) * 3;
                const qStart = new Date(now.getFullYear(), qMonth, 1);
                const qEnd = new Date(now.getFullYear(), qMonth + 3, 0);
                daysElapsed = Math.ceil((now - qStart) / 86400000) + 1;
                totalDays = Math.ceil((qEnd - qStart) / 86400000) + 1;
                periodLabel = 'this quarter';
                break;
            }
            case 'yearly':
                daysElapsed = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1;
                totalDays = (now.getFullYear() % 4 === 0) ? 366 : 365;
                periodLabel = 'this year';
                break;
            default:
                banner.style.display = 'none';
                return;
        }

        if (daysElapsed <= 0) daysElapsed = 1;
        const daysLeft = totalDays - daysElapsed;
        const pace = (loansGoal.current / daysElapsed) * totalDays;
        const projected = Math.round(pace * 10) / 10;
        const pct = loansGoal.target > 0 ? (projected / loansGoal.target) * 100 : 0;

        let message, statusClass;

        if (loansGoal.current >= loansGoal.target) {
            message = `You hit your goal of ${loansGoal.target} loans ${periodLabel}!`;
            statusClass = 'pace-ahead';
        } else if (pct >= 100) {
            message = `On pace for ${projected.toFixed(0)} loans ${periodLabel} — you'll beat your target of ${loansGoal.target}!`;
            statusClass = 'pace-ahead';
        } else if (pct >= 75) {
            const needed = loansGoal.target - loansGoal.current;
            message = `You need ${needed} more loan${needed !== 1 ? 's' : ''} in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} to hit your goal. You're close!`;
            statusClass = 'pace-on-track';
        } else {
            const needed = loansGoal.target - loansGoal.current;
            message = `${needed} more loan${needed !== 1 ? 's' : ''} needed in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Stay focused — you've got this!`;
            statusClass = 'pace-behind';
        }

        textEl.textContent = message;
        // Support both old (goal-pace-banner) and new ribbon (ribbon-pace) layouts
        const bannerBase = banner.classList.contains('ribbon-pace') || banner.closest('.briefing-ribbon') ? 'ribbon-pace' : 'goal-pace-banner';
        banner.className = bannerBase + ' ' + statusClass;
        banner.style.display = 'flex';
    },

    // ========================================
    // GOAL CARD UPDATES
    // ========================================
    updateAllGoals() {
        Object.keys(this.goals).forEach(goalId => {
            this.updateGoalCard(goalId);
        });
    },

    _animateCountUp(el, endValue, format, duration = 800) {
        const startValue = parseFloat(el.dataset.lastValue || '0') || 0;
        if (startValue === endValue) {
            el.textContent = format(endValue);
            return;
        }
        el.dataset.counting = 'true';
        const startTime = performance.now();
        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = startValue + (endValue - startValue) * eased;
            el.textContent = format(current);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = format(endValue);
                el.dataset.lastValue = String(endValue);
                delete el.dataset.counting;
            }
        };
        requestAnimationFrame(step);
    },

    updateGoalCard(goalId) {
        const goal = this.goals[goalId];
        if (!goal) return;

        const valueEl = document.getElementById(this.getValueId(goalId));
        if (valueEl) {
            this._animateCountUp(valueEl, goal.current, goal.format);
        }

        const targetEl = document.getElementById(this.getTargetId(goalId));
        if (targetEl) {
            if (goal.target > 0) {
                if (goal.type === 'currency') {
                    targetEl.textContent = goal.target.toFixed(1);
                } else {
                    targetEl.textContent = Math.round(goal.target);
                }
            } else {
                targetEl.textContent = '--';
            }
        }

        const progress = this.calculateProgress(goalId);
        this.updateProgressBar(goalId, progress);
        this.updateProgressText(goalId, progress);
        this._checkCelebration(goalId, progress);
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
        return Math.min(100, (goal.current / goal.target) * 100);
    },

    updateProgressBar(goalId, progress) {
        const progressBar = document.getElementById(this.getProgressId(goalId));
        if (!progressBar) return;

        progressBar.style.width = `${progress}%`;
        // Support both old (progress-fill) and new ribbon (ribbon-tile-fill) classes
        const baseClass = progressBar.classList.contains('ribbon-tile-fill') ? 'ribbon-tile-fill' : 'progress-fill';
        progressBar.className = baseClass;
        if (progress >= 100) {
            progressBar.classList.add('exceeded');
        } else if (progress >= 50) {
            progressBar.classList.add('on-track');
        } else if (progress > 0) {
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

        const goal = this.goals[goalId];
        if (!goal || goal.target <= 0) {
            textEl.textContent = 'Click to set a target';
            textEl.style.fontStyle = 'italic';
            return;
        }

        textEl.style.fontStyle = 'normal';

        if (progress >= 100) {
            textEl.textContent = 'Goal reached!';
        } else {
            textEl.textContent = `${Math.round(progress)}% of target`;
        }
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
    // CELEBRATIONS
    // ========================================
    _checkCelebration(goalId, progress) {
        const prevProgress = this._previousProgress[goalId] || 0;
        this._previousProgress[goalId] = progress;

        // Only celebrate on transitions (not initial load with no previous)
        if (prevProgress === 0 && progress > 0 && Object.keys(this._previousProgress).length <= 4) return;

        const goal = this.goals[goalId];
        if (!goal || goal.target <= 0) return;

        // Crossed 100%
        if (prevProgress < 100 && progress >= 100) {
            this._celebrate(goalId, `You hit your ${goal.label} goal!`);
        }
        // Crossed 75%
        else if (prevProgress < 75 && progress >= 75) {
            Utils.showToast(`Almost there! ${Math.round(progress)}% of your ${goal.label} goal.`, 'success');
        }
    },

    _celebrate(goalId, message) {
        // Animate the card
        const card = document.querySelector(`.goal-card[data-goal="${goalId}"]`);
        if (card) {
            card.classList.add('celebrating');
            setTimeout(() => card.classList.remove('celebrating'), 1500);
        }

        // Show toast
        Utils.showToast(message, 'success');
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
    // HELPERS
    // ========================================
    _formatDollar(amount) {
        if (!amount || amount === 0) return '$0';
        if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
        if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
        return `$${amount.toLocaleString()}`;
    },

    // ========================================
    // PUBLIC API (for gauges + settings)
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
