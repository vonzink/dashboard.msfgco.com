// Checklist render & state-query helpers — extracted from js/checklists.js
// (audit §2.3). Same mixin pattern as actions.js: Object.assign-ed onto
// the Checklists object so `this` semantics are preserved everywhere.
//
// Depends on (globals):
//   Utils.escapeHtml, Utils.showToast
//   ServerAPI.reorderChecklistItems
// Depends on (sibling Checklists state / methods, present at runtime):
//   this._statusMap, this.MAX_CHECKLISTS_PER_LOAN
//   this._currentChecklist, this._currentSource, this._selectedItemId,
//   this._pinnedOpen, this.STATUS_OPTIONS
//   this._fmtDate(), this._fmtDateTime(), this._isOverdue(), this._nextStatus()
//   this._applySelectionHighlight(), this._renderPinnedPanel()
//
// Exposes: window.ChecklistRender

(function () {
  const ChecklistRender = {

    // ─── Status badge (public API used by pipeline/funded-loans/pre-approvals)
    getStatusBadge(sourceType, itemId) {
      const list = (this._statusMap[sourceType] || {})[itemId] || [];
      let html = '<span class="cl-badges">';
      for (const info of list) {
        const pct = info.total > 0 ? Math.round((info.done / info.total) * 100) : 0;
        const cls = pct === 100 ? 'cl-badge-done' : info.done > 0 ? 'cl-badge-partial' : 'cl-badge-empty';
        const localCls = info.is_file_local ? ' cl-badge-filelocal' : '';
        const tipExtra = info.is_file_local ? ' (file-local, from PDF)' : '';
        const title = `${Utils.escapeHtml(info.name)}: ${info.done}/${info.total}${tipExtra}`;
        const icon = info.is_file_local ? 'fa-file-pdf' : 'fa-tasks';
        html += `<button type="button" class="cl-icon-btn ${cls}${localCls}" data-cl-checklist="${info.id}" data-cl-source="${sourceType}" data-cl-item="${itemId}" title="${title}">
          <i class="fas ${icon}"></i><span class="cl-badge-count">${info.done}/${info.total}</span>
        </button>`;
      }
      if (list.length < this.MAX_CHECKLISTS_PER_LOAN) {
        const tip = list.length ? 'Add another checklist' : 'Add a checklist';
        html += `<button type="button" class="cl-icon-btn cl-badge-add" data-cl-add="1" data-cl-source="${sourceType}" data-cl-item="${itemId}" title="${tip}">
          <i class="fas fa-plus"></i>
        </button>`;
      }
      html += '</span>';
      return html;
    },

    getEmptyBadge() { return ''; },

    // ─── State queries

    _findItem(id) {
      return (this._currentChecklist?.items || []).find(i => i.id === id);
    },

    _findSubitem(subId) {
      for (const item of (this._currentChecklist?.items || [])) {
        const sub = (item.subitems || []).find(s => s.id === subId);
        if (sub) return sub;
      }
      return null;
    },

    // ─── Targeted DOM updates (no full re-render)

    _updateItemInPlace(itemId) {
      const item = this._findItem(itemId);
      if (!item) return;
      const container = document.getElementById('clContent');
      if (!container) return;
      const el = container.querySelector(`.cl-item[data-item-id="${itemId}"]`);
      if (!el) return;

      const statusInfo = this.STATUS_OPTIONS.find(s => s.value === item.status) || this.STATUS_OPTIONS[0];
      const importance = item.importance || 'normal';

      const assignedTo = item.assigned_to || '';
      const assignedCls = assignedTo ? ` cl-assigned-${assignedTo}` : '';

      // Update item classes
      el.className = `cl-item ${statusInfo.cls} cl-imp-${importance}${assignedCls}`;
      el.dataset.importance = importance;
      el.dataset.assignedTo = assignedTo;

      // Update status button
      const statusBtn = el.querySelector('.cl-status-btn');
      if (statusBtn) {
        statusBtn.className = `cl-status-btn ${statusInfo.cls}`;
        statusBtn.title = statusInfo.label;
        statusBtn.innerHTML = `<i class="fas ${statusInfo.icon}"></i>`;
      }

      // Update date badges
      const actionsEl = el.querySelector('.cl-item-actions');
      if (actionsEl) {
        const dateStr = item.date ? this._fmtDate(item.date) : '';
        const dueDateStr = item.due_date ? this._fmtDate(item.due_date) : '';
        const overdue = item.due_date && item.status !== 'done' && this._isOverdue(item.due_date);

        const existingDate = actionsEl.querySelector('.cl-item-date');
        const existingDue = actionsEl.querySelector('.cl-item-due-date');

        if (dateStr) {
          if (existingDate) {
            existingDate.textContent = dateStr;
            existingDate.title = `Completed ${dateStr}`;
          } else {
            const span = document.createElement('span');
            span.className = 'cl-item-date';
            span.title = `Completed ${dateStr}`;
            span.textContent = dateStr;
            actionsEl.insertBefore(span, actionsEl.firstChild);
          }
        } else if (existingDate) {
          existingDate.remove();
        }

        if (dueDateStr) {
          if (existingDue) {
            existingDue.className = `cl-item-due-date${overdue ? ' cl-item-due-date-overdue' : ''}`;
            existingDue.title = `Due ${dueDateStr}${overdue ? ' (overdue)' : ''}`;
            existingDue.innerHTML = `<i class="fas fa-hourglass-half"></i> ${dueDateStr}`;
          } else {
            const span = document.createElement('span');
            span.className = `cl-item-due-date${overdue ? ' cl-item-due-date-overdue' : ''}`;
            span.title = `Due ${dueDateStr}${overdue ? ' (overdue)' : ''}`;
            span.innerHTML = `<i class="fas fa-hourglass-half"></i> ${dueDateStr}`;
            actionsEl.insertBefore(span, actionsEl.firstChild);
          }
        } else if (existingDue) {
          existingDue.remove();
        }
      }

      // Update status, assignment + importance active states in menu
      el.querySelectorAll('[data-cl-action="set-status"]').forEach(b => {
        b.classList.toggle('cl-menu-active', b.dataset.clStatus === item.status);
      });
      el.querySelectorAll('[data-cl-action="set-assigned-to"]').forEach(b => {
        b.classList.toggle('cl-menu-active', (b.dataset.clAssignedTo || '') === assignedTo);
      });
      el.querySelectorAll('[data-cl-action="set-importance"]').forEach(b => {
        b.classList.toggle('cl-menu-active', b.dataset.clImportance === importance);
      });

      // Mirror the same state into the pinned panel if it's showing this item
      if (this._pinnedOpen && this._selectedItemId === itemId) {
        this._renderPinnedPanel();
      }
    },

    _updateSubitemInPlace(subId) {
      const sub = this._findSubitem(subId);
      if (!sub) return;
      const container = document.getElementById('clContent');
      if (!container) return;

      const btn = container.querySelector(`.cl-status-btn-sm[data-cl-sub-id="${subId}"]`);
      if (!btn) return;

      const statusInfo = this.STATUS_OPTIONS.find(s => s.value === sub.status) || this.STATUS_OPTIONS[0];
      const subEl = btn.closest('.cl-subitem');
      if (subEl) {
        this.STATUS_OPTIONS.forEach(s => subEl.classList.remove(s.cls));
        subEl.classList.add(statusInfo.cls);
      }

      btn.className = `cl-status-btn-sm ${statusInfo.cls}`;
      btn.dataset.clStatus = this._nextStatus(sub.status);
      btn.title = statusInfo.label;
      btn.innerHTML = `<i class="fas ${statusInfo.icon}"></i>`;
    },

    _updateProgressBar() {
      const container = document.getElementById('clContent');
      if (!container || !this._currentChecklist) return;
      const items = this._currentChecklist.items || [];
      const total = items.length;
      const done = items.filter(i => i.status === 'done').length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      const bar = container.querySelector('.cl-progress-bar');
      const text = container.querySelector('.cl-progress-text');
      if (bar) bar.style.width = `${pct}%`;
      if (text) text.textContent = `${done}/${total} complete (${pct}%)`;
    },

    // ─── Full checklist render

    _renderChecklist() {
      const container = document.getElementById('clContent');
      if (!container || !this._currentChecklist) return;

      const cl = this._currentChecklist;
      const items = cl.items || [];
      const total = items.length;
      const done = items.filter(i => i.status === 'done').length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      const titleEl = document.getElementById('clModalTitle');
      if (titleEl) {
        const client = this._currentSource?.clientName || '';
        const clName = cl.name || 'Checklist';
        titleEl.innerHTML = `<i class="fas fa-tasks"></i> ${Utils.escapeHtml(clName)}${client ? ` — ${Utils.escapeHtml(client)}` : ''}`;
      }

      let html = `
        <div class="cl-toolbar">
          <div class="cl-progress-summary">
            <div class="cl-progress-bar-wrap">
              <div class="cl-progress-bar" style="width:${pct}%"></div>
            </div>
            <span class="cl-progress-text">${done}/${total} complete (${pct}%)</span>
          </div>
          <div class="cl-toolbar-actions">
            <button type="button" class="btn btn-sm btn-outline${this._pinnedOpen ? ' cl-pin-active' : ''}" data-cl-action="toggle-pinned" title="Show/hide the action menu — click an item to act on it"><i class="fas fa-bars"></i> ${this._pinnedOpen ? 'Hide Menu' : 'Menu'}</button>
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="add-item" title="Add item"><i class="fas fa-plus"></i> Add</button>
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="export-checklist" title="Export as .md"><i class="fas fa-file-export"></i> Export</button>
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="rename-checklist" title="Rename this checklist"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-outline btn-danger-outline" data-cl-action="delete-checklist" title="Delete this checklist"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="cl-items-list">
      `;

      for (const item of items) {
        const statusInfo = this.STATUS_OPTIONS.find(s => s.value === item.status) || this.STATUS_OPTIONS[0];
        const dateStr = item.date ? this._fmtDate(item.date) : '';
        const dueDateStr = item.due_date ? this._fmtDate(item.due_date) : '';
        const overdue = item.due_date && item.status !== 'done' && this._isOverdue(item.due_date);
        const importance = item.importance || 'normal';
        const importanceCls = `cl-imp-${importance}`;
        const assignedTo = item.assigned_to || '';
        const assignedCls = assignedTo ? ` cl-assigned-${assignedTo}` : '';

        html += `
          <div class="cl-item ${statusInfo.cls} ${importanceCls}${assignedCls}" data-item-id="${item.id}" data-importance="${importance}" data-assigned-to="${assignedTo}" draggable="true">
            <div class="cl-item-main">
              <button type="button" class="cl-status-btn ${statusInfo.cls}" data-cl-action="toggle-status" data-cl-id="${item.id}" title="${statusInfo.label}">
                <i class="fas ${statusInfo.icon}"></i>
              </button>
              <div class="cl-item-name">${Utils.escapeHtml(item.name)}</div>
              <div class="cl-item-actions">
                ${dueDateStr ? `<span class="cl-item-due-date${overdue ? ' cl-item-due-date-overdue' : ''}" title="Due ${dueDateStr}${overdue ? ' (overdue)' : ''}"><i class="fas fa-hourglass-half"></i> ${dueDateStr}</span>` : ''}
                ${dateStr ? `<span class="cl-item-date" title="Completed ${dateStr}">${dateStr}</span>` : ''}
              </div>
            </div>`;

        if (item.subitems?.length) {
          html += '<div class="cl-subitems">';
          for (const sub of item.subitems) {
            const subStatus = this.STATUS_OPTIONS.find(s => s.value === sub.status) || this.STATUS_OPTIONS[0];
            html += `
              <div class="cl-subitem ${subStatus.cls}">
                <button type="button" class="cl-status-btn-sm ${subStatus.cls}" data-cl-action="set-subitem-status" data-cl-sub-id="${sub.id}" data-cl-status="${this._nextStatus(sub.status)}" title="${subStatus.label}">
                  <i class="fas ${subStatus.icon}"></i>
                </button>
                <span class="cl-subitem-name">${Utils.escapeHtml(sub.name)}</span>
                ${sub.date ? `<span class="cl-subitem-date">${this._fmtDate(sub.date)}</span>` : ''}
                <button type="button" class="cl-subitem-del" data-cl-action="delete-subitem" data-cl-id="${sub.id}" title="Delete"><i class="fas fa-times"></i></button>
              </div>`;
          }
          html += '</div>';
        }

        if (item.notes?.length) {
          html += '<div class="cl-notes">';
          for (const n of item.notes) {
            html += `
              <div class="cl-note" data-note-id="${n.id}">
                <div class="cl-note-meta">
                  <i class="fas fa-phone-alt cl-note-icon"></i>
                  <span class="cl-note-stamp">${this._fmtDateTime(n.created_at)}</span>
                  <span class="cl-note-author">${Utils.escapeHtml(n.author_name || '')}</span>
                  <button type="button" class="cl-note-del" data-cl-action="delete-note" data-cl-id="${n.id}" title="Delete note"><i class="fas fa-times"></i></button>
                </div>
                <div class="cl-note-body">${Utils.escapeHtml(n.body)}</div>
              </div>`;
          }
          html += '</div>';
        }

        html += '</div>';
      }

      html += '</div>';
      container.innerHTML = html;

      this._bindItemDrag(container);

      // Re-apply selection highlight + sync pinned panel
      if (this._selectedItemId) {
        const stillExists = (this._currentChecklist?.items || []).some(i => i.id === this._selectedItemId);
        if (!stillExists) this._selectedItemId = null;
      }
      this._applySelectionHighlight();
      if (this._pinnedOpen) this._renderPinnedPanel();
    },

    // ─── Drag-to-reorder

    _bindItemDrag(container) {
      let dragId = null;
      container.querySelectorAll('.cl-item').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          if (e.target.closest('button, input, .cl-menu-dropdown')) {
            e.preventDefault();
            return;
          }
          dragId = parseInt(el.dataset.itemId);
          el.classList.add('cl-item-dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (_) {}
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('cl-item-dragging');
          container.querySelectorAll('.cl-item-drag-over').forEach(n => n.classList.remove('cl-item-drag-over'));
        });
        el.addEventListener('dragover', (e) => {
          if (dragId == null) return;
          const dragged = this._findItem(dragId);
          const target = this._findItem(parseInt(el.dataset.itemId));
          if (!dragged || !target) return;
          const draggedUrgent = (dragged.importance === 'urgent');
          const targetUrgent = (target.importance === 'urgent');
          if (draggedUrgent !== targetUrgent) return;
          e.preventDefault();
          el.classList.add('cl-item-drag-over');
        });
        el.addEventListener('dragleave', () => el.classList.remove('cl-item-drag-over'));
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          el.classList.remove('cl-item-drag-over');
          if (dragId == null) return;
          const dropTargetId = parseInt(el.dataset.itemId);
          if (dragId === dropTargetId) { dragId = null; return; }

          const items = this._currentChecklist?.items || [];
          const fromIdx = items.findIndex(i => i.id === dragId);
          const toIdx = items.findIndex(i => i.id === dropTargetId);
          if (fromIdx < 0 || toIdx < 0) { dragId = null; return; }

          const [moved] = items.splice(fromIdx, 1);
          items.splice(toIdx, 0, moved);
          for (let i = 0; i < items.length; i++) items[i].sort_order = i;
          this._renderChecklist();

          try {
            const src = this._currentSource;
            await ServerAPI.reorderChecklistItems(src.type, src.itemId, items.map(i => ({ id: i.id, sort_order: i.sort_order })));
          } catch (err) {
            Utils.showToast('Failed to save order: ' + err.message, 'error');
          }
          dragId = null;
        });
      });
    },

    _reorderClientSide() {
      const items = this._currentChecklist?.items || [];
      items.sort((a, b) => {
        const au = (a.importance === 'urgent') ? 1 : 0;
        const bu = (b.importance === 'urgent') ? 1 : 0;
        if (au !== bu) return bu - au;
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
    },

    _reorderItemsDom() {
      const container = document.getElementById('clContent');
      if (!container) return;
      const list = container.querySelector('.cl-items-list');
      if (!list) return;
      const items = this._currentChecklist?.items || [];
      const groups = new Map();
      let curId = null;
      for (const child of [...list.children]) {
        if (child.classList.contains('cl-item')) {
          curId = child.dataset.itemId;
          groups.set(curId, [child]);
        } else if (curId) {
          groups.get(curId).push(child);
        }
      }
      for (const item of items) {
        const els = groups.get(String(item.id));
        if (els) els.forEach(el => list.appendChild(el));
      }
    },

    // ─── Refresh per-row checklist badge in the pipeline / funded-loans table

    _refreshBadgeInTable(sourceType, itemId) {
      document.querySelectorAll(`.cl-badges`).forEach(wrap => {
        const probe = wrap.querySelector('[data-cl-item]');
        if (!probe) return;
        if (probe.dataset.clSource !== sourceType) return;
        if (parseInt(probe.dataset.clItem) !== itemId) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.getStatusBadge(sourceType, itemId);
        const fresh = wrapper.firstElementChild;
        if (!fresh) return;
        fresh.querySelectorAll('.cl-icon-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const checklistId = btn.dataset.clChecklist ? parseInt(btn.dataset.clChecklist) : null;
            const row = btn.closest('tr');
            const clientName = row?.querySelector('strong')?.textContent || '';
            if (checklistId) this.openById(checklistId, sourceType, itemId, clientName);
            else this.openForNew(sourceType, itemId, clientName);
          });
        });
        wrap.replaceWith(fresh);
      });
    },
  };

  window.ChecklistRender = ChecklistRender;
})();
