// Checklist dialog helpers — pure, no module state.
//
// Extracted from js/checklists.js (which had grown past 2k lines and was
// concentrating most of the checklist-related bugs). These functions are
// the small modal dialogs the checklist UI pops over the page: text input,
// confirm, choose-one, the call-note textarea, and the inline date picker.
//
// Depends on:  Utils.escapeHtml  (defined in js/utils.js — must load first)
// Exposes:     window.ChecklistDialogs
//
// Behavior is intentionally identical to the previous in-line versions —
// the Checklists object now delegates to these wrappers so nothing else
// has to change.

(function () {
  const ChecklistDialogs = {

    /**
     * Roomy resizable textarea prompt. Returns trimmed string or null on cancel.
     */
    promptInput(title, placeholder, defaultValue) {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'cl-prompt-overlay';
        wrap.innerHTML = `
          <div class="cl-prompt cl-prompt-wide">
            <div class="cl-prompt-header"><strong>${Utils.escapeHtml(title)}</strong></div>
            <textarea class="cl-prompt-input cl-prompt-textarea" rows="5" placeholder="${Utils.escapeHtml(placeholder || '')}">${Utils.escapeHtml(defaultValue || '')}</textarea>
            <div class="cl-prompt-hint">Cmd/Ctrl + Enter to save · Esc to cancel</div>
            <div class="cl-prompt-actions">
              <button type="button" class="btn btn-sm btn-outline" data-cl-cancel>Cancel</button>
              <button type="button" class="btn btn-sm btn-primary" data-cl-save>OK</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const input = wrap.querySelector('textarea');
        input.focus();
        input.select();
        const cleanup = (val) => { wrap.remove(); resolve(val); };
        const submit = () => {
          const v = input.value.trim();
          cleanup(v || null);
        };
        wrap.querySelector('[data-cl-cancel]').addEventListener('click', () => cleanup(null));
        wrap.querySelector('[data-cl-save]').addEventListener('click', submit);
        wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(null); });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cleanup(null);
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        });
      });
    },

    /**
     * Confirm dialog with destructive-action styling. Resolves true/false.
     */
    promptConfirm(title, message) {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'cl-prompt-overlay';
        wrap.innerHTML = `
          <div class="cl-prompt">
            <div class="cl-prompt-header"><strong>${Utils.escapeHtml(title)}</strong></div>
            <div class="cl-prompt-message">${Utils.escapeHtml(message)}</div>
            <div class="cl-prompt-actions">
              <button type="button" class="btn btn-sm btn-outline" data-cl-cancel>Cancel</button>
              <button type="button" class="btn btn-sm btn-danger" data-cl-confirm>Delete</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const cleanup = (val) => { wrap.remove(); resolve(val); };
        wrap.querySelector('[data-cl-cancel]').addEventListener('click', () => cleanup(false));
        wrap.querySelector('[data-cl-confirm]').addEventListener('click', () => cleanup(true));
        wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(false); });
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cleanup(false);
        });
        wrap.querySelector('[data-cl-cancel]').focus();
      });
    },

    /**
     * Choose-one dialog. `options` is [{value, label, icon, desc?}].
     * Resolves the chosen value or null on cancel.
     */
    promptChoice(title, message, options) {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'cl-prompt-overlay';
        const optionsHtml = options.map(o => `
          <button type="button" class="cl-choice-btn" data-cl-choice="${o.value}">
            <i class="fas ${o.icon}"></i>
            <div><strong>${Utils.escapeHtml(o.label)}</strong>${o.desc ? `<small>${Utils.escapeHtml(o.desc)}</small>` : ''}</div>
          </button>`).join('');
        wrap.innerHTML = `
          <div class="cl-prompt">
            <div class="cl-prompt-header"><strong>${Utils.escapeHtml(title)}</strong></div>
            <div class="cl-prompt-message">${Utils.escapeHtml(message)}</div>
            <div class="cl-choice-options">${optionsHtml}</div>
            <div class="cl-prompt-actions">
              <button type="button" class="btn btn-sm btn-outline" data-cl-cancel>Cancel</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const cleanup = (val) => { wrap.remove(); resolve(val); };
        wrap.querySelectorAll('.cl-choice-btn').forEach(btn => {
          btn.addEventListener('click', () => cleanup(btn.dataset.clChoice));
        });
        wrap.querySelector('[data-cl-cancel]').addEventListener('click', () => cleanup(null));
        wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(null); });
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cleanup(null);
        });
      });
    },

    /**
     * Call-note textarea dialog with item context. Resolves trimmed body
     * string (may be ''). Cmd/Ctrl+Enter submits; Esc cancels.
     */
    promptNoteBody(item) {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'cl-note-prompt-overlay';
        wrap.innerHTML = `
          <div class="cl-note-prompt">
            <div class="cl-note-prompt-header">
              <strong><i class="fas fa-phone-alt"></i> Add Call Note</strong>
              <small>${Utils.escapeHtml(item.name || '')}</small>
            </div>
            <textarea class="cl-note-prompt-input" rows="4" placeholder="What happened on the call? (timestamp + author logged automatically)"></textarea>
            <div class="cl-note-prompt-actions">
              <button type="button" class="btn btn-sm btn-outline" data-cl-cancel>Cancel</button>
              <button type="button" class="btn btn-sm btn-primary" data-cl-save>Save Note</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const ta = wrap.querySelector('textarea');
        ta.focus();
        const cleanup = (val) => { wrap.remove(); resolve(val); };
        wrap.querySelector('[data-cl-cancel]').addEventListener('click', () => cleanup(''));
        wrap.querySelector('[data-cl-save]').addEventListener('click', () => cleanup(ta.value.trim()));
        wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(''); });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cleanup('');
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) cleanup(ta.value.trim());
        });
      });
    },

    /**
     * Inline date-picker popover anchored to an element. Calls cb(isoString)
     * on change/blur. Tries native showPicker() so the OS calendar pops up.
     */
    pickDate(anchorEl, currentISO, cb) {
      const input = document.createElement('input');
      input.type = 'date';
      input.value = currentISO || '';
      input.className = 'cl-date-popover';
      const rect = anchorEl.getBoundingClientRect();
      input.style.position = 'fixed';
      input.style.top = `${rect.bottom + 4}px`;
      input.style.left = `${rect.left}px`;
      input.style.zIndex = '11000';

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        input.removeEventListener('change', onChange);
        input.removeEventListener('blur', onBlur);
        input.remove();
        cb(value);
      };
      const onChange = () => finish(input.value || '');
      const onBlur = () => setTimeout(() => finish(input.value || currentISO || ''), 100);

      input.addEventListener('change', onChange);
      input.addEventListener('blur', onBlur);
      document.body.appendChild(input);
      input.focus();
      if (input.showPicker) {
        try { input.showPicker(); } catch (_) { /* unsupported — fall back to focus */ }
      }
    },
  };

  window.ChecklistDialogs = ChecklistDialogs;
})();
