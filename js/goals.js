/* ============================================
   MSFG Dashboard - Goals Management
   Time period selection and editable goal sliders
   ============================================ */

const GoalsManager = {
    // ========================================
    // PROPERTIES
    // ========================================
    currentPeriod: 'monthly',
    goals: {
        'loans-closed': {
            current: 18,
            target: 25,
            type: 'number',
            format: (val) => Math.round(val).toString()
        },
        'volume-closed': {
            current: 7.2,
            target: 10,
            type: 'currency',
            format: (val) => `$${val.toFixed(1)}M`
        },
        'pipeline': {
            current: 5.8,
            target: 5.8,
            type: 'currency',
            format: (val) => `$${val.toFixed(1)}M`
        },
        'pull-through': {
            current: 84,
            target: 80,
            type: 'percentage',
            format: (val) => `${Math.round(val)}%`
        }
    },

    // ========================================
    // INITIALIZATION
    // ========================================
    async init() {
        await this.loadSavedGoals();
        this.bindPeriodSelector();
        this.bindEditButtons();
        this.bindSliders();
        this.updateAllGoals();
        console.log('GoalsManager initialized');
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
            await this.loadSavedGoals(); // Reload goals for new period
            this.updateAllGoals();
            console.log(`Period changed to: ${this.currentPeriod}`);
        });
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
        const card = document.querySelector(`[data-goal="${goalId}"]`);
        if (!card) return;

        const sliderContainer = card.querySelector('.goal-slider-container');
        const editBtn = card.querySelector('.goal-edit-btn');
        const isVisible = sliderContainer.style.display !== 'none';

        if (isVisible) {
            // Hide slider and save
            sliderContainer.style.display = 'none';
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            this.saveGoal(goalId);
        } else {
            // Show slider
            sliderContainer.style.display = 'block';
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
            'pullThroughSlider': 'pull-through'
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
            'pull-through': 'pullThroughSlider'
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
            } else if (goal.type === 'percentage') {
                display.textContent = Math.round(value);
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
            } else if (goal.type === 'percentage') {
                targetEl.textContent = Math.round(goal.target);
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
            'pull-through': 'pullThroughValue'
        };
        return map[goalId];
    },

    getTargetId(goalId) {
        const map = {
            'loans-closed': 'loansClosedTarget',
            'volume-closed': 'volumeClosedTarget',
            'pipeline': 'pipelineTarget',
            'pull-through': 'pullThroughTarget'
        };
        return map[goalId];
    },

    calculateProgress(goalId) {
        const goal = this.goals[goalId];
        if (!goal || goal.target === 0) return 0;

        // Special handling for pull-through (current vs target)
        if (goalId === 'pull-through') {
            return Math.min(100, (goal.current / goal.target) * 100);
        }

        // For pipeline, show as "exceeded" if current >= target
        if (goalId === 'pipeline') {
            return goal.current >= goal.target ? 100 : (goal.current / goal.target) * 100;
        }

        // Standard progress calculation
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
            'pull-through': 'pullThroughProgress'
        };
        return map[goalId];
    },

    updateProgressText(goalId, progress) {
        const textEl = document.getElementById(this.getProgressTextId(goalId));
        if (!textEl) return;

        const goal = this.goals[goalId];
        let text = '';

        if (goalId === 'pipeline') {
            text = progress >= 100 ? 'Strong pipeline' : `${Math.round(progress)}% of target`;
        } else if (goalId === 'pull-through') {
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
            'pull-through': 'pullThroughProgressText'
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
            const userId = CONFIG.currentUser?.id || null;
            const periodValue = this.getPeriodValue();
            
            const goalData = {
                user_id: userId,
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

    async loadSavedGoals() {
        try {
            const userId = CONFIG.currentUser?.id || null;
            const periodValue = this.getPeriodValue();
            
            const goals = await ServerAPI.getGoals(userId, this.currentPeriod, periodValue);
            
            // Update local goals from API response
            goals.forEach(apiGoal => {
                const goalId = apiGoal.goal_type;
                if (this.goals[goalId]) {
                    this.goals[goalId].target = parseFloat(apiGoal.target_value) || this.goals[goalId].target;
                    this.goals[goalId].current = parseFloat(apiGoal.current_value) || this.goals[goalId].current;
                }
            });
        } catch (error) {
            console.error('Failed to load goals from API:', error);
            // Fallback to localStorage
            Object.keys(this.goals).forEach(goalId => {
                const key = `goal_${goalId}_${this.currentPeriod}`;
                const saved = Utils.getStorage(key);
                if (saved) {
                    this.goals[goalId].target = saved.target;
                    this.goals[goalId].current = saved.current;
                }
            });
        }
    },

    // ========================================
    // PUBLIC API
    // ========================================
    setGoal(goalId, current, target) {
        if (this.goals[goalId]) {
            this.goals[goalId].current = current;
            this.goals[goalId].target = target;
            this.updateGoalCard(goalId);
            this.saveGoal(goalId);
        }
    },

    getGoal(goalId) {
        return this.goals[goalId] ? { ...this.goals[goalId] } : null;
    }
};

// Export to global scope
window.GoalsManager = GoalsManager;

