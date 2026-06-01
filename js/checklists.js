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
    // Restore pinned-menu visibility if user had it open last time
    const panel = document.getElementById('clPinnedPanel');
    if (panel && this._pinnedOpen) panel.style.display = 'block';
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
    // Hide the pinned menu too — in float mode it lives in document.body
    // and would otherwise linger on screen after the checklist closes.
    const panel = document.getElementById('clPinnedPanel');
    if (panel) panel.style.display = 'none';
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
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="import-checklist" title="Upload a previously exported .md checklist file and load it for this loan"><i class="fas fa-file-import"></i> Import .md File</button>
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
            date: this._normalizeImportDate(parts[2]),
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
            date: this._normalizeImportDate(cells[2]),
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

  // Exported dates may be full ISO timestamps (2026-05-28T00:00:00.000Z) or
  // already YYYY-MM-DD. Backend requires YYYY-MM-DD; return null otherwise.
  _normalizeImportDate(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  },

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

  // ════════════════════════════════════════════════
  //  PINNED ACTION PANEL
  //  One floating, draggable menu that operates on whichever
  //  checklist item is currently "selected" (clicked). Avoids
  //  the per-item 3-dot menu when working through many items.
  // ════════════════════════════════════════════════

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
    // Dock the panel above #clContent inside the modal box.
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

    // Row-click selection — delegated, bound ONCE on persistent #clContent
    content.addEventListener('click', (e) => {
      if (!this._pinnedOpen) return;
      if (e.target.closest('button, input, .cl-menu-dropdown, .cl-subitem, .cl-note, .cl-subitem-indent')) return;
      const row = e.target.closest('.cl-item');
      if (!row) return;
      const itemId = parseInt(row.dataset.itemId);
      if (!itemId) return;
      this._selectItem(itemId);
    });

    // First-time render of panel contents
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
      // Reparent back into the modal above #clContent
      if (modalBox && content && panel.parentElement !== modalBox) {
        modalBox.insertBefore(panel, content);
      }
      // Clear inline positioning so CSS takes over
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
    }
    // Update mode-toggle button icon/title
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

  _persistPinned() {
    try {
      localStorage.setItem('clPinned', JSON.stringify({
        open: this._pinnedOpen,
        mode: this._pinnedMode,
        pos: this._pinnedPos,
      }));
    } catch {}
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

  // Shared two-column action grid — used by both the per-item 3-dot
  // dropdown and the pinned panel so the two stay in sync.
  _itemActionsHtml(item) {
    const importance = item.importance || 'normal';
    const assignedTo = item.assigned_to || '';
    const statusBtns = this.STATUS_OPTIONS.map(s =>
      `<button type="button" data-cl-action="set-status" data-cl-item-id="${item.id}" data-cl-status="${s.value}"${s.value === item.status ? ' class="cl-menu-active"' : ''}><i class="fas ${s.icon} ${s.cls}"></i> ${s.label}</button>`
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

// Mix extracted modules onto the Checklists object. Order matters when
// modules call each other (e.g. actions call render methods via `this.`),
// but Object.assign just copies references — at call-time `this` resolves
// to whatever Checklists holds, so we don't care about assign order, only
// that every module has been registered before the dispatcher runs.
if (window.ChecklistRender)  Object.assign(Checklists, window.ChecklistRender);
else console.error('[Checklists] ChecklistRender module did not load.');
if (window.ChecklistActions) Object.assign(Checklists, window.ChecklistActions);
else console.error('[Checklists] ChecklistActions module did not load.');

window.Checklists = Checklists;
