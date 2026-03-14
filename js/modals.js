/* ============================================
   MSFG Dashboard - Modals & Forms
   Support ticket, notifications, announcements
   Step 5 compatible with a11y.js
   ============================================ */

const ModalsManager = {
  // ========================================
  // INITIALIZATION
  // ========================================
  init() {
    this.bindSupportTicketModal();
    this.bindNotificationsModal();
    this.bindAnnouncementModal();

    this.bindGlobalEscapeClose();      // ✅ single ESC handler
    this.bindDeleteButtons();          // ✅ delegated delete handler
    this.bindEmbedToggles();           // ✅ iframe preview toggle + resize
    this.loadAnnouncements();
  },

  // ========================================
  // GLOBAL ESC HANDLER (single source of truth)
  // ========================================
  bindGlobalEscapeClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      // Close the top-most modal (priority order)
      // Investor modals (company contacts sits on top of investor detail)
      if (this.isModalActive('companyContactsModal')) {
        if (typeof Investors !== 'undefined') Investors.hideCompanyContactsModal();
        return;
      }
      if (this.isModalActive('investorModal')) {
        if (typeof Investors !== 'undefined') Investors.hideModal();
        return;
      }
      if (this.isModalActive('announcementDetailOverlay')) {
        this.hideAnnouncementDetail();
        return;
      }
      if (this.isModalActive('addAnnouncementModal')) {
        this.hideAnnouncementModal();
        return;
      }
      if (this.isModalActive('notificationsModal')) {
        this.hideNotificationsModal();
        return;
      }
      if (this.isModalActive('supportTicketModal')) {
        this.hideSupportTicketModal();
      }
    });
  },

  isModalActive(modalId) {
    const modal = document.getElementById(modalId);
    return !!modal && modal.classList.contains('active');
  },

  // ========================================
  // DELETE BUTTONS (delegation)
  // ========================================
  bindDeleteButtons() {
    document.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.news-delete-btn');
      if (!deleteBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const announcementId = Number(deleteBtn.dataset.id);
      if (Number.isFinite(announcementId) && announcementId > 0) {
        this.deleteAnnouncement(announcementId);
      }
    });
  },

  // ========================================
  // SUPPORT TICKET MODAL
  // ========================================
  bindSupportTicketModal() {
    const modal = document.getElementById('supportTicketModal');
    if (!modal) return;

    // Close button
    const closeBtn = modal.querySelector('.support-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideSupportTicketModal());
    }

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideSupportTicketModal();
    });

    // NOTE:
    // Opening is handled by action-dispatcher.js calling showSupportTicketModal()
    // ARIA + focus trap are handled by a11y.js observing .active
  },

  showSupportTicketModal() {
    const modal = document.getElementById('supportTicketModal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Optional animation (works fine with CSP; a11y doesn't care)
    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideSupportTicketModal() {
    const modal = document.getElementById('supportTicketModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  // ========================================
  // NOTIFICATIONS MODAL
  // ========================================
  bindNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    // Close buttons
    modal.querySelectorAll('.notifications-modal-close').forEach((btn) => {
      btn.addEventListener('click', () => this.hideNotificationsModal());
    });

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideNotificationsModal();
    });

    // Toggle add form
    document.getElementById('notifToggleFormBtn')?.addEventListener('click', () => {
      const form = document.getElementById('notificationForm');
      const btn = document.getElementById('notifToggleFormBtn');
      if (form) {
        form.style.display = 'flex';
        btn.style.display = 'none';
        // Set default date to today
        const dateInput = document.getElementById('notificationDate');
        if (dateInput) {
          const today = new Date().toISOString().split('T')[0];
          dateInput.value = today;
          dateInput.min = today;
        }
      }
    });

    document.getElementById('notifCancelFormBtn')?.addEventListener('click', () => {
      const form = document.getElementById('notificationForm');
      const btn = document.getElementById('notifToggleFormBtn');
      if (form) { form.style.display = 'none'; form.reset(); }
      if (btn) btn.style.display = 'flex';
    });

    // Form submission
    const form = document.getElementById('notificationForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleNotificationSubmit();
      });
    }
  },

  showNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);

    // Reset form visibility
    const form = document.getElementById('notificationForm');
    const btn = document.getElementById('notifToggleFormBtn');
    if (form) { form.style.display = 'none'; form.reset(); }
    if (btn) btn.style.display = 'flex';

    // Load existing notifications
    this.loadNotificationsList();
  },

  hideNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  async loadNotificationsList() {
    const container = document.getElementById('notificationsList');
    if (!container) return;

    container.innerHTML = '<div class="settings-loading" style="padding:24px;text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
      const userId = CONFIG?.currentUser?.id;
      const notifications = await ServerAPI.get(`/notifications${userId ? '?user_id=' + userId : ''}`);

      if (!notifications || notifications.length === 0) {
        container.innerHTML = '<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>No reminders set up yet.</p></div>';
        return;
      }

      const esc = Utils.escapeHtml;
      const now = new Date();

      container.innerHTML = notifications.map(n => {
        const reminderDate = new Date(n.reminder_date + 'T' + (n.reminder_time || '00:00'));
        const isPast = reminderDate < now;
        const isSent = n.sent;
        const dateStr = reminderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = reminderDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const delivery = n.delivery_method || 'email';
        const recurrence = n.recurrence || 'none';

        return `
          <div class="notif-item ${isSent ? 'notif-sent' : ''}">
            <div class="notif-icon ${isSent ? 'notif-done' : 'notif-pending'}">
              <i class="fas ${isSent ? 'fa-check' : isPast ? 'fa-exclamation' : 'fa-bell'}"></i>
            </div>
            <div class="notif-body">
              <div class="notif-note">${esc(n.note)}</div>
              <div class="notif-meta">
                <span><i class="fas fa-calendar"></i> ${dateStr}</span>
                <span><i class="fas fa-clock"></i> ${timeStr}</span>
                ${delivery === 'email' || delivery === 'both' ? '<span class="notif-badge badge-email">Email</span>' : ''}
                ${delivery === 'text' || delivery === 'both' ? '<span class="notif-badge badge-text">Text</span>' : ''}
                ${recurrence !== 'none' ? `<span class="notif-badge badge-recur"><i class="fas fa-redo"></i> ${esc(recurrence)}</span>` : ''}
              </div>
            </div>
            <button type="button" class="notif-delete" data-id="${n.id}" title="Delete"><i class="fas fa-trash-alt"></i></button>
          </div>
        `;
      }).join('');

      // Bind delete buttons
      container.querySelectorAll('.notif-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this reminder?')) return;
          try {
            await ServerAPI.delete(`/notifications/${btn.dataset.id}`);
            this.loadNotificationsList();
          } catch (err) {
            Utils.showToast('Failed to delete: ' + err.message, 'error');
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<div class="notif-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load notifications.</p></div>';
    }
  },

  async handleNotificationSubmit() {
    const dateEl = document.getElementById('notificationDate');
    const timeEl = document.getElementById('notificationTime');
    const noteEl = document.getElementById('notificationNote');
    const deliveryEl = document.getElementById('notifDelivery');
    const recurrenceEl = document.getElementById('notifRecurrence');

    const date = dateEl?.value || '';
    const time = timeEl?.value || '';
    const note = noteEl?.value || '';
    const delivery = deliveryEl?.value || 'email';
    const recurrence = recurrenceEl?.value || 'none';

    if (!date || !time || !note) {
      Utils.showToast('Please complete date, time, and note.', 'error');
      return;
    }

    const userId = CONFIG?.currentUser?.id || 1;

    try {
      await ServerAPI.post('/notifications', {
        user_id: userId,
        reminder_date: date,
        reminder_time: time,
        note,
        delivery_method: delivery,
        recurrence,
      });
      Utils.showToast('Reminder saved!', 'success');
      // Hide form, reload list
      const form = document.getElementById('notificationForm');
      const btn = document.getElementById('notifToggleFormBtn');
      if (form) { form.style.display = 'none'; form.reset(); }
      if (btn) btn.style.display = 'flex';
      this.loadNotificationsList();
    } catch (err) {
      Utils.showToast('Failed to save: ' + err.message, 'error');
    }
  },

  // ========================================
  // ADD ANNOUNCEMENT MODAL
  // ========================================
  bindAnnouncementModal() {
    const modal = document.getElementById('addAnnouncementModal');
    if (!modal) return;

    // Close buttons
    const closeBtns = modal.querySelectorAll('.announcement-modal-close');
    closeBtns.forEach((btn) => {
      btn.addEventListener('click', () => this.hideAnnouncementModal());
    });

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideAnnouncementModal();
    });

    // Form submission
    const form = document.getElementById('announcementForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAnnouncementSubmit();
      });
    }

    // File input handling
    const fileInput = document.getElementById('announcementFile');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        this.handleFileSelection(e.target);
      });
    }

    // NOTE:
    // Opening is handled by action-dispatcher.js calling showAnnouncementModal()
    // ARIA + focus trap are handled by a11y.js
  },

  showAnnouncementModal() {
    const modal = document.getElementById('addAnnouncementModal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideAnnouncementModal() {
    const modal = document.getElementById('addAnnouncementModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';

      const form = document.getElementById('announcementForm');
      if (form) {
        form.reset();
        // Reset rich text editor
        const editor = document.getElementById('announcementContent');
        if (editor && editor.getAttribute('contenteditable')) editor.innerHTML = '';
        // Reset char counter
        const charCount = document.getElementById('annCharCount');
        if (charCount) charCount.textContent = '0 / 5,000';
        // Reset file dropzone
        const dropContent = document.getElementById('annDropzoneContent');
        const filePreview = document.getElementById('annFilePreview');
        if (dropContent) dropContent.style.display = '';
        if (filePreview) filePreview.style.display = 'none';
      }
    }, 200);
  },

  handleFileSelection(input) {
    const file = input && input.files ? input.files[0] : null;
    const label = input?.parentElement?.querySelector('.file-input-label');

    if (!label) return;

    if (file) {
      label.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
    } else {
      label.textContent = 'Choose file or drag and drop';
    }
  },

  async handleAnnouncementSubmit() {
    const titleEl = document.getElementById('announcementTitle');
    const contentEl = document.getElementById('announcementContent');
    const linkEl = document.getElementById('announcementLink');
    const iconEl = document.getElementById('announcementIcon');
    const fileInput = document.getElementById('announcementFile');

    const title = titleEl ? titleEl.value : '';
    // Rich text editor uses contenteditable div — grab innerHTML
    const content = contentEl ? (contentEl.getAttribute('contenteditable') ? contentEl.innerHTML.trim() : contentEl.value) : '';
    const link = linkEl ? linkEl.value : '';
    const icon = iconEl ? iconEl.value : '';
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    // Check if editor is truly empty (strip tags for validation)
    const plainText = contentEl ? contentEl.innerText.trim() : '';
    if (!title || !plainText) {
      alert('Please provide a title and content.');
      return;
    }

    if (plainText.length > 5000) {
      alert('Content exceeds 5,000 character limit. Please shorten your announcement.');
      return;
    }

    const cfg = window.MSFG_CONFIG || window.CONFIG || {};
    const authorName = cfg?.currentUser?.name || 'User';

    const announcement = {
      title,
      content,
      link: link || null,
      icon: icon || null,
      author: authorName,
      createdAt: new Date().toISOString(),
      file_s3_key: null,
      fileName: null,
      fileSize: null,
      fileType: null
    };

    if (file) {
      this.uploadFileAndSaveAnnouncement(file, announcement);
    } else {
      this.saveAnnouncement(announcement);
    }
  },

  async uploadFileAndSaveAnnouncement(file, announcement) {
    try {
      const uploadData = await ServerAPI.getUploadUrl(file.name, file.type, file.size);
      await ServerAPI.uploadToS3(uploadData.uploadUrl, file);

      announcement.file_s3_key = uploadData.fileKey;
      announcement.fileName = file.name;
      announcement.fileSize = file.size;
      announcement.fileType = file.type;

      this.saveAnnouncement(announcement);
    } catch (error) {
      console.error('File upload failed:', error);
      alert('File upload failed. Saving announcement without file.');
      this.saveAnnouncement(announcement);
    }
  },

  async saveAnnouncement(announcement) {
    try {
      const cfg = window.MSFG_CONFIG || window.CONFIG || {};
      const userId = cfg?.currentUser?.id || 1;
      const authorName = cfg?.currentUser?.name || 'User';

      const announcementData = {
        title: announcement.title,
        content: announcement.content,
        link: announcement.link || null,
        icon: announcement.icon || null,
        author_id: userId,
        file_s3_key: announcement.file_s3_key || null,
        file_name: announcement.fileName || null,
        file_size: announcement.fileSize || null,
        file_type: announcement.fileType || null
      };

      const saved = await ServerAPI.createAnnouncement(announcementData);

      // Remove any auto-archived announcements from the carousel
      if (saved.archivedIds && saved.archivedIds.length > 0) {
        this._carouselAnnouncements = this._carouselAnnouncements.filter(
          a => !saved.archivedIds.includes(a.id)
        );
      }

      const uiAnnouncement = {
        id: saved.id,
        title: saved.title,
        content: saved.content,
        link: saved.link,
        icon: saved.icon,
        author: saved.author_name || authorName,
        createdAt: saved.created_at,
        fileName: saved.file_name
      };

      this.addAnnouncementToUI(uiAnnouncement);

      alert('Announcement added successfully!');
      this.hideAnnouncementModal();
    } catch (error) {
      console.error('Failed to save announcement:', error);
      alert('Failed to save announcement. Please try again.');
    }
  },

  // ========================================
  // IFRAME EMBED TOGGLE + RESIZE
  // ========================================
  bindEmbedToggles() {
    // Delegated click handler for preview toggle buttons
    document.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('.news-embed-toggle');
      if (!toggleBtn) return;

      const wrapper = toggleBtn.closest('.news-embed-wrapper');
      const container = wrapper.querySelector('.news-embed-container');
      const iframe = wrapper.querySelector('.news-embed-frame');
      const isVisible = container.style.display !== 'none';

      if (isVisible) {
        // Collapse
        container.style.display = 'none';
        toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Preview Page';
        toggleBtn.classList.remove('active');
        iframe.src = '';  // unload iframe to save resources
      } else {
        // Expand — load the URL into iframe
        container.style.display = 'block';
        toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Preview';
        toggleBtn.classList.add('active');
        if (!iframe.src || iframe.src === 'about:blank') {
          iframe.src = iframe.dataset.src;
        }
      }
    });

    // Delegated drag-to-resize handler
    document.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.news-embed-resize-handle');
      if (!handle) return;

      e.preventDefault();
      const frameWrapper = handle.closest('.news-embed-frame-wrapper');
      const startY = e.clientY;
      const startH = frameWrapper.offsetHeight;

      const onMove = (ev) => {
        const newH = Math.max(150, Math.min(900, startH + (ev.clientY - startY)));
        frameWrapper.style.height = newH + 'px';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  // ========================================
  // ANNOUNCEMENTS STATE
  // ========================================
  _carouselAnnouncements: [],

  _canCreate() {
    // All authenticated users can create announcements
    return !!CONFIG.currentUser;
  },

  _canDelete() {
    const role = String(CONFIG.currentUser?.role || '').toLowerCase();
    return role === 'admin';
  },

  _sanitizeHtml(html) {
    if (!html) return '';
    // Strip dangerous tags and attributes, keep formatting
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Remove script, style, iframe, object, embed, form tags
    tmp.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach(el => el.remove());
    // Remove event handler attributes
    tmp.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('on') || attr.name === 'srcdoc' || (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return tmp.innerHTML;
  },

  _stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  },

  buildAnnouncementCard(announcement) {
    const iconClass = announcement.icon || 'fa-bullhorn';
    const relativeTime = Utils.getRelativeTime(announcement.createdAt);
    const safeLink = announcement.link ? Utils.escapeHtml(announcement.link) : null;
    const fallbackLogo = (window.CONFIG && CONFIG.assets && CONFIG.assets.logoFallback) || '/assets/msfg-logo-fallback.svg';
    const showDelete = this._canDelete();

    return `
      <div class="news-item" data-id="${announcement.id}">
        <div class="news-icon"><i class="fas ${iconClass}"></i></div>
        <div class="news-content">
          <div class="news-header">
            <h4>${Utils.escapeHtml(announcement.title)}</h4>
            ${showDelete ? `<button class="news-delete-btn" data-id="${announcement.id}" title="Delete announcement" type="button">
              <i class="fas fa-trash"></i>
            </button>` : ''}
          </div>

          <div class="announcement-body">${this._sanitizeHtml(announcement.content)}</div>

          ${safeLink ? `
            <div class="news-embed-wrapper">
              <div class="news-embed-toolbar">
                <button type="button" class="news-embed-toggle" data-url="${safeLink}" title="Preview page">
                  <i class="fas fa-eye"></i> Preview Page
                </button>
                <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="news-link-external" title="Open in new tab">
                  <i class="fas fa-external-link-alt"></i> Open in New Tab
                </a>
              </div>
              <div class="news-embed-container" style="display:none;">
                <div class="news-embed-frame-wrapper">
                  <iframe class="news-embed-frame" data-src="${safeLink}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" loading="lazy"></iframe>
                  <div class="news-embed-resize-handle" title="Drag to resize">
                    <i class="fas fa-grip-lines"></i>
                  </div>
                </div>
              </div>
            </div>` : ''}

          ${announcement.fileName ? `
            <div class="news-file">
              <i class="fas fa-file"></i> ${Utils.escapeHtml(announcement.fileName)}
            </div>` : ''}

          <div class="news-meta">
            <span><i class="fas fa-user"></i> ${Utils.escapeHtml(announcement.author)}</span>
            <span><i class="fas fa-clock"></i> ${relativeTime}</span>
          </div>
        </div>
      </div>
    `;
  },

  buildCardPreview(announcement) {
    const iconClass = announcement.icon || 'fa-bullhorn';
    const relativeTime = Utils.getRelativeTime(announcement.createdAt);

    return `
      <div class="news-card" data-announcement-id="${announcement.id}">
        <div class="news-card-header">
          <div class="news-card-icon"><i class="fas ${iconClass}"></i></div>
          <h4 class="news-card-title">${Utils.escapeHtml(announcement.title)}</h4>
        </div>
        <p class="news-card-excerpt">${Utils.escapeHtml(this._stripHtml(announcement.content))}</p>
        <div class="news-card-meta">
          <span><i class="fas fa-user"></i> ${Utils.escapeHtml(announcement.author)}</span>
          <span><i class="fas fa-clock"></i> ${relativeTime}</span>
        </div>
      </div>
    `;
  },

  renderCardGrid() {
    const grid = document.getElementById('newsCardGrid');
    if (!grid) return;

    const cards = this._carouselAnnouncements.slice(0, 3);

    if (cards.length === 0) {
      grid.innerHTML = '<div class="news-card-empty"><p>No announcements yet.</p></div>';
      return;
    }

    grid.innerHTML = cards.map(a => this.buildCardPreview(a)).join('');
  },

  bindCardGrid() {
    const grid = document.getElementById('newsCardGrid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.news-card');
      if (!card) return;
      const id = Number(card.dataset.announcementId);
      if (Number.isFinite(id)) this.showAnnouncementDetail(id);
    });
  },

  showAnnouncementDetail(id) {
    const announcement = this._carouselAnnouncements.find(a => a.id === id);
    if (!announcement) return;

    const overlay = document.getElementById('announcementDetailOverlay');
    const title = document.getElementById('announcementDetailTitle');
    const body = document.getElementById('announcementDetailBody');
    if (!overlay || !title || !body) return;

    title.textContent = announcement.title;
    body.innerHTML = this.buildAnnouncementCard(announcement);
    overlay.classList.add('active');
  },

  hideAnnouncementDetail() {
    const overlay = document.getElementById('announcementDetailOverlay');
    if (overlay) overlay.classList.remove('active');
  },

  bindAnnouncementDetail() {
    const overlay = document.getElementById('announcementDetailOverlay');
    const close = document.getElementById('announcementDetailClose');

    if (close) {
      close.addEventListener('click', () => this.hideAnnouncementDetail());
    }
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.hideAnnouncementDetail();
      });
    }
  },

  addAnnouncementToUI(announcement) {
    this._carouselAnnouncements.unshift(announcement);
    this.renderCardGrid();
  },

  async deleteAnnouncement(announcementId) {
    if (!confirm('Are you sure you want to delete this announcement?')) return;

    try {
      await ServerAPI.deleteAnnouncement(announcementId);

      this._carouselAnnouncements = this._carouselAnnouncements.filter(a => a.id !== announcementId);
      this.renderCardGrid();
    } catch (error) {
      console.error('Failed to delete announcement:', error);
      alert('Failed to delete announcement. Please try again.');
    }
  },

  _updateAddButtonVisibility() {
    const btn = document.getElementById('addAnnouncementBtn');
    if (btn) {
      btn.style.display = this._canCreate() ? '' : 'none';
    }
  },

  async loadAnnouncements() {
    const grid = document.getElementById('newsCardGrid');
    if (!grid) return;

    this.bindCardGrid();
    this.bindAnnouncementDetail();
    this._updateAddButtonVisibility();

    try {
      const announcements = await ServerAPI.getAnnouncements('active');

      // announcements come newest-first from API
      this._carouselAnnouncements = announcements.map(a => ({
        id: a.id,
        title: a.title,
        content: a.content,
        link: a.link,
        icon: a.icon,
        author: a.author_name || 'Unknown',
        createdAt: a.created_at,
        fileName: a.file_name
      }));

      this.renderCardGrid();
    } catch (error) {
      console.error('Failed to load announcements:', error);

      const cached = Utils.getStorage ? Utils.getStorage('announcements', []) : [];
      this._carouselAnnouncements = cached;
      this.renderCardGrid();
    }
  }
};

// Export to global scope
window.ModalsManager = ModalsManager;