/**
 * SettingsGoals – Goals tab in Settings panel.
 * Simplified: shows current goals at a glance with easy number inputs.
 * No more sliders — just clear, simple target fields.
 * Depends on globals: GoalsManager, CONFIG, ServerAPI, Utils
 */
const SettingsGoals = {
  _goalsPeriod: null,

  _getGoalsPeriodValue(period) {
    const now = new Date();
    switch (period) {
      case 'weekly': {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        return start.toISOString().slice(0, 10);
      }
      case 'monthly':
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      case 'quarterly': {
        const q = Math.ceil((now.getMonth() + 1) / 3);
        return `${now.getFullYear()}-Q${q}`;
      }
      case 'yearly':
        return `${now.getFullYear()}`;
      default:
        return '';
    }
  },

  async loadGoalsTab() {
    const container = document.getElementById('settingsGoalsContent');
    if (!container) return;

    if (!this._goalsPeriod) {
      this._goalsPeriod = GoalsManager?.currentPeriod || 'monthly';
    }

    container.innerHTML = '<div class="settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading goals...</div>';

    try {
      const userId = CONFIG.currentUser?.id;
      const period = this._goalsPeriod;
      const periodValue = this._getGoalsPeriodValue(period);

      const [fundedResult, pipelineResult, preApprovalsResult, goalsResult] = await Promise.allSettled([
        ServerAPI.getFundedLoansSummary({ period, lo_id: userId }),
        ServerAPI.getPipelineSummary({ lo_id: userId }),
        ServerAPI.getPreApprovalsSummary({ lo_id: userId }),
        ServerAPI.getGoals(userId, period, periodValue),
      ]);

      const funded = fundedResult.status === 'fulfilled' ? fundedResult.value : {};
      const pipeline = pipelineResult.status === 'fulfilled' ? pipelineResult.value : {};
      const preApprovals = preApprovalsResult.status === 'fulfilled' ? preApprovalsResult.value : {};
      const savedGoals = goalsResult.status === 'fulfilled' && Array.isArray(goalsResult.value) ? goalsResult.value : [];

      const targetMap = {};
      savedGoals.forEach(g => { targetMap[g.goal_type] = parseFloat(g.target_value) || 0; });

      const goalDefs = [
        {
          id: 'loans-closed', label: 'Loans Closed', icon: 'fa-file-signature',
          current: parseInt(funded.units || funded.count || 0),
          target: targetMap['loans-closed'] || 0,
          type: 'number', step: 1, prefix: '', suffix: '',
          hint: 'Number of loans you want to close',
        },
        {
          id: 'volume-closed', label: 'Volume Closed', icon: 'fa-dollar-sign',
          current: parseFloat(funded.total_amount || 0) / 1000000,
          target: targetMap['volume-closed'] || 0,
          type: 'currency', step: 0.5, prefix: '$', suffix: 'M',
          hint: 'Target in millions (e.g. 5 = $5M)',
        },
        {
          id: 'pipeline', label: 'Pipeline', icon: 'fa-chart-line',
          current: parseFloat(pipeline.total_amount || 0) / 1000000,
          target: targetMap['pipeline'] || 0,
          type: 'currency', step: 0.5, prefix: '$', suffix: 'M',
          hint: 'Pipeline target in millions',
        },
        {
          id: 'pre-approvals', label: 'Pre-Approvals', icon: 'fa-clipboard-check',
          current: parseInt(preApprovals.active_count || preApprovals.units || 0),
          target: targetMap['pre-approvals'] || 0,
          type: 'number', step: 1, prefix: '', suffix: '',
          hint: 'Number of active pre-approvals',
        },
      ];

      this._renderGoalsTab(goalDefs, period);
    } catch (err) {
      container.innerHTML = '<div class="settings-error"><i class="fas fa-exclamation-triangle"></i> Failed to load goals.</div>';
    }
  },

  _renderGoalsTab(goalDefs, period) {
    const container = document.getElementById('settingsGoalsContent');
    if (!container) return;

    const esc = Utils.escapeHtml;

    container.innerHTML = `
      <div class="settings-goals-header">
        <h4><i class="fas fa-trophy"></i> My Goals</h4>
        <select class="settings-goals-period-select" id="settingsGoalsPeriodSelect">
          <option value="weekly" ${period === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="monthly" ${period === 'monthly' ? 'selected' : ''}>Monthly</option>
          <option value="quarterly" ${period === 'quarterly' ? 'selected' : ''}>Quarterly</option>
          <option value="yearly" ${period === 'yearly' ? 'selected' : ''}>Yearly</option>
        </select>
      </div>
      <p class="settings-hint" style="margin-top:-8px;margin-bottom:12px;">
        Set your targets below. You can also set them by clicking any goal card on your dashboard.
      </p>
      <div class="settings-goals-grid">
        ${goalDefs.map(g => {
          const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
          const currentDisplay = g.type === 'currency' ? `$${g.current.toFixed(1)}M` : Math.round(g.current);

          return `
            <div class="settings-goal-card" data-goal-id="${g.id}">
              <div class="settings-goal-header">
                <i class="fas ${g.icon}"></i>
                <span class="settings-goal-label">${esc(g.label)}</span>
              </div>
              <div class="settings-goal-current">
                <span class="settings-goal-value">${currentDisplay}</span>
                <span class="settings-goal-of">current</span>
              </div>
              <div class="progress-bar"><div class="progress-fill ${pct >= 100 ? 'exceeded' : pct >= 50 ? 'on-track' : 'behind'}" style="width:${pct}%"></div></div>
              <div class="settings-goal-input-row">
                <label>Target:</label>
                <div class="settings-goal-input-wrap">
                  <span class="settings-goal-prefix">${g.prefix}</span>
                  <input type="number" min="0" step="${g.step}" value="${g.target || ''}"
                         placeholder="Enter target"
                         data-goal-id="${g.id}" class="settings-goal-number-input" />
                  <span class="settings-goal-suffix">${g.suffix}</span>
                </div>
              </div>
              <p class="settings-goal-hint">${g.hint}</p>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind number inputs (save on blur or Enter)
    container.querySelectorAll('.settings-goal-number-input').forEach(input => {
      const save = () => {
        const goalId = input.dataset.goalId;
        const val = parseFloat(input.value) || 0;
        this._saveGoalTarget(goalId, val);
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });

    // Period selector
    document.getElementById('settingsGoalsPeriodSelect')?.addEventListener('change', (e) => {
      this._goalsPeriod = e.target.value;
      this.loadGoalsTab();
    });
  },

  async _saveGoalTarget(goalId, targetValue) {
    try {
      const userId = CONFIG.currentUser?.id;
      const period = this._goalsPeriod || 'monthly';
      const periodValue = this._getGoalsPeriodValue(period);

      await ServerAPI.updateGoals({
        user_id: userId,
        period_type: period,
        period_value: periodValue,
        goal_type: goalId,
        target_value: targetValue,
      });

      // Update the main dashboard goals display too
      if (GoalsManager?.goals?.[goalId]) {
        GoalsManager.goals[goalId].target = targetValue;
        GoalsManager.updateGoalCard(goalId);
      }

      Utils.showToast('Target saved!', 'success');
    } catch (err) {
      Utils.showToast('Failed to save goal: ' + err.message, 'error');
    }
  },
};

window.SettingsGoals = SettingsGoals;
