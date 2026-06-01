// Checklist template manager + import/export — extracted from
// js/checklists.js (audit §2.3). Mixin pattern: Object.assign-ed onto
// the Checklists object so `this` semantics are unchanged.
//
// Covers three related surfaces (kept together because they share the
// markdown serializer and ServerAPI methods):
//   1. Template selector shown when a loan has no checklist yet.
//   2. Template manager UI in settings (CRUD personal templates,
//      copy global templates, edit/save/import/export).
//   3. Import/export of loan checklists as .md files.
//
// Depends on (globals): ServerAPI, Utils.escapeHtml, Utils.showToast
// Depends on (sibling Checklists state, present after Object.assign):
//   this._templates, this._currentChecklist, this._currentSource,
//   this._tmContainerId, this.STATUS_OPTIONS, this.SAMPLE_TEMPLATE,
//   this._promptInput(), this._promptConfirm(), this._promptChoice(),
//   this._renderChecklist(), this.loadStatusBadges(),
//   this._refreshBadgeInTable(), this._statusLabel(), this._parseStatus()
//
// Exposes: window.ChecklistTemplates

(function () {
  const ChecklistTemplates = {

    // ─── Template selector (shown when loan has no checklist yet)

    async _renderTemplateSelector() {
      const container = document.getElementById('clContent');
      if (!container) return;

      container.innerHTML = '<div class="cl-loading"><i class="fas fa-spinner fa-spin"></i> Loading templates...</div>';

      try {
        this._templates = await ServerAPI.getChecklistTemplates();
      } catch (_) { this._templates = []; }

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

    // ─── Import / export of loan checklists

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

    // PUBLIC — called by user-settings.js for "export template" button
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

    // PUBLIC — used by _importTemplateFlow + possibly external callers
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

    // Exported dates may be full ISO timestamps or already YYYY-MM-DD.
    // Backend requires YYYY-MM-DD; return null otherwise.
    _normalizeImportDate(str) {
      if (!str) return null;
      const m = String(str).trim().match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    },

    // ─── Template manager (settings panel)

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
      } catch (_) { this._templates = []; }

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

  window.ChecklistTemplates = ChecklistTemplates;
})();
