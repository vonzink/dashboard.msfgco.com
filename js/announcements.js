/* ============================================
   MSFG Dashboard - Announcements Module
   Extracted from modals.js
   ============================================ */

const Announcements = {
  // ========================================
  // INITIALIZATION
  // ========================================
  init() {
    this.bindAnnouncementModal();
    this.bindDeleteButtons();
    this.bindAttachmentDownloads();
    this.loadAnnouncements();
  },

  // ========================================
  // ATTACHMENT DOWNLOADS (delegation, fresh presigned URL per click)
  // ========================================
  bindAttachmentDownloads() {
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('.news-attachment-dl');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();

      const annId = Number(link.dataset.annId);
      const index = Number(link.dataset.attIndex);
      if (!Number.isFinite(annId) || !Number.isFinite(index)) return;

      link.classList.add('is-loading');
      try {
        const data = await ServerAPI.get(`/announcements/${annId}/attachments/${index}/url`);
        if (data && data.url) {
          window.open(data.url, '_blank', 'noopener,noreferrer');
        } else {
          Utils.showToast('Could not open attachment', 'error');
        }
      } catch (err) {
        Utils.showToast('Could not open attachment: ' + (err.message || 'error'), 'error');
      } finally {
        link.classList.remove('is-loading');
      }
    });
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
        if (window.AnnouncementEditor?.reset) window.AnnouncementEditor.reset();
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
    const iconEl = document.getElementById('announcementIcon');
    const publishBtn = document.getElementById('announcementPublishBtn');

    const title = titleEl ? titleEl.value : '';
    const icon = iconEl ? iconEl.value : '';
    const links = window.AnnouncementEditor?.getLinks ? window.AnnouncementEditor.getLinks() : [];
    const attachmentFiles = window.AnnouncementEditor?.getAttachmentFiles ? window.AnnouncementEditor.getAttachmentFiles() : [];
    const graphicFile = window.AnnouncementEditor?.getGraphicFile ? window.AnnouncementEditor.getGraphicFile() : null;

    // Inline validation
    const plainText = contentEl ? contentEl.innerText.trim() : '';
    let valid = true;
    if (!title) { Utils.setFieldError(titleEl, 'Title is required'); valid = false; } else { Utils.setFieldError(titleEl, null); }
    if (!plainText) {
      Utils.showToast('Please add content to your announcement.', 'error');
      valid = false;
    }
    if (!valid) return;

    if (plainText.length > 5000) {
      Utils.showToast('Content exceeds 5,000 character limit.', 'error');
      return;
    }

    const cfg = window.MSFG_CONFIG || window.CONFIG || {};
    const authorName = cfg?.currentUser?.name || 'User';

    try {
      Utils.btnLoading(publishBtn, true);

      const content = window.AnnouncementEditor?.prepareContentForPublish
        ? await window.AnnouncementEditor.prepareContentForPublish(this.uploadAnnouncementFile.bind(this))
        : (contentEl ? (contentEl.getAttribute('contenteditable') ? contentEl.innerHTML.trim() : contentEl.value) : '');

      const attachments = await Promise.all(attachmentFiles.map(file => this.uploadAnnouncementFile(file)));
      const image = graphicFile
        ? await this.uploadAnnouncementFile(graphicFile)
        : (attachments.find(item => item.file_type && item.file_type.startsWith('image/')) || null);

      const announcement = {
        title,
        content,
        links,
        link: links[0]?.url || null,
        icon: icon || null,
        author: authorName,
        createdAt: new Date().toISOString(),
        attachments,
        image
      };

      await this.saveAnnouncement(announcement);
    } catch (error) {
      console.error('Failed to publish announcement:', error);
      Utils.showToast(error.message || 'Failed to publish announcement.', 'error');
    } finally {
      Utils.btnLoading(publishBtn, false);
    }
  },

  async uploadAnnouncementFile(file) {
    const uploadData = await ServerAPI.getUploadUrl(file.name, file.type, file.size);
    await ServerAPI.uploadToS3(uploadData.uploadUrl, file);
    return {
      file_s3_key: uploadData.fileKey,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type || 'application/octet-stream'
    };
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
        links: announcement.links || [],
        icon: announcement.icon || null,
        author_id: userId,
        file_s3_key: announcement.attachments?.[0]?.file_s3_key || null,
        file_name: announcement.attachments?.[0]?.file_name || null,
        file_size: announcement.attachments?.[0]?.file_size || null,
        file_type: announcement.attachments?.[0]?.file_type || null,
        attachments: announcement.attachments || [],
        image_s3_key: announcement.image?.file_s3_key || null,
        image_name: announcement.image?.file_name || null,
        image_size: announcement.image?.file_size || null,
        image_type: announcement.image?.file_type || null
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
        links: saved.links || [],
        icon: saved.icon,
        author: saved.author_name || authorName,
        createdAt: saved.created_at,
        fileName: saved.file_name,
        attachments: saved.attachments || [],
        imageUrl: saved.image_url,
        imageName: saved.image_name,
        imageType: saved.image_type
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
        const unsafeUrl = ['href', 'src'].includes(attr.name) && /^(javascript|data):/i.test(attr.value.trim());
        if (attr.name.startsWith('on') || attr.name === 'srcdoc' || unsafeUrl) {
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

  _getLinks(announcement) {
    if (Array.isArray(announcement.links) && announcement.links.length > 0) {
      return announcement.links.filter(link => link && link.url);
    }
    return announcement.link ? [{ label: 'Link 1', url: announcement.link }] : [];
  },

  _getAttachments(announcement) {
    if (Array.isArray(announcement.attachments) && announcement.attachments.length > 0) {
      return announcement.attachments;
    }
    return announcement.fileName ? [{
      file_name: announcement.fileName,
      file_type: announcement.fileType || null,
      file_size: announcement.fileSize || null,
      url: announcement.fileUrl || null
    }] : [];
  },

  _safeUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return Utils.escapeHtml(parsed.href);
    } catch {
      return '';
    }
  },

  buildAnnouncementCard(announcement) {
    const iconClass = announcement.icon || 'fa-bullhorn';
    const postedAt = new Date(announcement.createdAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const imageUrl = this._safeUrl(announcement.imageUrl || announcement.image_url);
    const links = this._getLinks(announcement);
    const attachments = this._getAttachments(announcement);
    const showDelete = this._canDelete();
    const linksHtml = links.map((link, index) => {
      const safeUrl = this._safeUrl(link.url);
      if (!safeUrl) return '';
      const label = link.label || `Link ${index + 1}`;
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="news-link-pill">
        <i class="fas fa-link"></i> ${Utils.escapeHtml(label)}
      </a>`;
    }).join('');
    const attachmentsHtml = attachments.map((attachment, index) => {
      const name = attachment.file_name || attachment.fileName || 'Attachment';
      const type = attachment.file_type || attachment.fileType || '';
      const size = attachment.file_size || attachment.fileSize || 0;
      const safeUrl = this._safeUrl(attachment.url || attachment.file_url || '');
      // Prefer an on-demand fresh URL fetch (presigned URLs in the payload
      // expire after 15 min). If the attachment is a dashboard S3 upload we
      // have an announcement id + index to mint a fresh URL per click.
      const canFreshFetch = !!(attachment.file_s3_key && Number.isFinite(announcement.id));
      const isImage = type.startsWith('image/') && safeUrl;
      const thumb = isImage
        ? `<img src="${safeUrl}" alt="">`
        : `<i class="fas ${Utils.fileIconForMime ? Utils.fileIconForMime(type) : 'fa-file'}"></i>`;
      const inner = `
        <div class="news-attachment-thumb">${thumb}</div>
        <div>
          <div class="news-attachment-name">${Utils.escapeHtml(name)}</div>
          <div class="news-attachment-meta">${Utils.escapeHtml(type || 'file')}${size ? ' &middot; ' + Utils.formatFileSize(size) : ''}</div>
        </div>
        ${(canFreshFetch || safeUrl) ? '<i class="fas fa-download"></i>' : ''}
      `;
      if (canFreshFetch) {
        return `<a class="news-attachment news-attachment-dl" href="#" data-ann-id="${announcement.id}" data-att-index="${index}" data-att-name="${Utils.escapeHtml(name)}">${inner}</a>`;
      }
      return safeUrl
        ? `<a class="news-attachment" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : `<div class="news-attachment">${inner}</div>`;
    }).join('');

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

          ${imageUrl ? `<div class="news-hero-image"><img src="${imageUrl}" alt=""></div>` : ''}
          <div class="announcement-body">${this._sanitizeHtml(announcement.content)}</div>

          ${linksHtml ? `<div class="news-links">${linksHtml}</div>` : ''}
          ${attachmentsHtml ? `<div class="news-attachments">${attachmentsHtml}</div>` : ''}

          <div class="news-meta">
            <span><i class="fas fa-user"></i> ${Utils.escapeHtml(announcement.author)}</span>
            <span><i class="fas fa-clock"></i> ${postedAt}</span>
          </div>
        </div>
      </div>
    `;
  },

  _activeCategory: 'all',

  // Detect category from icon or title keywords
  _detectCategory(announcement) {
    const title = (announcement.title || '').toLowerCase();
    const icon = (announcement.icon || '').toLowerCase();

    if (/rate|interest|pricing|lock|margin/i.test(title) || icon.includes('percent') || icon.includes('chart-line')) return 'rates';
    if (/event|meeting|webinar|conference|happy hour|lunch/i.test(title) || icon.includes('calendar') || icon.includes('users')) return 'events';
    if (/training|course|cert|learn|workshop|onboard/i.test(title) || icon.includes('graduation') || icon.includes('book')) return 'training';
    if (/alert|urgent|warning|important|action|deadline|outage/i.test(title) || icon.includes('exclamation') || icon.includes('bell')) return 'alerts';
    return 'general';
  },

  buildCardPreview(announcement) {
    const iconClass = announcement.icon || 'fa-bullhorn';
    const postedAt = new Date(announcement.createdAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const category = this._detectCategory(announcement);
    const imageUrl = this._safeUrl(announcement.imageUrl || announcement.image_url);

    return `
      <div class="news-card" data-announcement-id="${announcement.id}" data-category="${category}">
        ${imageUrl ? `<div class="news-card-image"><img src="${imageUrl}" alt=""></div>` : ''}
        <div class="news-card-header">
          <div class="news-card-icon"><i class="fas ${iconClass}"></i></div>
          <h4 class="news-card-title">${Utils.escapeHtml(announcement.title)}</h4>
        </div>
        <p class="news-card-excerpt">${Utils.escapeHtml(this._stripHtml(announcement.content))}</p>
        <div class="news-card-meta">
          <span><i class="fas fa-user"></i> ${Utils.escapeHtml(announcement.author)}</span>
          <span><i class="fas fa-clock"></i> ${postedAt}</span>
        </div>
      </div>
    `;
  },

  renderCardGrid() {
    const grid = document.getElementById('newsCardGrid');
    if (!grid) return;

    // Filter by active category
    const filtered = this._activeCategory === 'all'
      ? this._carouselAnnouncements
      : this._carouselAnnouncements.filter(a => this._detectCategory(a) === this._activeCategory);

    if (filtered.length === 0) {
      const msg = this._activeCategory === 'all' ? 'No announcements yet.' : 'No ' + this._activeCategory + ' announcements.';
      grid.innerHTML = '<div class="news-card-empty"><p>' + msg + '</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(a => this.buildCardPreview(a)).join('');
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

    // Category filter tabs
    const tabs = document.getElementById('newsFilterTabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.news-tab');
        if (!tab) return;
        tabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._activeCategory = tab.dataset.category || 'all';
        this.renderCardGrid();
      });
    }

    // Carousel arrows
    const prev = document.getElementById('newsCarouselPrev');
    const next = document.getElementById('newsCarouselNext');
    if (prev && grid) {
      prev.addEventListener('click', () => { grid.scrollBy({ left: -320, behavior: 'smooth' }); });
    }
    if (next && grid) {
      next.addEventListener('click', () => { grid.scrollBy({ left: 320, behavior: 'smooth' }); });
    }
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
    if (!await Utils.confirm('Are you sure you want to delete this announcement?', { title: 'Delete Announcement' })) return;

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
        links: a.links || [],
        icon: a.icon,
        author: a.author_name || 'Unknown',
        createdAt: a.created_at,
        fileName: a.file_name,
        fileType: a.file_type,
        fileSize: a.file_size,
        fileUrl: a.file_url,
        attachments: a.attachments || [],
        imageUrl: a.image_url,
        imageName: a.image_name,
        imageType: a.image_type
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
window.Announcements = Announcements;
