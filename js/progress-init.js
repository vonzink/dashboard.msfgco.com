/* ==========================================
   Progress Width Initializer (CSP-friendly)
========================================== */
(function () {
  function applyProgressWidths(root) {
    const nodes = root.querySelectorAll('[data-progress]');
    nodes.forEach((el) => {
      const raw = el.getAttribute('data-progress');
      const num = Number(raw);
      if (!Number.isFinite(num)) return;

      const clamped = Math.max(0, Math.min(100, num));
      el.style.width = `${clamped}%`;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyProgressWidths(document));
  } else {
    applyProgressWidths(document);
  }
})();