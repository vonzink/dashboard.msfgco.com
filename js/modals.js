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
    this.loadAnnouncements();

    console.log('ModalsManager initialized');
  },

  // ========================================
  // GLOBAL ESC HANDLER (single source of truth)
  // ========================================
  bindGlobalEscapeClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      // Close the top-most modal (priority order)
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
    const closeBtns = modal.querySelectorAll('.notifications-modal-close');
    closeBtns.forEach((btn) => {
      btn.addEventListener('click', () => this.hideNotificationsModal());
    });

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideNotificationsModal();
    });

    // Form submission
    const form = document.getElementById('notificationForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleNotificationSubmit();
      });
    }

    // NOTE:
    // Opening is handled by action-dispatcher.js calling showNotificationsModal()
    // ARIA + focus trap are handled by a11y.js
  },

  showNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    // Set default date to today
    const dateInput = document.getElementById('notificationDate');
    if (dateInput) {
      const today = new Date().toISOString().split('T')[0];
      dateInput.value = today;
      dateInput.min = today; // Prevent past dates
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';

      // Reset form
      const form = document.getElementById('notificationForm');
      if (form) form.reset();
    }, 200);
  },

  handleNotificationSubmit() {
    const dateEl = document.getElementById('notificationDate');
    const timeEl = document.getElementById('notificationTime');
    const noteEl = document.getElementById('notificationNote');

    const date = dateEl ? dateEl.value : '';
    const time = timeEl ? timeEl.value : '';
    const note = noteEl ? noteEl.value : '';

    if (!date || !time || !note) {
      alert('Please complete date, time, and note.');
      return;
    }

    const userId =
      (window.MSFG_CONFIG && MSFG_CONFIG.currentUser && MSFG_CONFIG.currentUser.id) ||
      (window.CONFIG && CONFIG.currentUser && CONFIG.currentUser.id) ||
      1;

    ServerAPI.createNotification(userId, date, time, note)
      .then(() => {
        alert(`Reminder set for ${date} at ${time}`);
        this.hideNotificationsModal();
      })
      .catch((error) => {
        console.error('Failed to save notification:', error);
        alert('Failed to save notification. Please try again.');
      });
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
        const fileLabel = form.querySelector('.file-input-label');
        if (fileLabel) fileLabel.textContent = 'Choose file or drag and drop';
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
    const content = contentEl ? contentEl.value : '';
    const link = linkEl ? linkEl.value : '';
    const icon = iconEl ? iconEl.value : '';
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!title || !content) {
      alert('Please provide a title and content.');
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

      const uiAnnouncement = {
        id: saved.id,
        title: saved.title,
        content: saved.content,
        link: saved.link,
        icon: saved.icon,
        author: authorName,
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

  addAnnouncementToUI(announcement) {
    const newsFeed = document.getElementById('newsFeed');
    if (!newsFeed) return;

    const iconClass = announcement.icon || 'fa-bullhorn';
    const relativeTime = Utils.getRelativeTime(announcement.createdAt);

    const safeLink = announcement.link ? Utils.escapeHtml(announcement.link) : null;

    const announcementHTML = `
      <div class="news-item" data-id="${announcement.id}">
        <div class="news-icon"><i class="fas ${iconClass}"></i></div>
        <div class="news-content">
          <div class="news-header">
            <h4>${Utils.escapeHtml(announcement.title)}</h4>
            <button class="news-delete-btn" data-id="${announcement.id}" title="Delete announcement" type="button">
              <i class="fas fa-trash"></i>
            </button>
          </div>

          <p>${Utils.escapeHtml(announcement.content)}</p>

          ${safeLink ? `
            <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="news-link">
              <i class="fas fa-external-link-alt"></i> View Link
            </a>` : ''}

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

    newsFeed.insertAdjacentHTML('afterbegin', announcementHTML);
  },

  async deleteAnnouncement(announcementId) {
    if (!confirm('Are you sure you want to delete this announcement?')) return;

    try {
      await ServerAPI.deleteAnnouncement(announcementId);

      const newsItem = document.querySelector(`.news-item[data-id="${announcementId}"]`);
      if (newsItem) {
        newsItem.style.transition = 'opacity 0.3s, transform 0.3s';
        newsItem.style.opacity = '0';
        newsItem.style.transform = 'translateX(-20px)';
        setTimeout(() => newsItem.remove(), 300);
      }
    } catch (error) {
      console.error('Failed to delete announcement:', error);
      alert('Failed to delete announcement. Please try again.');
    }
  },

  async loadAnnouncements() {
    const newsFeed = document.getElementById('newsFeed');
    if (!newsFeed) return;

    try {
      const announcements = await ServerAPI.getAnnouncements();

      announcements.forEach((a) => {
        const uiAnnouncement = {
          id: a.id,
          title: a.title,
          content: a.content,
          link: a.link,
          icon: a.icon,
          author: 'Admin',
          createdAt: a.created_at,
          fileName: a.file_name
        };
        this.addAnnouncementToUI(uiAnnouncement);
      });
    } catch (error) {
      console.error('Failed to load announcements:', error);

      // Fallback to local storage cache if you use it
      const cached = Utils.getStorage ? Utils.getStorage('announcements', []) : [];
      cached.forEach((a) => this.addAnnouncementToUI(a));
    }
  }
};

// Export to global scope
window.ModalsManager = ModalsManager;