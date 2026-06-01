// Checklist action handlers — extracted from js/checklists.js (audit §2.3).
//
// These are intentionally stateful: every handler reads/writes
// this._currentChecklist, this._currentSource, calls this._renderChecklist(),
// etc. We keep `this` semantics by exposing the handlers on a plain object
// and Object.assign-ing them onto the Checklists object at boot. From the
// dispatcher's point of view, nothing changes — these still appear as
// Checklists._actionXxx methods.
//
// Depends on (globals, set up elsewhere):
//   ServerAPI                — HTTP client
//   Utils.showToast          — toast notifications
// Depends on (sibling Checklists methods, expected after Object.assign):
//   this._currentChecklist, this._currentSource, this._selectedItemId
//   this._renderChecklist(), this._updateItemInPlace(), this._updateSubitemInPlace(),
//   this._updateProgressBar(), this._reorderClientSide(), this._reorderItemsDom()
//   this._findItem(), this._findSubitem()
//   this._promptInput(), this._promptConfirm(), this._promptNoteBody(),
//   this._pickDate(), this._pickFile()
//   this._nextStatus(), this._todayISO()
//   this.close(), this.loadStatusBadges(), this._refreshBadgeInTable()
//
// Exposes: window.ChecklistActions

(function () {
  const ChecklistActions = {
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
        Utils.showToast('Failed to update status: ' + (err.message || ''), 'error');
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

      try {
        await ServerAPI.updateChecklistItem(itemId, payload);
        this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
      } catch (err) {
        item.status = prevStatus;
        item.date = prevDate;
        this._updateItemInPlace(itemId);
        this._updateProgressBar();
        Utils.showToast('Failed to update: ' + (err.message || ''), 'error');
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
        Utils.showToast('Failed to update: ' + (err.message || ''), 'error');
      }
    },

    async _actionDeleteItem(id, src) {
      const itemId = parseInt(id);
      const confirmed = await this._promptConfirm('Delete Item', 'Delete this checklist item?');
      if (!confirmed) return;
      try {
        await ServerAPI.deleteChecklistItem(itemId);
        this._currentChecklist.items = this._currentChecklist.items.filter(i => i.id !== itemId);
        if (this._selectedItemId === itemId) this._selectedItemId = null;
        this._renderChecklist();
        this.loadStatusBadges(src.type).then(() => this._refreshBadgeInTable(src.type, src.itemId));
      } catch (err) { Utils.showToast('Failed to delete: ' + (err.message || ''), 'error'); }
    },

    async _actionDeleteSubitem(id) {
      const subId = parseInt(id);
      try {
        await ServerAPI.deleteChecklistSubitem(subId);
        for (const item of (this._currentChecklist?.items || [])) {
          item.subitems = (item.subitems || []).filter(s => s.id !== subId);
        }
        this._renderChecklist();
      } catch (err) { Utils.showToast('Failed to delete: ' + (err.message || ''), 'error'); }
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
      } catch (err) { Utils.showToast('Failed to add item: ' + (err.message || ''), 'error'); }
    },

    async _actionMakeFromPdf(src) {
      const file = await this._pickFile('.pdf,application/pdf');
      if (!file) return;
      Utils.showToast('Parsing PDF…');
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
      } catch (err) { Utils.showToast('Failed to add subitem: ' + (err.message || ''), 'error'); }
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
      } catch (err) { Utils.showToast('Failed to delete note: ' + (err.message || ''), 'error'); }
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
      } catch (err) { Utils.showToast('Failed to update: ' + (err.message || ''), 'error'); }
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
        this._updateItemInPlace(itemId);
        this._reorderItemsDom();
      } catch (err) { Utils.showToast('Failed to set importance: ' + (err.message || ''), 'error'); }
    },

    async _actionSetAssignedTo(id, btn) {
      const itemId = parseInt(id);
      const newVal = btn.dataset.clAssignedTo || null;
      const item = this._findItem(itemId);
      if (!item) return;

      try {
        await ServerAPI.updateChecklistItem(itemId, { assigned_to: newVal });
        item.assigned_to = newVal;
        this._updateItemInPlace(itemId);
      } catch (err) { Utils.showToast('Failed to set assignment: ' + (err.message || ''), 'error'); }
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
        } catch (err) { Utils.showToast('Failed to update date: ' + (err.message || ''), 'error'); }
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
        } catch (err) { Utils.showToast('Failed to update due date: ' + (err.message || ''), 'error'); }
      });
    },
  };

  window.ChecklistActions = ChecklistActions;
})();
