/* ============================================
   MSFG Dashboard - Collapsible Sections
   Toggleable dashboard sections with
   localStorage state persistence
   ============================================ */

const CollapsibleSections = {
  STORAGE_KEY: 'msfg_collapse_state',
  DEFAULT_COLLAPSED: ['goalsSection', 'preApprovalsSection', 'pipelineSection', 'fundedLoansSection'],

  init() {
    const savedState = this._loadState();
    const isFirstVisit = (savedState === null);

    const sections = document.querySelectorAll('.section-card[data-collapsible]');

    // Phase 1: Restore state WITHOUT transitions so nothing flashes on load
    sections.forEach(section => {
      const body = section.querySelector('.section-body');
      const btn = section.querySelector('.section-collapse-btn');
      const sectionId = section.id;

      if (!body) return;

      // Suppress transition during initial state restore
      body.style.transition = 'none';

      if (sectionId) {
        let shouldCollapse = false;

        if (isFirstVisit) {
          shouldCollapse = this.DEFAULT_COLLAPSED.includes(sectionId);
        } else {
          shouldCollapse = savedState[sectionId] === true;
        }

        if (shouldCollapse) {
          section.classList.add('collapsed');
          body.style.maxHeight = '0px';
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Phase 2: Re-enable transitions after a frame so the browser paints
    // the collapsed state first, then future toggles animate smoothly
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sections.forEach(section => {
          const body = section.querySelector('.section-body');
          if (body) body.style.transition = '';
        });
      });
    });

    // Phase 3: Bind event listeners
    sections.forEach(section => {
      const header = section.querySelector('.section-header');
      const btn = section.querySelector('.section-collapse-btn');

      if (!header) return;

      // Header click toggles (but not clicks on other interactive elements)
      header.addEventListener('click', (e) => {
        if (
          e.target.closest('.section-actions') &&
          !e.target.closest('.section-collapse-btn')
        ) {
          return;
        }
        this.toggle(section);
      });

      // Keyboard support on the toggle button
      if (btn) {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.toggle(section);
          }
        });
      }
    });

    if (isFirstVisit) {
      this._saveCurrentState();
    }
  },

  toggle(section) {
    const body = section.querySelector('.section-body');
    const btn = section.querySelector('.section-collapse-btn');
    if (!body) return;

    const isCollapsed = section.classList.contains('collapsed');

    if (isCollapsed) {
      this.expand(section, body, btn);
    } else {
      this.collapse(section, body, btn);
    }

    this._saveCurrentState();
  },

  collapse(section, body, btn) {
    body.style.maxHeight = body.scrollHeight + 'px';
    body.offsetHeight; // eslint-disable-line no-unused-expressions
    body.style.maxHeight = '0px';
    section.classList.add('collapsed');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  },

  expand(section, body, btn) {
    section.classList.remove('collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    if (btn) btn.setAttribute('aria-expanded', 'true');

    const onEnd = () => {
      body.style.maxHeight = '';
      body.removeEventListener('transitionend', onEnd);
    };
    body.addEventListener('transitionend', onEnd);
  },

  _loadState() {
    return Utils.getStorage(this.STORAGE_KEY, null);
  },

  _saveCurrentState() {
    const state = {};
    document.querySelectorAll('.section-card[data-collapsible]').forEach(section => {
      if (section.id) {
        state[section.id] = section.classList.contains('collapsed');
      }
    });
    Utils.setStorage(this.STORAGE_KEY, state);
  }
};

window.CollapsibleSections = CollapsibleSections;
