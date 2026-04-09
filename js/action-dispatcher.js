/* ==========================================
   Global Action Dispatcher
   Handles all [data-action] clicks centrally
========================================== */
(() => {
  'use strict';

  const comingSoon = (feature) => Utils.showToast(feature + ' — Coming Soon');

  const ACTIONS = {
    // =====================
    // Modals
    // =====================
    'open-support-ticket': () =>
      window.ModalsManager?.showSupportTicketModal(),

    'open-notifications': () =>
      window.ModalsManager?.showNotificationsModal(),

    'open-add-announcement': () =>
      window.Announcements?.showAnnouncementModal(),

    'open-company-contacts': () =>
      window.Investors?.showCompanyContactsModal?.(),

    'open-investor': (el) => {
      const id = el?.dataset?.investor;
      if (id) window.Investors?.showModal?.(id);
    },

    'show-all-investors': () =>
      window.Investors?.showAllInvestors?.(),

    'manage-investors': () =>
      Utils.openPopup('Calculators/Admin Settings/admin-settings.html#investors', 'MSFGAdminSettings'),

    // =====================
    // HR / Docs
    // =====================
    'open-handbook': () => { window.location.href = '/handbook.html'; },
    'open-401k': () => comingSoon('401(k) Portal'),
    'open-training': () => comingSoon('Training Center'),

    'open-employee-card': (el) => {
      const empId = el?.dataset?.employeeId;
      if (!empId) return;
      window.Investors?.showContactCard?.(empId);
    },
    // =====================
    // LendingPad
    // =====================
    'open-lendingpad': () =>
      Utils.openPopup('Calculators/LendingPad/lendingpad.html', 'MSFGLendingPad', 1280, 860),

    // =====================
    // Schedule
    // =====================
    'open-company-calendar': () =>
      Utils.openPopup('Calculators/Company Calendar/calendar.html', 'MSFGCalendar', 1280, 860),

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
      window.ModalsManager?.showSupportTicketModal(),

    // =====================
    // Tools
    // =====================
    'open-settings': () => {
      if (typeof UserSettings !== 'undefined') {
        UserSettings.open();
      } else {
        comingSoon('User Settings');
      }
    },

    'open-admin-settings': () =>
      Utils.openPopup('Calculators/Admin Settings/admin-settings.html', 'MSFGAdminSettings'),

    'open-forms-library': () =>
      Utils.openPopup('Calculators/File Browser/file-browser.html?library=forms', 'MSFGFormsLibrary', 1100, 800),

    'open-logos-browser': () =>
      Utils.openPopup('Calculators/File Browser/file-browser.html?library=logos', 'MSFGLogosBrowser', 1100, 800),

    'open-content-studio': () => {
      if (typeof ContentStudio !== 'undefined') ContentStudio.open();
    },

    // =====================
    // Monday.com Integration
    // =====================
    'monday-settings': () =>
      Utils.openPopup('Calculators/Admin Settings/admin-settings.html#monday', 'MSFGAdminSettings'),

    'monday-sync': (el) => {
      if (typeof MondaySettings !== 'undefined') {
        MondaySettings.triggerSyncFromToolbar(el);
      }
    },

    // =====================
    // Processing
    // =====================
    'open-processing': (el) => {
      const type = el?.dataset?.type || 'title';
      Utils.openPopup('processing.html?type=' + encodeURIComponent(type), 'MSFGProcessing', 1280, 860);
    },

    // =====================
    // Programs
    // =====================
    'open-program': (el) => {
      const category = el?.dataset?.category;
      if (category && window.Programs) Programs.open(category);
    },

    // =====================
    // HR Resources
    // =====================
    'open-hr-resource': (el) => {
      const category = el?.dataset?.category;
      if (category && window.HRResources) HRResources.open(category);
    },

    // =====================
    // Guidelines
    // =====================
    'open-guidelines': () => {
      window.location.href = '/guidelines';
    },

    // =====================
    // Property Tax Calculator
    // =====================
    'open-mil-levy': () => {
      window.location.href = '/mil-levy.html';
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
