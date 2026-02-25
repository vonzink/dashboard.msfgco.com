/* ============================================
   MSFG Dashboard - Main Application
   Application initialization and orchestration
   ============================================ */

const App = {
    // ========================================
    // INITIALIZATION
    // ========================================
    init() {
        console.log('🏔️ MSFG Dashboard starting...');

        // Initialize modules — each wrapped in try/catch so one
        // failing module doesn't prevent the rest from loading
        const modules = [
            ['Theme',          () => this.initTheme()],
            ['Tables',         () => this.initTables()],
            ['Chat',           () => this.initChat()],
            ['Investors',      () => this.initInvestors()],
            ['Funded Loans',   () => this.initFundedLoans()],
            ['Goals',          () => this.initGoals()],
            ['Modals',         () => this.initModals()],
            ['Monday',         () => this.initMondaySettings()],
            ['Progress Bars',  () => this.initProgressBars()],
        ];

        for (const [name, initFn] of modules) {
            try {
                initFn();
            } catch (err) {
                console.error('Failed to init ' + name + ':', err);
            }
        }

        // Load user info + data from API
        this.loadCurrentUser();
        this.loadData();
        this.loadEmployeeDirectory();

        // Start auto-refresh
        if (typeof DataRefresher !== 'undefined') DataRefresher.start();

        console.log('✅ MSFG Dashboard ready!');
    },

    // ========================================
    // MODULE INITIALIZATION
    // ========================================
    initTheme() {
        ThemeManager.init();
    },

    initTables() {
        TableManager.init();
    },

    initChat() {
        Chat.init();
        
        // Connect to WebSocket (uncomment and update URL when ready)
        // Chat.connect('wss://your-server.com/chat');
    },

    initInvestors() {
        Investors.init();
        this.initManageInvestorsModal();
    },

    initManageInvestorsModal() {
        // Close button
        const modal = document.getElementById('manageInvestorsModal');
        if (!modal) return;

        const closeBtn = modal.querySelector('.manage-investors-close');
        if (closeBtn) closeBtn.addEventListener('click', () => Investors.hideManageModal());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) Investors.hideManageModal();
        });

        // Search
        const searchInput = document.getElementById('manageInvestorSearch');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                Investors._manageSearchTerm = searchInput.value;
                Investors._renderManageList();
            });
        }

        // Add button
        const addBtn = document.getElementById('manageAddInvestorBtn');
        if (addBtn) addBtn.addEventListener('click', () => Investors._openForm(null));

        // Cancel button on form
        const cancelBtn = document.getElementById('manageFormCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => Investors._showManageView('list'));

        // Form submit
        const form = document.getElementById('investorAdminForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                Investors._saveForm();
            });
        }
    },

    initFundedLoans() {
        if (typeof FundedLoans !== 'undefined') {
            FundedLoans.init();
        }
    },

    initGoals() {
        GoalsManager.init();
    },

    initModals() {
        ModalsManager.init();
    },

    initMondaySettings() {
        if (typeof MondaySettings !== 'undefined') {
            MondaySettings.init();
        }
    },

    initProgressBars() {
        // Animate progress bars after a short delay
        setTimeout(() => {
            document.querySelectorAll('.progress-fill').forEach(bar => {
                bar.style.transition = 'width 1s ease-out';
            });
        }, 500);
    },

    // ========================================
    // CURRENT USER / ADMIN DETECTION
    // ========================================
    async loadCurrentUser() {
        try {
            const me = await ServerAPI.getMe();
            if (me) {
                CONFIG.currentUser.id = me.id;
                CONFIG.currentUser.name = me.name || CONFIG.currentUser.name;
                CONFIG.currentUser.email = me.email;
                CONFIG.currentUser.initials = me.initials || CONFIG.currentUser.initials;
                CONFIG.currentUser.role = me.role || 'user';

                // Update header UI
                const nameEl = document.getElementById('userName');
                const roleEl = document.getElementById('userRole');
                const avatarEl = document.getElementById('userAvatar');
                if (nameEl && me.name) nameEl.textContent = me.name;
                if (roleEl && me.role) roleEl.textContent = me.role;
                if (avatarEl && me.initials) avatarEl.textContent = me.initials;

                // Show admin-only elements
                const role = String(me.role).toLowerCase();
                if (role === 'admin') {
                    document.querySelectorAll('.admin-only-item').forEach(el => {
                        el.style.display = '';
                    });
                }

                // Show LO filter on funded loans for admin/manager
                if (role === 'admin' || role === 'manager') {
                    const fundedLO = document.getElementById('fundedLOSelect');
                    if (fundedLO) fundedLO.style.display = '';
                }
            }
        } catch (err) {
            console.warn('Could not load current user:', err);
        }
    },

    // ========================================
    // EMPLOYEE DIRECTORY (HR dropdown)
    // ========================================
    async loadEmployeeDirectory() {
        const container = document.getElementById('hrEmployeeList');
        if (!container) return;

        try {
            const users = await ServerAPI.get('/users/directory');
            if (!Array.isArray(users) || users.length === 0) {
                container.innerHTML = '<span class="text-muted" style="padding: 0.5rem 1rem; font-size: 0.8rem;">No employees found.</span>';
                return;
            }

            container.innerHTML = users.map(u => {
                const initials = u.initials || (u.name || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                const email = u.display_email || u.email || '';
                return `
                    <button type="button" class="dropdown-item employee-card-link" data-action="open-employee-card" data-employee-id="${u.id}">
                        <span class="employee-avatar-sm">${initials}</span>
                        <span class="employee-link-info">
                            <strong>${u.name || 'Unknown'}</strong>
                            <small>${u.role || ''}</small>
                        </span>
                    </button>`;
            }).join('');
        } catch (err) {
            console.warn('Employee directory load failed:', err.message);
            container.innerHTML = '<span class="text-muted" style="padding: 0.5rem 1rem; font-size: 0.8rem;">Could not load employees.</span>';
        }
    },

    // ========================================
    // DATA LOADING
    // ========================================
    async loadData() {
        try {
            await API.loadAllData();
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showNotification('Failed to load data. Please refresh.', 'error');
        }
    },

    // ========================================
    // NOTIFICATIONS
    // ========================================
    showNotification(message, type = 'info') {
        // Could implement toast notifications here
        console.log(`[${type.toUpperCase()}] ${message}`);
    },

    // ========================================
    // ERROR HANDLING
    // ========================================
    handleError(error, context = '') {
        console.error(`Error ${context}:`, error);
        
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            this.showNotification('Network error. Please check your connection.', 'error');
        } else {
            this.showNotification('Something went wrong. Please try again.', 'error');
        }
    }
};

// ========================================
// GLOBAL ERROR HANDLER
// ========================================
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', { message, source, lineno, colno, error });
    return false;
};

window.onunhandledrejection = function(event) {
    console.error('Unhandled promise rejection:', event.reason);
};

// ========================================
// DOM READY
// ========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

// Export to global scope
window.App = App;
