/* ============================================
   MSFG Dashboard - Configuration
   Application settings and constants
============================================ */

(() => {
  'use strict';

  const CONFIG = {
    // ========================================
    // API SETTINGS
    // ========================================
    api: {
      // Prefer same-origin API proxy path if you have one (best for CSP & cookies)
      // baseUrl: '/api',

      // Otherwise use your domain for prod, and IP only for dev fallback
      baseUrl: window.location.protocol === 'https:'
        ? 'https://api.msfgco.com/api'
        : 'http://54.175.238.145:8080/api',

      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
    },

    // ========================================
    // REFRESH INTERVALS (milliseconds)
    // ========================================
    refresh: {
      news: 300000,
      tasks: 60000,
      preApprovals: 300000,
      pipeline: 300000,
      goals: 600000,
      chat: 30000
    },

    // ========================================
    // DATE/TIME FORMATTING
    // ========================================
    dateFormat: {
      short: { month: 'short', day: 'numeric' },
      medium: { month: 'short', day: 'numeric', year: 'numeric' },
      long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      time: { hour: 'numeric', minute: '2-digit' },
      datetime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    },

    // ========================================
    // CURRENCY FORMATTING
    // ========================================
    currency: {
      locale: 'en-US',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    },

    // ========================================
    // PAGINATION
    // ========================================
    pagination: {
      defaultPageSize: 10,
      pageSizeOptions: [10, 25, 50, 100]
    },

    // ========================================
    // CHAT SETTINGS
    // ========================================
    chat: {
      maxMessages: 100,
      maxMessageLength: 1000,
      typingTimeout: 3000
    },

    // ========================================
    // CURRENT USER (loaded from session)
    // ========================================
    currentUser: {
      id: null,
      initials: 'ZB',
      name: 'Zachary',
      role: 'Loan Officer',
      email: null
    },

    // ========================================
    // FEATURE FLAGS
    // ========================================
    features: {
      darkMode: true,
      chat: true,
      notifications: true,
      autoRefresh: true,
      exportData: true
    },

    // ========================================
    // STORAGE KEYS
    // ========================================
    storage: {
      theme: 'msfg_theme',
      filters: 'msfg_filters',
      preferences: 'msfg_preferences'
    },

    // ========================================
    // LINK MAP (used by link-init.js)
    // ========================================
    links: {
      payroll_new: "https://identity.myisolved.com/Account/Login?ReturnUrl=%2Fconnect%2Fauthorize%2Fcallback%3Fclient_id%3Daee%26redirect_uri%3Dhttps%253A%252F%252Faee.myisolved.com%26response_type%3Dcode%26scope%3Dopenid%2520core-api%2520multi-tenant%2520workspaces-api%2520notifications-api%2520adaptive-perform-api%2520entitlements-api.read%26nonce%3D22120140bfda48094c9c275b5c1bb8eb59ewpdNMH%26state%3De31acde63632bf3dc13601467c8350c5e1CDIgmLi%26code_challenge%3D2uMpUx7PO0lW6U8jcjjdbh82NRFaXbQACrzvJ1xSz2E%26code_challenge_method%3DS256",

      gohighlevel: "https://app.gohighlevel.com",
      lendingpad: "https://prod.lendingpad.com/web/#/dashboard",
      monday: "https://msfg-squad.monday.com/",

      mmi: "https://new.mmi.run/login",
      listreports: "https://listreports.com/login?redirect=https%253A%252F%252Flistreports.com%252Fagent-intel%253Ftab%253Dlistside",
      passport: "https://v3.titlepro247.com/Home?ReturnUrl=%2FAccount%2FIndex",
      flueid: "https://pro.flueid.com/auth/sign-in",

      advantage_credit: "https://credit.advcredit.com/custom/login.aspx",
      dropbox: "https://dropbox.com",
      microsoft: "https://microsoft.com",
      teams: "https://teams.microsoft.com",

      logos_s3: "https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/",
      facebook: "https://www.facebook.com/MSFGhomeloans",
      instagram: "https://www.instagram.com/msfg.us/",

      keyword_explorer: "https://keywords.msfgco.com",

      ratesheet: "https://loansifternow.optimalblue.com"
    }
  };

  // Freeze everything (deep enough for this structure)
  Object.freeze(CONFIG.api);
  Object.freeze(CONFIG.refresh);
  Object.freeze(CONFIG.dateFormat);
  Object.freeze(CONFIG.currency);
  Object.freeze(CONFIG.pagination);
  Object.freeze(CONFIG.chat);
  // NOTE: currentUser is NOT frozen — it is populated at runtime from /api/me
  // Object.freeze(CONFIG.currentUser);
  Object.freeze(CONFIG.features);
  Object.freeze(CONFIG.storage);
  Object.freeze(CONFIG.links);
  Object.freeze(CONFIG);

  // Single global export
  window.CONFIG = CONFIG;
  window.MSFG_CONFIG = CONFIG;
})();


// Ensure CONFIG is available as a global identifier (for scripts that reference `CONFIG` directly)
var CONFIG = window.CONFIG || window.MSFG_CONFIG;
