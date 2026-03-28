/* ============================================
   MSFG Dashboard - Content Studio
   Generate AI social media posts & publish via webhooks.
   Auto-detects platforms from employee profile social URLs.
   ============================================ */

const ContentStudio = {
  _profile: null,
  _platforms: [],     // platforms the user has configured
  _generated: [],     // last generated results per platform
  _queue: [],         // content items from server
  _queueStats: null,

  // ========================================
  // INITIALIZATION
  // ========================================
  async init() {
    this._bindEvents();
  },

  // ========================================
  // OPEN / CLOSE
  // ========================================
  async open() {
    const modal = document.getElementById('contentStudioModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Show loading while we fetch profile
    this._showTab('generate');
    await this._loadUserProfile();
    await this._loadQueue();
  },

  close() {
    const modal = document.getElementById('contentStudioModal');
    if (modal) modal.style.display = 'none';
  },

  // ========================================
  // EVENT BINDING
  // ========================================
  _bindEvents() {
    // Close
    document.getElementById('csClose')?.addEventListener('click', () => this.close());
    document.getElementById('contentStudioModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'contentStudioModal') this.close();
    });

    // Tabs
    document.querySelectorAll('.cs-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this._showTab(tab);
        if (tab === 'queue') this._loadQueue();
      });
    });

    // Generate
    document.getElementById('csGenerateBtn')?.addEventListener('click', () => this._generate());

    // Enter key on topic input
    document.getElementById('csTopic')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._generate();
      }
    });

    // Publish all
    document.getElementById('csPublishAllBtn')?.addEventListener('click', () => this._publishAll());
  },

  _showTab(tab) {
    document.querySelectorAll('.cs-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.cs-tab-panel').forEach(p => p.classList.toggle('active', p.id === `csTab-${tab}`));
  },

  // ========================================
  // LOAD USER PROFILE → DETECT PLATFORMS
  // ========================================
  async _loadUserProfile() {
    try {
      this._profile = await ServerAPI.get('/me/profile');
    } catch (err) {
      console.warn('ContentStudio: could not load profile', err);
      this._profile = {};
    }

    // Detect which platforms the user has URLs for
    const platformMap = [
      { key: 'facebook_url',   platform: 'facebook',  icon: 'fab fa-facebook',  label: 'Facebook' },
      { key: 'facebook_business_url', platform: 'facebook', icon: 'fab fa-facebook', label: 'Facebook Business' },
      { key: 'instagram_url',  platform: 'instagram', icon: 'fab fa-instagram', label: 'Instagram' },
      { key: 'twitter_url',    platform: 'x',         icon: 'fab fa-x-twitter', label: 'X / Twitter' },
      { key: 'linkedin_url',   platform: 'linkedin',  icon: 'fab fa-linkedin',  label: 'LinkedIn' },
      { key: 'tiktok_url',     platform: 'tiktok',    icon: 'fab fa-tiktok',    label: 'TikTok' },
    ];

    // Deduplicate by platform (facebook might appear twice)
    const seen = new Set();
    this._platforms = [];
    for (const p of platformMap) {
      if (this._profile?.[p.key] && !seen.has(p.platform)) {
        seen.add(p.platform);
        this._platforms.push(p);
      }
    }

    this._renderPlatformToggles();
  },

  _renderPlatformToggles() {
    const container = document.getElementById('csPlatformToggles');
    if (!container) return;

    if (this._platforms.length === 0) {
      container.innerHTML = `
        <div class="cs-no-platforms">
          <i class="fas fa-exclamation-circle"></i>
          <span>No social media accounts found in your profile.
          <a href="#" onclick="document.getElementById('contentStudioModal').style.display='none'; UserSettings.open && UserSettings.open('profile'); return false;">Add them in Settings → Profile</a>.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = this._platforms.map(p => `
      <label class="cs-platform-toggle">
        <input type="checkbox" value="${p.platform}" checked />
        <i class="${p.icon}"></i>
        <span>${p.label}</span>
      </label>
    `).join('');
  },

  _getSelectedPlatforms() {
    const checkboxes = document.querySelectorAll('#csPlatformToggles input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  },

  // ========================================
  // GENERATE CONTENT
  // ========================================
  async _generate() {
    const topic = document.getElementById('csTopic')?.value?.trim();
    if (!topic) {
      Utils.showToast('Enter a topic or keyword first', 'warning');
      return;
    }

    const platforms = this._getSelectedPlatforms();
    if (platforms.length === 0) {
      Utils.showToast('Select at least one platform', 'warning');
      return;
    }

    const instructions = document.getElementById('csInstructions')?.value?.trim() || '';
    const btn = document.getElementById('csGenerateBtn');
    const resultsContainer = document.getElementById('csResults');

    // Loading state
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    resultsContainer.innerHTML = '<div class="cs-loading"><i class="fas fa-magic fa-spin"></i> AI is crafting your posts...</div>';

    try {
      const result = await ServerAPI.post('/content/generate', {
        suggestion: topic,
        platforms: platforms,
        keyword: topic,
        additional_instructions: instructions,
        save_drafts: true,
      });

      this._generated = result.platforms || [];
      this._renderResults(result);
    } catch (err) {
      resultsContainer.innerHTML = `<div class="cs-error"><i class="fas fa-exclamation-triangle"></i> ${Utils.escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-magic"></i> Generate Posts';
    }
  },

  _renderResults(result) {
    const container = document.getElementById('csResults');
    if (!container) return;

    if (!result.platforms || result.platforms.length === 0) {
      container.innerHTML = '<div class="cs-error">No content generated. Please try again.</div>';
      return;
    }

    const platformIcons = {
      facebook: 'fab fa-facebook', instagram: 'fab fa-instagram',
      x: 'fab fa-x-twitter', linkedin: 'fab fa-linkedin', tiktok: 'fab fa-tiktok',
    };

    const savedMap = {};
    (result.saved || []).forEach(s => { savedMap[s.platform] = s.content_id; });

    container.innerHTML = result.platforms.map((p, i) => {
      const icon = platformIcons[p.platform] || 'fas fa-share';
      const hashtags = (p.hashtags || []).map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
      const contentId = savedMap[p.platform];
      const hasError = !!p.error;

      return `
        <div class="cs-result-card" data-platform="${p.platform}" data-content-id="${contentId || ''}">
          <div class="cs-result-header">
            <div class="cs-result-platform">
              <i class="${icon}"></i>
              <span>${p.platform.charAt(0).toUpperCase() + p.platform.slice(1)}</span>
            </div>
            <span class="cs-char-count">${p.characterCount || 0} chars</span>
          </div>
          ${hasError ? `<div class="cs-error">${Utils.escapeHtml(p.error)}</div>` : `
            <textarea class="cs-result-text" data-index="${i}">${Utils.escapeHtml(p.text || '')}</textarea>
            ${hashtags ? `<div class="cs-result-hashtags">${Utils.escapeHtml(hashtags)}</div>` : ''}
            <div class="cs-result-actions">
              <button class="btn btn-sm btn-secondary cs-copy-btn" data-index="${i}" title="Copy to clipboard">
                <i class="fas fa-copy"></i> Copy
              </button>
              ${contentId ? `
                <button class="btn btn-sm btn-primary cs-publish-btn" data-content-id="${contentId}" data-platform="${p.platform}" title="Publish via webhook">
                  <i class="fas fa-paper-plane"></i> Publish
                </button>
              ` : ''}
            </div>
          `}
        </div>
      `;
    }).join('');

    // Bind copy buttons
    container.querySelectorAll('.cs-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const textarea = container.querySelector(`.cs-result-text[data-index="${idx}"]`);
        if (textarea) {
          navigator.clipboard.writeText(textarea.value).then(() => {
            Utils.showToast('Copied to clipboard!', 'success');
          });
        }
      });
    });

    // Bind publish buttons
    container.querySelectorAll('.cs-publish-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._publishSingle(btn.dataset.contentId, btn.dataset.platform, btn);
      });
    });

    // Show publish all button if multiple drafts
    const publishAllBtn = document.getElementById('csPublishAllBtn');
    const draftIds = Object.values(savedMap).filter(Boolean);
    if (publishAllBtn) {
      publishAllBtn.style.display = draftIds.length > 1 ? '' : 'none';
      publishAllBtn.dataset.ids = JSON.stringify(draftIds);
    }
  },

  // ========================================
  // PUBLISHING (webhook method)
  // ========================================
  async _publishSingle(contentId, platform, btn) {
    if (!contentId) return;

    // First update the text in case user edited it
    const card = document.querySelector(`.cs-result-card[data-content-id="${contentId}"]`);
    const textarea = card?.querySelector('.cs-result-text');
    if (textarea) {
      try {
        await ServerAPI.put(`/content/items/${contentId}`, {
          text_content: textarea.value,
        });
      } catch (e) { /* ok, publish with original */ }
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

    try {
      // Approve first, then publish
      await ServerAPI.post(`/content/items/${contentId}/approve`, {});
      const result = await ServerAPI.post(`/content/publish/${contentId}`, { method: 'n8n' });

      if (result.success) {
        btn.innerHTML = '<i class="fas fa-check"></i> Posted!';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        Utils.showToast(`Published to ${platform}!`, 'success');
      } else {
        throw new Error(result.error || 'Publish failed');
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Retry';
      Utils.showToast(`Failed: ${err.message}`, 'error');
    }
  },

  async _publishAll() {
    const btn = document.getElementById('csPublishAllBtn');
    if (!btn) return;

    const ids = JSON.parse(btn.dataset.ids || '[]');
    if (ids.length === 0) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing all...';

    try {
      // Approve all first
      for (const id of ids) {
        await ServerAPI.post(`/content/items/${id}/approve`, {}).catch(() => {});
      }

      const result = await ServerAPI.post('/content/publish/batch', {
        item_ids: ids,
        method: 'n8n',
      });

      Utils.showToast(`Published ${result.succeeded} of ${result.total} posts!`, result.failed > 0 ? 'warning' : 'success');
      btn.innerHTML = '<i class="fas fa-check"></i> All Published!';

      // Update individual buttons
      (result.results || []).forEach(r => {
        const pubBtn = document.querySelector(`.cs-publish-btn[data-content-id="${r.content_id}"]`);
        if (pubBtn && r.success) {
          pubBtn.innerHTML = '<i class="fas fa-check"></i> Posted!';
          pubBtn.disabled = true;
          pubBtn.classList.remove('btn-primary');
          pubBtn.classList.add('btn-success');
        }
      });
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publish All';
      Utils.showToast(`Batch publish failed: ${err.message}`, 'error');
    }
  },

  // ========================================
  // CONTENT QUEUE TAB
  // ========================================
  async _loadQueue() {
    const container = document.getElementById('csQueueList');
    if (!container) return;
    container.innerHTML = '<div class="cs-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
      const [items, stats] = await Promise.all([
        ServerAPI.get('/content/items?limit=30'),
        ServerAPI.get('/content/items/stats'),
      ]);

      this._queue = items.items || [];
      this._queueStats = stats;
      this._renderQueue();
    } catch (err) {
      container.innerHTML = `<div class="cs-error">${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  _renderQueue() {
    const container = document.getElementById('csQueueList');
    const statsBar = document.getElementById('csQueueStats');
    if (!container) return;

    // Stats bar
    if (statsBar && this._queueStats) {
      const s = this._queueStats;
      statsBar.innerHTML = `
        <span class="cs-stat"><strong>${s.draft || 0}</strong> drafts</span>
        <span class="cs-stat"><strong>${s.approved || 0}</strong> approved</span>
        <span class="cs-stat"><strong>${s.posted || 0}</strong> posted</span>
        <span class="cs-stat"><strong>${s.failed || 0}</strong> failed</span>
      `;
    }

    if (this._queue.length === 0) {
      container.innerHTML = '<div class="cs-empty"><i class="fas fa-inbox"></i><p>No content yet. Generate some posts to get started!</p></div>';
      return;
    }

    const platformIcons = {
      facebook: 'fab fa-facebook', instagram: 'fab fa-instagram',
      x: 'fab fa-x-twitter', linkedin: 'fab fa-linkedin', tiktok: 'fab fa-tiktok',
    };
    const statusColors = {
      draft: 'var(--text-muted)', approved: 'var(--status-info)',
      posted: 'var(--status-success)', failed: 'var(--status-danger)',
      scheduled: 'var(--status-warning)', archived: 'var(--text-muted)',
    };

    container.innerHTML = this._queue.map(item => {
      const icon = platformIcons[item.platform] || 'fas fa-share';
      const text = (item.text_content || '').substring(0, 120);
      const date = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
      const statusColor = statusColors[item.status] || 'var(--text-muted)';

      return `
        <div class="cs-queue-item">
          <div class="cs-queue-platform"><i class="${icon}"></i></div>
          <div class="cs-queue-content">
            <div class="cs-queue-text">${Utils.escapeHtml(text)}${text.length >= 120 ? '...' : ''}</div>
            <div class="cs-queue-meta">
              <span style="color:${statusColor}; font-weight:600; text-transform:capitalize;">${item.status}</span>
              <span>${date}</span>
              ${item.keyword ? `<span class="cs-queue-keyword">${Utils.escapeHtml(item.keyword)}</span>` : ''}
            </div>
          </div>
          <div class="cs-queue-actions">
            ${item.status === 'draft' ? `
              <button class="btn btn-xs btn-primary cs-queue-publish" data-id="${item.id}" data-platform="${item.platform}">
                <i class="fas fa-paper-plane"></i>
              </button>
            ` : ''}
            ${item.status === 'draft' || item.status === 'failed' ? `
              <button class="btn btn-xs btn-danger cs-queue-delete" data-id="${item.id}">
                <i class="fas fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Bind queue actions
    container.querySelectorAll('.cs-queue-publish').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
          await ServerAPI.post(`/content/items/${id}/approve`, {});
          await ServerAPI.post(`/content/publish/${id}`, { method: 'n8n' });
          Utils.showToast('Published!', 'success');
          this._loadQueue();
        } catch (err) {
          Utils.showToast(err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
      });
    });

    container.querySelectorAll('.cs-queue-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          await ServerAPI.delete(`/content/items/${id}`);
          this._loadQueue();
        } catch (err) {
          Utils.showToast(err.message, 'error');
        }
      });
    });
  },
};

window.ContentStudio = ContentStudio;
