/* ============================================
   MSFG Dashboard - Loan Checklists Module
   Checklist templates, loan-specific instances,
   import/export, and template manager.
============================================ */

const Checklists = {
  _statusMap: {},
  _currentSource: null, // { type, itemId, clientName }
  _currentChecklist: null,
  _templates: [],
  _initialized: false,

  STATUS_OPTIONS: [
    { value: 'not_started', label: 'Not Started', icon: 'fa-circle', cls: 'cl-status-not-started' },
    { value: 'in_progress', label: 'In Progress', icon: 'fa-spinner', cls: 'cl-status-in-progress' },
    { value: 'done',        label: 'Done',        icon: 'fa-check-circle', cls: 'cl-status-done' },
    { value: 'issue',       label: 'Issue',       icon: 'fa-exclamation-triangle', cls: 'cl-status-issue' },
    { value: 'na',          label: 'N/A',         icon: 'fa-minus-circle', cls: 'cl-status-na' },
  ],

  SAMPLE_TEMPLATE: {
    name: 'Loan Processing Checklist',
    description: 'Standard loan processing workflow — covers pre-approval through funding.',
    items: [
      'Do Pre-Approval Letter and Mark in Tanya Team List',
      'Make sure Middle Initial is in Lending Pad',
      'Set Up Monday Client Checklist Template',
      'Make sure Phone Number is in Mobile section',
      'Add Assistant and Processor to Lending Pad',
      'Add in Net Benefit in LP',
      'Check Declarations In Lending Pad for any other YES (Loan App & Declaration Tab)',
      'Add Vesting (Title) Info into Lending Pad',
      'Add Real Estate Agent info into Lending Pad',
      'Tax Statement in Dropbox',
      "Driver's Licenses in Drop Box",
      'Current Pay Stubs In Drop Box',
      "Taxes/W2's in Drop Box",
      'Add Title Company Info into Lending Pad',
      'Add Title Company to Monday Board',
      'PA & Addendums in Drop Box',
      'EMD in Drop Box',
      'Check if the Full Credit Report Has Been Pulled',
      'Shop Interest Rates',
      'Check Address on PA, in Monday, & LP. Make Sure They Match',
      'Upload Loan to Investor',
      'Add Lender Info & Loan Number to Lending Pad',
      'DATES: Add Application, Registration, Closing & Funding Dates in Lending Pad',
      'Run AUS',
      'Upload Wire Instructions (All Lenders)',
      'View What is Missing in Submission Folder & Email to Tanya',
      'Add Insurance Provider to LENDING PAD',
      "Enter In HOI section on Tanya's Board / Contact is in KSPs When Insurance is Entered into LP",
      'DATES: Add Loan Estimate Date to Lending Pad',
      'Pull Cert & Auth. Put in Borrower Folder in DB',
      'Check Appraisal Waiver Doc That 3 Days of Closing is Waived',
      'DATES: Lock Date & Info',
      'DATES: Initial Submittal and Approval Signed',
      'Add Underwriter Name, Phone Number & Email to Monday',
      'Put Conditions in the Monday Conditions Board',
      'Final Loan Amount Matches',
      'Confirm Lock Expiration Date',
      'DATES: Closing Disclosures & Clear to Close',
      'Add Funding Date to LP after closing is complete (10 minutes)',
      'Add Funding Date in Monday & Hit Loan Complete',
      'Review file in Drop Box and convert any Word Docs',
    ],
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._bindModalEvents();
  },

  // ════════════════════════════════════════════════
  //  STATUS BADGE CACHE (batch load per source type)
  // ════════════════════════════════════════════════
  async loadStatusBadges(sourceType) {
    try {
      this._statusMap[sourceType] = await ServerAPI.getChecklistStatus(sourceType);
    } catch { this._statusMap[sourceType] = {}; }
  },

  MAX_CHECKLISTS_PER_LOAN: 3,

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

  // ════════════════════════════════════════════════
  //  MODAL OPEN / CLOSE
  // ════════════════════════════════════════════════
  async openById(checklistId, sourceType, sourceItemId, clientName) {
    this._currentSource = { type: sourceType, itemId: sourceItemId, clientName: clientName || '' };
    this._openModalChrome(clientName);
    try {
      this._currentChecklist = await ServerAPI.getLoanChecklist(checklistId);
    } catch (err) {
      this._currentChecklist = null;
    }
    if (this._currentChecklist) {
      this._renderChecklist();
    } else {
      await this._renderTemplateSelector();
    }
  },

  async openForNew(sourceType, sourceItemId, clientName) {
    this._currentSource = { type: sourceType, itemId: sourceItemId, clientName: clientName || '' };
    this._currentChecklist = null;
    this._openModalChrome(clientName);
    await this._renderTemplateSelector();
  },

  async open(sourceType, sourceItemId, clientName) {
    this._currentSource = { type: sourceType, itemId: sourceItemId, clientName: clientName || '' };
    this._openModalChrome(clientName);
    try {
      const list = await ServerAPI.getLoanChecklists(sourceType, sourceItemId);
      if (Array.isArray(list) && list.length > 0) {
        this._currentChecklist = list[0];
        this._renderChecklist();
        return;
      }
    } catch {}
    this._currentChecklist = null;
    await this._renderTemplateSelector();
  },

  _openModalChrome(clientName) {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('clModalTitle').textContent = clientName ? `Checklist — ${clientName}` : 'Loan Checklist';
    document.getElementById('clContent').innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  },

  close() {
    const modal = document.getElementById('checklistModal');
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }
    this._currentSource = null;
    this._currentChecklist = null;
    this._dragOffset = { x: 0, y: 0 };
    const modalBox = document.querySelector('#checklistModal .cl-modal');
    if (modalBox) modalBox.style.transform = '';
  },

  _bindModalEvents() {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;

    modal.querySelector('.cl-modal-close')?.addEventListener('click', () => this.close());

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cl-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.clAction;
      const id = btn.dataset.clId;
      this._handleAction(action, id, btn);
    });

    // Persistent delegated handler for closing dropdown menus
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cl-menu-trigger')) {
        modal.querySelectorAll('.cl-menu-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });

    this._bindDragHandle();
  },

  _dragOffset: { x: 0, y: 0 },
  _bindDragHandle() {
    const header = document.querySelector('#checklistModal .cl-modal-header');
    const modalBox = document.querySelector('#checklistModal .cl-modal');
    if (!header || !modalBox) return;

    let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;

    const onDown = (e) => {
      if (e.target.closest('.cl-modal-close')) return;
      dragging = true;
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      originX = this._dragOffset.x;
      originY = this._dragOffset.y;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      this._dragOffset.x = originX + (pt.clientX - startX);
      this._dragOffset.y = originY + (pt.clientY - startY);
      modalBox.style.transform = `translate(${this._dragOffset.x}px, ${this._dragOffset.y}px)`;
    };
    const onUp = () => { dragging = false; };

    header.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    header.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  },

  // ════════════════════════════════════════════════
  //  ACTION DISPATCHER — routes to discrete handlers
  // ════════════════════════════════════════════════
  async _handleAction(action, id, btn) {
    const src = this._currentSource;
    if (!src) return;

    const handler = {
      'assign-template':       () => this._actionAssignTemplate(id, src),
      'rename-checklist':      () => this._actionRenameChecklist(src),
      'delete-checklist':      () => this._actionDeleteChecklist(src),
      'toggle-status':         () => this._actionToggleStatus(id, src),
      'set-status':            () => this._actionSetStatus(btn, src),
      'set-subitem-status':    () => this._actionSetSubitemStatus(btn),
      'delete-item':           () => this._actionDeleteItem(id, src),
      'delete-subitem':        () => this._actionDeleteSubitem(id),
      'add-item':              () => this._actionAddItem(src),
      'make-from-pdf':         () => this._actionMakeFromPdf(src),
      'add-subitem':           () => this._actionAddSubitem(id),
      'add-note':              () => this._actionAddNote(id),
      'delete-note':           () => this._actionDeleteNote(id),
      'edit-item':             () => this._actionEditItem(id),
      'set-importance':        () => this._actionSetImportance(id, btn),
      'set-date':              () => this._actionSetDate(id, btn),
      'set-due-date':          () => this._actionSetDueDate(id, btn),
      'export-checklist':      () => this._exportCurrentChecklist(),
      'import-checklist':      () => this._importChecklist(),
      'show-template-selector':() => this._renderTemplateSelector(),
    }[action];

    if (!handler) return;

    try {
      await handler();
    } catch (err) {
      Utils.showToast('Something went wrong: ' + (err.message || 'Unknown error'), 'error');
    }
  },

  // ════════════════════════════════════════════════
  //  ACTION HANDLERS — each isolated with own error handling
  // ════════════════════════════════════════════════
  async _actionAssignTemplate(id, src) {
    const templateId = parseInt(id);
    if (!templateId) return;
    try {
      this._currentChecklist = await ServerAPI.assignChecklistTemplate(src.type, src.itemId, templateId);
      this._renderChecklist();
      Utils.showToast('Checklist added!', 'success');
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) { Utils.showToast('Failed: ' + err.message, 'error'); }
  },

  async _actionRenameChecklist(src) {
    if (!this._currentChecklist) return;
    const newName = await this._promptInput('Rename Checklist', 'Enter a new name', this._currentChecklist.name || '');
    if (!newName) return;
    try {
      await ServerAPI.renameLoanChecklist(this._currentChecklist.id, newName);
      this._currentChecklist.name = newName;
      this._renderChecklist();
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) { Utils.showToast('Rename failed: ' + err.message, 'error'); }
  },

  async _actionDeleteChecklist(src) {
    if (!this._currentChecklist) return;
    const confirmed = await this._promptConfirm(
      'Delete Checklist',
      `Delete "${this._currentChecklist.name || 'this checklist'}"? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await ServerAPI.deleteLoanChecklist(this._currentChecklist.id);
      this._currentChecklist = null;
      this.close();
      Utils.showToast('Checklist deleted', 'success');
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) { Utils.showToast('Delete failed: ' + err.message, 'error'); }
  },

  async _actionToggleStatus(id, src) {
    const itemId = parseInt(id);
    const item = this._findItem(itemId);
    if (!item) return;
    const next = this._nextStatus(item.status);
    const payload = { status: next };
    if (next === 'done' && !item.date) payload.date = this._todayISO();
    if (next !== 'done' && item.status === 'done' && item.date) payload.date = null;

    // Optimistic update
    const prevStatus = item.status;
    const prevDate = item.date;
    item.status = next;
    if (payload.date !== undefined) item.date = payload.date;
    this._updateItemInPlace(itemId);
    this._updateProgressBar();

    try {
      await ServerAPI.updateChecklistItem(itemId, payload);
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) {
      item.status = prevStatus;
      item.date = prevDate;
      this._updateItemInPlace(itemId);
      this._updateProgressBar();
      Utils.showToast('Failed to update status', 'error');
    }
  },

  async _actionSetStatus(btn, src) {
    const itemId = parseInt(btn.dataset.clItemId);
    const newStatus = btn.dataset.clStatus;
    const item = this._findItem(itemId);
    if (!item) return;
    const payload = { status: newStatus };
    if (newStatus === 'done' && !item.date) payload.date = this._todayISO();
    if (newStatus !== 'done' && item.status === 'done' && item.date) payload.date = null;

    const prevStatus = item.status;
    const prevDate = item.date;
    item.status = newStatus;
    if (payload.date !== undefined) item.date = payload.date;
    this._updateItemInPlace(itemId);
    this._updateProgressBar();
    // Close menu after selection
    const container = document.getElementById('clContent');
    if (container) container.querySelectorAll('.cl-menu-dropdown.open').forEach(d => d.classList.remove('open'));

    try {
      await ServerAPI.updateChecklistItem(itemId, payload);
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) {
      item.status = prevStatus;
      item.date = prevDate;
      this._updateItemInPlace(itemId);
      this._updateProgressBar();
      Utils.showToast('Failed to update', 'error');
    }
  },

  async _actionSetSubitemStatus(btn) {
    const subId = parseInt(btn.dataset.clSubId);
    const newStatus = btn.dataset.clStatus;
    const sub = this._findSubitem(subId);
    if (!sub) return;

    const prevStatus = sub.status;
    sub.status = newStatus;
    this._updateSubitemInPlace(subId);

    try {
      await ServerAPI.updateChecklistSubitem(subId, { status: newStatus });
    } catch (err) {
      sub.status = prevStatus;
      this._updateSubitemInPlace(subId);
      Utils.showToast('Failed to update', 'error');
    }
  },

  async _actionDeleteItem(id, src) {
    const itemId = parseInt(id);
    const confirmed = await this._promptConfirm('Delete Item', 'Delete this checklist item?');
    if (!confirmed) return;
    try {
      await ServerAPI.deleteChecklistItem(itemId);
      this._currentChecklist.items = this._currentChecklist.items.filter(i => i.id !== itemId);
      this._renderChecklist();
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) { Utils.showToast('Failed to delete', 'error'); }
  },

  async _actionDeleteSubitem(id) {
    const subId = parseInt(id);
    try {
      await ServerAPI.deleteChecklistSubitem(subId);
      for (const item of (this._currentChecklist?.items || [])) {
        item.subitems = (item.subitems || []).filter(s => s.id !== subId);
      }
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to delete', 'error'); }
  },

  async _actionAddItem(src) {
    if (!this._currentChecklist) {
      const clName = await this._promptInput('New Checklist', 'Name this checklist', 'Custom Checklist');
      if (!clName) return;
      const itemName = await this._promptInput('First Item', 'Enter the first item name');
      if (!itemName) return;
      try {
        this._currentChecklist = await ServerAPI.importLoanChecklist(src.type, src.itemId, {
          items: [{ name: itemName, status: 'not_started', sort_order: 0 }],
          name: clName,
        });
        this._renderChecklist();
        this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
      } catch (err) { Utils.showToast('Failed: ' + err.message, 'error'); }
      return;
    }
    const name = await this._promptInput('Add Item', 'New checklist item name');
    if (!name) return;
    try {
      const maxSort = (this._currentChecklist.items || []).reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const newItem = await ServerAPI.addChecklistItem(this._currentChecklist.id, {
        name, status: 'not_started', sort_order: maxSort + 1,
      });
      this._currentChecklist.items.push({ ...newItem, subitems: [] });
      this._renderChecklist();
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) { Utils.showToast('Failed to add item', 'error'); }
  },

  async _actionMakeFromPdf(src) {
    const file = await this._pickFile('.pdf,application/pdf');
    if (!file) return;
    const toast = Utils.showToast('Parsing PDF…');
    try {
      const created = await ServerAPI.createChecklistFromPdf(src.type, src.itemId, file);
      this._currentChecklist = created;
      this._renderChecklist();
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
      Utils.showToast(`Created "${created.name}" from ${file.name}`, 'success');
    } catch (err) {
      Utils.showToast('PDF conversion failed: ' + err.message, 'error');
    }
  },

  async _actionAddSubitem(id) {
    const itemId = parseInt(id);
    const name = await this._promptInput('Add Subitem', 'New subitem name');
    if (!name) return;
    try {
      const newSub = await ServerAPI.addChecklistSubitem(itemId, { name });
      const item = this._findItem(itemId);
      if (item) {
        if (!item.subitems) item.subitems = [];
        item.subitems.push(newSub);
      }
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to add subitem', 'error'); }
  },

  async _actionAddNote(id) {
    const itemId = parseInt(id);
    const item = this._findItem(itemId);
    if (!item) return;
    const body = await this._promptNoteBody(item);
    if (!body) return;
    try {
      const newNote = await ServerAPI.addChecklistItemNote(itemId, body);
      if (newNote) {
        if (!item.notes) item.notes = [];
        item.notes.unshift(newNote);
      }
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to add note: ' + (err.message || ''), 'error'); }
  },

  async _actionDeleteNote(id) {
    const noteId = parseInt(id);
    const confirmed = await this._promptConfirm('Delete Note', 'Delete this note? This cannot be undone.');
    if (!confirmed) return;
    try {
      await ServerAPI.deleteChecklistItemNote(noteId);
      for (const it of (this._currentChecklist?.items || [])) {
        if (it.notes) it.notes = it.notes.filter(n => n.id !== noteId);
      }
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to delete note', 'error'); }
  },

  async _actionEditItem(id) {
    const itemId = parseInt(id);
    const item = this._findItem(itemId);
    if (!item) return;
    const name = await this._promptInput('Edit Item', 'Item name', item.name);
    if (!name || name === item.name) return;
    try {
      await ServerAPI.updateChecklistItem(itemId, { name });
      item.name = name;
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to update', 'error'); }
  },

  async _actionSetImportance(id, btn) {
    const itemId = parseInt(id);
    const newImp = btn.dataset.clImportance;
    const item = this._findItem(itemId);
    if (!item) return;
    try {
      await ServerAPI.updateChecklistItem(itemId, { importance: newImp });
      item.importance = newImp;
      this._reorderClientSide();
      this._renderChecklist();
    } catch (err) { Utils.showToast('Failed to set importance', 'error'); }
  },

  async _actionSetDate(id, btn) {
    const itemId = parseInt(id);
    const item = this._findItem(itemId);
    if (!item) return;
    this._pickDate(btn, item.date || '', async (newDate) => {
      try {
        await ServerAPI.updateChecklistItem(itemId, { date: newDate || null });
        item.date = newDate || null;
        this._updateItemInPlace(itemId);
      } catch (err) { Utils.showToast('Failed to update date', 'error'); }
    });
  },

  async _actionSetDueDate(id, btn) {
    const itemId = parseInt(id);
    const item = this._findItem(itemId);
    if (!item) return;
    this._pickDate(btn, item.due_date || '', async (newDate) => {
      try {
        await ServerAPI.updateChecklistItem(itemId, { due_date: newDate || null });
        item.due_date = newDate || null;
        this._updateItemInPlace(itemId);
      } catch (err) { Utils.showToast('Failed to update due date', 'error'); }
    });
  },

  // ════════════════════════════════════════════════
  //  TARGETED DOM UPDATES (no full re-render needed)
  // ════════════════════════════════════════════════
  _updateItemInPlace(itemId) {
    const item = this._findItem(itemId);
    if (!item) return;
    const container = document.getElementById('clContent');
    if (!container) return;
    const el = container.querySelector(`.cl-item[data-item-id="${itemId}"]`);
    if (!el) return;

    const statusInfo = this.STATUS_OPTIONS.find(s => s.value === item.status) || this.STATUS_OPTIONS[0];
    const importance = item.importance || 'normal';

    // Update item classes
    el.className = `cl-item ${statusInfo.cls} cl-imp-${importance}`;
    el.dataset.importance = importance;

    // Update status button
    const statusBtn = el.querySelector('.cl-status-btn');
    if (statusBtn) {
      statusBtn.className = `cl-status-btn ${statusInfo.cls}`;
      statusBtn.title = statusInfo.label;
      statusBtn.innerHTML = `<i class="fas ${statusInfo.icon}"></i>`;
    }

    // Update item name styling (strikethrough etc handled by CSS)
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
  },

  _updateSubitemInPlace(subId) {
    const sub = this._findSubitem(subId);
    if (!sub) return;
    const container = document.getElementById('clContent');
    if (!container) return;

    // Find the subitem's status button
    const btn = container.querySelector(`.cl-status-btn-sm[data-cl-sub-id="${subId}"]`);
    if (!btn) return;

    const statusInfo = this.STATUS_OPTIONS.find(s => s.value === sub.status) || this.STATUS_OPTIONS[0];
    const subEl = btn.closest('.cl-subitem');
    if (subEl) {
      // Remove old status classes, add new one
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

  // ════════════════════════════════════════════════
  //  RENDER: Checklist View
  // ════════════════════════════════════════════════
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

      html += `
        <div class="cl-item ${statusInfo.cls} ${importanceCls}" data-item-id="${item.id}" data-importance="${importance}" draggable="true">
          <div class="cl-item-main">
            <button type="button" class="cl-status-btn ${statusInfo.cls}" data-cl-action="toggle-status" data-cl-id="${item.id}" title="${statusInfo.label}">
              <i class="fas ${statusInfo.icon}"></i>
            </button>
            <div class="cl-item-name">${Utils.escapeHtml(item.name)}</div>
            <div class="cl-item-actions">
              ${dueDateStr ? `<span class="cl-item-due-date${overdue ? ' cl-item-due-date-overdue' : ''}" title="Due ${dueDateStr}${overdue ? ' (overdue)' : ''}"><i class="fas fa-hourglass-half"></i> ${dueDateStr}</span>` : ''}
              ${dateStr ? `<span class="cl-item-date" title="Completed ${dateStr}">${dateStr}</span>` : ''}
              <div class="cl-item-menu">
                <button type="button" class="cl-menu-trigger" title="Actions"><i class="fas fa-ellipsis-v"></i></button>
                <div class="cl-menu-dropdown">
                  ${this.STATUS_OPTIONS.map(s => `<button type="button" data-cl-action="set-status" data-cl-item-id="${item.id}" data-cl-status="${s.value}"><i class="fas ${s.icon} ${s.cls}"></i> ${s.label}</button>`).join('')}
                  <hr>
                  <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="urgent"${importance === 'urgent' ? ' class="cl-menu-active"' : ''}><i class="fas fa-fire cl-imp-icon-urgent"></i> Mark Urgent</button>
                  <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="important"${importance === 'important' ? ' class="cl-menu-active"' : ''}><i class="fas fa-flag cl-imp-icon-important"></i> Mark Important</button>
                  <button type="button" data-cl-action="set-importance" data-cl-id="${item.id}" data-cl-importance="normal"${importance === 'normal' ? ' class="cl-menu-active"' : ''}><i class="fas fa-minus"></i> Mark Normal</button>
                  <hr>
                  <button type="button" data-cl-action="set-date" data-cl-id="${item.id}"><i class="fas fa-calendar-check"></i> Set Date</button>
                  <button type="button" data-cl-action="set-due-date" data-cl-id="${item.id}"><i class="fas fa-hourglass-half"></i> Set Due Date</button>
                  <button type="button" data-cl-action="edit-item" data-cl-id="${item.id}"><i class="fas fa-pencil-alt"></i> Edit</button>
                  <button type="button" data-cl-action="add-subitem" data-cl-id="${item.id}"><i class="fas fa-indent"></i> Add Subitem</button>
                  <button type="button" data-cl-action="add-note" data-cl-id="${item.id}"><i class="fas fa-comment-medical"></i> Add Call Note</button>
                  <button type="button" data-cl-action="delete-item" data-cl-id="${item.id}" class="cl-menu-danger"><i class="fas fa-trash"></i> Delete</button>
                </div>
              </div>
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

    // Toggle menus — use event delegation, no per-trigger listeners
    container.addEventListener('click', (e) => {
      const trigger = e.target.closest('.cl-menu-trigger');
      if (!trigger) return;
      e.stopPropagation();
      const dd = trigger.nextElementSibling;
      const wasOpen = dd.classList.contains('open');
      container.querySelectorAll('.cl-menu-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) dd.classList.add('open');
    });

    this._bindItemDrag(container);
  },

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
        try { e.dataTransfer.setData('text/plain', String(dragId)); } catch {}
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

  // ════════════════════════════════════════════════
  //  RENDER: Template Selector (when no checklist)
  // ════════════════════════════════════════════════
  async _renderTemplateSelector() {
    const container = document.getElementById('clContent');
    if (!container) return;

    container.innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading templates...</div>';

    try {
      this._templates = await ServerAPI.getChecklistTemplates();
    } catch { this._templates = []; }

    const globals = this._templates.filter(t => t.is_global);
    const personals = this._templates.filter(t => !t.is_global);

    let html = `
      <div class="cl-template-selector">
        <div class="cl-template-header">
          <h4>Choose a template to get started</h4>
          <div class="cl-template-actions">
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="make-from-pdf" title="Upload a PDF (lender conditions, DU findings, etc.) and convert it into a checklist for this file"><i class="fas fa-file-pdf"></i> Make Checklist from PDF</button>
          </div>
        </div>
    `;

    if (this._templates.length === 0) {
      html += `
        <div class="cl-empty">
          <i class="fas fa-clipboard-list cl-empty-icon"></i>
          <p>No templates yet. Create or import one in <strong>Settings → Checklists</strong>, or start with a blank checklist.</p>
        </div>`;
    } else {
      if (globals.length) {
        html += `<div class="cl-tpl-section-header"><i class="fas fa-globe"></i> General Templates</div>`;
        html += '<div class="cl-template-grid">';
        for (const tpl of globals) {
          html += `
            <button type="button" class="cl-template-card cl-template-global" data-cl-action="assign-template" data-cl-id="${tpl.id}">
              <i class="fas fa-globe"></i>
              <strong>${Utils.escapeHtml(tpl.name)}</strong>
              ${tpl.description ? `<small>${Utils.escapeHtml(tpl.description)}</small>` : ''}
            </button>`;
        }
        html += '</div>';
      }
      if (personals.length) {
        html += `<div class="cl-tpl-section-header"><i class="fas fa-user"></i> Your Templates</div>`;
        html += '<div class="cl-template-grid">';
        for (const tpl of personals) {
          html += `
            <button type="button" class="cl-template-card" data-cl-action="assign-template" data-cl-id="${tpl.id}">
              <i class="fas fa-clipboard-list"></i>
              <strong>${Utils.escapeHtml(tpl.name)}</strong>
              ${tpl.description ? `<small>${Utils.escapeHtml(tpl.description)}</small>` : ''}
            </button>`;
        }
        html += '</div>';
      }
    }

    html += '</div>';

    if (this._currentChecklist?.items?.length) {
      html = `<div class="cl-toolbar"><button type="button" class="btn btn-sm btn-outline" onclick="Checklists._renderChecklist()"><i class="fas fa-arrow-left"></i> Back to Checklist</button></div>` + html;
    }

    container.innerHTML = html;
  },

  // ════════════════════════════════════════════════
  //  IMPORT / EXPORT
  // ════════════════════════════════════════════════
  _exportCurrentChecklist() {
    if (!this._currentChecklist) return;
    const cl = this._currentChecklist;
    const items = cl.items || [];

    let md = '---\n';
    md += `type: loan-checklist\n`;
    md += `name: ${cl.client_name || 'Loan Checklist'}\n`;
    if (cl.source_template_name) md += `sourceTemplateName: ${cl.source_template_name}\n`;
    if (cl.client_name) md += `clientName: ${cl.client_name}\n`;
    md += `loanId: ${cl.source_item_id}\n`;
    md += `sourceType: ${cl.source_type}\n`;
    md += `exportedAt: ${new Date().toISOString()}\n`;
    md += `version: 1\n`;
    md += '---\n\n';
    md += `# ${cl.client_name || 'Loan Checklist'}\n\n`;
    md += '| Name | Status | Date |\n';
    md += '|---|---|---|\n';
    for (const item of items) {
      const status = this._statusLabel(item.status);
      const date = item.date || '';
      md += `| ${item.name.replace(/\|/g, '\\|')} | ${status} | ${date} |\n`;
    }

    const hasSubitems = items.some(i => i.subitems?.length);
    if (hasSubitems) {
      md += '\n## Subitems\n';
      for (const item of items) {
        if (!item.subitems?.length) continue;
        md += `\n### ${item.name}\n`;
        for (const sub of item.subitems) {
          md += `- ${sub.name.replace(/\|/g, '\\|')} | ${this._statusLabel(sub.status)} | ${sub.date || ''}\n`;
        }
      }
    }

    this._downloadFile(md, `checklist-${(cl.client_name || 'export').replace(/\s+/g, '-').toLowerCase()}.md`);
  },

  exportTemplate(template) {
    let md = '---\n';
    md += `type: checklist-template\n`;
    md += `name: ${template.name}\n`;
    if (template.description) md += `description: ${template.description}\n`;
    md += `exportedAt: ${new Date().toISOString()}\n`;
    md += `version: 1\n`;
    md += '---\n\n';
    md += `# ${template.name}\n\n`;
    md += '| Name | Status | Date |\n';
    md += '|---|---|---|\n';
    for (const item of (template.items || [])) {
      md += `| ${item.name.replace(/\|/g, '\\|')} | ${this._statusLabel(item.default_status || item.status)} | |\n`;
    }

    const hasSubitems = (template.items || []).some(i => i.subitems?.length);
    if (hasSubitems) {
      md += '\n## Subitems\n';
      for (const item of template.items) {
        if (!item.subitems?.length) continue;
        md += `\n### ${item.name}\n`;
        for (const sub of item.subitems) {
          md += `- ${sub.name.replace(/\|/g, '\\|')} | ${this._statusLabel(sub.default_status || sub.status)} | ${sub.date || ''}\n`;
        }
      }
    }

    this._downloadFile(md, `template-${template.name.replace(/\s+/g, '-').toLowerCase()}.md`);
  },

  _downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async _importChecklist() {
    const file = await this._pickFile('.md');
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = this._parseMarkdown(text);
      if (!parsed.items.length) {
        Utils.showToast('No checklist items found in the file', 'error');
        return;
      }

      let mode = 'replace';
      if (this._currentChecklist?.items?.length) {
        const choice = await this._promptChoice(
          'Import Checklist',
          `This loan already has ${this._currentChecklist.items.length} checklist items. How would you like to import?`,
          [
            { value: 'merge', label: 'Merge', icon: 'fa-code-branch', desc: 'Add imported items alongside existing ones' },
            { value: 'replace', label: 'Replace', icon: 'fa-exchange-alt', desc: 'Remove existing items and use imported ones' },
          ]
        );
        if (!choice) return;
        mode = choice;
      }

      const src = this._currentSource;
      this._currentChecklist = await ServerAPI.importLoanChecklist(src.type, src.itemId, {
        items: parsed.items,
        mode,
        name: parsed.name,
      });

      this._renderChecklist();
      Utils.showToast(`Imported ${parsed.items.length} items (${mode})`, 'success');
      this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
    } catch (err) {
      Utils.showToast('Import failed: ' + err.message, 'error');
    }
  },

  async importTemplate() {
    const file = await this._pickFile('.md');
    if (!file) return null;

    try {
      const text = await file.text();
      const parsed = this._parseMarkdown(text);
      if (!parsed.items.length) {
        Utils.showToast('No checklist items found in the file', 'error');
        return null;
      }
      return parsed;
    } catch (err) {
      Utils.showToast('Import failed: ' + err.message, 'error');
      return null;
    }
  },

  _pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', () => resolve(input.files[0] || null));
      input.click();
    });
  },

  _parseMarkdown(text) {
    const result = { name: '', items: [], subitems: {} };

    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      if (nameMatch) result.name = nameMatch[1].trim();
    }

    const lines = text.split('\n');
    let inTable = false;
    let inSubitems = false;
    let currentParent = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('| Name') || trimmed.startsWith('|---')) {
        inTable = true;
        continue;
      }

      if (trimmed === '## Subitems') {
        inTable = false;
        inSubitems = true;
        continue;
      }

      if (inSubitems && trimmed.startsWith('### ')) {
        currentParent = trimmed.slice(4).trim();
        continue;
      }

      if (inSubitems && trimmed.startsWith('- ') && currentParent) {
        const parts = trimmed.slice(2).split('|').map(p => p.trim());
        const subName = parts[0]?.replace(/\\\|/g, '|');
        if (subName) {
          if (!result.subitems[currentParent]) result.subitems[currentParent] = [];
          result.subitems[currentParent].push({
            name: subName,
            status: this._parseStatus(parts[1]),
            date: parts[2] || null,
          });
        }
        continue;
      }

      if (inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
        const name = cells[0]?.replace(/\\\|/g, '|');
        if (name && name !== 'Name' && !name.match(/^-+$/)) {
          result.items.push({
            name,
            status: this._parseStatus(cells[1]),
            date: cells[2] || null,
            sort_order: result.items.length,
            subitems: [],
          });
        }
        continue;
      }

      if (inTable && !trimmed) inTable = false;
    }

    for (const item of result.items) {
      const subs = result.subitems[item.name];
      if (subs) item.subitems = subs;
    }

    return result;
  },

  _parseStatus(str) {
    if (!str) return 'not_started';
    const lower = str.toLowerCase().trim();
    if (lower === 'done') return 'done';
    if (lower === 'in progress' || lower === 'in_progress') return 'in_progress';
    if (lower === 'issue') return 'issue';
    if (lower === 'n/a' || lower === 'na') return 'na';
    if (lower === 'not started' || lower === 'not_started') return 'not_started';
    return 'not_started';
  },

  _statusLabel(status) {
    const map = { not_started: 'Not Started', in_progress: 'In Progress', done: 'Done', issue: 'Issue', na: 'N/A' };
    return map[status] || 'Not Started';
  },

  // ════════════════════════════════════════════════
  //  INLINE PROMPT HELPERS (replace native prompt/confirm)
  // ════════════════════════════════════════════════

  _promptInput(title, placeholder, defaultValue) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'cl-prompt-overlay';
      wrap.innerHTML = `
        <div class="cl-prompt">
          <div class="cl-prompt-header"><strong>${Utils.escapeHtml(title)}</strong></div>
          <input type="text" class="cl-prompt-input" value="${Utils.escapeHtml(defaultValue || '')}" placeholder="${Utils.escapeHtml(placeholder || '')}" />
          <div class="cl-prompt-actions">
            <button type="button" class="btn btn-sm btn-outline" data-cl-cancel>Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" data-cl-save>OK</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const input = wrap.querySelector('input');
      input.focus();
      input.select();
      const cleanup = (val) => { wrap.remove(); resolve(val); };
      wrap.querySelector('[data-cl-cancel]').addEventListener('click', () => cleanup(null));
      wrap.querySelector('[data-cl-save]').addEventListener('click', () => {
        const v = input.value.trim();
        cleanup(v || null);
      });
      wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cleanup(null);
        if (e.key === 'Enter') {
          const v = input.value.trim();
          cleanup(v || null);
        }
      });
    });
  },

  _promptConfirm(title, message) {
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

  _promptChoice(title, message, options) {
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

  // ════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════
  _nextStatus(current) {
    const order = ['not_started', 'in_progress', 'done'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  },

  _todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  },

  _promptNoteBody(item) {
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

  _fmtDateTime(value) {
    if (!value) return '';
    const d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    let h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const am = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return `${mm}/${dd}/${yy} ${h}:${min} ${am}`;
  },

  _fmtDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).slice(0, 10).split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      return `${m}/${d}/${y.slice(2)}`;
    }
    return dateStr;
  },

  _isOverdue(dueDateStr) {
    if (!dueDateStr) return false;
    const today = this._todayISO();
    return String(dueDateStr).slice(0, 10) < today;
  },

  _pickDate(anchorEl, currentISO, cb) {
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
      try { input.showPicker(); } catch {}
    }
  },

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

  // ════════════════════════════════════════════════
  //  TEMPLATE MANAGER (Settings panel)
  // ════════════════════════════════════════════════
  async openTemplateManager() {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;

    this._currentSource = null;
    this._currentChecklist = null;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    document.getElementById('clModalTitle').textContent = 'Checklist Templates';
    this._tmContainerId = 'clContent';
    await this._renderTemplateManager();
  },

  async renderTemplateManagerInto(containerId) {
    this._tmContainerId = containerId;
    await this._renderTemplateManager();
  },

  async _renderTemplateManager() {
    const container = document.getElementById(this._tmContainerId || 'clContent');
    if (!container) return;

    container.innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading templates...</div>';

    try {
      this._templates = await ServerAPI.getChecklistTemplates();
    } catch { this._templates = []; }

    const globals = this._templates.filter(t => t.is_global);
    const personals = this._templates.filter(t => !t.is_global);

    let html = `
      <div class="cl-toolbar">
        <div class="cl-toolbar-actions">
          <button type="button" class="btn btn-sm btn-primary" onclick="Checklists._createTemplate()"><i class="fas fa-plus"></i> New Template</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._importTemplateFlow()"><i class="fas fa-file-import"></i> Import .md File</button>
        </div>
      </div>
    `;

    if (globals.length) {
      html += `<div class="cl-tpl-section-header"><i class="fas fa-globe"></i> General Templates <small>(shared, read-only)</small></div>`;
      html += '<div class="cl-template-manager-list">';
      for (const tpl of globals) {
        html += `
          <div class="cl-tpl-row cl-tpl-global">
            <div class="cl-tpl-info">
              <strong><i class="fas fa-lock cl-tpl-lock"></i> ${Utils.escapeHtml(tpl.name)}</strong>
              ${tpl.description ? `<small>${Utils.escapeHtml(tpl.description)}</small>` : ''}
            </div>
            <div class="cl-tpl-actions">
              <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._copyGlobalTemplate(${tpl.id})" title="Copy to your library"><i class="fas fa-copy"></i> Copy</button>
              <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._exportTemplate(${tpl.id})" title="Export as .md"><i class="fas fa-file-export"></i></button>
            </div>
          </div>`;
      }
      html += '</div>';
    }

    html += `<div class="cl-tpl-section-header"><i class="fas fa-user"></i> Your Templates</div>`;
    if (personals.length === 0) {
      html += `
        <div class="cl-empty">
          <i class="fas fa-clipboard-list cl-empty-icon"></i>
          <p>No personal templates yet. Create one, import from a .md file, or copy one of the General Templates above.</p>
        </div>`;
    } else {
      html += '<div class="cl-template-manager-list">';
      for (const tpl of personals) {
        html += `
          <div class="cl-tpl-row">
            <div class="cl-tpl-info">
              <strong>${Utils.escapeHtml(tpl.name)}</strong>
              ${tpl.description ? `<small>${Utils.escapeHtml(tpl.description)}</small>` : ''}
            </div>
            <div class="cl-tpl-actions">
              <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._editTemplate(${tpl.id})" title="Edit"><i class="fas fa-pencil-alt"></i></button>
              <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._exportTemplate(${tpl.id})" title="Export"><i class="fas fa-file-export"></i></button>
              <button type="button" class="btn btn-sm btn-outline btn-danger-outline" onclick="Checklists._deleteTemplate(${tpl.id})" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
      }
      html += '</div>';
    }

    container.innerHTML = html;
  },

  async _copyGlobalTemplate(id) {
    try {
      const source = await ServerAPI.getChecklistTemplate(id);
      const newName = await this._promptInput('Copy Template', 'Name for your copy', source.name + ' (copy)');
      if (!newName) return;
      await ServerAPI.createChecklistTemplate({
        name: newName,
        description: source.description || '',
        items: (source.items || []).map((it, i) => ({
          name: it.name,
          default_status: it.default_status || 'not_started',
          sort_order: i,
          subitems: (it.subitems || []).map((s, j) => ({
            name: s.name,
            default_status: s.default_status || 'not_started',
            sort_order: j,
          })),
        })),
      });
      Utils.showToast('Template copied to your library', 'success');
      await this._renderTemplateManager();
    } catch (err) {
      Utils.showToast('Copy failed: ' + err.message, 'error');
    }
  },

  async _createTemplate() {
    const name = await this._promptInput('New Template', 'Template name');
    if (!name) return;

    try {
      const tpl = await ServerAPI.createChecklistTemplate({ name, items: [] });
      Utils.showToast('Template created!', 'success');
      await this._editTemplate(tpl.id);
    } catch (err) {
      Utils.showToast('Failed: ' + err.message, 'error');
    }
  },

  async _editTemplate(id) {
    const container = document.getElementById(this._tmContainerId || 'clContent');
    if (!container) return;

    container.innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    let template;
    try {
      template = await ServerAPI.getChecklistTemplate(id);
    } catch (err) {
      Utils.showToast('Failed to load template', 'error');
      return this._renderTemplateManager();
    }

    const items = template.items || [];

    let html = `
      <div class="cl-toolbar">
        <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._renderTemplateManager()"><i class="fas fa-arrow-left"></i> Back</button>
        <div class="cl-toolbar-actions">
          <button type="button" class="btn btn-sm btn-primary" id="clSaveTemplate"><i class="fas fa-save"></i> Save</button>
        </div>
      </div>
      <div class="cl-tpl-edit">
        <div class="cl-tpl-edit-header">
          <label>Template Name</label>
          <input type="text" id="clTplName" class="cl-input" value="${Utils.escapeHtml(template.name)}" />
          <label>Description <small>(optional)</small></label>
          <input type="text" id="clTplDesc" class="cl-input" value="${Utils.escapeHtml(template.description || '')}" placeholder="Brief description..." />
        </div>
        <div class="cl-tpl-items-header">
          <h4>Items</h4>
          <button type="button" class="btn btn-sm btn-outline" id="clTplAddItem"><i class="fas fa-plus"></i> Add Item</button>
        </div>
        <div class="cl-tpl-items" id="clTplItemsList">
    `;

    for (let i = 0; i < items.length; i++) {
      html += this._templateItemRow(items[i], i);
    }

    html += '</div></div>';
    container.innerHTML = html;

    document.getElementById('clSaveTemplate').addEventListener('click', async () => {
      const itemRows = container.querySelectorAll('.cl-tpl-item-row');
      const newItems = [];
      itemRows.forEach((row, idx) => {
        const nameInput = row.querySelector('.cl-tpl-item-name');
        const statusSelect = row.querySelector('.cl-tpl-item-status');
        if (nameInput?.value.trim()) {
          const subitems = [];
          row.querySelectorAll('.cl-tpl-subitem-row').forEach((subRow, sIdx) => {
            const subName = subRow.querySelector('.cl-tpl-subitem-name')?.value.trim();
            if (subName) {
              subitems.push({ name: subName, default_status: 'not_started', sort_order: sIdx });
            }
          });
          newItems.push({
            name: nameInput.value.trim(),
            default_status: statusSelect?.value || 'not_started',
            sort_order: idx,
            subitems,
          });
        }
      });

      try {
        await ServerAPI.updateChecklistTemplate(id, {
          name: document.getElementById('clTplName').value.trim() || template.name,
          description: document.getElementById('clTplDesc').value.trim() || null,
          items: newItems,
        });
        Utils.showToast('Template saved!', 'success');
        await this._renderTemplateManager();
      } catch (err) {
        Utils.showToast('Failed: ' + err.message, 'error');
      }
    });

    document.getElementById('clTplAddItem').addEventListener('click', () => {
      const list = document.getElementById('clTplItemsList');
      const idx = list.querySelectorAll('.cl-tpl-item-row').length;
      const temp = document.createElement('div');
      temp.innerHTML = this._templateItemRow({ name: '', default_status: 'not_started', subitems: [] }, idx);
      const row = temp.firstElementChild;
      list.appendChild(row);
      this._bindTemplateItemRow(row);
      row.querySelector('.cl-tpl-item-name')?.focus();
    });

    container.querySelectorAll('.cl-tpl-item-row').forEach(row => this._bindTemplateItemRow(row));
  },

  _templateItemRow(item, idx) {
    const statusOpts = this.STATUS_OPTIONS.map(s =>
      `<option value="${s.value}" ${(item.default_status || item.status) === s.value ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    let html = `
      <div class="cl-tpl-item-row" data-idx="${idx}">
        <div class="cl-tpl-item-main">
          <span class="cl-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
          <input type="text" class="cl-input cl-tpl-item-name" value="${Utils.escapeHtml(item.name)}" placeholder="Item name..." />
          <select class="cl-select cl-tpl-item-status">${statusOpts}</select>
          <button type="button" class="cl-tpl-item-del btn btn-sm btn-outline" title="Delete"><i class="fas fa-times"></i></button>
        </div>
        <div class="cl-tpl-subitems">
    `;

    for (const sub of (item.subitems || [])) {
      html += `
          <div class="cl-tpl-subitem-row">
            <span class="cl-subitem-indent"></span>
            <input type="text" class="cl-input cl-tpl-subitem-name" value="${Utils.escapeHtml(sub.name)}" placeholder="Subitem..." />
            <button type="button" class="cl-tpl-subitem-del btn btn-sm btn-outline" title="Delete"><i class="fas fa-times"></i></button>
          </div>`;
    }

    html += `
          <button type="button" class="cl-tpl-add-subitem btn btn-sm btn-link"><i class="fas fa-plus"></i> Add subitem</button>
        </div>
      </div>`;
    return html;
  },

  _bindTemplateItemRow(row) {
    row.querySelector('.cl-tpl-item-del')?.addEventListener('click', () => row.remove());

    row.querySelector('.cl-tpl-add-subitem')?.addEventListener('click', () => {
      const subsContainer = row.querySelector('.cl-tpl-subitems');
      const addBtn = row.querySelector('.cl-tpl-add-subitem');
      const temp = document.createElement('div');
      temp.innerHTML = `
        <div class="cl-tpl-subitem-row">
          <span class="cl-subitem-indent"></span>
          <input type="text" class="cl-input cl-tpl-subitem-name" placeholder="Subitem..." />
          <button type="button" class="cl-tpl-subitem-del btn btn-sm btn-outline" title="Delete"><i class="fas fa-times"></i></button>
        </div>`;
      const subRow = temp.firstElementChild;
      subsContainer.insertBefore(subRow, addBtn);
      subRow.querySelector('.cl-tpl-subitem-del')?.addEventListener('click', () => subRow.remove());
      subRow.querySelector('.cl-tpl-subitem-name')?.focus();
    });

    row.querySelectorAll('.cl-tpl-subitem-del').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.cl-tpl-subitem-row').remove());
    });
  },

  async _deleteTemplate(id) {
    const confirmed = await this._promptConfirm(
      'Delete Template',
      'Delete this template? This cannot be undone. Existing loan checklists using this template will not be affected.'
    );
    if (!confirmed) return;
    try {
      await ServerAPI.deleteChecklistTemplate(id);
      Utils.showToast('Template deleted', 'success');
      await this._renderTemplateManager();
    } catch (err) {
      Utils.showToast('Failed: ' + err.message, 'error');
    }
  },

  async _exportTemplate(id) {
    try {
      const template = await ServerAPI.getChecklistTemplate(id);
      this.exportTemplate(template);
    } catch (err) {
      Utils.showToast('Failed to export template', 'error');
    }
  },

  async _seedSampleTemplate() {
    const sample = this.SAMPLE_TEMPLATE;
    try {
      await ServerAPI.createChecklistTemplate({
        name: sample.name,
        description: sample.description,
        items: sample.items.map((name, i) => ({
          name,
          default_status: 'not_started',
          sort_order: i,
          subitems: [],
        })),
      });
      Utils.showToast('Sample template created!', 'success');
      await this._renderTemplateManager();
    } catch (err) {
      Utils.showToast('Failed: ' + err.message, 'error');
    }
  },

  async _importTemplateFlow() {
    const parsed = await this.importTemplate();
    if (!parsed) return;

    const name = await this._promptInput('Import Template', 'Template name', parsed.name || 'Imported Template');
    if (!name) return;

    try {
      await ServerAPI.createChecklistTemplate({
        name,
        items: parsed.items.map((item, i) => ({
          name: item.name,
          default_status: item.status || 'not_started',
          sort_order: i,
          subitems: (item.subitems || []).map((s, j) => ({
            name: s.name,
            default_status: s.status || 'not_started',
            sort_order: j,
          })),
        })),
      });
      Utils.showToast('Template imported!', 'success');
      await this._renderTemplateManager();
    } catch (err) {
      Utils.showToast('Failed: ' + err.message, 'error');
    }
  },
};

window.Checklists = Checklists;
