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

    // =====================
    // HR / Docs (placeholders)
    // =====================
    'open-handbook': () => console.log('Open handbook'),
    'open-401k': () => console.log('Open 401k'),
    'open-training': () => console.log('Open training'),

    // =====================
    // Schedule
    // =====================
    'open-company-calendar': () => console.log('Open calendar'),
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