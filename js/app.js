/* ============================================
   MSFG Dashboard - Main Application
   Application initialization and orchestration

   SCRIPT LOAD ORDER (index.html):
     1. auth-gate.js          — Blocks render until JWT exists (redirects to login)
     2. config.js             — CONFIG global (api urls, cognito, feature flags)
     3. link-init.js          — SPA link routing
     4. event-bus.js          — Lightweight pub/sub for decoupled module communication
     5. action-dispatcher.js  — Global [data-action] click handler
     6. api-server.js         — ServerAPI (HTTP client, token refresh, response cache)
     7. utils.js              — Utils (formatting, DOM, toast, openPopup)
     8. theme.js              — ThemeManager (dark/light)
     9. tables.js             — TableManager (sorting, search, pagination)
    10. chat.js               — Chat (messages, tags, polling)
    11. api.js                — API (data loading, pipeline/PA rendering)
    12. sync-manager.js       — SyncManager (data sync orchestration)
    13. investors.js          — Investors (modals, CRUD, contact cards)
    14. funded-loans.js       — FundedLoans — depends on API._displayPrefs, ServerAPI
    15. goals.js              — GoalsManager — depends on API (pipeline/funded data)
    16. announcements.js      — Announcements carousel
    17. modals.js             — ModalsManager (support ticket, notifications, announcements)
    18. settings-goals.js     — Goal settings panel
    19. user-settings.js      — UserSettings
    20. collapsible.js        — CollapsibleSections (toggle sections with persistence)
    21. gauges.js             — DashboardGauges
    22. a11y.js               — Accessibility helpers
    23. progress-init.js      — Progress bar animation
    24. announcement-editor.js — Announcement editor modal
    25. app.js                — THIS FILE — orchestrates init of all modules above
   ============================================ */

const App = {
    // ========================================
    // INITIALIZATION
    // ========================================
    initMobileNav() {
        const hamburger = document.getElementById('navHamburger');
        const nav = document.getElementById('mainNav');
        if (!hamburger || !nav) return;

        const isMobile = () => window.matchMedia('(max-width: 1300px)').matches;

        hamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = nav.classList.toggle('open');
            hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        // Click nav-button on mobile expands/collapses its dropdown instead of navigating
        nav.querySelectorAll('.nav-item > .nav-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!isMobile()) return;
                const item = btn.parentElement;
                if (!item || !item.querySelector('.dropdown-menu')) return;
                e.preventDefault();
                e.stopPropagation();
                // Close siblings
                nav.querySelectorAll('.nav-item.expanded').forEach(other => {
                    if (other !== item) {
                        other.classList.remove('expanded');
                        const m = other.querySelector('.dropdown-menu');
                        if (m) m.setAttribute('hidden', '');
                        const b = other.querySelector('.nav-button');
                        if (b) b.setAttribute('aria-expanded', 'false');
                    }
                });
                const isExpanded = item.classList.toggle('expanded');
                const menu = item.querySelector('.dropdown-menu');
                if (menu) {
                    if (isExpanded) menu.removeAttribute('hidden');
                    else menu.setAttribute('hidden', '');
                }
                btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            });
        });

        // Close drawer when clicking a dropdown item (link/button)
        nav.addEventListener('click', (e) => {
            if (!isMobile()) return;
            const item = e.target.closest('.dropdown-item');
            if (item) {
                nav.classList.remove('open');
                hamburger.setAttribute('aria-expanded', 'false');
                nav.querySelectorAll('.nav-item.expanded').forEach(n => {
                    n.classList.remove('expanded');
                    const m = n.querySelector('.dropdown-menu');
                    if (m) m.setAttribute('hidden', '');
                    const b = n.querySelector('.nav-button');
                    if (b) b.setAttribute('aria-expanded', 'false');
                });
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!nav.classList.contains('open')) return;
            if (nav.contains(e.target) || hamburger.contains(e.target)) return;
            nav.classList.remove('open');
            hamburger.setAttribute('aria-expanded', 'false');
        });

        // Reset state when resizing back to desktop
        window.addEventListener('resize', () => {
            if (!isMobile()) {
                nav.classList.remove('open');
                hamburger.setAttribute('aria-expanded', 'false');
                nav.querySelectorAll('.nav-item.expanded').forEach(n => n.classList.remove('expanded'));
            }
        });
    },

    async init() {

        // Initialize modules — each wrapped in try/catch so one
        // failing module doesn't prevent the rest from loading
        const modules = [
            ['Theme',          () => ThemeManager.init()],
            ['Tables',         () => TableManager.init()],
            ['Chat',           () => Chat.init()],
            ['Investors',      () => Investors.init()],
            ['Funded Loans',   () => typeof FundedLoans !== 'undefined' && FundedLoans.init()],
            ['Gauges',         () => typeof DashboardGauges !== 'undefined' && DashboardGauges.init()],
            ['Modals',         () => ModalsManager.init()],
            ['User Settings',  () => typeof UserSettings !== 'undefined' && UserSettings.init()],
            ['Programs',       () => typeof Programs !== 'undefined' && Programs.init()],
            ['HRResources',    () => typeof HRResources !== 'undefined' && HRResources.init()],
            ['ContentStudio',  () => typeof ContentStudio !== 'undefined' && ContentStudio.init()],
            ['Monday',         () => typeof MondaySettings !== 'undefined' && MondaySettings.init()],
            ['Progress Bars',  () => setTimeout(() => {
                document.querySelectorAll('.progress-fill').forEach(bar => {
                    bar.style.transition = 'width 1s ease-out';
                });
            }, 500)],
            ['Collapsible',    () => typeof CollapsibleSections !== 'undefined' && CollapsibleSections.init()],
            ['MobileNav',      () => App.initMobileNav()],
        ];

        for (const [name, initFn] of modules) {
            try {
                initFn();
            } catch (err) {
                console.error('Failed to init ' + name + ':', err);
            }
        }

        // Load user info first — CONFIG.currentUser must be populated
        // before modules that depend on it (e.g. GoalsManager) initialize
        await this.loadCurrentUser();

        const isExternal = (CONFIG.currentUser.activeRole || '').toLowerCase() === 'external';

        // Skip data-heavy modules for External users (they only see news + calendar)
        if (!isExternal) {
            try {
                GoalsManager.init();
            } catch (err) {
                console.error('Failed to init Goals:', err);
            }
            this.loadData();
        }

        this.loadEmployeeDirectory();

        // Start auto-refresh (skip for External — nothing to refresh)
        if (!isExternal && typeof DataRefresher !== 'undefined') DataRefresher.start();
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
                CONFIG.currentUser.cognitoGroups = me.cognitoGroups || [];

                // Determine active role — saved preference > 'Admin' default > first group > DB role
                const groups = me.cognitoGroups || [];
                const saved = localStorage.getItem('active_role');
                let activeRole;
                if (saved && groups.includes(saved)) {
                    activeRole = saved;
                } else if (groups.includes('Admin')) {
                    activeRole = 'Admin';
                } else if (groups.length > 0) {
                    activeRole = groups[0];
                } else {
                    activeRole = me.role || 'user';
                }
                localStorage.setItem('active_role', activeRole);
                CONFIG.currentUser.activeRole = activeRole;

                // Update header UI
                const nameEl = document.getElementById('userName');
                const roleEl = document.getElementById('userRole');
                const avatarEl = document.getElementById('userAvatar');
                if (nameEl && me.name) nameEl.textContent = me.name;
                const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', lo: 'Loan Officer', processor: 'Processor', external: 'External', user: 'Loan Officer' };
                if (roleEl) roleEl.textContent = ROLE_LABELS[String(activeRole).toLowerCase()] || activeRole;
                if (avatarEl && me.initials) avatarEl.textContent = me.initials;

                // Build role switcher if user has multiple groups
                if (groups.length > 1) {
                    this.initRoleSwitcher(groups, activeRole);
                }

                // Apply role-based visibility
                this.applyRoleVisibility(activeRole.toLowerCase());

                // Board/group filters are shown dynamically when data loads
                // (see api.js _populatePreApprovalFilters and funded-loans.js _renderBoardFilter/_renderGroupFilter)
            }
        } catch (err) {
            console.warn('Could not load current user:', err);
        }
    },

    // ========================================
    // ROLE-BASED VISIBILITY
    // ========================================
    applyRoleVisibility(role) {
        // Admin: show admin-only elements
        if (role === 'admin') {
            document.querySelectorAll('.admin-only-item').forEach(el => {
                el.style.display = '';
            });
        }

        // External: hide everything except news/announcements and calendar
        if (role === 'external') {
            const hiddenSections = [
                'preApprovalsSection', 'pipelineSection', 'fundedLoansSection',
                'goalsSection', 'chatSection', 'investorsSection',
                'processingSection', 'contentSection',
            ];
            hiddenSections.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            // Also hide admin-only sidebar items
            document.querySelectorAll('.admin-only-item').forEach(el => {
                el.style.display = 'none';
            });
            // Hide sidebar links that External shouldn't access
            document.querySelectorAll('[data-section-link]').forEach(el => {
                const target = el.getAttribute('data-section-link');
                if (target && !['news', 'calendar'].includes(target)) {
                    el.style.display = 'none';
                }
            });
        }
    },

    // ========================================
    // ROLE SWITCHER
    // ========================================
    initRoleSwitcher(groups, activeRole) {
        const switcher = document.getElementById('roleSwitcher');
        const btn = document.getElementById('roleSwitcherBtn');
        const menu = document.getElementById('roleSwitcherMenu');
        if (!switcher || !btn || !menu) return;

        switcher.style.display = '';

        // Build menu items
        menu.innerHTML = groups.map(g => {
            const isActive = g === activeRole ? ' active' : '';
            return '<button type="button" class="role-switcher__item' + isActive + '" data-role="' + g + '">' + g + '</button>';
        }).join('');

        // Toggle menu
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
        });

        // Close on outside click
        document.addEventListener('click', () => menu.classList.remove('open'));

        // Role selection
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.role-switcher__item');
            if (!item) return;
            const newRole = item.dataset.role;
            if (newRole === activeRole) { menu.classList.remove('open'); return; }

            localStorage.setItem('active_role', newRole);
            // Reload to apply the new role everywhere
            window.location.reload();
        });
    },

    // ========================================
    // EMPLOYEE DIRECTORY (HR dropdown)
    // ========================================
    async loadEmployeeDirectory() {
        const container = document.getElementById('contactsEmployeeList');
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
        Utils.showToast(message, type);
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

    // User-facing toast for meaningful errors (skip noise like ResizeObserver)
    if (typeof message === 'string' && !message.includes('ResizeObserver') && !message.includes('Script error')) {
        Utils?.showToast?.('Something went wrong. Please refresh if issues persist.', 'error');
    }
    return false;
};

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);

    // Don't toast on AbortError (user navigated away / timeout) or auth redirects
    const msg = String(event.reason?.message || event.reason || '');
    if (msg.includes('AbortError') || msg.includes('Session expired') || msg.includes('signal')) return;

    if (msg.includes('fetch') || msg.includes('network') || msg.includes('NetworkError')) {
        Utils?.showToast?.('Network error. Please check your connection.', 'error');
    }
});

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
