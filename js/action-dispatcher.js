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
    // HR / Docs (placeholders)
    // =====================
    'open-handbook': () => console.log('Open handbook'),
    'open-401k': () => console.log('Open 401k'),
    'open-training': () => console.log('Open training'),

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
    'open-timeoff-requests': () => console.log('Open PTO'),

    // =====================
    // Marketing
    // =====================
    'open-brand-guidelines': () => console.log('Open brand guidelines'),

    // =====================
    // Footer
    // =====================
    'open-privacy': () => console.log('Open privacy policy'),
    'open-terms': () => console.log('Open terms'),
    'open-support': () =>
      safeCall(window.ModalsManager?.showSupportTicketModal, 'open-support'),

    // =====================
    // Tools
    // =====================
    'open-settings': () => console.log('Open settings'),

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
      if (typeof MondaySettings !== 'undefined') MondaySettings.show();
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