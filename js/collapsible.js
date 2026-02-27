/* ============================================
   MSFG Dashboard - Collapsible Sections
   Default-open, toggleable dashboard sections
   ============================================ */

const CollapsibleSections = {
  init() {
    document.querySelectorAll('.section-card[data-collapsible]').forEach(section => {
      const header = section.querySelector('.section-header');
      const body = section.querySelector('.section-body');
      const btn = section.querySelector('.section-collapse-btn');

      if (!header || !body) return;

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
  },

  collapse(section, body, btn) {
    // Set explicit max-height to current height so transition has a start value
    body.style.maxHeight = body.scrollHeight + 'px';
    // Force reflow
    body.offsetHeight; // eslint-disable-line no-unused-expressions
    // Animate to 0
    body.style.maxHeight = '0px';
    section.classList.add('collapsed');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  },

  expand(section, body, btn) {
    section.classList.remove('collapsed');
    // Measure the full height and animate to it
    body.style.maxHeight = body.scrollHeight + 'px';
    if (btn) btn.setAttribute('aria-expanded', 'true');

    // After transition, remove inline max-height so content can grow dynamically
    const onEnd = () => {
      body.style.maxHeight = '';
      body.removeEventListener('transitionend', onEnd);
    };
    body.addEventListener('transitionend', onEnd);
  }
};

window.CollapsibleSections = CollapsibleSections;
