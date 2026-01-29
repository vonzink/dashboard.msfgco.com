/* ============================================
   MSFG Dashboard - Theme Manager
   Dark/Light mode handling
   ============================================ */

// Ensure CONFIG is available
var CONFIG = window.CONFIG || window.MSFG_CONFIG;
if (!CONFIG) { throw new Error('CONFIG not loaded. js/config.js must load before theme.js'); }

const ThemeManager = {
    // ========================================
    // PROPERTIES
    // ========================================
    currentTheme: 'light',
    storageKey: CONFIG.storage.theme,

    // ========================================
    // INITIALIZATION
    // ========================================
    init() {
        // Load saved theme or detect system preference
        const savedTheme = Utils.getStorage(this.storageKey);
        
        if (savedTheme) {
            this.setTheme(savedTheme, false);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.setTheme('dark', false);
        }

        // Listen for system theme changes
        this.listenForSystemChanges();
        
        // Bind theme toggle button
        this.bindThemeToggle();
        
        console.log(`Theme initialized: ${this.currentTheme}`);
    },

    // ========================================
    // THEME METHODS
    // ========================================
    
    /**
     * Toggle between light and dark themes
     */
    toggle() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme, true);
    },

    /**
     * Set specific theme
     */
    setTheme(theme, save = true) {
        this.currentTheme = theme;
        
        // Update DOM
        if (theme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
        
        // Update icon
        this.updateIcon();
        
        // Save preference
        if (save) {
            Utils.setStorage(this.storageKey, theme);
        }

        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('themechange', { 
            detail: { theme: this.currentTheme } 
        }));
    },

    /**
     * Update the theme toggle icon
     */
    updateIcon() {
        const icon = document.querySelector('.theme-toggle i');
        if (!icon) return;
        
        icon.classList.remove('fa-moon', 'fa-sun');
        icon.classList.add(this.currentTheme === 'dark' ? 'fa-sun' : 'fa-moon');
    },

    /**
     * Get current theme
     */
    getTheme() {
        return this.currentTheme;
    },

    /**
     * Check if dark mode
     */
    isDark() {
        return this.currentTheme === 'dark';
    },

    // ========================================
    // SYSTEM PREFERENCE LISTENER
    // ========================================
    listenForSystemChanges() {
        if (!window.matchMedia) return;

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            // Only auto-switch if user hasn't set a preference
            const savedTheme = Utils.getStorage(this.storageKey);
            if (!savedTheme) {
                this.setTheme(e.matches ? 'dark' : 'light', false);
            }
        });
    },

    // ========================================
    // BIND THEME TOGGLE BUTTON
    // ========================================
    bindThemeToggle() {
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }
    }
};

// Global toggle function for onclick handlers
window.toggleTheme = () => ThemeManager.toggle();

// Export to global scope
window.ThemeManager = ThemeManager;
