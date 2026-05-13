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

  /**
   * Render the inline icon row for a loan: up to 3 existing-checklist badges
   * plus a "+" button to add another (if under the cap). The status map now
   * holds an ARRAY per source_item_id, one entry per checklist.
   */
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

  /** Legacy no-op kept for back-compat with existing call sites in pipeline.js
   *  and pre-approvals.js. getStatusBadge now always renders the full row. */
  getEmptyBadge() { return ''; },

  // ════════════════════════════════════════════════
  //  MODAL OPEN / CLOSE
  // ════════════════════════════════════════════════
  /** Open a specific checklist by id. */
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

  /** Open the template picker to add a new checklist on this loan. */
  async openForNew(sourceType, sourceItemId, clientName) {
    this._currentSource = { type: sourceType, itemId: sourceItemId, clientName: clientName || '' };
    this._currentChecklist = null;
    this._openModalChrome(clientName);
    await this._renderTemplateSelector();
  },

  /** Back-compat: open the first checklist on this loan (or template picker
   *  if none exist). Prefer openById / openForNew for new code. */
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
    // Reset drag offset for next open
    this._dragOffset = { x: 0, y: 0 };
    const modalBox = document.querySelector('#checklistModal .cl-modal');
    if (modalBox) modalBox.style.transform = '';
  },

  _bindModalEvents() {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;

    modal.querySelector('.cl-modal-close')?.addEventListener('click', () => this.close());
    // Floating panel: outside click DOES NOT close — the overlay is
    // pointer-events: none anyway, but be explicit for clarity.

    // Delegate clicks inside modal content
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cl-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.clAction;
      const id = btn.dataset.clId;
      this._handleAction(action, id, btn);
    });

    this._bindDragHandle();
  },

  /** Click-and-drag the modal by its header. Persists offset across renders. */
  _dragOffset: { x: 0, y: 0 },
  _bindDragHandle() {
    const header = document.querySelector('#checklistModal .cl-modal-header');
    const modalBox = document.querySelector('#checklistModal .cl-modal');
    if (!header || !modalBox) return;

    let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;

    const onDown = (e) => {
      // Don't start drag on close button
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

  async _handleAction(action, id, btn) {
    const src = this._currentSource;
    if (!src) return;

    switch (action) {
      case 'assign-template': {
        const templateId = parseInt(id);
        if (!templateId) return;
        try {
          this._currentChecklist = await ServerAPI.assignChecklistTemplate(src.type, src.itemId, templateId);
          this._renderChecklist();
          Utils.showToast('Checklist added!', 'success');
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed: ' + err.message, 'error'); }
        break;
      }
      case 'rename-checklist': {
        if (!this._currentChecklist) return;
        const newName = prompt('Rename this checklist:', this._currentChecklist.name || '');
        if (newName === null) return;
        const name = newName.trim();
        if (!name) return;
        try {
          await ServerAPI.renameLoanChecklist(this._currentChecklist.id, name);
          this._currentChecklist.name = name;
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Rename failed: ' + err.message, 'error'); }
        break;
      }
      case 'delete-checklist': {
        if (!this._currentChecklist) return;
        if (!confirm(`Delete the checklist "${this._currentChecklist.name || 'this checklist'}"? This cannot be undone.`)) return;
        try {
          await ServerAPI.deleteLoanChecklist(this._currentChecklist.id);
          this._currentChecklist = null;
          this.close();
          Utils.showToast('Checklist deleted', 'success');
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Delete failed: ' + err.message, 'error'); }
        break;
      }
      case 'toggle-status': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        const next = this._nextStatus(item.status);
        // Auto-stamp completion date when transitioning to done.
        const payload = { status: next };
        if (next === 'done' && !item.date) payload.date = this._todayISO();
        // Clear date when status goes back from done to in-progress/not_started.
        if (next !== 'done' && item.status === 'done' && item.date) payload.date = null;
        try {
          await ServerAPI.updateChecklistItem(itemId, payload);
          item.status = next;
          if (payload.date !== undefined) item.date = payload.date;
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to update status', 'error'); }
        break;
      }
      case 'set-status': {
        const itemId = parseInt(btn.dataset.clItemId);
        const newStatus = btn.dataset.clStatus;
        const item = this._findItem(itemId);
        const payload = { status: newStatus };
        if (newStatus === 'done' && item && !item.date) payload.date = this._todayISO();
        if (newStatus !== 'done' && item?.status === 'done' && item.date) payload.date = null;
        try {
          await ServerAPI.updateChecklistItem(itemId, payload);
          if (item) {
            item.status = newStatus;
            if (payload.date !== undefined) item.date = payload.date;
          }
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to update', 'error'); }
        break;
      }
      case 'set-subitem-status': {
        const subId = parseInt(btn.dataset.clSubId);
        const newStatus = btn.dataset.clStatus;
        try {
          await ServerAPI.updateChecklistSubitem(subId, { status: newStatus });
          const sub = this._findSubitem(subId);
          if (sub) sub.status = newStatus;
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to update', 'error'); }
        break;
      }
      case 'delete-item': {
        const itemId = parseInt(id);
        if (!confirm('Delete this checklist item?')) return;
        try {
          await ServerAPI.deleteChecklistItem(itemId);
          this._currentChecklist.items = this._currentChecklist.items.filter(i => i.id !== itemId);
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to delete', 'error'); }
        break;
      }
      case 'delete-subitem': {
        const subId = parseInt(id);
        try {
          await ServerAPI.deleteChecklistSubitem(subId);
          for (const item of (this._currentChecklist?.items || [])) {
            item.subitems = (item.subitems || []).filter(s => s.id !== subId);
          }
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to delete', 'error'); }
        break;
      }
      case 'add-item': {
        // If no checklist is open yet (e.g. from the template selector's "Start Blank"),
        // create an empty one first, then add the typed item to it.
        if (!this._currentChecklist) {
          const clName = prompt('Name this new checklist:', 'Custom Checklist');
          if (clName === null) return;
          const itemName = prompt('First item name:');
          if (!itemName?.trim()) return;
          try {
            this._currentChecklist = await ServerAPI.importLoanChecklist(src.type, src.itemId, {
              items: [{ name: itemName.trim(), status: 'not_started', sort_order: 0 }],
              name: clName.trim() || 'Custom Checklist',
            });
            this._renderChecklist();
            this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
          } catch (err) { Utils.showToast('Failed: ' + err.message, 'error'); }
          break;
        }
        const name = prompt('New checklist item name:');
        if (!name?.trim()) return;
        try {
          const maxSort = (this._currentChecklist.items || []).reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
          const newItem = await ServerAPI.addChecklistItem(this._currentChecklist.id, {
            name: name.trim(), status: 'not_started', sort_order: maxSort + 1,
          });
          this._currentChecklist.items.push({ ...newItem, subitems: [] });
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to add item', 'error'); }
        break;
      }
      case 'make-from-pdf': {
        // File picker → upload → create file-local checklist
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
        break;
      }
      case 'add-subitem': {
        const itemId = parseInt(id);
        const name = prompt('New subitem name:');
        if (!name?.trim()) return;
        try {
          const newSub = await ServerAPI.addChecklistSubitem(itemId, { name: name.trim() });
          const item = this._findItem(itemId);
          if (item) {
            if (!item.subitems) item.subitems = [];
            item.subitems.push(newSub);
          }
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to add subitem', 'error'); }
        break;
      }
      case 'edit-item': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        const name = prompt('Edit item name:', item.name);
        if (!name?.trim() || name.trim() === item.name) return;
        try {
          await ServerAPI.updateChecklistItem(itemId, { name: name.trim() });
          item.name = name.trim();
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to update', 'error'); }
        break;
      }
      case 'set-importance': {
        const itemId = parseInt(id);
        const newImp = btn.dataset.clImportance;
        const item = this._findItem(itemId);
        if (!item) return;
        try {
          await ServerAPI.updateChecklistItem(itemId, { importance: newImp });
          item.importance = newImp;
          // Re-sort: urgent first, then by stored sort_order
          this._reorderClientSide();
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to set importance', 'error'); }
        break;
      }
      case 'set-date': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        this._pickDate(btn, item.date || '', async (newDate) => {
          try {
            await ServerAPI.updateChecklistItem(itemId, { date: newDate || null });
            item.date = newDate || null;
            this._renderChecklist();
          } catch (err) { Utils.showToast('Failed to update date', 'error'); }
        });
        break;
      }
      case 'set-due-date': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        this._pickDate(btn, item.due_date || '', async (newDate) => {
          try {
            await ServerAPI.updateChecklistItem(itemId, { due_date: newDate || null });
            item.due_date = newDate || null;
            this._renderChecklist();
          } catch (err) { Utils.showToast('Failed to update due date', 'error'); }
        });
        break;
      }
      case 'export-checklist': {
        this._exportCurrentChecklist();
        break;
      }
      case 'import-checklist': {
        this._importChecklist();
        break;
      }
      case 'show-template-selector': {
        await this._renderTemplateSelector();
        break;
      }
    }
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

    // Show "<Client> — <Checklist Name>" in the modal title so the user knows
    // which of the (up to 3) checklists is currently open.
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

      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Toggle menus
    container.querySelectorAll('.cl-menu-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = trigger.nextElementSibling;
        const wasOpen = dd.classList.contains('open');
        container.querySelectorAll('.cl-menu-dropdown.open').forEach(d => d.classList.remove('open'));
        if (!wasOpen) dd.classList.add('open');
      });
    });

    document.addEventListener('click', () => {
      container.querySelectorAll('.cl-menu-dropdown.open').forEach(d => d.classList.remove('open'));
    }, { once: true });

    // Drag-to-reorder
    this._bindItemDrag(container);
  },

  /**
   * HTML5 drag-and-drop for reordering items within the active checklist.
   * Disallows dragging across the urgent/non-urgent boundary — urgent items
   * are sticky at the top.
   */
  _bindItemDrag(container) {
    let dragId = null;
    container.querySelectorAll('.cl-item').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        // Don't initiate drag from interactive controls
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
        // Block cross-boundary drops: urgent must stay above non-urgent
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

        // Reorder in memory
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        // Re-stamp sort_order based on new array position (urgents keep
        // their own contiguous indexes; service-side sort handles the rest)
        for (let i = 0; i < items.length; i++) items[i].sort_order = i;
        this._renderChecklist();

        // Persist
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

  /** Sort the in-memory items array urgent-first, then by sort_order. */
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
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="add-item"><i class="fas fa-plus"></i> Start Blank</button>
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

    // If there's an existing checklist, add a back button
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
        const choice = prompt(
          `This loan already has ${this._currentChecklist.items.length} checklist items.\n\nType "merge" to merge, "replace" to replace, or cancel:`,
          'merge'
        );
        if (!choice) return;
        mode = choice.toLowerCase().includes('merge') ? 'merge' : 'replace';
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

    // Parse YAML frontmatter
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      if (nameMatch) result.name = nameMatch[1].trim();
    }

    // Parse table rows
    const lines = text.split('\n');
    let inTable = false;
    let inSubitems = false;
    let currentParent = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Table header detection
      if (trimmed.startsWith('| Name') || trimmed.startsWith('|---')) {
        inTable = true;
        continue;
      }

      // Subitems section
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

      // Table row
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

      // Blank line ends table
      if (inTable && !trimmed) inTable = false;
    }

    // Attach subitems to items
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
  //  HELPERS
  // ════════════════════════════════════════════════
  _nextStatus(current) {
    const order = ['not_started', 'in_progress', 'done'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  },

  /** Today's date in YYYY-MM-DD (local time). */
  _todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  },

  /** Display dates as MM/DD/YY. Input is YYYY-MM-DD (DB shape). */
  _fmtDate(dateStr) {
    if (!dateStr) return '';
    // Parse the YYYY-MM-DD parts directly to avoid timezone shift.
    const parts = String(dateStr).slice(0, 10).split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      return `${m}/${d}/${y.slice(2)}`;
    }
    return dateStr;
  },

  /** True if a due_date is in the past (not including today). */
  _isOverdue(dueDateStr) {
    if (!dueDateStr) return false;
    const today = this._todayISO();
    return String(dueDateStr).slice(0, 10) < today;
  },

  /**
   * Show a native date picker positioned near a trigger element, then
   * call cb(isoDate) when the user picks a date. Pass empty string to clear.
   */
  _pickDate(anchorEl, currentISO, cb) {
    // Create a transient <input type="date"> positioned over the anchor.
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
      try { input.showPicker(); } catch { /* showPicker requires user gesture */ }
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

  /**
   * Re-render the whole .cl-badges row for a single loan row in any table
   * (pipeline / pre-approvals) after the status map has been reloaded.
   * Rebuilds the row from getStatusBadge() and re-wires the click handlers
   * via a fresh dispatch on the row's table.
   */
  _refreshBadgeInTable(sourceType, itemId) {
    document.querySelectorAll(`.cl-badges`).forEach(wrap => {
      // Any badge inside identifies this wrapper's loan
      const probe = wrap.querySelector('[data-cl-item]');
      if (!probe) return;
      if (probe.dataset.clSource !== sourceType) return;
      if (parseInt(probe.dataset.clItem) !== itemId) return;
      // Re-render and bind clicks
      const wrapper = document.createElement('div');
      wrapper.innerHTML = this.getStatusBadge(sourceType, itemId);
      const fresh = wrapper.firstElementChild;
      if (!fresh) return;
      // Wire new badge buttons to the same handler the table uses
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
    // Floating panel — no body scroll lock.

    document.getElementById('clModalTitle').textContent = 'Checklist Templates';
    this._tmContainerId = 'clContent';
    await this._renderTemplateManager();
  },

  /** Public entry point used by user-settings.js to render the template
   *  manager inline inside the Settings → Checklists tab. */
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

  /** Copy a global template into the user's personal library so they can edit it. */
  async _copyGlobalTemplate(id) {
    try {
      const source = await ServerAPI.getChecklistTemplate(id);
      const newName = prompt('Name for your copy:', source.name + ' (copy)');
      if (!newName?.trim()) return;
      await ServerAPI.createChecklistTemplate({
        name: newName.trim(),
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
    const name = prompt('Template name:');
    if (!name?.trim()) return;

    try {
      const tpl = await ServerAPI.createChecklistTemplate({ name: name.trim(), items: [] });
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

    // Bind save
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

    // Bind add item
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

    // Bind existing rows
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
    if (!confirm('Delete this template? This cannot be undone. Existing loan checklists using this template will not be affected.')) return;
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

    const name = prompt('Template name:', parsed.name || 'Imported Template');
    if (!name?.trim()) return;

    try {
      await ServerAPI.createChecklistTemplate({
        name: name.trim(),
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
