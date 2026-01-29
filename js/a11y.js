/* ==========================================
   Accessibility (Step 5)
   - Accessible nav dropdowns (ARIA + keyboard)
   - Modal ARIA + focus trap (auto via MutationObserver)
========================================== */
(() => {
  'use strict';

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const getFocusable = (root) =>
    Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

  // -------------------------
  // NAV DROPDOWNS
  // -------------------------
  const initNavDropdowns = () => {
    const nav = document.querySelector('.nav-container');
    if (!nav) return;

    nav.setAttribute('aria-label', 'Primary');

    const navItems = Array.from(nav.querySelectorAll('.nav-item'));

    navItems.forEach((item, idx) => {
      const button = item.querySelector('.nav-button');
      const menu = item.querySelector('.dropdown-menu');
      if (!button || !menu) return;

      // Ensure button is not treated like a submit button
      button.setAttribute('type', 'button');

      // Assign an id to menu if it doesn't have one
      if (!menu.id) menu.id = `navMenu-${idx + 1}`;

      // ARIA for button/menu relationship
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', menu.id);
      button.setAttribute('aria-expanded', 'false');

      // Menu semantics
      menu.setAttribute('role', 'menu');
      menu.setAttribute('hidden', '');

      // Menu label (use visible button text)
      const label = button.textContent.replace(/\s+/g, ' ').trim();
      menu.setAttribute('aria-label', label);

      // Make menu items keyboard-friendly
      const menuItems = Array.from(menu.querySelectorAll('a.dropdown-item, button.dropdown-item'));
      menuItems.forEach(mi => {
        mi.setAttribute('role', 'menuitem');
        mi.setAttribute('tabindex', '-1');
        if (mi.tagName === 'BUTTON') mi.setAttribute('type', 'button');
      });
    });

    const closeAll = (exceptItem = null) => {
      navItems.forEach((item) => {
        if (exceptItem && item === exceptItem) return;
        const button = item.querySelector('.nav-button');
        const menu = item.querySelector('.dropdown-menu');
        if (!button || !menu) return;

        button.setAttribute('aria-expanded', 'false');
        menu.setAttribute('hidden', '');
        item.classList.remove('is-open');
      });
    };

    const openMenu = (item) => {
      const button = item.querySelector('.nav-button');
      const menu = item.querySelector('.dropdown-menu');
      if (!button || !menu) return;

      closeAll(item);

      item.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      menu.removeAttribute('hidden');

      // Focus first menu item
      const first = menu.querySelector('a.dropdown-item, button.dropdown-item');
      if (first) first.focus();
    };

    const toggleMenu = (item) => {
      const button = item.querySelector('.nav-button');
      const menu = item.querySelector('.dropdown-menu');
      if (!button || !menu) return;

      const isOpen = button.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeAll();
      else openMenu(item);
    };

    // Click handler (open/close)
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-button');
      if (!btn) return;

      const item = btn.closest('.nav-item');
      if (!item) return;

      e.preventDefault();
      e.stopPropagation();
      toggleMenu(item);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-container')) closeAll();
    });

    // Keyboard support
    nav.addEventListener('keydown', (e) => {
      const btn = e.target.closest('.nav-button');
      const menuItem = e.target.closest('.dropdown-item');
      const item = e.target.closest('.nav-item');

      // If focus is on the nav button
      if (btn && item) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleMenu(item);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          openMenu(item);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeAll();
          btn.focus();
          return;
        }
      }

      // If focus is inside an open menu
      if (menuItem && item) {
        const menu = item.querySelector('.dropdown-menu');
        if (!menu) return;

        const items = Array.from(menu.querySelectorAll('a.dropdown-item, button.dropdown-item'));
        const currentIndex = items.indexOf(menuItem);

        if (e.key === 'Escape') {
          e.preventDefault();
          closeAll();
          const b = item.querySelector('.nav-button');
          if (b) b.focus();
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = items[(currentIndex + 1) % items.length];
          if (next) next.focus();
          return;
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = items[(currentIndex - 1 + items.length) % items.length];
          if (prev) prev.focus();
          return;
        }

        // If they tab out, close menus to avoid “stuck open”
        if (e.key === 'Tab') {
          closeAll();
        }
      }
    });
  };

  // -------------------------
  // MODAL ARIA + FOCUS TRAP
  // -------------------------
  const modalState = new Map(); // modalEl -> { lastFocus, trapHandler }

  const applyModalA11yBase = (modal) => {
    // Base ARIA
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');

    // Ensure title has an id and connect it
    const title = modal.querySelector('.modal-header .investor-name');
    if (title) {
      if (!title.id) title.id = `${modal.id || 'modal'}-title`;
      modal.setAttribute('aria-labelledby', title.id);
    }
  };

  const trapFocus = (modal, e) => {
    if (e.key !== 'Tab') return;

    const focusables = getFocusable(modal);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Shift+Tab from first -> last
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return;
    }

    // Tab from last -> first
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onModalOpen = (modal) => {
    applyModalA11yBase(modal);

    // Record last focused element
    const lastFocus = document.activeElement;

    modal.removeAttribute('aria-hidden');

    // Focus first focusable element inside modal content (close button first is fine)
    const focusables = getFocusable(modal);
    if (focusables[0]) focusables[0].focus();

    // Install focus trap
    const handler = (e) => trapFocus(modal, e);
    document.addEventListener('keydown', handler);

    modalState.set(modal, { lastFocus, trapHandler: handler });
  };

  const onModalClose = (modal) => {
    modal.setAttribute('aria-hidden', 'true');

    const state = modalState.get(modal);
    if (state?.trapHandler) document.removeEventListener('keydown', state.trapHandler);

    // Restore focus to the element that opened the modal
    if (state?.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus();
    }

    modalState.delete(modal);
  };

  const observeModals = () => {
    const modals = Array.from(document.querySelectorAll('.investor-modal'));
    if (!modals.length) return;

    modals.forEach(applyModalA11yBase);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type !== 'attributes' || m.attributeName !== 'class') return;
        const modal = m.target;

        const isActive = modal.classList.contains('active');
        const wasTracked = modalState.has(modal);

        if (isActive && !wasTracked) onModalOpen(modal);
        if (!isActive && wasTracked) onModalClose(modal);
      });
    });

    modals.forEach((modal) => observer.observe(modal, { attributes: true }));
  };

  // -------------------------
  // Boot
  // -------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initNavDropdowns();
    observeModals();
  });
})();