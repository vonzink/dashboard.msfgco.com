/* ============================================
   MSFG Dashboard - Utilities
   Helper functions and common utilities
   ============================================ */

const Utils = {
    // ========================================
    // STRING UTILITIES
    // ========================================
    
    /**
     * Convert a string to Title Case (e.g. "client_name" → "Client Name")
     */
    toTitleCase(str) {
        if (!str) return '';
        return str
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Get initials from a name
     */
    getInitials(name) {
        if (!name) return '??';
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    },

    /**
     * Truncate text with ellipsis
     */
    truncate(text, maxLength = 50) {
        if (!text || text.length <= maxLength) return text;
        return text.slice(0, maxLength - 3) + '...';
    },

    /**
     * Capitalize first letter
     */
    capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    },

    // ========================================
    // DATE UTILITIES
    // ========================================
    
    /**
     * Format date with options
     */
    formatDate(dateStr, format = 'medium') {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const options = CONFIG.dateFormat[format] || CONFIG.dateFormat.medium;
        return date.toLocaleDateString('en-US', options);
    },

    /**
     * Format time
     */
    formatTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('en-US', CONFIG.dateFormat.time);
    },

    /**
     * Get relative time (e.g., "2 hours ago")
     */
    getRelativeTime(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        
        return this.formatDate(dateStr, 'short');
    },

    /**
     * Check if date is expired
     */
    isExpired(dateStr) {
        return new Date(dateStr) < new Date();
    },

    /**
     * Check if date is within X days
     */
    isWithinDays(dateStr, days) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = date - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= days;
    },

    // ========================================
    // NUMBER UTILITIES
    // ========================================
    
    /**
     * Format currency
     */
    formatCurrency(amount) {
        if (amount == null) return '';
        return new Intl.NumberFormat(CONFIG.currency.locale, {
            style: 'currency',
            currency: CONFIG.currency.currency,
            minimumFractionDigits: CONFIG.currency.minimumFractionDigits,
            maximumFractionDigits: CONFIG.currency.maximumFractionDigits
        }).format(amount);
    },

    /**
     * Format number with commas
     */
    formatNumber(num) {
        if (num == null) return '';
        return new Intl.NumberFormat('en-US').format(num);
    },

    /**
     * Format percentage
     */
    formatPercent(value, decimals = 0) {
        if (value == null) return '';
        return `${value.toFixed(decimals)}%`;
    },

    /**
     * Parse currency string to number
     */
    parseCurrency(str) {
        if (!str) return 0;
        return parseFloat(str.replace(/[$,]/g, '')) || 0;
    },

    // ========================================
    // DOM UTILITIES
    // ========================================
    
    /**
     * Query selector shorthand
     */
    $(selector, parent = document) {
        return parent.querySelector(selector);
    },

    /**
     * Query selector all shorthand
     */
    $$(selector, parent = document) {
        return Array.from(parent.querySelectorAll(selector));
    },

    /**
     * Create element with attributes
     */
    createElement(tag, attributes = {}, children = []) {
        const el = document.createElement(tag);
        
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                el.className = value;
            } else if (key === 'dataset') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    el.dataset[dataKey] = dataValue;
                });
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else {
                el.setAttribute(key, value);
            }
        });

        children.forEach(child => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        });

        return el;
    },

    // ========================================
    // ASYNC UTILITIES
    // ========================================
    
    /**
     * Debounce function
     */
    debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Throttle function
     */
    throttle(func, limit = 300) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * Sleep/delay helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // ========================================
    // STORAGE UTILITIES
    // ========================================
    
    /**
     * Get from localStorage
     */
    getStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    /**
     * Set to localStorage
     */
    setStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Remove from localStorage
     */
    removeStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch {
            return false;
        }
    },

    // ========================================
    // VALIDATION UTILITIES
    // ========================================
    
    /**
     * Check if value is empty
     */
    isEmpty(value) {
        if (value == null) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    },

    /**
     * Check if valid email
     */
    isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    // ========================================
    // WINDOW UTILITIES
    // ========================================

    /**
     * Open a centered popup window (DRY helper for window.open sizing)
     * @param {string} url    - URL to open
     * @param {string} name   - Window name (reuse if already open)
     * @param {number} maxW   - Maximum width  (default 1200)
     * @param {number} maxH   - Maximum height (default 860)
     */
    openPopup(url, name = '_blank', maxW = 1200, maxH = 860) {
        const w = Math.min(maxW, screen.availWidth - 80);
        const h = Math.min(maxH, screen.availHeight - 80);
        const left = Math.round((screen.availWidth - w) / 2);
        const top  = Math.round((screen.availHeight - h) / 2);
        return window.open(
            url, name,
            'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
        );
    },

    // ========================================
    // NOTIFICATION UTILITIES
    // ========================================

    /**
     * Show a brief toast notification
     */
    showToast(message, type = 'info') {
        const colors = { info: '#104547', error: '#c0392b', success: '#27ae60' };
        const bg = colors[type] || colors.info;
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:' + bg + ';color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-family:Inter,sans-serif;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:0;transition:opacity .3s;max-width:400px;';
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

// Export to global scope
window.Utils = Utils;
