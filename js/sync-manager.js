/* ============================================
   MSFG Dashboard - Sync Manager
   MondaySettings: Monday.com toolbar sync trigger + pipeline filtering/search.
   DataRefresher:  Auto-refresh intervals that pause when the browser tab is hidden.
   Both depend on API (js/api.js) and ServerAPI (js/api-server.js).
   ============================================ */

// ========================================
// MONDAY.COM SETTINGS (SLIM)
// Modal moved to Admin Settings. Only toolbar sync + pipeline filter remain.
// ========================================
const MondaySettings = {
    init() {
        // Pipeline filter handlers — both LO dropdown and search update summary
        const loSelect = document.getElementById('pipelineLO');
        if (loSelect) {
            // Restore saved LO filter
            const savedLO = Utils.getStorage('pipeline_lo', '');
            if (savedLO) loSelect.value = savedLO;
            loSelect.addEventListener('change', () => {
                Utils.setStorage('pipeline_lo', loSelect.value);
                this.filterPipeline();
            });
        }
        const searchInput = document.getElementById('pipelineSearch');
        if (searchInput) {
            const debounced = Utils.debounce(() => this.filterPipeline(), 200);
            searchInput.addEventListener('input', debounced);
        }
    },

    async triggerSyncFromToolbar(clickedBtn) {
        // Disable ALL sync buttons while syncing
        const allBtns = document.querySelectorAll('.monday-sync-btn');
        const originals = new Map();
        allBtns.forEach(btn => {
            originals.set(btn, btn.innerHTML);
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        });

        try {
            // POST /sync now returns immediately — sync runs in background
            await ServerAPI.syncMonday();

            // Poll for sync completion (check every 3s, up to 2 minutes)
            const maxWait = 120000;
            const interval = 3000;
            const start = Date.now();
            let completed = false;

            while (Date.now() - start < maxWait) {
                await new Promise(r => setTimeout(r, interval));
                try {
                    const status = await ServerAPI.getMondaySyncStatus();
                    if (status.lastSync) {
                        const syncStatus = status.lastSync.status;
                        if (syncStatus === 'success' || syncStatus === 'error') {
                            completed = true;
                            if (syncStatus === 'error') {
                                Utils.showToast('Sync completed with errors: ' + (status.lastSync.error_message || 'Unknown'), 'error');
                            }
                            break;
                        }
                    }
                } catch { /* ignore polling errors */ }
            }

            // Reload all three synced sections
            await Promise.allSettled([
                API.loadPreApprovals(),
                API.loadPipeline(),
                typeof FundedLoans !== 'undefined' ? FundedLoans.load() : Promise.resolve(),
            ]);

            // Brief success flash
            allBtns.forEach(btn => {
                btn.innerHTML = '<i class="fas fa-check"></i> Done';
            });
            if (completed) {
                Utils.showToast('Monday.com sync completed successfully!', 'success');
            } else {
                Utils.showToast('Sync is still running in the background. Data will refresh shortly.', 'info');
            }
            setTimeout(() => {
                allBtns.forEach(btn => {
                    btn.innerHTML = originals.get(btn);
                    btn.disabled = false;
                });
            }, 2000);
        } catch (err) {
            Utils.showToast('Sync failed: ' + err.message, 'error');
            allBtns.forEach(btn => {
                btn.innerHTML = originals.get(btn);
                btn.disabled = false;
            });
        }
    },

    filterPipeline() {
        const loVal = (document.getElementById('pipelineLO')?.value || '').toLowerCase();
        const searchVal = (document.getElementById('pipelineSearch')?.value || '').toLowerCase();
        const rows = document.querySelectorAll('#pipelineTable tbody tr');

        rows.forEach(row => {
            if (row.querySelector('.empty-state')) return;
            const rowLO = (row.getAttribute('data-lo') || '').toLowerCase();
            const rowText = row.textContent.toLowerCase();

            let show = true;
            if (loVal && rowLO !== loVal) show = false;
            if (searchVal && !rowText.includes(searchVal)) show = false;
            row.style.display = show ? '' : 'none';
        });

        // Recalculate summary from visible rows
        this._updatePipelineSummaryFromVisible();
    },

    /** Recalculate pipeline summary from currently visible table rows */
    _updatePipelineSummaryFromVisible() {
        if (!API.pipelineData) return;

        const loVal = (document.getElementById('pipelineLO')?.value || '').toLowerCase();
        const searchVal = (document.getElementById('pipelineSearch')?.value || '').toLowerCase();
        const hasFilters = loVal || searchVal;

        if (!hasFilters) {
            // No filters active — show full summary
            API.updatePipelineSummary(API.pipelineData);
            return;
        }

        // Build filtered dataset from the original data
        const filtered = API.pipelineData.filter(item => {
            if (loVal) {
                const itemLO = (item.assigned_lo_name || '').toLowerCase();
                if (itemLO !== loVal) return false;
            }
            if (searchVal) {
                const text = Object.values(item).join(' ').toLowerCase();
                if (!text.includes(searchVal)) return false;
            }
            return true;
        });

        API.updatePipelineSummary(filtered);
    },
};

// ========================================
// DATA REFRESHER — pauses when tab is hidden
// ========================================
const DataRefresher = {
    intervals: {},
    _visibilityBound: false,

    start() {
        if (!CONFIG.features.autoRefresh) return;

        this.intervals.news = setInterval(() => API.loadNews(), CONFIG.refresh.news);
        this.intervals.tasks = setInterval(() => API.loadTasks(), CONFIG.refresh.tasks);
        this.intervals.preApprovals = setInterval(() => API.loadPreApprovals(), CONFIG.refresh.preApprovals);
        this.intervals.pipeline = setInterval(() => API.loadPipeline(), CONFIG.refresh.pipeline);
        this.intervals.goals = setInterval(() => API.loadGoals(), CONFIG.refresh.goals);

        // Pause refreshes when tab is hidden, resume when visible
        if (!this._visibilityBound) {
            this._visibilityBound = true;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this._pause();
                } else {
                    // Refresh immediately on return, then resume intervals
                    API.loadAllData();
                    this._resume();
                }
            });
        }

    },

    /** Clear intervals without removing the visibility listener */
    _pause() {
        Object.values(this.intervals).forEach(id => clearInterval(id));
        this.intervals = {};
    },

    /** Re-create intervals (called when tab becomes visible) */
    _resume() {
        if (!CONFIG.features.autoRefresh) return;
        // Avoid duplicate intervals
        this._pause();
        this.intervals.news = setInterval(() => API.loadNews(), CONFIG.refresh.news);
        this.intervals.tasks = setInterval(() => API.loadTasks(), CONFIG.refresh.tasks);
        this.intervals.preApprovals = setInterval(() => API.loadPreApprovals(), CONFIG.refresh.preApprovals);
        this.intervals.pipeline = setInterval(() => API.loadPipeline(), CONFIG.refresh.pipeline);
        this.intervals.goals = setInterval(() => API.loadGoals(), CONFIG.refresh.goals);
    },

    stop() {
        this._pause();
    },

    restart() {
        this.stop();
        this.start();
    }
};

// Export to global scope
window.MondaySettings = MondaySettings;
window.DataRefresher = DataRefresher;
