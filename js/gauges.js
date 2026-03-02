/* ============================================
   MSFG Dashboard - Performance Gauge Displays
   SVG arc gauges for Pre-Approvals, Pipeline, Funded Loans
   ============================================ */

const DashboardGauges = {
  data: {
    preApprovals: { units: 0, total_amount: 0 },
    pipeline:     { units: 0, total_amount: 0 },
    funded:       { units: 0, total_amount: 0 },
  },

  // ========================================
  // INITIALIZATION
  // ========================================
  async init() {
    await this.fetchAllSummaries();
    this.renderAllGauges();
    this.bindPeriodListener();
    console.log('DashboardGauges initialized');
  },

  // ========================================
  // DATA FETCHING
  // ========================================
  async fetchAllSummaries() {
    try {
      const [preApprovals, pipeline, funded] = await Promise.all([
        ServerAPI.getPreApprovalsSummary().catch(() => ({ units: 0, total_amount: 0 })),
        ServerAPI.getPipelineSummary().catch(() => ({ units: 0, total_amount: 0 })),
        ServerAPI.getFundedLoansSummary().catch(() => ({ units: 0, total_amount: 0 })),
      ]);

      this.data.preApprovals = preApprovals;
      this.data.pipeline     = pipeline;
      this.data.funded        = funded;
    } catch (err) {
      console.error('DashboardGauges: failed to fetch summaries', err);
    }
  },

  // ========================================
  // PERIOD LISTENER
  // ========================================
  bindPeriodListener() {
    const periodSelect = document.getElementById('goalPeriodSelect');
    if (!periodSelect) return;

    periodSelect.addEventListener('change', () => {
      // Re-fetch after a short delay to let GoalsManager update first
      setTimeout(() => this.refresh(), 300);
    });
  },

  // ========================================
  // PUBLIC REFRESH
  // ========================================
  async refresh() {
    await this.fetchAllSummaries();
    this.renderAllGauges();
  },

  // ========================================
  // RENDER ALL GAUGES
  // ========================================
  renderAllGauges() {
    this.renderGauge('gaugePreApprovals', {
      units: this.data.preApprovals.units,
      volume: this.data.preApprovals.total_amount,
      target: null, // No goal target for pre-approvals
      label: 'Pre-Approvals',
      color: 'var(--primary, #0d7377)',
    });

    const pipelineGoal = window.GoalsManager?.getGoal?.('pipeline');
    this.renderGauge('gaugePipeline', {
      units: this.data.pipeline.units,
      volume: this.data.pipeline.total_amount,
      target: pipelineGoal ? pipelineGoal.target * 1000000 : null, // Target is in $M
      label: 'Pipeline',
      color: 'var(--primary, #0d7377)',
    });

    const fundedGoal = window.GoalsManager?.getGoal?.('loans-closed');
    const pullThroughGoal = window.GoalsManager?.getGoal?.('pull-through');
    const pullThroughActual = this.data.pipeline.units > 0
      ? Math.round((this.data.funded.units / this.data.pipeline.units) * 100)
      : 0;

    this.renderGauge('gaugeFunded', {
      units: this.data.funded.units,
      volume: this.data.funded.total_amount,
      target: fundedGoal ? fundedGoal.target : null,
      label: 'Funded Loans',
      color: 'var(--primary, #0d7377)',
      pullThrough: pullThroughActual,
      pullThroughTarget: pullThroughGoal ? pullThroughGoal.target : null,
    });

    // Also update GoalsManager current values if available
    if (window.GoalsManager) {
      if (fundedGoal) {
        window.GoalsManager.goals['loans-closed'].current = this.data.funded.units;
      }
      const volGoal = window.GoalsManager.goals['volume-closed'];
      if (volGoal) {
        volGoal.current = this.data.funded.total_amount / 1000000; // Convert to $M
      }
      const pipGoal = window.GoalsManager.goals['pipeline'];
      if (pipGoal) {
        pipGoal.current = this.data.pipeline.total_amount / 1000000; // Convert to $M
      }
      const ptGoal = window.GoalsManager.goals['pull-through'];
      if (ptGoal) {
        ptGoal.current = pullThroughActual;
      }
      window.GoalsManager.updateAllGoals();
    }
  },

  // ========================================
  // RENDER SINGLE GAUGE
  // ========================================
  renderGauge(containerId, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svgContainer = container.querySelector('.gauge-svg-container');
    const unitsEl      = container.querySelector('.gauge-units');
    const volumeEl     = container.querySelector('.gauge-volume');
    const pullEl       = container.querySelector('.gauge-pull-through');

    if (!svgContainer) return;

    // Calculate progress percentage
    let progress = 100; // Default: full arc if no target
    if (opts.target && opts.target > 0) {
      progress = Math.min(100, (opts.units / opts.target) * 100);
    }

    // Determine color class
    let colorClass = 'gauge-on-track';
    if (opts.target && opts.target > 0) {
      if (progress >= 100) colorClass = 'gauge-exceeded';
      else if (progress >= 75) colorClass = 'gauge-on-track';
      else if (progress >= 50) colorClass = 'gauge-warning';
      else colorClass = 'gauge-behind';
    }

    // SVG arc parameters
    const width = 160;
    const height = 90;
    const cx = width / 2;
    const cy = height - 5;
    const radius = 65;
    const startAngle = Math.PI;       // 180° (left)
    const endAngle   = 0;             // 0° (right)
    const totalArc   = Math.PI;       // 180° semicircle

    // Background arc path (full semicircle)
    const bgPath = this.describeArc(cx, cy, radius, startAngle, endAngle);
    // Progress arc path
    const progressAngle = startAngle - (totalArc * (progress / 100));
    const fgPath = this.describeArc(cx, cy, radius, startAngle, Math.max(progressAngle, endAngle));

    // Build SVG
    svgContainer.innerHTML = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="gauge-svg">
        <path d="${bgPath}" fill="none" stroke="var(--border-color, #e0e0e0)" stroke-width="12" stroke-linecap="round" />
        <path d="${fgPath}" fill="none" class="gauge-arc ${colorClass}" stroke-width="12" stroke-linecap="round" />
        <text x="${cx}" y="${cy - 20}" text-anchor="middle" class="gauge-center-value">${opts.units}</text>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="gauge-center-label">Units</text>
      </svg>
    `;

    // Update text stats
    if (unitsEl) {
      unitsEl.textContent = `${opts.units} Unit${opts.units !== 1 ? 's' : ''}`;
    }
    if (volumeEl) {
      volumeEl.textContent = this.formatVolume(opts.volume);
    }
    if (pullEl && opts.pullThrough !== undefined) {
      pullEl.textContent = `${opts.pullThrough}% Pull-Through`;
    }
  },

  // ========================================
  // SVG ARC HELPER
  // ========================================
  describeArc(cx, cy, radius, startAngle, endAngle) {
    const startX = cx + radius * Math.cos(startAngle);
    const startY = cy - radius * Math.sin(startAngle);
    const endX   = cx + radius * Math.cos(endAngle);
    const endY   = cy - radius * Math.sin(endAngle);

    const largeArcFlag = (startAngle - endAngle) > Math.PI ? 1 : 0;

    return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
  },

  // ========================================
  // FORMAT HELPERS
  // ========================================
  formatVolume(amount) {
    if (!amount || amount === 0) return '$0';
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(0)}K`;
    }
    return `$${amount.toLocaleString()}`;
  },
};

// Export to global scope
window.DashboardGauges = DashboardGauges;
