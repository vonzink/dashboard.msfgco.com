/* Navigation is convenience only; the CMS service enforces every capability. */
(async function () {
  'use strict';
  const link = document.getElementById('website-cms-link');
  if (!link || !window.ServerAPI?.request) return;
  link.hidden = true;
  try {
    const access = await window.ServerAPI.request('/website-cms/entities', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!access || !Array.isArray(access.entities)) return;
    link.hidden = false;
  } catch { /* Missing mount, denied access and outages keep navigation hidden. */ }
})();
