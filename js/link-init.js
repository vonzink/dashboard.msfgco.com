/* ==========================================
   Link Initializer
   - Applies config links to <a data-link-key="...">
   - Disables items when no link is configured
========================================== */
(() => {
  'use strict';

 const links = (window.MSFG_CONFIG && window.MSFG_CONFIG.links) || {};

  const anchors = document.querySelectorAll('a[data-link-key]');

  anchors.forEach((a) => {
    const key = a.getAttribute('data-link-key');
    const url = links[key];

    if (typeof url === 'string' && url.trim()) {
      a.setAttribute('href', url);

      // If external, ensure safe new-tab behavior
      if (/^https?:\/\//i.test(url)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }

    // No URL configured: disable cleanly
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.classList.add('is-disabled');
  });
})();