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
        
        // Initialize modules in order
        this.initTheme();
        this.initTables();
        this.initChat();
        this.initInvestors();
        this.initGoals();
        this.initModals();
        this.initProgressBars();
        
        // Load data from API
        this.loadData();
        
        // Start auto-refresh
        DataRefresher.start();
        
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
    },

    initGoals() {
        GoalsManager.init();
    },

    initModals() {
        ModalsManager.init();
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
