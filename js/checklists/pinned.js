// Checklist pinned action panel — extracted from js/checklists.js
// (audit §2.3). Mixin pattern: Object.assign-ed onto Checklists so the
// previous `this.*` semantics are unchanged.
//
// The pinned panel is a single floating/docked menu that operates on
// whichever checklist row the user has clicked. It replaces the per-item
// 3-dot dropdown (removed in step 5 of the audit plan).
//
// Depends on (sibling Checklists state, set up at load):
//   this._pinnedOpen, this._pinnedMode, this._pinnedPos,
//   this._selectedItemId, this._currentChecklist, this.STATUS_OPTIONS
//   this._handleAction(), this._renderChecklist()
//
// Exposes: window.ChecklistPinned

(function () {
  const ChecklistPinned = {

    _initPinnedPanel() {
      const modal = document.getElementById('checklistModal');
      if (!modal) return;
      if (document.getElementById('clPinnedPanel')) return; // idempotent

      const modalBox = modal.querySelector('.cl-modal');
      const content = document.getElementById('clContent');
      if (!modalBox || !content) return;

      const panel = document.createElement('div');
      panel.id = 'clPinnedPanel';
      panel.className = 'cl-pinned-panel';
      panel.innerHTML = `
        <div class="cl-pinned-header">
          <i class="fas fa-grip-horizontal cl-pinned-grip"></i>
          <span class="cl-pinned-title">Menu</span>
          <button type="button" class="cl-pinned-mode" data-cl-action="toggle-pinned-mode" title="Detach (float) / Dock to top"><i class="fas fa-thumbtack"></i></button>
          <button type="button" class="cl-pinned-close" data-cl-action="toggle-pinned" title="Hide menu"><i class="fas fa-times"></i></button>
        </div>
        <div class="cl-pinned-body"></div>
      `;
      modalBox.insertBefore(panel, content);

      this._applyPinnedMode(panel);
      panel.style.display = this._pinnedOpen ? 'block' : 'none';

      this._bindPinnedDrag(panel);

      // Action dispatch — bind directly on the panel so it works in BOTH
      // dock mode (panel inside modal) and float mode (panel reparented to
      // document.body, outside the modal's click delegation).
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cl-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.clAction;
        const id = btn.dataset.clId;
        this._handleAction(action, id, btn);
      });

      // Row-click selection — bound ONCE on the persistent #clContent.
      content.addEventListener('click', (e) => {
        if (!this._pinnedOpen) return;
        if (e.target.closest('button, input, .cl-menu-dropdown, .cl-subitem, .cl-note, .cl-subitem-indent')) return;
        const row = e.target.closest('.cl-item');
        if (!row) return;
        const itemId = parseInt(row.dataset.itemId);
        if (!itemId) return;
        this._selectItem(itemId);
      });

      if (this._pinnedOpen) this._renderPinnedPanel();
    },

    _bindPinnedDrag(panel) {
      const header = panel.querySelector('.cl-pinned-header');
      if (!header) return;
      let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

      const onDown = (e) => {
        // Drag only works in float mode; ignore button clicks.
        if (this._pinnedMode !== 'float') return;
        if (e.target.closest('.cl-pinned-close, .cl-pinned-mode')) return;
        dragging = true;
        const pt = e.touches ? e.touches[0] : e;
        startX = pt.clientX; startY = pt.clientY;
        const rect = panel.getBoundingClientRect();
        origLeft = rect.left; origTop = rect.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        const pt = e.touches ? e.touches[0] : e;
        const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, origLeft + (pt.clientX - startX)));
        const top  = Math.max(0, Math.min(window.innerHeight - 40, origTop + (pt.clientY - startY)));
        panel.style.left = left + 'px';
        panel.style.top  = top + 'px';
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        this._pinnedPos = { left: parseInt(panel.style.left) || 0, top: parseInt(panel.style.top) || 0 };
        this._persistPinned();
      };

      header.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      header.addEventListener('touchstart', onDown, { passive: false });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    },

    _applyPinnedMode(panel) {
      panel = panel || document.getElementById('clPinnedPanel');
      if (!panel) return;
      const modalBox = document.querySelector('#checklistModal .cl-modal');
      const content = document.getElementById('clContent');

      if (this._pinnedMode === 'float') {
        panel.classList.add('cl-pinned-float');
        panel.classList.remove('cl-pinned-dock');
        // The modal box uses CSS transform for drag, which traps position:fixed
        // descendants in the modal's coordinate space. Reparent to body so float
        // mode actually escapes to the viewport.
        if (panel.parentElement !== document.body) document.body.appendChild(panel);
        // Restore (or default) floating position — clamp to viewport so a stale
        // saved position can never park the panel off-screen.
        let { left, top } = this._pinnedPos || {};
        if (typeof left !== 'number' || typeof top !== 'number') {
          left = Math.max(20, window.innerWidth - 420);
          top = 140;
        }
        left = Math.max(0, Math.min(window.innerWidth - 200, left));
        top = Math.max(0, Math.min(window.innerHeight - 80, top));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      } else {
        panel.classList.add('cl-pinned-dock');
        panel.classList.remove('cl-pinned-float');
        if (modalBox && content && panel.parentElement !== modalBox) {
          modalBox.insertBefore(panel, content);
        }
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '';
        panel.style.bottom = '';
      }
      const modeBtn = panel.querySelector('.cl-pinned-mode i');
      const modeBtnWrap = panel.querySelector('.cl-pinned-mode');
      if (modeBtn) modeBtn.className = this._pinnedMode === 'float' ? 'fas fa-window-maximize' : 'fas fa-thumbtack';
      if (modeBtnWrap) modeBtnWrap.title = this._pinnedMode === 'float' ? 'Dock to top' : 'Detach (drag anywhere)';
    },

    _togglePinnedMode() {
      this._pinnedMode = this._pinnedMode === 'float' ? 'dock' : 'float';
      this._applyPinnedMode();
      this._persistPinned();
    },

    // Fully tear down the Menu when the checklist modal closes. In float mode
    // the panel is reparented to <body>, so hiding the modal does NOT hide it —
    // it must be explicitly hidden AND re-docked back into the modal, or it
    // lingers on screen after the checklist is closed (Bug 2). The user's
    // mode/position preference is preserved and re-applied next time it opens.
    _teardownPinnedPanel() {
      const panel = document.getElementById('clPinnedPanel');
      if (panel) {
        panel.style.display = 'none';
        const modalBox = document.querySelector('#checklistModal .cl-modal');
        const content = document.getElementById('clContent');
        if (modalBox && content && panel.parentElement !== modalBox) {
          // Re-dock the DOM node back inside the modal. _pinnedMode (the saved
          // preference) is intentionally left untouched.
          panel.classList.remove('cl-pinned-float');
          panel.classList.add('cl-pinned-dock');
          panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
          modalBox.insertBefore(panel, content);
        }
      }
      this._selectedItemId = null;
      this._applySelectionHighlight();
    },

    _persistPinned() {
      try {
        localStorage.setItem('clPinned', JSON.stringify({
          open: this._pinnedOpen,
          mode: this._pinnedMode,
          pos: this._pinnedPos,
        }));
      } catch (_) { /* localStorage may be unavailable in private mode */ }
    },

    _togglePinnedPanel() {
      this._pinnedOpen = !this._pinnedOpen;
      const panel = document.getElementById('clPinnedPanel');
      if (panel) panel.style.display = this._pinnedOpen ? 'block' : 'none';
      this._persistPinned();
      if (this._pinnedOpen) this._renderPinnedPanel();
      else {
        this._selectedItemId = null;
        this._applySelectionHighlight();
      }
      // Refresh the Pin button label in the toolbar
      if (this._currentChecklist) this._renderChecklist();
    },

    _selectItem(itemId) {
      this._selectedItemId = itemId;
      this._applySelectionHighlight();
      this._renderPinnedPanel();
    },

    _applySelectionHighlight() {
      const container = document.getElementById('clContent');
      if (!container) return;
      container.querySelectorAll('.cl-item.cl-item-selected').forEach(el => el.classList.remove('cl-item-selected'));
      if (this._selectedItemId) {
        const el = container.querySelector(`.cl-item[data-item-id="${this._selectedItemId}"]`);
        if (el) el.classList.add('cl-item-selected');
      }
    },

    _renderPinnedPanel() {
      const panel = document.getElementById('clPinnedPanel');
      if (!panel) return;
      const body = panel.querySelector('.cl-pinned-body');
      const title = panel.querySelector('.cl-pinned-title');
      if (!body || !title) return;

      const item = this._selectedItemId
        ? (this._currentChecklist?.items || []).find(i => i.id === this._selectedItemId)
        : null;

      if (!item) {
        title.textContent = 'Quick Actions';
        body.innerHTML = `<div class="cl-pinned-empty"><i class="fas fa-mouse-pointer"></i> Click a checklist item to act on it.</div>`;
        return;
      }

      title.textContent = item.name.length > 40 ? item.name.slice(0, 40) + '…' : item.name;
      title.title = item.name;
      body.innerHTML = this._itemActionsHtml(item);
    },

    // Shared two-column action grid — rendered into the pinned panel.
    _itemActionsHtml(item) {
      const importance = item.importance || 'normal';
      const assignedTo = item.assigned_to || '';
      const statusBtns = this.STATUS_OPTIONS.map(s =>
        `<button type="button" data-cl-action="set-status" data-cl-item-id="${item.id}" data-cl-status="${s.value}"${s.value === item.status ? ' class="cl-menu-active"' : ''}><i class="fas ${s.icon} ${s.cls}"></i> ${s.label}</button>`
      ).join('');
      const category = item.category || '';
      const gate = item.gate || '';
      const catBtns = this.CATEGORY_OPTIONS.map(c =>
        `<button type="button" class="cl-tag-pill cl-cat-${c.value}${category === c.value ? ' cl-tag-active' : ''}" data-cl-action="set-category" data-cl-id="${item.id}" data-cl-category="${c.value}">${c.label}</button>`
      ).join('');
      const gateBtns = this.GATE_OPTIONS.map(g =>
        `<button type="button" class="cl-tag-pill cl-gate-${g.value}${gate === g.value ? ' cl-tag-active' : ''}" data-cl-action="set-gate" data-cl-id="${item.id}" data-cl-gate="${g.value}">${g.label}</button>`
      ).join('');
      return `
        <div class="cl-menu-cols">
          <div class="cl-menu-col">
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Status</div>
              <div class="cl-menu-section-buttons">${statusBtns}</div>
            </div>
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Priority</div>
              <div class="cl-menu-section-buttons">
                <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="urgent"${importance === 'urgent' ? ' class="cl-menu-active"' : ''}><i class="fas fa-fire cl-imp-icon-urgent"></i> Urgent</button>
                <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="important"${importance === 'important' ? ' class="cl-menu-active"' : ''}><i class="fas fa-flag cl-imp-icon-important"></i> Important</button>
                <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="normal"${importance === 'normal' ? ' class="cl-menu-active"' : ''}><i class="fas fa-minus"></i> Normal</button>
              </div>
            </div>
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Category</div>
              <div class="cl-menu-section-buttons cl-tag-pills">${catBtns}</div>
            </div>
          </div>
          <div class="cl-menu-col">
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Assign To</div>
              <div class="cl-menu-section-buttons">
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to="underwriter"${assignedTo === 'underwriter' ? ' class="cl-menu-active"' : ''}><i class="fas fa-user-tie cl-assign-icon-underwriter"></i> Underwriter</button>
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to="investor"${assignedTo === 'investor' ? ' class="cl-menu-active"' : ''}><i class="fas fa-landmark cl-assign-icon-investor"></i> Investor</button>
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to="title"${assignedTo === 'title' ? ' class="cl-menu-active"' : ''}><i class="fas fa-file-signature cl-assign-icon-title"></i> Title</button>
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to="borrower"${assignedTo === 'borrower' ? ' class="cl-menu-active"' : ''}><i class="fas fa-user cl-assign-icon-borrower"></i> Borrower</button>
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to="processor"${assignedTo === 'processor' ? ' class="cl-menu-active"' : ''}><i class="fas fa-cogs cl-assign-icon-processor"></i> Processor</button>
                <button type="button" data-cl-action="set-assigned-to" data-cl-id="${item.id}" data-cl-assigned-to=""${!assignedTo ? ' class="cl-menu-active"' : ''}><i class="fas fa-times-circle"></i> Unassign</button>
              </div>
            </div>
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Gate</div>
              <div class="cl-menu-section-buttons cl-tag-pills">${gateBtns}</div>
            </div>
            <div class="cl-menu-section">
              <div class="cl-menu-section-label">Actions</div>
              <div class="cl-menu-section-buttons">
                <button type="button" data-cl-action="set-date" data-cl-id="${item.id}"><i class="fas fa-calendar-check"></i> Set Date</button>
                <button type="button" data-cl-action="set-due-date" data-cl-id="${item.id}"><i class="fas fa-hourglass-half"></i> Due Date</button>
                <button type="button" data-cl-action="edit-item" data-cl-id="${item.id}"><i class="fas fa-pencil-alt"></i> Edit</button>
                <button type="button" data-cl-action="add-subitem" data-cl-id="${item.id}"><i class="fas fa-indent"></i> Subitem</button>
                <button type="button" data-cl-action="add-note" data-cl-id="${item.id}"><i class="fas fa-comment-medical"></i> Call Note</button>
                <button type="button" data-cl-action="delete-item" data-cl-id="${item.id}" class="cl-menu-danger"><i class="fas fa-trash"></i> Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
    },
  };

  window.ChecklistPinned = ChecklistPinned;
})();
