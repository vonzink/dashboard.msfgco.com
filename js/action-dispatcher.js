/* ==========================================
   Global Action Dispatcher
   Handles all [data-action] clicks centrally
========================================== */
(() => {
  'use strict';

  const safeCall = (fn, name) => {
    if (typeof fn !== 'function') {
      console.warn(`Action handler not available: ${name}`);
      return;
    }
    fn();
  };

  // Simple toast notification for "Coming Soon" features
  const comingSoon = (feature) => {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#104547;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-family:Inter,sans-serif;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:0;transition:opacity .3s;';
    toast.textContent = feature + ' — Coming Soon';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  };

  const ACTIONS = {
    // =====================
    // Modals
    // =====================
    'open-support-ticket': () =>
      safeCall(window.ModalsManager?.showSupportTicketModal, 'open-support-ticket'),

    'open-notifications': () =>
      safeCall(window.ModalsManager?.showNotificationsModal, 'open-notifications'),

    'open-add-announcement': () =>
      safeCall(window.ModalsManager?.showAnnouncementModal, 'open-add-announcement'),

    'open-company-contacts': () =>
      window.Investors?.showCompanyContactsModal?.(),

    'open-investor': (el) => {
      const id = el?.dataset?.investor;
      if (id) window.Investors?.showModal?.(id);
    },

    'manage-investors': () => {
      window.Investors?.showManageModal?.();
    },

    // =====================
    // HR / Docs
    // =====================
    'open-handbook': () => comingSoon('Employee Handbook'),
    'open-401k': () => comingSoon('401(k) Portal'),
    'open-training': () => comingSoon('Training Center'),
    'open-lock-desk': () => comingSoon('Lock Desk'),

    // =====================
    // Schedule
    // =====================
    'open-company-calendar': () => {
      const w = Math.min(1280, screen.availWidth - 80);
      const h = Math.min(860, screen.availHeight - 80);
      const left = Math.round((screen.availWidth - w) / 2);
      const top  = Math.round((screen.availHeight - h) / 2);
      window.open(
        'Calculators/Company Calendar/calendar.html',
        'MSFGCalendar',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
      );
    },
    'open-timeoff-requests': () => comingSoon('Time-Off Requests'),

    // =====================
    // Marketing
    // =====================
    'open-brand-guidelines': () => comingSoon('Brand Guidelines'),

    // =====================
    // Footer
    // =====================
    'open-privacy': () => comingSoon('Privacy Policy'),
    'open-terms': () => comingSoon('Terms of Service'),
    'open-support': () =>
      safeCall(window.ModalsManager?.showSupportTicketModal, 'open-support'),

    // =====================
    // Tools
    // =====================
    'open-settings': () => comingSoon('User Settings'),

    'open-admin-settings': () => {
      const w = Math.min(1200, screen.availWidth - 80);
      const h = Math.min(860, screen.availHeight - 80);
      const left = Math.round((screen.availWidth - w) / 2);
      const top  = Math.round((screen.availHeight - h) / 2);
      window.open(
        'Calculators/Admin Settings/admin-settings.html',
        'MSFGAdminSettings',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
      );
    },

    'open-forms-library': () => {
      const w = Math.min(1100, screen.availWidth - 80);
      const h = Math.min(800, screen.availHeight - 80);
      const left = Math.round((screen.availWidth - w) / 2);
      const top  = Math.round((screen.availHeight - h) / 2);
      window.open(
        'Calculators/File Browser/file-browser.html?library=forms',
        'MSFGFormsLibrary',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
      );
    },

    'open-logos-browser': () => {
      const w = Math.min(1100, screen.availWidth - 80);
      const h = Math.min(800, screen.availHeight - 80);
      const left = Math.round((screen.availWidth - w) / 2);
      const top  = Math.round((screen.availHeight - h) / 2);
      window.open(
        'Calculators/File Browser/file-browser.html?library=logos',
        'MSFGLogosBrowser',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
      );
    },

    // =====================
    // Monday.com Integration
    // =====================
    'monday-settings': () => {
      const w = Math.min(1200, screen.availWidth - 80);
      const h = Math.min(860, screen.availHeight - 80);
      const left = Math.round((screen.availWidth - w) / 2);
      const top  = Math.round((screen.availHeight - h) / 2);
      window.open(
        'Calculators/Admin Settings/admin-settings.html#monday',
        'MSFGAdminSettings',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
      );
    },
    'monday-sync': () => {
      if (typeof MondaySettings !== 'undefined') MondaySettings.triggerSyncFromToolbar();
    },
  };

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const handler = ACTIONS[action];

    if (!handler) {
      console.warn(`No handler registered for action: ${action}`);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    handler(target);
  });
})();