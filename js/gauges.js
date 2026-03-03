/* ============================================
   MSFG Dashboard - Header Mini Speedometer Gauges
   Compact SVG arc gauges in header bar, fed from
   the same data as Performance & Goals section
   ============================================ */

const DashboardGauges = {
  data: {
    preApprovals: { units: 0, total_amount: 0 },
    pipeline:     { units: 0, total_amount: 0 },
    funded:       { units: 0, total_amount: 0 },
  },

  // Arc geometry constants (tiny semicircle)
  CX: 22,
  CY: 24,
  R: 18,

  // ========================================
  // INITIALIZATION
  // ========================================
  async init() {
    await this.fetchAllSummaries();
    this.renderHeaderMetrics();
    this.bindPeriodListener();
    console.log('HeaderMetrics initialized');
  },

  // ========================================
  // DATA FETCHING
  // ========================================
  async fetchAllSummaries() {
    try {
      // Map GoalsManager period to funded-loans API period param
      const goalPeriod = window.GoalsManager?.currentPeriod || 'monthly';
      const fundedPeriod = goalPeriod === 'yearly' ? 'ytd' : 'mtd';

      const [preApprovals, pipeline, funded] = await Promise.all([
        ServerAPI.getPreApprovalsSummary().catch(() => ({ units: 0, total_amount: 0 })),
        ServerAPI.getPipelineSummary().catch(() => ({ units: 0, total_amount: 0 })),
        ServerAPI.getFundedLoansSummary({ period: fundedPeriod }).catch(() => ({ units: 0, total_amount: 0 })),
      ]);

      this.data.preApprovals = preApprovals;
      this.data.pipeline     = pipeline;
      this.data.funded        = funded;
    } catch (err) {
      console.error('HeaderMetrics: failed to fetch summaries', err);
    }
  },

  // ========================================
  // PERIOD LISTENER
  // ========================================
  bindPeriodListener() {
    const periodSelect = document.getElementById('goalPeriodSelect');
    if (!periodSelect) return;

    periodSelect.addEventListener('change', () => {
      setTimeout(() => this.refresh(), 300);
    });
  },

  // ========================================
  // PUBLIC REFRESH
  // ========================================
  async refresh() {
    await this.fetchAllSummaries();
    this.renderHeaderMetrics();
  },

  // ========================================
  // RENDER ALL HEADER METRICS + GAUGES
  // ========================================
  renderHeaderMetrics() {
    const gm = window.GoalsManager;
    const pullThrough = this.data.pipeline.units > 0
      ? Math.round((this.data.funded.units / this.data.pipeline.units) * 100)
      : 0;

    // Pre-Approvals — no goal target, show as full or proportional to 20
    const paTarget = 20;
    const paPct = Math.min(100, (this.data.preApprovals.units / paTarget) * 100);
    this.renderMiniGauge('hdrGaugePreApprovals', paPct);
    this.setText('hdrPreApprovalUnits', this.data.preApprovals.units);

    // Pipeline — use goal target if set
    const pipGoal = gm?.getGoal?.('pipeline');
    const pipVal = this.data.pipeline.total_amount / 1000000;
    const pipTarget = pipGoal?.target || 10;
    const pipPct = Math.min(100, (pipVal / pipTarget) * 100);
    this.renderMiniGauge('hdrGaugePipeline', pipPct);
    this.setText('hdrPipelineUnits', this.data.pipeline.units);

    // Funded Units — use loans-closed goal target
    const fundedGoal = gm?.getGoal?.('loans-closed');
    const fundedTarget = fundedGoal?.target || 25;
    const fundedPct = Math.min(100, (this.data.funded.units / fundedTarget) * 100);
    this.renderMiniGauge('hdrGaugeFunded', fundedPct);
    this.setText('hdrFundedUnits', this.data.funded.units);

    // Volume — use volume-closed goal target
    const volGoal = gm?.getGoal?.('volume-closed');
    const volVal = this.data.funded.total_amount / 1000000;
    const volTarget = volGoal?.target || 10;
    const volPct = Math.min(100, (volVal / volTarget) * 100);
    this.renderMiniGauge('hdrGaugeVolume', volPct);
    this.setText('hdrFundedVolume', this.formatVolume(this.data.funded.total_amount));

    // Pull-Through — use pull-through goal target
    const ptGoal = gm?.getGoal?.('pull-through');
    const ptTarget = ptGoal?.target || 80;
    const ptPct = Math.min(100, (pullThrough / ptTarget) * 100);
    this.renderMiniGauge('hdrGaugePullThrough', ptPct);
    this.setText('hdrPullThrough', pullThrough + '%');

    // Feed current values back into GoalsManager
    if (gm) {
      if (gm.goals['loans-closed'])  gm.goals['loans-closed'].current = this.data.funded.units;
      if (gm.goals['volume-closed']) gm.goals['volume-closed'].current = volVal;
      if (gm.goals['pipeline'])      gm.goals['pipeline'].current = pipVal;
      if (gm.goals['pull-through'])  gm.goals['pull-through'].current = pullThrough;
      gm.updateAllGoals();
    }
  },

  // ========================================
  // RENDER MINI SPEEDOMETER GAUGE
  // ========================================
  renderMiniGauge(containerId, percent) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const svg = container.querySelector('.hdr-gauge-svg');
    if (!svg) return;

    const cx = this.CX;
    const cy = this.CY;
    const r = this.R;
    const pct = Math.max(0, Math.min(100, percent));

    // Arc path (180° semicircle, left to right)
    const startX = cx - r;
    const startY = cy;
    const endX   = cx + r;
    const endY   = cy;
    const arcPath = `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`;

    // Total arc length for dash animation
    const arcLen = Math.PI * r; // semicircle circumference
    const fillLen = (pct / 100) * arcLen;

    // Color based on progress
    let color;
    if (pct >= 100)     color = '#4ade80'; // green
    else if (pct >= 75) color = '#22d3ee'; // cyan/teal
    else if (pct >= 50) color = '#fbbf24'; // amber
    else if (pct >= 25) color = '#fb923c'; // orange
    else                color = '#f87171'; // red

    // Needle angle: 180° (left) at 0%, 0° (right) at 100%
    const needleAngle = 180 - (pct / 100) * 180;
    const needleRad = (needleAngle * Math.PI) / 180;
    const needleLen = r - 4;
    const nx = cx + needleLen * Math.cos(needleRad);
    const ny = cy - needleLen * Math.sin(needleRad);

    svg.innerHTML =
      // Background arc
      `<path d="${arcPath}" class="hdr-gauge-bg" />` +
      // Colored fill arc
      `<path d="${arcPath}" class="hdr-gauge-fill" ` +
        `stroke="${color}" ` +
        `stroke-dasharray="${arcLen}" ` +
        `stroke-dashoffset="${arcLen - fillLen}" />` +
      // Needle line
      `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="hdr-gauge-needle" />` +
      // Center dot
      `<circle cx="${cx}" cy="${cy}" r="1.5" fill="#fff" />`;
  },

  // ========================================
  // HELPERS
  // ========================================
  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  },

  formatVolume(amount) {
    if (!amount || amount === 0) return '$0';
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount.toLocaleString()}`;
  },

  // Legacy API bridge
  getGoal(id) {
    return window.GoalsManager?.getGoal?.(id) || null;
  },
};

// Export to global scope
window.DashboardGauges = DashboardGauges;
