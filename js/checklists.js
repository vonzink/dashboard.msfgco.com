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
  _selectedItemId: null,
  _pinnedOpen: false,
  _pinnedMode: 'dock', // 'dock' (locked across top) | 'float' (draggable)
  _pinnedPos: null,    // {left, top} when in float mode

  STATUS_OPTIONS: [
    { value: 'not_started', label: 'Not Started', icon: 'fa-circle', cls: 'cl-status-not-started' },
    { value: 'in_progress', label: 'In Progress', icon: 'fa-spinner', cls: 'cl-status-in-progress' },
    { value: 'submitted',   label: 'Submitted',   icon: 'fa-paper-plane', cls: 'cl-status-submitted' },
    { value: 'done',        label: 'Done',        icon: 'fa-check-circle', cls: 'cl-status-done' },
    { value: 'incomplete',  label: 'Incomplete',  icon: 'fa-exclamation-circle', cls: 'cl-status-incomplete' },
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
    // Restore pinned-panel preference
    try {
      const raw = localStorage.getItem('clPinned');
      if (raw) {
        const saved = JSON.parse(raw);
        this._pinnedOpen = !!saved.open;
        this._pinnedMode = saved.mode === 'float' ? 'float' : 'dock';
        this._pinnedPos = saved.pos || null;
      }
    } catch {}
    this._bindModalEvents();
    this._initPinnedPanel();
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

  // getStatusBadge / getEmptyBadge moved to js/checklists/render.js
  // (mixin via Object.assign at the bottom of this file).

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
    // Restore pinned-menu visibility if user had it open last time. Re-apply
    // the saved mode first so a panel that was re-docked on the previous close
    // floats again when float is the user's preference.
    const panel = document.getElementById('clPinnedPanel');
    if (panel && this._pinnedOpen) {
      this._applyPinnedMode(panel);
      panel.style.display = 'block';
    }
  },

  close() {
    const modal = document.getElementById('checklistModal');
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }
    this._currentSource = null;
    this._currentChecklist = null;
    this._selectedItemId = null;
    this._dragOffset = { x: 0, y: 0 };
    const modalBox = document.querySelector('#checklistModal .cl-modal');
    if (modalBox) modalBox.style.transform = '';
    // Tear down the pinned Menu — in float mode it lives in document.body, so
    // it must be hidden AND re-docked or it lingers after the modal closes.
    this._teardownPinnedPanel();
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

    // (The legacy per-item 3-dot dropdown was removed — the docked/floating
    // pinned Menu panel is the single action surface now.)

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
      'set-assigned-to':       () => this._actionSetAssignedTo(id, btn),
      'set-date':              () => this._actionSetDate(id, btn),
      'set-due-date':          () => this._actionSetDueDate(id, btn),
      'export-checklist':      () => this._exportCurrentChecklist(),
      'import-checklist':      () => this._importChecklist(),
      'show-template-selector':() => this._renderTemplateSelector(),
      'toggle-pinned':         () => this._togglePinnedPanel(),
      'toggle-pinned-mode':    () => this._togglePinnedMode(),
    }[action];

    if (!handler) return;

    try {
      await handler();
    } catch (err) {
      Utils.showToast('Something went wrong: ' + (err.message || 'Unknown error'), 'error');
    }
  },

  // ════════════════════════════════════════════════
  //  ACTION HANDLERS — moved to js/checklists/actions.js and
  //  Object.assign-ed onto Checklists at the bottom of this file.
  //  See window.ChecklistActions.
  // ════════════════════════════════════════════════

  // ════════════════════════════════════════════════
  //  RENDER + targeted DOM updates moved to js/checklists/render.js
  //  (mixin). These shims are intentionally not present in the literal —
  //  the methods land on Checklists via Object.assign(ChecklistRender) at
  //  the bottom of this file. Methods extracted:
  //    _updateItemInPlace, _updateSubitemInPlace, _updateProgressBar,
  //    _renderChecklist, _bindItemDrag, _reorderClientSide,
  //    _reorderItemsDom, _findItem, _findSubitem, _refreshBadgeInTable
  // ════════════════════════════════════════════════
  // Template selector + import/export moved to js/checklists/templates.js
  // (mixin). See window.ChecklistTemplates.

  // Format/status helpers — extracted to js/checklists/format.js.
  // Thin wrappers preserve existing `this._fmtDate(...)` / `this._isOverdue(...)`
  // call sites scattered through this file.
  _parseStatus(str)     { return ChecklistFormat.parseStatus(str); },
  _statusLabel(status)  { return ChecklistFormat.statusLabel(status); },

  // ════════════════════════════════════════════════
  //  INLINE PROMPT HELPERS (replace native prompt/confirm)
  // ════════════════════════════════════════════════

  // Dialog helpers — extracted to js/checklists/dialogs.js. These thin
  // wrappers preserve the previous `this._prompt*` call sites so nothing
  // else in this file had to change.
  _promptInput(title, placeholder, defaultValue) {
    return ChecklistDialogs.promptInput(title, placeholder, defaultValue);
  },
  _promptConfirm(title, message) {
    return ChecklistDialogs.promptConfirm(title, message);
  },
  _promptChoice(title, message, options) {
    return ChecklistDialogs.promptChoice(title, message, options);
  },

  // ════════════════════════════════════════════════
  //  HELPERS — most delegate to ChecklistFormat / ChecklistDialogs
  // ════════════════════════════════════════════════
  _nextStatus(current)               { return ChecklistFormat.nextStatus(current); },
  _todayISO()                        { return ChecklistFormat.todayISO(); },
  _fmtDateTime(value)                { return ChecklistFormat.fmtDateTime(value); },
  _fmtDate(dateStr)                  { return ChecklistFormat.fmtDate(dateStr); },
  _isOverdue(dueDateStr)             { return ChecklistFormat.isOverdue(dueDateStr); },
  _promptNoteBody(item)              { return ChecklistDialogs.promptNoteBody(item); },
  _pickDate(anchorEl, currentISO, cb){ return ChecklistDialogs.pickDate(anchorEl, currentISO, cb); },

  // _findItem / _findSubitem / _refreshBadgeInTable — moved to render.js mixin.

  // Template manager moved to js/checklists/templates.js (mixin).
};

// Mix extracted modules onto the Checklists object. Order matters when
// modules call each other (e.g. actions call render methods via `this.`),
// but Object.assign just copies references — at call-time `this` resolves
// to whatever Checklists holds, so we don't care about assign order, only
// that every module has been registered before the dispatcher runs.
if (window.ChecklistTemplates) Object.assign(Checklists, window.ChecklistTemplates);
else console.error('[Checklists] ChecklistTemplates module did not load.');
if (window.ChecklistRender)    Object.assign(Checklists, window.ChecklistRender);
else console.error('[Checklists] ChecklistRender module did not load.');
if (window.ChecklistPinned)    Object.assign(Checklists, window.ChecklistPinned);
else console.error('[Checklists] ChecklistPinned module did not load.');
if (window.ChecklistActions)   Object.assign(Checklists, window.ChecklistActions);
else console.error('[Checklists] ChecklistActions module did not load.');

window.Checklists = Checklists;
