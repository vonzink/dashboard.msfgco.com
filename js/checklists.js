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

  getStatusBadge(sourceType, itemId) {
    const map = this._statusMap[sourceType] || {};
    const info = map[itemId];
    if (!info || info.total === 0) return '';
    const pct = Math.round((info.done / info.total) * 100);
    const cls = pct === 100 ? 'cl-badge-done' : pct > 0 ? 'cl-badge-partial' : 'cl-badge-empty';
    return `<button type="button" class="cl-icon-btn ${cls}" data-cl-source="${sourceType}" data-cl-item="${itemId}" title="Checklist: ${info.done}/${info.total}">
      <i class="fas fa-tasks"></i><span class="cl-badge-count">${info.done}/${info.total}</span>
    </button>`;
  },

  getEmptyBadge(sourceType, itemId) {
    return `<button type="button" class="cl-icon-btn cl-badge-none" data-cl-source="${sourceType}" data-cl-item="${itemId}" title="Add checklist">
      <i class="fas fa-tasks"></i>
    </button>`;
  },

  // ════════════════════════════════════════════════
  //  MODAL OPEN / CLOSE
  // ════════════════════════════════════════════════
  async open(sourceType, sourceItemId, clientName) {
    this._currentSource = { type: sourceType, itemId: sourceItemId, clientName: clientName || '' };
    const modal = document.getElementById('checklistModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    document.getElementById('clModalTitle').textContent = clientName ? `Checklist — ${clientName}` : 'Loan Checklist';
    document.getElementById('clContent').innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
      this._currentChecklist = await ServerAPI.getLoanChecklist(sourceType, sourceItemId);
    } catch (err) {
      this._currentChecklist = null;
    }

    if (this._currentChecklist && this._currentChecklist.items?.length > 0) {
      this._renderChecklist();
    } else {
      await this._renderTemplateSelector();
    }
  },

  close() {
    const modal = document.getElementById('checklistModal');
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    this._currentSource = null;
    this._currentChecklist = null;
  },

  _bindModalEvents() {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;

    modal.querySelector('.cl-modal-close')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });

    // Delegate clicks inside modal content
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cl-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.clAction;
      const id = btn.dataset.clId;
      this._handleAction(action, id, btn);
    });
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
          Utils.showToast('Template applied!', 'success');
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed: ' + err.message, 'error'); }
        break;
      }
      case 'toggle-status': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        const next = this._nextStatus(item.status);
        try {
          await ServerAPI.updateChecklistItem(itemId, { status: next });
          item.status = next;
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to update status', 'error'); }
        break;
      }
      case 'set-status': {
        const itemId = parseInt(btn.dataset.clItemId);
        const newStatus = btn.dataset.clStatus;
        try {
          await ServerAPI.updateChecklistItem(itemId, { status: newStatus });
          const item = this._findItem(itemId);
          if (item) item.status = newStatus;
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
        const name = prompt('New checklist item name:');
        if (!name?.trim()) return;
        try {
          const maxSort = (this._currentChecklist?.items || []).reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
          const newItem = await ServerAPI.addChecklistItem(src.type, src.itemId, {
            name: name.trim(), status: 'not_started', sort_order: maxSort + 1,
          });
          if (!this._currentChecklist) {
            this._currentChecklist = await ServerAPI.getLoanChecklist(src.type, src.itemId);
          } else {
            this._currentChecklist.items.push({ ...newItem, subitems: [] });
          }
          this._renderChecklist();
          this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
        } catch (err) { Utils.showToast('Failed to add item', 'error'); }
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
      case 'set-date': {
        const itemId = parseInt(id);
        const item = this._findItem(itemId);
        if (!item) return;
        const date = prompt('Set date (YYYY-MM-DD):', item.date || '');
        if (date === null) return;
        try {
          await ServerAPI.updateChecklistItem(itemId, { date: date || null });
          item.date = date || null;
          this._renderChecklist();
        } catch (err) { Utils.showToast('Failed to update date', 'error'); }
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
          <button type="button" class="btn btn-sm btn-outline" data-cl-action="import-checklist" title="Import from .md"><i class="fas fa-file-import"></i> Import</button>
          <button type="button" class="btn btn-sm btn-outline" data-cl-action="export-checklist" title="Export as .md"><i class="fas fa-file-export"></i> Export</button>
          <button type="button" class="btn btn-sm btn-outline" data-cl-action="show-template-selector" title="Apply template"><i class="fas fa-clipboard-list"></i> Templates</button>
        </div>
      </div>
      <div class="cl-items-list">
    `;

    for (const item of items) {
      const statusInfo = this.STATUS_OPTIONS.find(s => s.value === item.status) || this.STATUS_OPTIONS[0];
      const dateStr = item.date ? Utils.formatDate(item.date) : '';

      html += `
        <div class="cl-item ${statusInfo.cls}" data-item-id="${item.id}">
          <div class="cl-item-main">
            <button type="button" class="cl-status-btn ${statusInfo.cls}" data-cl-action="toggle-status" data-cl-id="${item.id}" title="${statusInfo.label}">
              <i class="fas ${statusInfo.icon}"></i>
            </button>
            <div class="cl-item-name">${Utils.escapeHtml(item.name)}</div>
            <div class="cl-item-actions">
              ${dateStr ? `<span class="cl-item-date">${dateStr}</span>` : ''}
              <div class="cl-item-menu">
                <button type="button" class="cl-menu-trigger" title="Actions"><i class="fas fa-ellipsis-v"></i></button>
                <div class="cl-menu-dropdown">
                  ${this.STATUS_OPTIONS.map(s => `<button type="button" data-cl-action="set-status" data-cl-item-id="${item.id}" data-cl-status="${s.value}"><i class="fas ${s.icon} ${s.cls}"></i> ${s.label}</button>`).join('')}
                  <hr>
                  <button type="button" data-cl-action="set-date" data-cl-id="${item.id}"><i class="fas fa-calendar-alt"></i> Set Date</button>
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
              ${sub.date ? `<span class="cl-subitem-date">${Utils.formatDate(sub.date)}</span>` : ''}
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

    let html = `
      <div class="cl-template-selector">
        <div class="cl-template-header">
          <h4>Choose a template to get started</h4>
          <div class="cl-template-actions">
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="import-checklist"><i class="fas fa-file-import"></i> Import from File</button>
            <button type="button" class="btn btn-sm btn-outline" data-cl-action="add-item"><i class="fas fa-plus"></i> Start Blank</button>
          </div>
        </div>
    `;

    if (this._templates.length === 0) {
      html += `
        <div class="cl-empty">
          <i class="fas fa-clipboard-list cl-empty-icon"></i>
          <p>No templates yet. Create one in <strong>Settings → Checklist Templates</strong>, import from a file, or start with a blank checklist.</p>
        </div>`;
    } else {
      html += '<div class="cl-template-grid">';
      for (const tpl of this._templates) {
        html += `
          <button type="button" class="cl-template-card" data-cl-action="assign-template" data-cl-id="${tpl.id}">
            <i class="fas fa-clipboard-list"></i>
            <strong>${Utils.escapeHtml(tpl.name)}</strong>
            ${tpl.description ? `<small>${Utils.escapeHtml(tpl.description)}</small>` : ''}
          </button>`;
      }
      html += '</div>';
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
    document.querySelectorAll(`[data-cl-source="${sourceType}"][data-cl-item="${itemId}"]`).forEach(el => {
      const info = (this._statusMap[sourceType] || {})[itemId];
      if (info && info.total > 0) {
        const pct = Math.round((info.done / info.total) * 100);
        el.className = `cl-icon-btn ${pct === 100 ? 'cl-badge-done' : pct > 0 ? 'cl-badge-partial' : 'cl-badge-empty'}`;
        const countEl = el.querySelector('.cl-badge-count');
        if (countEl) countEl.textContent = `${info.done}/${info.total}`;
        el.title = `Checklist: ${info.done}/${info.total}`;
      }
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
    document.body.style.overflow = 'hidden';

    document.getElementById('clModalTitle').textContent = 'Checklist Templates';
    await this._renderTemplateManager();
  },

  async _renderTemplateManager() {
    const container = document.getElementById('clContent');
    if (!container) return;

    container.innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading templates...</div>';

    try {
      this._templates = await ServerAPI.getChecklistTemplates();
    } catch { this._templates = []; }

    let html = `
      <div class="cl-toolbar">
        <div class="cl-toolbar-actions">
          <button type="button" class="btn btn-sm btn-primary" onclick="Checklists._createTemplate()"><i class="fas fa-plus"></i> New Template</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="Checklists._importTemplateFlow()"><i class="fas fa-file-import"></i> Import from File</button>
        </div>
      </div>
    `;

    if (this._templates.length === 0) {
      html += `
        <div class="cl-empty">
          <i class="fas fa-clipboard-list cl-empty-icon"></i>
          <p>No templates yet. Create one, import from a .md file, or start with the sample template below.</p>
          <button type="button" class="btn btn-sm btn-primary" onclick="Checklists._seedSampleTemplate()"><i class="fas fa-magic"></i> Use Sample Loan Processing Checklist</button>
        </div>`;
    } else {
      html += '<div class="cl-template-manager-list">';
      for (const tpl of this._templates) {
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
    const container = document.getElementById('clContent');
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
