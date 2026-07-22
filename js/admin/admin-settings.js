// Admin Settings — extracted from Calculators/Admin Settings/admin-settings.html
// (audit §2.1). Behavior is byte-identical to the previous inline <script>;
// the same IIFE wrapper is preserved, the same window.* exports are kept
// (deleteInvestorDoc, registerWebhook, unregisterWebhook) because dynamically-
// generated HTML in this file contains onclick="..." attributes that call them.
//
// Loaded by Calculators/Admin Settings/admin-settings.html via a single
// <script src="/js/admin/admin-settings.js?v=..."></script> tag.

(() => {
  'use strict';

  /* ── API Config ── */
  const API_BASE = window.location.protocol === 'https:'
    ? 'https://api.msfgco.com/api'
    : 'http://52.203.186.217:8080/api';

  function getAuthToken() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
    return (
      localStorage.getItem('auth_token') ||
      (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null) ||
      sessionStorage.getItem('auth_token')
    );
  }

  async function api(path, opts = {}) {
    const token = getAuthToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!headers['Content-Type'] && opts.body && typeof opts.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(API_BASE + path, { ...opts, headers });

    if (res.status === 401) {
      alert('Session expired. Please log in again.');
      return null;
    }
    if (res.status === 403) {
      alert('Admin access required.');
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json();
  }

  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Tabs ── */
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');

      // Load data on tab switch
      const tabName = tab.dataset.tab;
      if (tabName === 'employees') loadUsers();
      if (tabName === 'investors') loadInvestors();
      if (tabName === 'processors') loadProcessorAssignments();
      if (tabName === 'system') loadSystem();
      if (tabName === 'monday') loadMondayTab();
    });
  });

  /* ═══════════════════════════════════════
     EMPLOYEES TAB
  ═══════════════════════════════════════ */
  let editingUserId = null;

  async function loadUsers() {
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
      const users = await api('/admin/users');
      if (!users) return;

      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">No users found.</td></tr>';
        return;
      }

      tbody.innerHTML = users.map(u => {
        const roleBadge = u.role === 'admin'
          ? '<span class="badge badge-admin">' + escHtml(u.role) + '</span>'
          : escHtml(u.role || 'user');

        return (
          '<tr data-user-id="' + u.id + '">' +
          '<td><strong>' + escHtml(u.name) + '</strong></td>' +
          '<td>' + escHtml(u.email) + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td>' +
            '<label class="toggle-switch" title="' + (u.is_active ? 'Active' : 'Inactive') + '">' +
              '<input type="checkbox" class="user-active-toggle" data-id="' + u.id + '"' + (u.is_active ? ' checked' : '') + '>' +
              '<span class="toggle-slider"></span>' +
            '</label>' +
            '<span style="margin-left:8px; font-size:0.82em; color:' + (u.is_active ? 'var(--msfg-green)' : '#999') + ';">' +
              (u.is_active ? 'Active' : 'Inactive') +
            '</span>' +
          '</td>' +
          '<td style="position:relative;">' +
            '<div class="user-actions-dropdown" style="position:relative; display:inline-block;">' +
              '<button class="btn btn-sm btn-secondary user-actions-btn" data-id="' + u.id + '" data-name="' + escHtml(u.name) + '" style="display:inline-flex; align-items:center; gap:6px;">Actions <i class="fas fa-caret-down"></i></button>' +
              '<div class="user-actions-menu" data-id="' + u.id + '" style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:#fff; border:1px solid #ddd; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12); min-width:180px; z-index:100; overflow:hidden;">' +
                '<button class="user-action-item" data-action="view" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:13px; color:#333;"><i class="fas fa-id-card" style="width:14px; color:#3b82f6;"></i> View Profile</button>' +
                '<button class="user-action-item" data-action="edit" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:13px; color:#333;"><i class="fas fa-edit" style="width:14px; color:#6b7280;"></i> Edit</button>' +
                '<button class="user-action-item" data-action="set-password" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:13px; color:#333;"><i class="fas fa-key" style="width:14px; color:#f59e0b;"></i> Set Password</button>' +
                '<button class="user-action-item" data-action="reset-password" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:13px; color:#333;"><i class="fas fa-envelope" style="width:14px; color:#0ea5e9;"></i> Email Reset Code</button>' +
                '<div style="height:1px; background:#eee; margin:4px 0;"></div>' +
                '<button class="user-action-item" data-action="delete" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:13px; color:#dc3545;"><i class="fas fa-trash-alt" style="width:14px;"></i> Delete Permanently</button>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '</tr>'
        );
      }).join('');

      // Bind active/inactive toggles
      tbody.querySelectorAll('.user-active-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => toggleUserActive(toggle.dataset.id, toggle.checked));
      });

      // Bind dropdown toggle buttons
      tbody.querySelectorAll('.user-actions-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const menu = tbody.querySelector('.user-actions-menu[data-id="' + id + '"]');
          // Close all other menus
          tbody.querySelectorAll('.user-actions-menu').forEach(m => {
            if (m !== menu) m.style.display = 'none';
          });
          if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });
      });

      // Bind dropdown menu items
      tbody.querySelectorAll('.user-actions-menu').forEach(menu => {
        const id = menu.dataset.id;
        const user = users.find(u => String(u.id) === id);
        if (!user) return;
        menu.querySelectorAll('.user-action-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            const action = item.dataset.action;
            if (action === 'view') showProfile(id, users);
            else if (action === 'edit') editUser(user);
            else if (action === 'set-password') setUserPassword(id, user.name);
            else if (action === 'reset-password') resetUserPassword(id, user.name);
            else if (action === 'delete') hardDeleteUser(id, user.name);
          });
        });
        // Hover styling
        menu.querySelectorAll('.user-action-item').forEach(item => {
          item.addEventListener('mouseenter', () => { item.style.background = '#f3f4f6'; });
          item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
        });
      });

      // Close menus on outside click (bind once per render)
      if (!window._userActionsCloseHandler) {
        window._userActionsCloseHandler = () => {
          document.querySelectorAll('.user-actions-menu').forEach(m => { m.style.display = 'none'; });
        };
        document.addEventListener('click', window._userActionsCloseHandler);
      }
    } catch (err) {
      console.error('Load users error:', err);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#e74c3c;">Failed to load users.</td></tr>';
    }
  }

  function showUserForm(user) {
    const form = document.getElementById('userForm');
    const title = document.getElementById('userFormTitle');

    const pwdGroup = document.getElementById('userPasswordGroup');
    const pwdInput = document.getElementById('userPasswordInput');
    if (user) {
      editingUserId = user.id;
      title.textContent = 'Edit Employee';
      document.getElementById('userNameInput').value = user.name || '';
      document.getElementById('userEmailInput').value = user.email || '';
      document.getElementById('userEmailInput').disabled = true;
      document.getElementById('userInitialsInput').value = user.initials || '';
      document.getElementById('userRoleSelect').value = user.role || 'user';
      if (pwdGroup) pwdGroup.style.display = 'none';
      if (pwdInput) pwdInput.value = '';
    } else {
      editingUserId = null;
      title.textContent = 'Add Employee';
      document.getElementById('userNameInput').value = '';
      document.getElementById('userEmailInput').value = '';
      document.getElementById('userEmailInput').disabled = false;
      document.getElementById('userInitialsInput').value = '';
      document.getElementById('userRoleSelect').value = 'user';
      if (pwdGroup) pwdGroup.style.display = '';
      if (pwdInput) pwdInput.value = '';
    }

    form.classList.add('active');
  }

  function hideUserForm() {
    document.getElementById('userForm').classList.remove('active');
    editingUserId = null;
  }

  function editUser(user) {
    if (user) showUserForm(user);
  }

  async function saveUser() {
    const name = document.getElementById('userNameInput').value.trim();
    const email = document.getElementById('userEmailInput').value.trim();
    const initials = document.getElementById('userInitialsInput').value.trim();
    const role = document.getElementById('userRoleSelect').value;
    const password = document.getElementById('userPasswordInput').value;

    if (!name) return alert('Name is required');
    if (!editingUserId && !email) return alert('Email is required');
    if (!editingUserId && (!password || password.length < 8)) {
      return alert('Initial password is required and must be at least 8 characters');
    }

    try {
      if (editingUserId) {
        await api('/admin/users/' + editingUserId, {
          method: 'PUT',
          body: JSON.stringify({ name, initials, role }),
        });
      } else {
        await api('/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email, name, initials, role, password }),
        });
      }

      hideUserForm();
      loadUsers();
    } catch (err) {
      alert('Error saving user: ' + err.message);
    }
  }

  async function setUserPassword(userId, userName) {
    const pwd = prompt('Set a new permanent password for "' + userName + '"\n(min 8 characters):');
    if (pwd == null) return;
    if (pwd.length < 8) return alert('Password must be at least 8 characters');
    try {
      await api('/admin/users/' + userId + '/set-password', {
        method: 'POST',
        body: JSON.stringify({ password: pwd }),
      });
      alert('Password updated for "' + userName + '". They can log in with the new password immediately.');
    } catch (err) {
      alert('Error setting password: ' + err.message);
    }
  }

  async function resetUserPassword(userId, userName) {
    const ok = confirm('Email a password reset code to "' + userName + '"?\n\nThey will receive a code and be required to set a new password at next login.');
    if (!ok) return;
    try {
      await api('/admin/users/' + userId + '/reset-password', { method: 'POST' });
      alert('Reset code emailed to "' + userName + '".');
    } catch (err) {
      alert('Error sending reset: ' + err.message);
    }
  }

  async function toggleUserActive(userId, activate) {
    try {
      await api('/admin/users/' + userId, {
        method: 'PUT',
        body: JSON.stringify({ is_active: activate }),
      });
      loadUsers();
    } catch (err) {
      alert('Error: ' + err.message);
      loadUsers(); // re-render to reset toggle state on failure
    }
  }

  async function hardDeleteUser(userId, userName) {
    const confirmed = confirm(
      '⚠️ PERMANENTLY DELETE "' + userName + '"?\n\n' +
      'This will remove the user and ALL associated data:\n' +
      '• Profile & documents\n' +
      '• Chat messages\n' +
      '• Goals & content\n' +
      '• Integration keys\n\n' +
      'This action CANNOT be undone.'
    );
    if (!confirmed) return;

    // Double confirm
    const doubleConfirm = confirm('Are you absolutely sure? Type OK to confirm permanent deletion of "' + userName + '".');
    if (!doubleConfirm) return;

    try {
      await api('/admin/users/' + userId + '/permanent', { method: 'DELETE' });
      alert('User "' + userName + '" has been permanently deleted.');
      loadUsers();
    } catch (err) {
      alert('Error deleting user: ' + err.message);
    }
  }

  // Employee event listeners
  document.getElementById('addUserBtn').addEventListener('click', () => showUserForm(null));
  document.getElementById('userFormCancelBtn').addEventListener('click', hideUserForm);
  document.getElementById('userFormSaveBtn').addEventListener('click', saveUser);

  /* ═══════════════════════════════════════
     EMPLOYEE PROFILE VIEW
  ═══════════════════════════════════════ */
  let profileUserId = null;
  let profileUserObj = null;
  let profileData = null;

  // --- Show / Hide Profile ---
  function showProfile(userId, users) {
    profileUserId = userId;
    profileUserObj = users ? users.find(u => String(u.id) === String(userId)) : null;

    // Hide table + form, show profile view
    document.getElementById('usersTable').style.display = 'none';
    document.getElementById('userForm').classList.remove('active');
    document.getElementById('addUserBtn').parentElement.parentElement.style.display = 'none';
    document.getElementById('employeeProfileView').style.display = 'block';

    // Set header
    document.getElementById('profileTitle').textContent = (profileUserObj ? profileUserObj.name : 'Employee') + ' — Profile';

    // Reset to Basic Info tab
    document.querySelectorAll('#profileTabs .profile-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#employeeProfileView .profile-section').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-ptab="basic"]').classList.add('active');
    document.getElementById('ptab-basic').classList.add('active');

    // Set static display info
    if (profileUserObj) {
      document.getElementById('profileNameDisplay').textContent = profileUserObj.name || '';
      document.getElementById('profileRoleDisplay').textContent = (profileUserObj.role || 'user').toUpperCase();
      document.getElementById('profileEmailDisplay').textContent = profileUserObj.email || '';
      document.getElementById('profileAvatarInitials').textContent = profileUserObj.initials || profileUserObj.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '';
    }

    loadProfileData();
  }

  function hideProfile() {
    document.getElementById('employeeProfileView').style.display = 'none';
    document.getElementById('usersTable').style.display = '';
    document.getElementById('addUserBtn').parentElement.parentElement.style.display = '';
    profileUserId = null;
    profileUserObj = null;
  }

  // Back button
  document.getElementById('profileBackBtn').addEventListener('click', hideProfile);

  // Profile sub-tab switching (scoped to employee profile)
  document.querySelectorAll('#profileTabs .profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#profileTabs .profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#employeeProfileView .profile-section').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('ptab-' + tab.dataset.ptab).classList.add('active');

      // Lazy-load data per tab
      const t = tab.dataset.ptab;
      if (t === 'notes') loadNotes();
      if (t === 'documents') loadDocuments();
      if (t === 'ai') loadAIKeys();
    });
  });

  // --- Load Profile Data ---
  async function loadProfileData() {
    try {
      const data = await api('/admin/users/' + profileUserId + '/profile');
      profileData = data;
      if (!data) return;

      // Basic fields
      document.getElementById('profileTeam').value = data.team || '';
      document.getElementById('profilePhone').value = data.phone || '';
      document.getElementById('profileDisplayEmail').value = data.display_email || '';
      document.getElementById('profileWebsite').value = data.website || '';
      document.getElementById('profileOnlineApp').value = data.online_app_url || '';

      // Social fields — personal
      document.getElementById('profileFacebook').value = data.facebook_url || '';
      document.getElementById('profileInstagram').value = data.instagram_url || '';
      document.getElementById('profileTwitter').value = data.twitter_url || '';
      document.getElementById('profileLinkedin').value = data.linkedin_url || '';
      document.getElementById('profileTiktok').value = data.tiktok_url || '';
      document.getElementById('profileYoutube').value = data.youtube_url || '';

      // Social fields — business & compliance
      document.getElementById('profileFacebookBusiness').value = data.facebook_business_url || '';
      document.getElementById('profileFacebookBusiness2').value = data.facebook_business_url_2 || '';
      document.getElementById('profileLinkedin2').value = data.linkedin_url_2 || '';
      document.getElementById('profileNextdoor').value = data.nextdoor_url || '';
      document.getElementById('profileGoogleMyBusiness').value = data.google_my_business_url || '';
      document.getElementById('profileSocialAuditDate').value = data.social_audit_date
        ? data.social_audit_date.substring(0, 10) : '';
      document.getElementById('profileSocialAuditNotes').value = data.social_audit_notes || '';

      // Licensing fields
      document.getElementById('profileNmls').value = data.nmls_number || '';
      document.getElementById('profileInsuranceProvider').value = data.insurance_provider || '';
      document.getElementById('profileInsurancePolicyNumber').value = data.insurance_policy_number || '';
      document.getElementById('profileInsuranceExpiration').value = data.insurance_expiration || '';
      document.getElementById('profileBondCompany').value = data.bond_company || '';
      document.getElementById('profileBondNumber').value = data.bond_number || '';
      document.getElementById('profileBondExpiration').value = data.bond_expiration || '';
      document.getElementById('profileComputerId').value = data.computer_id || '';
      document.getElementById('profileClientDropboxLocation').value = data.client_dropbox_location || '';

      // Email signature
      document.getElementById('profileSignatureInput').value = data.email_signature || '';
      document.getElementById('signaturePreview').style.display = 'none';

      // Avatar
      const img = document.getElementById('profileAvatarImg');
      const initials = document.getElementById('profileAvatarInitials');
      const removeBtn = document.getElementById('avatarRemoveBtn');
      const adjustBtn = document.getElementById('avatarAdjustBtn');
      img.style.objectPosition = data.avatar_position || '50% 50%';
      if (data.avatar_url) {
        img.src = data.avatar_url;
        img.style.display = 'block';
        initials.style.display = 'none';
        removeBtn.style.display = '';
        adjustBtn.style.display = '';
      } else {
        img.style.display = 'none';
        initials.style.display = '';
        removeBtn.style.display = 'none';
        adjustBtn.style.display = 'none';
      }

      // Business Card tab: load stored front/back HTML + brand (persists until re-saved)
      document.getElementById('bizcardFrontInput').value = data.business_card_html || '';
      document.getElementById('bizcardBackInput').value = data.business_card_back_html || '';
      document.getElementById('bizcardBrandSelect').value = data.business_card_brand === 'compass' ? 'compass' : 'msfg';
      document.getElementById('bizcardPreview').style.display = 'none';
      document.getElementById('bizcardMissing').style.display = 'none';

      // QR Codes
      loadQrCodeState(1, data.qr_code_1_url, data.qr_code_1_label);
      loadQrCodeState(2, data.qr_code_2_url, data.qr_code_2_label);

      // Custom links
      loadCustomLinks(data.custom_links || []);

      // AI keys status (inline in profile data)
      if (data.ai_keys) {
        updateAIStatus('openai', data.ai_keys.openai);
        updateAIStatus('anthropic', data.ai_keys.anthropic);
        updateAIStatus('deepseek', data.ai_keys.deepseek);
      }
    } catch (err) {
      console.error('Load profile error:', err);
    }
  }

  function loadQrCodeState(num, url, label) {
    const imgEl = document.getElementById('qrCode' + num + 'Img');
    const placeholder = document.getElementById('qrCode' + num + 'Placeholder');
    const removeBtn = document.getElementById('qrCode' + num + 'RemoveBtn');
    const downloadBtn = document.getElementById('qrCode' + num + 'DownloadBtn');
    const container = document.getElementById('qrCode' + num + 'Container');
    const labelInput = document.getElementById('qrCode' + num + 'Label');
    labelInput.value = label || '';
    if (url) {
      imgEl.src = url;
      imgEl.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = '';
      downloadBtn.style.display = '';
      container.style.borderStyle = 'solid';
    } else {
      imgEl.style.display = 'none';
      placeholder.style.display = '';
      removeBtn.style.display = 'none';
      downloadBtn.style.display = 'none';
      container.style.borderStyle = 'dashed';
    }
  }

  function loadCustomLinks(links) {
    const container = document.getElementById('customLinksContainer');
    container.innerHTML = '';
    links.forEach(link => addCustomLinkRow(link));
  }

  function addCustomLinkRow(link) {
    const container = document.getElementById('customLinksContainer');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px;';
    row.dataset.linkId = link ? link.id : '';
    row.innerHTML = `
      <input type="text" class="cl-label" value="${link ? (link.label || '') : ''}" placeholder="Label (e.g. My Website)" style="flex:1; padding:8px 12px; border:1px solid #ddd; border-radius:8px; font-family:inherit; font-size:13px;" />
      <input type="url" class="cl-url" value="${link ? (link.url || '') : ''}" placeholder="https://..." style="flex:2; padding:8px 12px; border:1px solid #ddd; border-radius:8px; font-family:inherit; font-size:13px;" />
      <button class="btn btn-sm btn-danger cl-remove" title="Remove"><i class="fas fa-times"></i></button>
    `;
    row.querySelector('.cl-remove').addEventListener('click', async () => {
      const linkId = row.dataset.linkId;
      if (linkId) {
        try {
          await api('/admin/users/' + profileUserId + '/custom-links/' + linkId, { method: 'DELETE' });
        } catch (err) { console.error(err); }
      }
      row.remove();
    });
    container.appendChild(row);
  }

  // --- Save Basic Info ---
  document.getElementById('profileBasicSaveBtn').addEventListener('click', async () => {
    try {
      await api('/admin/users/' + profileUserId + '/profile', {
        method: 'PUT',
        body: JSON.stringify({
          team: document.getElementById('profileTeam').value.trim(),
          phone: document.getElementById('profilePhone').value.trim(),
          display_email: document.getElementById('profileDisplayEmail').value.trim(),
          website: document.getElementById('profileWebsite').value.trim(),
          online_app_url: document.getElementById('profileOnlineApp').value.trim(),
          qr_code_1_label: document.getElementById('qrCode1Label').value.trim(),
          qr_code_2_label: document.getElementById('qrCode2Label').value.trim(),
          nmls_number: document.getElementById('profileNmls').value.trim(),
          insurance_provider: document.getElementById('profileInsuranceProvider').value.trim(),
          insurance_policy_number: document.getElementById('profileInsurancePolicyNumber').value.trim(),
          insurance_expiration: document.getElementById('profileInsuranceExpiration').value || null,
          bond_company: document.getElementById('profileBondCompany').value.trim(),
          bond_number: document.getElementById('profileBondNumber').value.trim(),
          bond_expiration: document.getElementById('profileBondExpiration').value || null,
          computer_id: document.getElementById('profileComputerId').value.trim() || null,
          client_dropbox_location: document.getElementById('profileClientDropboxLocation').value.trim() || null,
        }),
      });
      alert('Basic info saved!');
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  // --- Save Social ---
  document.getElementById('profileSocialSaveBtn').addEventListener('click', async () => {
    try {
      // Save social profile fields
      await api('/admin/users/' + profileUserId + '/profile', {
        method: 'PUT',
        body: JSON.stringify({
          // Personal
          facebook_url:             document.getElementById('profileFacebook').value.trim() || null,
          instagram_url:            document.getElementById('profileInstagram').value.trim() || null,
          twitter_url:              document.getElementById('profileTwitter').value.trim() || null,
          linkedin_url:             document.getElementById('profileLinkedin').value.trim() || null,
          tiktok_url:               document.getElementById('profileTiktok').value.trim() || null,
          youtube_url:              document.getElementById('profileYoutube').value.trim() || null,
          // Business & compliance
          facebook_business_url:    document.getElementById('profileFacebookBusiness').value.trim() || null,
          facebook_business_url_2:  document.getElementById('profileFacebookBusiness2').value.trim() || null,
          linkedin_url_2:           document.getElementById('profileLinkedin2').value.trim() || null,
          nextdoor_url:             document.getElementById('profileNextdoor').value.trim() || null,
          google_my_business_url:   document.getElementById('profileGoogleMyBusiness').value.trim() || null,
          social_audit_date:        document.getElementById('profileSocialAuditDate').value || null,
          social_audit_notes:       document.getElementById('profileSocialAuditNotes').value.trim() || null,
        }),
      });

      // Save custom links
      const rows = document.querySelectorAll('#customLinksContainer > div');
      for (const row of rows) {
        const label = row.querySelector('.cl-label').value.trim();
        const url = row.querySelector('.cl-url').value.trim();
        if (!label || !url) continue;
        const linkId = row.dataset.linkId;
        if (linkId) {
          await api('/admin/users/' + profileUserId + '/custom-links/' + linkId, {
            method: 'PUT',
            body: JSON.stringify({ label, url }),
          });
        } else {
          const created = await api('/admin/users/' + profileUserId + '/custom-links', {
            method: 'POST',
            body: JSON.stringify({ label, url }),
          });
          if (created) row.dataset.linkId = created.id;
        }
      }

      alert('Social links saved!');
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  // --- Add Custom Link Row ---
  document.getElementById('addCustomLinkBtn').addEventListener('click', () => {
    addCustomLinkRow(null);
  });

  // --- Avatar Upload ---
  document.getElementById('avatarUploadBtn').addEventListener('click', () => {
    document.getElementById('avatarFileInput').click();
  });

  document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return alert('Please select an image file');
    if (file.size > 5 * 1024 * 1024) return alert('Image must be under 5 MB');

    try {
      // 1. Get presigned URL
      const urlData = await api('/admin/users/' + profileUserId + '/avatar/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!urlData) return;

      // 2. Upload to S3
      const uploadRes = await fetch(urlData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Upload to S3 failed');

      // 3. Confirm
      await api('/admin/users/' + profileUserId + '/avatar/confirm', {
        method: 'PUT',
        body: JSON.stringify({ fileKey: urlData.fileKey }),
      });

      // 4. Show preview (backend resets avatar_position for the new photo)
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = document.getElementById('profileAvatarImg');
        img.src = ev.target.result;
        img.style.objectPosition = '50% 50%';
        img.style.display = 'block';
        document.getElementById('profileAvatarInitials').style.display = 'none';
        document.getElementById('avatarRemoveBtn').style.display = '';
        document.getElementById('avatarAdjustBtn').style.display = '';
      };
      reader.readAsDataURL(file);
    } catch (err) {
      alert('Avatar upload failed: ' + err.message);
    }

    e.target.value = ''; // reset file input
  });

  // --- Avatar Remove ---
  document.getElementById('avatarRemoveBtn').addEventListener('click', async () => {
    if (!confirm('Remove profile picture?')) return;
    try {
      await api('/admin/users/' + profileUserId + '/avatar', { method: 'DELETE' });
      document.getElementById('profileAvatarImg').style.display = 'none';
      document.getElementById('profileAvatarInitials').style.display = '';
      document.getElementById('avatarRemoveBtn').style.display = 'none';
      document.getElementById('avatarAdjustBtn').style.display = 'none';
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Avatar Reposition (drag the photo inside the circle) ---
  (function setupAvatarReposition() {
    const container = document.getElementById('profileAvatar');
    const img = document.getElementById('profileAvatarImg');
    const actionRow = document.getElementById('avatarActionRow');
    const controls = document.getElementById('avatarAdjustControls');
    const hint = document.getElementById('avatarAdjustHint');
    let adjusting = false;
    let posBeforeAdjust = '50% 50%';
    let dragStart = null;

    img.draggable = false; // no ghost-image drag while repositioning

    function parsePos(str) {
      const m = /^([\d.]+)%\s+([\d.]+)%$/.exec(str || '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 50, y: 50 };
    }

    function setAdjustMode(on) {
      adjusting = on;
      actionRow.style.display = on ? 'none' : 'flex';
      controls.style.display = on ? 'flex' : 'none';
      hint.style.display = on ? '' : 'none';
      container.style.cursor = on ? 'grab' : '';
      container.style.touchAction = on ? 'none' : '';
    }

    document.getElementById('avatarAdjustBtn').addEventListener('click', () => {
      posBeforeAdjust = img.style.objectPosition || '50% 50%';
      setAdjustMode(true);
    });

    document.getElementById('avatarAdjustCancelBtn').addEventListener('click', () => {
      img.style.objectPosition = posBeforeAdjust;
      setAdjustMode(false);
    });

    document.getElementById('avatarAdjustSaveBtn').addEventListener('click', async () => {
      try {
        await api('/admin/users/' + profileUserId + '/profile', {
          method: 'PUT',
          body: JSON.stringify({ avatar_position: img.style.objectPosition || '50% 50%' }),
        });
        setAdjustMode(false);
      } catch (err) {
        alert('Error saving position: ' + err.message);
      }
    });

    container.addEventListener('pointerdown', (e) => {
      if (!adjusting) return;
      e.preventDefault();
      dragStart = { px: e.clientX, py: e.clientY, ...parsePos(img.style.objectPosition) };
      container.setPointerCapture(e.pointerId);
      container.style.cursor = 'grabbing';
    });

    container.addEventListener('pointermove', (e) => {
      if (!adjusting || !dragStart) return;
      const cw = img.clientWidth, ch = img.clientHeight;
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh || !cw || !ch) return;
      // object-fit: cover — only the overflowing axis can pan; map cursor
      // pixels 1:1 onto the hidden overflow so the photo tracks the pointer.
      const scale = Math.max(cw / nw, ch / nh);
      const overX = nw * scale - cw;
      const overY = nh * scale - ch;
      const dx = e.clientX - dragStart.px;
      const dy = e.clientY - dragStart.py;
      const nx = overX > 0 ? Math.min(100, Math.max(0, dragStart.x - (dx / overX) * 100)) : 50;
      const ny = overY > 0 ? Math.min(100, Math.max(0, dragStart.y - (dy / overY) * 100)) : 50;
      img.style.objectPosition = nx.toFixed(1) + '% ' + ny.toFixed(1) + '%';
    });

    const endDrag = () => {
      dragStart = null;
      if (adjusting) container.style.cursor = 'grab';
    };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
  })();

  // --- QR Code Upload/Remove/Download (generic for slots 1 & 2) ---
  function setupQrCodeHandlers(num) {
    const slug = 'qr-code-' + num;

    document.getElementById('qrCode' + num + 'UploadBtn').addEventListener('click', () => {
      document.getElementById('qrCode' + num + 'FileInput').click();
    });
    document.getElementById('qrCode' + num + 'Container').addEventListener('click', () => {
      document.getElementById('qrCode' + num + 'FileInput').click();
    });

    document.getElementById('qrCode' + num + 'FileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) return alert('Please select an image file');
      if (file.size > 5 * 1024 * 1024) return alert('Image must be under 5 MB');

      try {
        const urlData = await api('/admin/users/' + profileUserId + '/' + slug + '/upload-url', {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, fileType: file.type }),
        });
        if (!urlData) return;

        const uploadRes = await fetch(urlData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!uploadRes.ok) throw new Error('Upload to S3 failed');

        await api('/admin/users/' + profileUserId + '/' + slug + '/confirm', {
          method: 'PUT',
          body: JSON.stringify({ fileKey: urlData.fileKey }),
        });

        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('qrCode' + num + 'Img').src = ev.target.result;
          document.getElementById('qrCode' + num + 'Img').style.display = 'block';
          document.getElementById('qrCode' + num + 'Placeholder').style.display = 'none';
          document.getElementById('qrCode' + num + 'RemoveBtn').style.display = '';
          document.getElementById('qrCode' + num + 'DownloadBtn').style.display = '';
          document.getElementById('qrCode' + num + 'Container').style.borderStyle = 'solid';
        };
        reader.readAsDataURL(file);
      } catch (err) {
        alert('QR code upload failed: ' + err.message);
      }
      e.target.value = '';
    });

    document.getElementById('qrCode' + num + 'RemoveBtn').addEventListener('click', async () => {
      if (!confirm('Remove QR code ' + num + '?')) return;
      try {
        await api('/admin/users/' + profileUserId + '/' + slug, { method: 'DELETE' });
        document.getElementById('qrCode' + num + 'Img').style.display = 'none';
        document.getElementById('qrCode' + num + 'Placeholder').style.display = '';
        document.getElementById('qrCode' + num + 'RemoveBtn').style.display = 'none';
        document.getElementById('qrCode' + num + 'DownloadBtn').style.display = 'none';
        document.getElementById('qrCode' + num + 'Container').style.borderStyle = 'dashed';
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });

    document.getElementById('qrCode' + num + 'DownloadBtn').addEventListener('click', () => {
      const img = document.getElementById('qrCode' + num + 'Img');
      if (img.src && img.style.display !== 'none') {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'qr-code-' + num + '.png';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  }
  setupQrCodeHandlers(1);
  setupQrCodeHandlers(2);

  // --- Email Signature ---

  // Standard MSFG signature (Seth Angell layout). Fixed parts: company, address,
  // fax, website, fraud + confidentiality notices. Variable parts come from the
  // open profile. No DB field exists for job title or the secure-upload link, so
  // those default to editable placeholders the admin completes before saving.
  function msfgSignatureHtml(p) {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const telDigits = String(p.phone || '').replace(/[^\d]/g, '');
    const website = (p.website && p.website.trim()) || 'https://www.msfg.us';
    const websiteText = website.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const photoCell = p.photoUrl
      ? `<td valign="top" style="padding-right: 14px;"><img src="${esc(p.photoUrl)}" alt="${esc(p.name)}" style="width: 110px; height: auto; border: 0; display: block; border-radius: 6px;"></td>`
      : '';
    const infoStyle = p.photoUrl ? 'padding-left: 14px; border-left: 4px solid #8cc63e;' : '';
    return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: #404041; line-height: 1.5; max-width: 700px;">
  <tr>
    ${photoCell}
    <td valign="top" style="${infoStyle}">
      <div style="font-size: 18px; font-weight: bold; color: #104547;">${esc(p.name)}</div>
      <div style="font-size: 14px; font-weight: bold; color: #4b7b4d;">${esc(p.title)}</div>
      <div style="margin-top: 8px; font-weight: bold; color: #404041;">Mountain State Financial Group, LLC</div>
      <div>9035 Wadsworth Pkwy., Ste 3400</div>
      <div>Westminster, CO 80021</div>
      <div style="margin-top: 8px;"><strong>Ph:</strong> <a href="tel:${esc(telDigits)}" style="color: #104547; text-decoration: none;">${esc(p.phone)}</a> &nbsp;|&nbsp; <strong>Fax:</strong> 720-293-0300</div>
      <div><a href="mailto:${esc(p.email)}" style="color: #104547; text-decoration: none;">${esc(p.email)}</a></div>
      <div><a href="${esc(website)}" style="color: #104547; text-decoration: none;" target="_blank">${esc(websiteText)}</a></div>
      <div style="margin-top: 6px; color: #404041;"><strong>NMLS #${esc(p.nmls)}</strong></div>
      <div style="margin-top: 10px;"><span style="color: #404041; font-weight: bold;">SECURE LINK FOR UPLOADING FILES:</span> <a href="${esc(p.secureLink || '#')}" style="color: #8cc63e; font-weight: bold; text-decoration: none;" target="_blank">CLICK HERE</a></div>
      <div style="margin-top: 14px; font-size: 12px; color: #404041;"><strong style="color: #c00000;">WARNING – FRAUDULENT FUNDING INSTRUCTIONS</strong><br>Email hacking and fraud are on the rise to fraudulently misdirect funds. Please call your escrow officer immediately using contact information found from an independent source, such as the sales contract or internet, to verify any funding instruction received. We are not responsible for any wires sent by you to an incorrect bank account.</div>
      <div style="margin-top: 12px; font-size: 11px; color: #666666;"><strong>IMPORTANT NOTICE:</strong> This message is intended only for the addressee and may contain confidential, privileged information. If you are not the intended recipient, you may not use, copy or disclose any information contained in the message. If you have received this message in error, please notify the sender by reply e-mail and delete the message.</div>
    </td>
  </tr>
</table>`;
  }

  // Build the public msfg-media URL for a raw S3 key (encodes each path segment).
  function mediaPublicUrl(key) {
    if (!key) return '';
    const path = String(key).split('/').map(encodeURIComponent).join('/');
    return 'https://msfg-media.s3.us-west-2.amazonaws.com/' + path;
  }

  document.getElementById('signatureGenerateBtn').addEventListener('click', () => {
    const ta = document.getElementById('profileSignatureInput');
    if (ta.value.trim() && !confirm('Replace the current signature with the MSFG template (filled from this profile)? Title and the secure-upload link still need to be filled in.')) return;

    const sig = msfgSignatureHtml({
      name: (profileUserObj && profileUserObj.name) || '',
      title: 'Loan Officer', // no DB field — edit per person (e.g. "Executive VP")
      photoUrl: mediaPublicUrl(profileData && profileData.avatar_s3_key),
      phone: document.getElementById('profilePhone').value.trim(),
      email: document.getElementById('profileDisplayEmail').value.trim() || (profileUserObj && profileUserObj.email) || '',
      website: document.getElementById('profileWebsite').value.trim(),
      nmls: document.getElementById('profileNmls').value.trim(),
      secureLink: '#', // no DB field — paste each person's upload link
    });

    ta.value = sig;
    document.getElementById('signaturePreviewContent').innerHTML = sig;
    document.getElementById('signaturePreview').style.display = 'block';
  });

  document.getElementById('signaturePreviewBtn').addEventListener('click', () => {
    const html = document.getElementById('profileSignatureInput').value;
    const preview = document.getElementById('signaturePreview');
    document.getElementById('signaturePreviewContent').innerHTML = html;
    preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('signatureCopyBtn').addEventListener('click', () => {
    const html = document.getElementById('profileSignatureInput').value;
    navigator.clipboard.writeText(html).then(() => {
      const btn = document.getElementById('signatureCopyBtn');
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy HTML'; }, 2000);
    }).catch(() => alert('Failed to copy'));
  });

  document.getElementById('signatureDownloadBtn').addEventListener('click', () => {
    const html = document.getElementById('profileSignatureInput').value;
    const name = (profileUserObj?.name || 'signature').replace(/\s+/g, '-').toLowerCase();
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '-email-signature.html';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('signatureSaveBtn').addEventListener('click', async () => {
    try {
      await api('/admin/users/' + profileUserId + '/profile', {
        method: 'PUT',
        body: JSON.stringify({
          email_signature: document.getElementById('profileSignatureInput').value,
        }),
      });
      alert('Signature saved!');
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  // --- Business Card Generator (two-sided, MSFG / Compass) ---

  // Company NMLS printed on every card back — compliance requirement.
  const BIZCARD_COMPANY_NMLS = '1314257';
  // Black EHL (Zack's pick). White-background file — rendered with multiply
  // blending so the white disappears on the dark card sections.
  const BIZCARD_EQ_HOUSING = 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/EQ-Housing/EQUAL%20HOUSING%20LENDER.png';
  const BIZCARD_BRANDS = {
    msfg: {
      frontLogo: 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG%20Home%20Loans/MSFGHL-LLC-side.png',
      frontLogoAlt: 'Mountain State Financial Group, LLC Home Loans',
      backLogo: 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG%20Home%20Loans/MSFGHL-LLC-side.png',
      backLogoAlt: 'Mountain State Financial Group, LLC Home Loans',
      backLogoMaxH: 300,
      dark: '#104547',
      lime: '#8cc63e',
      divider: 'border-top: 5px solid #8cc63e;',
      fax: '720-293-0300',
      defaultWebsite: 'msfg.us',
    },
    compass: {
      frontLogo: 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/Compass/Compass%20Home%20Loan%20-%20Color%20Transparent%20Background.png',
      frontLogoAlt: 'Compass Home Loans',
      backLogo: 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/Compass/Compass%20Home%20Loan%20-%20Color%20Transparent%20Background.png',
      backLogoAlt: 'Compass Home Loans',
      backLogoMaxH: 300,
      dark: '#1f4e50',
      lime: '#8cc63e',
      divider: '',
      fax: '', // the Compass card layout carries no fax row
      defaultWebsite: 'CompassHL.us',
    },
  };

  // Resolve a stored value that may be a raw msfg-media key OR an external URL.
  function mediaUrlOrPassthrough(value) {
    if (!value) return '';
    return /^https?:\/\//.test(value) ? value : mediaPublicUrl(value);
  }

  function bizcardEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Phone numbers print with dashes regardless of how they were stored:
  // "(303) 870-6518", "3038706518", "1-303-870-6518" all become 303-870-6518.
  function formatPhoneDashes(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    const ten = digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
    if (ten.length === 10) return ten.slice(0, 3) + '-' + ten.slice(3, 6) + '-' + ten.slice(6);
    return String(raw || '').trim();
  }

  // Card FRONT (1050x600 = 3.5x2in at 300dpi). No QR — it lives on the back
  // now. Headshot circle straddles the white/dark boundary on the right
  // (Compass reference layout); Equal Housing logo is the black version.
  // Print: @page 3.5x2in with zoom scaling so text stays vector-crisp.
  function bizcardFrontHtml(p) {
    const esc = bizcardEsc;
    const brand = BIZCARD_BRANDS[p.brand] || BIZCARD_BRANDS.msfg;
    const websiteText = ((p.website && p.website.trim()) || brand.defaultWebsite)
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const nmlsText = String(p.nmls || '').replace(/^#/, '');
    const headshotWrap = p.showPhoto === false ? '' : `<div class="headshot-wrap">
      ${p.photoUrl ? `<img class="headshot" src="${esc(p.photoUrl)}"${p.photoPos ? ` style="object-position: ${p.photoPos};"` : ''} alt="${esc(p.name)}" />` : ''}
    </div>`;
    const rows = [['Phone', formatPhoneDashes(p.phone)]];
    if (brand.fax) rows.push(['Fax', brand.fax]);
    rows.push(['Email', p.email], ['Web', websiteText], ['NMLS', '#' + nmlsText]);
    const rowsHtml = rows.map(([label, value]) =>
      `<div class="contact-row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`
    ).join('\n          ');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.name)} Business Card — Front</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
      background: #e9eeee;
      font-family: Arial, Helvetica, sans-serif;
    }
    .card {
      position: relative;
      width: 1050px;
      height: 600px;
      background: #ffffff;
      overflow: hidden;
      border-radius: 8px;
      box-shadow: 0 18px 55px rgba(16, 69, 71, 0.22);
    }
    .bc-front .top {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 330px;
      background: #ffffff;
      padding: 36px 48px 0;
    }
    .bc-front .company-logo {
      display: block;
      max-width: 640px;
      max-height: 190px;
      object-fit: contain;
      object-position: left center;
      margin-bottom: 18px;
    }
    .bc-front .name {
      margin: 0;
      color: ${brand.dark};
      font-size: 46px;
      line-height: 1;
      letter-spacing: 1px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .bc-front .title {
      margin: 8px 0 0;
      color: #404041;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 700;
      text-transform: uppercase;
    }
    .bc-front .bottom {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 270px;
      background: ${brand.dark};
      ${brand.divider}
      padding: 30px 48px;
      color: #ffffff;
    }
    .bc-front .contact-list {
      display: grid;
      gap: 12px;
      max-width: 620px;
    }
    .bc-front .contact-row {
      display: grid;
      grid-template-columns: 130px 1fr;
      align-items: baseline;
      column-gap: 14px;
      font-size: 29px;
      line-height: 1.05;
    }
    .bc-front .label {
      color: ${brand.lime};
      font-size: 24px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .bc-front .value {
      color: #ffffff;
      font-weight: 400;
      overflow-wrap: anywhere;
    }
    .bc-front .headshot-wrap {
      position: absolute;
      top: 58px;
      right: 64px;
      width: 340px;
      height: 340px;
      border-radius: 50%;
      overflow: hidden;
      border: 6px solid #ffffff;
      background: #d8e6e6;
      box-shadow: 0 6px 24px rgba(16, 69, 71, 0.25);
      z-index: 2;
    }
    .bc-front .headshot {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .bc-front .equal-housing-logo {
      position: absolute;
      right: 48px;
      bottom: 22px;
      width: 120px;
      height: auto;
      object-fit: contain;
      mix-blend-mode: multiply; /* white box vanishes on the dark section */
    }
    @media print {
      @page { size: 3.5in 2in; margin: 0; }
      body { padding: 0; background: transparent; min-height: 0; display: block; }
      .card { zoom: 0.32; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>

  <article class="card bc-front">

    <section class="top">
      <img class="company-logo" src="${brand.frontLogo}" alt="${esc(brand.frontLogoAlt)}" />
      <h1 class="name">${esc(p.name)}</h1>
      <p class="title">${esc(p.title)}</p>
    </section>

    <section class="bottom">
      <div class="contact-list">
          ${rowsHtml}
      </div>
    </section>

    ${headshotWrap}

    <img class="equal-housing-logo" src="${BIZCARD_EQ_HOUSING}" alt="Equal Housing Lender" />

  </article>

</body>
</html>`;
  }

  // Card BACK (1050x600). Brand logo + company NMLS (compliance). With QR
  // enabled: logo left, QR right (Compass reference). Without: centered
  // logo-only back (MSFG reference).
  function bizcardBackHtml(p) {
    const esc = bizcardEsc;
    const brand = BIZCARD_BRANDS[p.brand] || BIZCARD_BRANDS.msfg;
    const showQr = p.showQr === true;
    const qrImg = p.qrUrl
      ? `<img class="back-qr" src="${esc(p.qrUrl)}" alt="Scan ${esc(p.name)} QR code" />`
      : `<div class="back-qr back-qr-missing">QR Code ${p.qrSlot || 2}<br />not uploaded</div>`;
    const wrapClass = showQr ? 'wrap wrap-qr' : 'wrap wrap-center';
    const qrPanel = showQr ? `
    <div class="qr-panel">
      ${qrImg}
    </div>` : '';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.name)} Business Card — Back</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
      background: #e9eeee;
      font-family: Arial, Helvetica, sans-serif;
    }
    .card {
      position: relative;
      width: 1050px;
      height: 600px;
      background: #ffffff;
      overflow: hidden;
      border-radius: 8px;
      box-shadow: 0 18px 55px rgba(16, 69, 71, 0.22);
    }
    .bc-back .wrap {
      height: 100%;
      display: grid;
      align-items: center;
    }
    .bc-back .wrap-center {
      place-items: center;
      padding: 44px;
    }
    .bc-back .wrap-qr {
      grid-template-columns: minmax(0, 1fr) 380px;
      gap: 40px;
      padding: 44px 80px;
    }
    .bc-back .brand-block {
      text-align: center;
    }
    .bc-back .back-logo {
      display: block;
      max-width: 100%;
      max-height: ${brand.backLogoMaxH}px;
      object-fit: contain;
      margin: 0 auto;
    }
    .bc-back .back-nmls {
      margin-top: 16px;
      color: ${brand.dark};
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 1px;
      text-align: center;
    }
    .bc-back .qr-panel {
      justify-self: center;
    }
    .bc-back .back-qr {
      display: block;
      width: 340px;
      height: 340px;
      object-fit: contain;
    }
    .bc-back .back-qr-missing {
      display: grid;
      place-items: center;
      border: 2px dashed #c5d4d4;
      border-radius: 12px;
      color: #9ab0b0;
      font-size: 22px;
      text-align: center;
    }
    @media print {
      @page { size: 3.5in 2in; margin: 0; }
      body { padding: 0; background: transparent; min-height: 0; display: block; }
      .card { zoom: 0.32; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>

  <article class="card bc-back">

    <div class="${wrapClass}">

      <div class="brand-block">
        <img class="back-logo" src="${brand.backLogo}" alt="${esc(brand.backLogoAlt)}" />
        <div class="back-nmls">NMLS #${BIZCARD_COMPANY_NMLS}</div>
      </div>
${qrPanel}

    </div>

  </article>

</body>
</html>`;
  }
  // Everything below reads the editable textareas, so manual edits to the
  // generated HTML are always honored by Preview / Save / Print / PNG / HTML.
  function currentBizcardFront() {
    return document.getElementById('bizcardFrontInput').value;
  }
  function currentBizcardBack() {
    return document.getElementById('bizcardBackInput').value;
  }

  // QR-slot selector greys out when "Include QR code" is unchecked. Switching
  // brand resets the QR default: Compass backs ship with a QR (to their site),
  // MSFG backs default to logo-only.
  (function () {
    const showQr = document.getElementById('bizcardShowQr');
    const qrSelect = document.getElementById('bizcardQrSelect');
    const sync = () => {
      qrSelect.disabled = !showQr.checked;
      qrSelect.style.opacity = showQr.checked ? '1' : '0.5';
    };
    showQr.addEventListener('change', sync);
    document.getElementById('bizcardBrandSelect').addEventListener('change', (e) => {
      showQr.checked = e.target.value === 'compass';
      sync();
    });
    sync();
  })();

  function renderBizcardPreviews() {
    document.getElementById('bizcardPreviewFrontFrame').srcdoc = currentBizcardFront();
    document.getElementById('bizcardPreviewBackFrame').srcdoc = currentBizcardBack();
  }

  // Single source for template inputs — used by Generate and the PNG export.
  function bizcardBuildParams() {
    const showQr = document.getElementById('bizcardShowQr').checked;
    const qrSlot = document.getElementById('bizcardQrSelect').value === '1' ? 1 : 2;
    return {
      brand: document.getElementById('bizcardBrandSelect').value === 'compass' ? 'compass' : 'msfg',
      name: (profileUserObj && profileUserObj.name) || '',
      title: document.getElementById('bizcardTitleInput').value.trim() || 'Mortgage Loan Originator',
      photoUrl: mediaUrlOrPassthrough(profileData && profileData.avatar_s3_key),
      // Stored circle-crop position ("50% 30%"); strict format check since it
      // lands in a style attribute and in canvas math. Empty = centered.
      photoPos: /^[\d.]+% [\d.]+%$/.test((profileData && profileData.avatar_position) || '')
        ? profileData.avatar_position : '',
      showPhoto: document.getElementById('bizcardShowPhoto').checked,
      showQr,
      qrSlot,
      qrUrl: showQr ? mediaUrlOrPassthrough(profileData && profileData['qr_code_' + qrSlot + '_s3_key']) : '',
      phone: document.getElementById('profilePhone').value.trim(),
      email: document.getElementById('profileDisplayEmail').value.trim() || (profileUserObj && profileUserObj.email) || '',
      website: document.getElementById('profileWebsite').value.trim(),
      nmls: document.getElementById('profileNmls').value.trim(),
    };
  }

  document.getElementById('bizcardGenerateBtn').addEventListener('click', () => {
    const frontTa = document.getElementById('bizcardFrontInput');
    const backTa = document.getElementById('bizcardBackInput');
    if ((frontTa.value.trim() || backTa.value.trim()) &&
        !confirm('Replace the current front & back HTML with freshly generated cards from this profile?')) return;

    const p = bizcardBuildParams();

    frontTa.value = bizcardFrontHtml(p);
    backTa.value = bizcardBackHtml(p);

    const missing = [];
    if (p.showPhoto !== false && !p.photoUrl) missing.push('profile photo (Basic Info tab)');
    if (p.showQr && !p.qrUrl) missing.push('QR Code ' + p.qrSlot + ' (Basic Info tab)');
    if (!p.phone) missing.push('phone');
    if (!p.nmls) missing.push('NMLS #');
    const missingEl = document.getElementById('bizcardMissing');
    if (missing.length) {
      missingEl.textContent = 'Missing from this profile: ' + missing.join(', ') + '. Fill in and regenerate.';
      missingEl.style.display = 'block';
    } else {
      missingEl.style.display = 'none';
    }

    renderBizcardPreviews();
    document.getElementById('bizcardPreview').style.display = 'block';
  });

  document.getElementById('bizcardPreviewBtn').addEventListener('click', () => {
    if (!currentBizcardFront().trim() && !currentBizcardBack().trim()) {
      alert('Nothing to preview yet — click Generate first.');
      return;
    }
    const preview = document.getElementById('bizcardPreview');
    renderBizcardPreviews();
    preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('bizcardSaveBtn').addEventListener('click', async () => {
    try {
      const front = currentBizcardFront();
      const back = currentBizcardBack();
      const brand = document.getElementById('bizcardBrandSelect').value;
      await api('/admin/users/' + profileUserId + '/profile', {
        method: 'PUT',
        body: JSON.stringify({
          business_card_html: front,
          business_card_back_html: back,
          business_card_brand: brand,
        }),
      });
      if (profileData) {
        profileData.business_card_html = front;
        profileData.business_card_back_html = back;
        profileData.business_card_brand = brand;
      }
      alert('Business card saved!');
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  // Merge front + back docs into one two-page document for printing or
  // download. Styles are scoped (.bc-front / .bc-back) so they don't collide;
  // the shared .card base rules are identical in both docs.
  function bizcardCombinedDoc(frontHtml, backHtml) {
    const parse = (html) => {
      const d = new DOMParser().parseFromString(html, 'text/html');
      const card = d.querySelector('.card');
      return {
        styles: Array.prototype.map.call(d.querySelectorAll('style'), (s) => s.textContent).join('\n'),
        card: card ? card.outerHTML : '',
      };
    };
    const f = parse(frontHtml);
    const b = parse(backHtml);
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>Business Card</title>\n<style>\n' +
      f.styles + '\n' + b.styles + '\n' +
      'body { margin: 0; min-height: 0; display: block; padding: 24px; background: #e9eeee; }\n' +
      '.card { margin: 0 auto 24px; }\n' +
      '@media print { body { padding: 0; background: transparent; } .card { margin: 0; page-break-after: always; } .card:last-child { page-break-after: auto; } }\n' +
      '</style>\n</head>\n<body>\n' + f.card + '\n' + b.card + '\n</body>\n</html>';
  }

  document.getElementById('bizcardPrintBtn').addEventListener('click', () => {
    const front = currentBizcardFront();
    const back = currentBizcardBack();
    if (!front.trim() && !back.trim()) return;
    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked — allow popups for this site to print.'); return; }
    w.document.write(bizcardCombinedDoc(front, back));
    w.document.close();
  });

  document.getElementById('bizcardDownloadBtn').addEventListener('click', () => {
    const front = currentBizcardFront();
    const back = currentBizcardBack();
    if (!front.trim() && !back.trim()) return;
    const name = (profileUserObj?.name || 'business-card').replace(/\s+/g, '-').toLowerCase();
    const blob = new Blob([bizcardCombinedDoc(front, back)], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '-business-card.html';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // --- PNG export: native canvas rendering ---
  // Deliberately NOT an HTML rasterization: SVG foreignObject taints the
  // canvas in WebKit (and some embedded engines), which kills toBlob(). The
  // card geometry is fixed, so each side is drawn directly with 2D canvas
  // calls mirroring the template layout. PNG renders the standard template
  // from profile data — hand-edits to the HTML boxes affect Print/HTML only.

  function loadBizImage(url) {
    return fetch(url, { mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error('Could not load image: ' + url); return r.blob(); })
      .then((b) => createImageBitmap(b));
  }

  // CSS max-width/max-height contain behavior (never upscales).
  function bizContain(img, maxW, maxH) {
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    return { w: img.width * s, h: img.height * s };
  }

  // All coordinates in card space (1050x600) — caller pre-scales the context.
  async function bizcardDrawFront(ctx, p) {
    const brand = BIZCARD_BRANDS[p.brand] || BIZCARD_BRANDS.msfg;
    const [logo, ehl, photo] = await Promise.all([
      loadBizImage(brand.frontLogo),
      loadBizImage(BIZCARD_EQ_HOUSING),
      p.showPhoto !== false && p.photoUrl ? loadBizImage(p.photoUrl) : Promise.resolve(null),
    ]);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1050, 600);
    if (brand.divider) {
      ctx.fillStyle = brand.lime;
      ctx.fillRect(0, 330, 1050, 5);
      ctx.fillStyle = brand.dark;
      ctx.fillRect(0, 335, 1050, 265);
    } else {
      ctx.fillStyle = brand.dark;
      ctx.fillRect(0, 330, 1050, 270);
    }

    const lg = bizContain(logo, 640, 190);
    ctx.drawImage(logo, 48, 36, lg.w, lg.h);

    const nameY = 36 + lg.h + 18;
    ctx.textBaseline = 'top';
    ctx.fillStyle = brand.dark;
    ctx.font = '800 46px Arial';
    ctx.fillText(String(p.name || '').toUpperCase(), 48, nameY);
    ctx.fillStyle = '#404041';
    ctx.font = '700 24px Arial';
    ctx.fillText(String(p.title || '').toUpperCase(), 48, nameY + 46 + 8);

    const websiteText = ((p.website && p.website.trim()) || brand.defaultWebsite)
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const rows = [['PHONE', formatPhoneDashes(p.phone)]];
    if (brand.fax) rows.push(['FAX', brand.fax]);
    rows.push(
      ['EMAIL', p.email],
      ['WEB', websiteText],
      ['NMLS', '#' + String(p.nmls || '').replace(/^#/, '')]
    );
    const rowsTop = (brand.divider ? 335 : 330) + 30;
    ctx.textBaseline = 'alphabetic';
    rows.forEach(([label, value], i) => {
      const baseY = rowsTop + i * 42.5 + 24;
      ctx.fillStyle = brand.lime;
      ctx.font = '800 24px Arial';
      ctx.fillText(label, 48, baseY);
      ctx.fillStyle = '#ffffff';
      ctx.font = '400 29px Arial';
      ctx.fillText(String(value == null ? '' : value), 192, baseY);
    });

    // EHL: multiply drops its white background into the dark band. Drawn
    // before the headshot so the photo never gets blended.
    const ehW = 120;
    const ehH = 120 * (ehl.height / ehl.width);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(ehl, 1050 - 48 - ehW, 600 - 22 - ehH, ehW, ehH);
    ctx.restore();

    // Headshot: white ring circle straddling the boundary, cover-cropped.
    // Skipped entirely when the photo option is off.
    if (p.showPhoto !== false) {
      const cx = 1050 - 64 - 170;
      const cy = 58 + 170;
      const r = 170;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
      ctx.clip();
      if (photo) {
        const d = (r - 6) * 2;
        const s = Math.max(d / photo.width, d / photo.height);
        const dw = photo.width * s;
        const dh = photo.height * s;
        // Same semantics as CSS object-position: the stored fraction of the
        // cover-overflow is hidden on the leading edge (0.5 = centered).
        const m = /^([\d.]+)% ([\d.]+)%$/.exec(p.photoPos || '');
        const fx = m ? Math.min(100, parseFloat(m[1])) / 100 : 0.5;
        const fy = m ? Math.min(100, parseFloat(m[2])) / 100 : 0.5;
        ctx.drawImage(photo, (cx - d / 2) - (dw - d) * fx, (cy - d / 2) - (dh - d) * fy, dw, dh);
      } else {
        ctx.fillStyle = '#d8e6e6';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  async function bizcardDrawBack(ctx, p) {
    const brand = BIZCARD_BRANDS[p.brand] || BIZCARD_BRANDS.msfg;
    const showQr = p.showQr === true;
    const [logo, qr] = await Promise.all([
      loadBizImage(brand.backLogo),
      showQr && p.qrUrl ? loadBizImage(p.qrUrl) : Promise.resolve(null),
    ]);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1050, 600);

    const drawBrandBlock = (centerX, maxW) => {
      const lg = bizContain(logo, maxW, brand.backLogoMaxH);
      const blockH = lg.h + 16 + 34;
      const top = (600 - blockH) / 2;
      ctx.drawImage(logo, centerX - lg.w / 2, top, lg.w, lg.h);
      ctx.fillStyle = brand.dark;
      ctx.font = '700 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('NMLS #' + BIZCARD_COMPANY_NMLS, centerX, top + lg.h + 16 + 28);
      ctx.textAlign = 'left';
    };

    if (showQr) {
      // wrap-qr: padding 44/80, columns 1fr 380px, gap 40 -> left col 80..550
      drawBrandBlock(315, 470);
      if (qr) ctx.drawImage(qr, 610, 130, 340, 340);
    } else {
      drawBrandBlock(525, 962);
    }
  }

  async function downloadBizcardPng(side) {
    const btn = document.getElementById(side === 'front' ? 'bizcardPngFrontBtn' : 'bizcardPngBackBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rendering...';
    btn.disabled = true;
    try {
      const p = bizcardBuildParams();
      const canvas = document.createElement('canvas');
      canvas.width = 2100;  // 600dpi at 3.5in
      canvas.height = 1200;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      if (side === 'front') await bizcardDrawFront(ctx, p);
      else await bizcardDrawBack(ctx, p);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
      const name = (profileUserObj?.name || 'business-card').replace(/\s+/g, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '-business-card-' + side + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('PNG export failed: ' + err.message);
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
    }
  }

  document.getElementById('bizcardPngFrontBtn').addEventListener('click', () => downloadBizcardPng('front'));
  document.getElementById('bizcardPngBackBtn').addEventListener('click', () => downloadBizcardPng('back'));

  // --- AI Keys ---
  // Capitalize the first letter so 'openai' -> 'Openai', 'deepseek' -> 'Deepseek'
  // — matches the DOM id convention (aiOpenaiStatus, aiAnthropicStatus, aiDeepseekStatus).
  function aiServiceId(service) {
    return service.charAt(0).toUpperCase() + service.slice(1);
  }

  function updateAIStatus(service, data) {
    const el = document.getElementById('ai' + aiServiceId(service) + 'Status');
    if (!el) return;
    if (data && data.maskedValue) {
      el.innerHTML = '<span style="color:#2e7d32;"><i class="fas fa-check-circle"></i> Configured</span> — ' + escHtml(data.maskedValue);
    } else {
      el.innerHTML = '<span style="color:#999;"><i class="fas fa-times-circle"></i> Not configured</span>';
    }
  }

  const AI_SERVICES = ['openai', 'anthropic', 'deepseek'];

  async function loadAIKeys() {
    try {
      const keys = await api('/admin/users/' + profileUserId + '/integrations');
      if (!keys) return;
      AI_SERVICES.forEach(s => updateAIStatus(s, null));
      keys.forEach(k => updateAIStatus(k.service, k));
    } catch (err) {
      console.error('Load AI keys error:', err);
    }
  }

  async function saveAIKey(service) {
    const inputId = 'ai' + aiServiceId(service) + 'Input';
    const value = document.getElementById(inputId).value.trim();
    if (!value) return alert('Please enter an API key');

    try {
      const result = await api('/admin/users/' + profileUserId + '/integrations', {
        method: 'POST',
        body: JSON.stringify({ service, value }),
      });
      if (result) {
        document.getElementById(inputId).value = '';
        loadAIKeys();
        alert('API key saved!');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  async function clearAIKey(service) {
    if (!confirm('Remove this API key?')) return;
    try {
      await api('/admin/users/' + profileUserId + '/integrations/' + service, { method: 'DELETE' });
      loadAIKeys();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  document.getElementById('aiOpenaiSaveBtn').addEventListener('click', () => saveAIKey('openai'));
  document.getElementById('aiOpenaiClearBtn').addEventListener('click', () => clearAIKey('openai'));
  document.getElementById('aiAnthropicSaveBtn').addEventListener('click', () => saveAIKey('anthropic'));
  document.getElementById('aiAnthropicClearBtn').addEventListener('click', () => clearAIKey('anthropic'));
  document.getElementById('aiDeepseekSaveBtn').addEventListener('click', () => saveAIKey('deepseek'));
  document.getElementById('aiDeepseekClearBtn').addEventListener('click', () => clearAIKey('deepseek'));

  // --- Notes ---
  async function loadNotes() {
    const container = document.getElementById('notesList');
    container.innerHTML = '<p style="text-align:center; color:#999; font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';

    try {
      const notes = await api('/admin/users/' + profileUserId + '/notes');
      if (!notes) return;

      if (notes.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; font-size:13px;">No notes yet.</p>';
        return;
      }

      container.innerHTML = notes.map(n => {
        const date = new Date(n.created_at);
        const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          + ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return (
          '<div class="note-card" data-note-id="' + n.id + '">' +
            '<div class="note-header">' +
              '<span class="note-author">' + escHtml(n.author_name) + '</span>' +
              '<span class="note-date">' + escHtml(dateStr) + '</span>' +
              '<button class="btn btn-sm btn-danger delete-note-btn" data-id="' + n.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</div>' +
            '<div class="note-body">' + escHtml(n.note) + '</div>' +
          '</div>'
        );
      }).join('');

      container.querySelectorAll('.delete-note-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteNote(btn.dataset.id));
      });
    } catch (err) {
      container.innerHTML = '<p style="text-align:center; color:#e74c3c; font-size:13px;">Failed to load notes.</p>';
    }
  }

  document.getElementById('addNoteBtn').addEventListener('click', async () => {
    const input = document.getElementById('noteInput');
    const note = input.value.trim();
    if (!note) return alert('Please enter a note');

    try {
      await api('/admin/users/' + profileUserId + '/notes', {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      input.value = '';
      loadNotes();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await api('/admin/users/' + profileUserId + '/notes/' + noteId, { method: 'DELETE' });
      loadNotes();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // --- Documents ---
  async function loadDocuments() {
    const tbody = document.getElementById('documentsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
      const docs = await api('/admin/users/' + profileUserId + '/documents');
      if (!docs) return;

      if (docs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">No documents uploaded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = docs.map(d => {
        const date = new Date(d.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const size = d.file_size ? formatFileSize(d.file_size) : '—';
        const cat = d.category ? '<span class="doc-category">' + escHtml(d.category) + '</span>' : '—';
        return (
          '<tr>' +
            '<td><strong>' + escHtml(d.file_name) + '</strong>' +
              (d.description ? '<br><small style="color:#666;">' + escHtml(d.description) + '</small>' : '') +
            '</td>' +
            '<td>' + cat + '</td>' +
            '<td>' + escHtml(size) + '</td>' +
            '<td>' + escHtml(d.uploader_name) + '</td>' +
            '<td>' + escHtml(date) + '</td>' +
            '<td>' +
              '<button class="btn btn-sm btn-secondary download-doc-btn" data-id="' + d.id + '" title="Download"><i class="fas fa-download"></i></button> ' +
              '<button class="btn btn-sm btn-danger delete-doc-btn" data-id="' + d.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</td>' +
          '</tr>'
        );
      }).join('');

      tbody.querySelectorAll('.download-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => downloadDoc(btn.dataset.id));
      });
      tbody.querySelectorAll('.delete-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteDoc(btn.dataset.id));
      });
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#e74c3c;">Failed to load documents.</td></tr>';
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function downloadDoc(docId) {
    try {
      const data = await api('/admin/users/' + profileUserId + '/documents/' + docId + '/download-url');
      if (data && data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
      }
    } catch (err) {
      alert('Download error: ' + err.message);
    }
  }

  async function deleteDoc(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await api('/admin/users/' + profileUserId + '/documents/' + docId, { method: 'DELETE' });
      loadDocuments();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // Document upload zone
  const docZone = document.getElementById('docUploadZone');
  const docInput = document.getElementById('docFileInput');

  docZone.addEventListener('click', () => docInput.click());
  docZone.addEventListener('dragover', (e) => { e.preventDefault(); docZone.classList.add('dragover'); });
  docZone.addEventListener('dragleave', () => docZone.classList.remove('dragover'));
  docZone.addEventListener('drop', (e) => {
    e.preventDefault();
    docZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleDocUpload(e.dataTransfer.files);
  });
  docInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleDocUpload(e.target.files);
    e.target.value = '';
  });

  async function handleDocUpload(files) {
    const progressEl = document.getElementById('docUploadProgress');
    const statusText = document.getElementById('docUploadStatusText');
    const fill = document.getElementById('docUploadProgressFill');
    const category = document.getElementById('docCategoryUpload').value;
    const description = document.getElementById('docDescriptionInput').value.trim();

    progressEl.style.display = 'block';
    const total = files.length;
    let done = 0;

    for (const file of files) {
      try {
        statusText.textContent = 'Uploading ' + file.name + ' (' + (done + 1) + '/' + total + ')...';
        fill.style.width = ((done / total) * 100) + '%';

        // 1. Get presigned URL
        const urlData = await api('/admin/users/' + profileUserId + '/documents/upload-url', {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, fileType: file.type }),
        });
        if (!urlData) continue;

        // 2. Upload to S3
        const uploadRes = await fetch(urlData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error('S3 upload failed for ' + file.name);

        // 3. Confirm
        await api('/admin/users/' + profileUserId + '/documents/confirm', {
          method: 'POST',
          body: JSON.stringify({
            fileKey: urlData.fileKey,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            category: category || null,
            description: description || null,
          }),
        });

        done++;
        fill.style.width = ((done / total) * 100) + '%';
      } catch (err) {
        console.error('Upload error for', file.name, err);
        alert('Failed to upload ' + file.name + ': ' + err.message);
      }
    }

    statusText.textContent = done + ' of ' + total + ' files uploaded.';
    fill.style.width = '100%';
    setTimeout(() => { progressEl.style.display = 'none'; fill.style.width = '0'; }, 2000);

    // Clear description field
    document.getElementById('docDescriptionInput').value = '';

    loadDocuments();
  }

  /* ═══════════════════════════════════════
     INVESTORS TAB
  ═══════════════════════════════════════ */
  let investorsList = [];
  let currentInvestorId = null;
  let currentInvestorData = null;

  async function loadInvestors() {
    const tbody = document.getElementById('investorsBody');
    tbody.innerHTML = '<tr><td colspan="5" class="state-msg"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></td></tr>';

    try {
      const investors = await api('/investors?all=true');
      if (!investors) return;
      investorsList = investors;

      if (investors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="state-msg"><p>No investors.</p></td></tr>';
        return;
      }

      tbody.innerHTML = investors.map(inv => {
        const active = inv.is_active === 1 || inv.is_active === true;
        return '<tr data-inv-id="' + inv.id + '" style="' + (active ? '' : 'opacity:0.55;') + '">' +
        '<td><strong>' + escHtml(inv.name) + '</strong>' + (active ? '' : ' <span style="font-size:11px; color:#e74c3c; font-weight:600;">(Inactive)</span>') + '</td>' +
        '<td>' + escHtml(inv.account_executive_name || '--') + '</td>' +
        '<td>' + escHtml(inv.states || '--') + '</td>' +
        '<td>' + escHtml(inv.best_programs || '--') + '</td>' +
        '<td>' +
          '<button class="btn btn-sm btn-secondary inv-edit-btn" data-key="' + escHtml(inv.investor_key) + '" title="Edit"><i class="fas fa-pen"></i></button> ' +
          '<button class="btn btn-sm btn-danger inv-delete-btn" data-id="' + inv.id + '" data-name="' + escHtml(inv.name) + '" title="Delete"><i class="fas fa-trash"></i></button>' +
        '</td>' +
        '</tr>';
      }).join('');

      // Edit buttons → open profile
      tbody.querySelectorAll('.inv-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => showInvestorProfile(btn.dataset.key));
      });

      // Delete buttons
      tbody.querySelectorAll('.inv-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteInvestor(btn.dataset.id, btn.dataset.name));
      });
    } catch (err) {
      console.error('Load investors error:', err);
      tbody.innerHTML = '<tr><td colspan="5" class="state-msg" style="color:#e74c3c;"><p>Failed to load investors.</p></td></tr>';
    }
  }

  // --- Quick Add / Edit form ---
  const invQuickForm = document.getElementById('investorQuickForm');
  const invQuickFormTitle = document.getElementById('investorQuickFormTitle');

  document.getElementById('addInvestorBtn').addEventListener('click', () => {
    document.getElementById('invNameInput').value = '';
    document.getElementById('invAeNameInput').value = '';
    invQuickFormTitle.textContent = 'Add Investor';
    invQuickForm.classList.add('active');
  });

  document.getElementById('invQuickCancelBtn').addEventListener('click', () => {
    invQuickForm.classList.remove('active');
  });

  document.getElementById('invQuickSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('invNameInput').value.trim();
    if (!name) return alert('Please enter an investor name.');

    try {
      await api('/investors', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          account_executive_name: document.getElementById('invAeNameInput').value.trim() || null,
        }),
      });
      invQuickForm.classList.remove('active');
      loadInvestors();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  async function deleteInvestor(id, name) {
    if (!confirm('Delete investor "' + name + '"? This cannot be undone.')) return;
    try {
      await api('/investors/' + id, { method: 'DELETE' });
      loadInvestors();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // --- Investor Profile Detail View ---
  async function showInvestorProfile(investorKey) {
    try {
      const data = await api('/investors/' + encodeURIComponent(investorKey));
      if (!data) return;

      currentInvestorData = data;
      currentInvestorId = data.id;

      // Hide table, show profile
      document.getElementById('investorsTable').style.display = 'none';
      document.getElementById('investorListToolbar').style.display = 'none';
      invQuickForm.classList.remove('active');
      document.getElementById('investorProfileView').style.display = 'block';
      document.getElementById('invProfileTitle').textContent = data.name + ' — Profile';
      document.getElementById('invProfileName').textContent = data.name;

      // Reset sub-tabs to Basic Info
      document.querySelectorAll('#invProfileTabs .profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.inv-profile-section').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-inv-tab="inv-basic"]').classList.add('active');
      document.getElementById('inv-basic').classList.add('active');

      // Populate Basic Info
      populateInvestorBasicInfo(data);

      // Populate sub-sections
      populateInvestorAes(data.aes || []);
      populateInvestorTeam(data.team || []);
      // Turn times removed
      populateInvestorLenderIds(data.lenderIds || {});
      populateInvestorClauses(data.mortgageeClauses || []);
      populateInvestorLinks(data.links || []);

      // Documents
      loadInvestorDocs();

      // Logo
      loadInvestorLogo(data);

      // Active toggle
      const activeToggle = document.getElementById('invActiveToggle');
      const activeLabel = document.getElementById('invActiveLabel');
      const isActive = data.is_active === 1 || data.is_active === true;
      activeToggle.checked = isActive;
      activeLabel.textContent = isActive ? 'Active' : 'Inactive';
      activeLabel.style.color = isActive ? '#8cc63E' : '#e74c3c';
    } catch (err) {
      alert('Error loading investor: ' + err.message);
    }
  }

  function hideInvestorProfile() {
    document.getElementById('investorProfileView').style.display = 'none';
    document.getElementById('investorsTable').style.display = '';
    document.getElementById('investorListToolbar').style.display = '';
    currentInvestorId = null;
    currentInvestorData = null;
  }

  // Back button
  document.getElementById('invProfileBackBtn').addEventListener('click', () => {
    hideInvestorProfile();
    loadInvestors();
  });

  // Active toggle in profile
  document.getElementById('invActiveToggle').addEventListener('change', async (e) => {
    if (!currentInvestorId) return;
    const label = document.getElementById('invActiveLabel');
    try {
      const result = await api('/investors/' + currentInvestorId + '/toggle-active', { method: 'PATCH' });
      if (result) {
        const nowActive = result.is_active === 1 || result.is_active === true;
        e.target.checked = nowActive;
        label.textContent = nowActive ? 'Active' : 'Inactive';
        label.style.color = nowActive ? '#8cc63E' : '#e74c3c';
      }
    } catch (err) {
      console.error('Toggle active error:', err);
      e.target.checked = !e.target.checked;
    }
  });

  // Investor sub-tab switching (scoped to investor profile)
  document.querySelectorAll('#invProfileTabs .profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#invProfileTabs .profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.inv-profile-section').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.invTab).classList.add('active');
    });
  });

  // --- Populate Basic Info ---
  function populateInvestorBasicInfo(data) {
    document.getElementById('invEditName').value = data.name || '';
    document.getElementById('invEditAeName').value = data.account_executive_name || '';
    document.getElementById('invEditAeEmail').value = data.account_executive_email || '';
    document.getElementById('invEditAePhone').value = data.account_executive_mobile || '';
    document.getElementById('invEditStates').value = data.states || '';
    document.getElementById('invEditBestPrograms').value = data.best_programs || '';
    document.getElementById('invEditMinFico').value = data.minimum_fico || '';
    document.getElementById('invEditDpa').value = data.in_house_dpa || '';
    document.getElementById('invEditEpo').value = data.epo || '';
    document.getElementById('invEditMaxComp').value = data.max_comp ?? '';
    document.getElementById('invEditUnderwritingFee').value = data.underwriting_fee || '';
    document.getElementById('invEditInHouseServicing').value = data.in_house_servicing || '';
    document.getElementById('invEditAdverseActionNotice').value = data.adverse_action_notice || '';
    document.getElementById('invEditCreditProviders').value = data.credit_providers || '';
    document.getElementById('invEditNotes').value = data.notes || '';
    // Custom toggles
    loadCustomToggles();
    // Toggle fields
    document.getElementById('invToggleConventional').checked = !!data.conventional;
    document.getElementById('invToggleFha').checked = !!data.fha;
    document.getElementById('invToggleVaLoans').checked = !!data.va_loans;
    document.getElementById('invToggleUsda').checked = !!data.usda;
    document.getElementById('invToggleJumbo').checked = !!data.jumbo;
    document.getElementById('invToggleNonQm').checked = !!data.non_qm;
    document.getElementById('invToggleDscr').checked = !!data.dscr;
    document.getElementById('invToggleBankStatement').checked = !!data.bank_statement;
    document.getElementById('invToggleAssetDepletion').checked = !!data.asset_depletion;
    document.getElementById('invToggleInterestOnly').checked = !!data.interest_only;
    document.getElementById('invToggleItinForeignNational').checked = !!data.itin_foreign_national;
    document.getElementById('invToggleBridgeLoans').checked = !!data.bridge_loans;
    document.getElementById('invToggleLandLoans').checked = !!data.land_loans;
    document.getElementById('invToggleConstruction').checked = !!data.construction;
    document.getElementById('invToggleRenovation').checked = !!data.renovation;
    document.getElementById('invToggleManufactured').checked = !!data.manufactured;
    document.getElementById('invToggleDoctor').checked = !!data.doctor;
    document.getElementById('invToggleCondoNonWarrantable').checked = !!data.condo_non_warrantable;
    document.getElementById('invToggleSubFin').checked = !!data.subordinate_financing;
    document.getElementById('invToggleHelocSecond').checked = !!data.heloc_second;
    document.getElementById('invToggleVantageCredit').checked = !!data.vantage_credit;
    document.getElementById('invToggleManualUw').checked = !!data.manual_underwriting;
    document.getElementById('invToggleServicing').checked = !!data.servicing;
    document.getElementById('invToggleScenarioDesk').checked = !!data.scenario_desk;
    document.getElementById('invToggleCondoReview').checked = !!data.condo_review;
    document.getElementById('invToggleExceptionDesk').checked = !!data.exception_desk;
    document.getElementById('invToggleWireReview').checked = !!data.review_wire_release;
    // AE Photo
    loadAePhoto(data);
  }

  function loadAePhoto(data) {
    const img = document.getElementById('invAePhotoImg');
    const placeholder = document.getElementById('invAePhotoPlaceholder');
    const removeBtn = document.getElementById('invAePhotoRemoveBtn');
    if (data.account_executive_photo_url) {
      img.src = data.account_executive_photo_url;
      img.style.display = '';
      placeholder.style.display = 'none';
      removeBtn.style.display = '';
    } else {
      img.src = '';
      img.style.display = 'none';
      placeholder.style.display = '';
      removeBtn.style.display = 'none';
    }
  }

  // AE Photo upload
  document.getElementById('invAePhotoPreview').addEventListener('click', () => {
    document.getElementById('invAePhotoFileInput').click();
  });
  document.getElementById('invAePhotoUploadBtn').addEventListener('click', () => {
    document.getElementById('invAePhotoFileInput').click();
  });

  document.getElementById('invAePhotoFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentInvestorId) return;
    const ALLOWED = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!ALLOWED.includes(file.type)) { alert('Only PNG, JPG, and SVG images are allowed.'); e.target.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { alert('Photo must be under 5 MB.'); e.target.value = ''; return; }
    try {
      const { uploadUrl, fileKey } = await api('/investors/' + currentInvestorId + '/photo/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size, purpose: 'ae' }),
      });
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const result = await api('/investors/' + currentInvestorId + '/photo/confirm', {
        method: 'PUT',
        body: JSON.stringify({ fileKey, purpose: 'ae' }),
      });
      loadAePhoto({ account_executive_photo_url: result.photo_url });
    } catch (err) {
      alert('AE photo upload failed: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('invAePhotoRemoveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    if (!confirm('Remove AE photo?')) return;
    try {
      await api('/investors/' + currentInvestorId + '/ae-photo', { method: 'DELETE' });
      loadAePhoto({});
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Additional AEs (multi-entry) ---
  function populateInvestorAes(aes) {
    const container = document.getElementById('invAesRows');
    container.innerHTML = '';
    if (!Array.isArray(aes) || aes.length === 0) return;
    aes.forEach(a => addAeRow(container, a));
  }

  function addAeRow(container, data) {
    container = container || document.getElementById('invAesRows');
    const row = document.createElement('div');
    row.className = 'inv-repeatable-row';
    const photoUrl = (data && data.photo_url) || '';
    const photoKey = (data && data.photo_key) || '';
    row.innerHTML =
      '<div class="inv-ae-photo" title="Click to upload photo" style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:#f0f0f0;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;">' +
        '<img src="' + escHtml(photoUrl) + '" style="width:100%;height:100%;object-fit:cover;' + (photoUrl ? '' : 'display:none;') + '" />' +
        '<i class="fas fa-user-tie" style="color:#bbb;font-size:14px;' + (photoUrl ? 'display:none;' : '') + '"></i>' +
      '</div>' +
      '<input type="hidden" data-field="photo_url" value="' + escHtml(photoKey) + '" />' +
      '<input type="text" placeholder="AE Name" value="' + escHtml((data && data.name) || '') + '" data-field="name" />' +
      '<input type="tel" placeholder="Phone" value="' + escHtml((data && data.mobile) || '') + '" data-field="mobile" />' +
      '<input type="email" placeholder="Email" value="' + escHtml((data && data.email) || '') + '" data-field="email" />' +
      '<button class="btn btn-sm btn-danger" title="Remove"><i class="fas fa-times"></i></button>';
    row.querySelector('button').addEventListener('click', () => row.remove());
    row.querySelector('.inv-ae-photo').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/svg+xml';
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentInvestorId) return;
        try {
          const { uploadUrl, fileKey } = await api('/investors/' + currentInvestorId + '/photo/upload-url', {
            method: 'POST',
            body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size, purpose: 'team' }),
          });
          await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
          const result = await api('/investors/' + currentInvestorId + '/photo/confirm', {
            method: 'PUT',
            body: JSON.stringify({ fileKey, purpose: 'team' }),
          });
          const img = row.querySelector('.inv-ae-photo img');
          const icon = row.querySelector('.inv-ae-photo i');
          img.src = result.photo_url;
          img.style.display = '';
          icon.style.display = 'none';
          row.querySelector('[data-field="photo_url"]').value = fileKey;
        } catch (err) {
          alert('Photo upload failed: ' + err.message);
        }
      });
      input.click();
    });
    container.appendChild(row);
  }

  document.getElementById('invAddAeBtn').addEventListener('click', () => addAeRow());

  document.getElementById('invAesSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    const rows = document.querySelectorAll('#invAesRows .inv-repeatable-row');
    const aes = [];
    rows.forEach((row, i) => {
      const name = row.querySelector('[data-field="name"]').value.trim();
      const mobile = row.querySelector('[data-field="mobile"]').value.trim();
      const email = row.querySelector('[data-field="email"]').value.trim();
      const photo_url = row.querySelector('[data-field="photo_url"]').value.trim();
      if (name || email || mobile) aes.push({ name, mobile, email, photo_url: photo_url || null, sort_order: i });
    });
    try {
      await api('/investors/' + currentInvestorId + '/aes', {
        method: 'PUT',
        body: JSON.stringify({ aes }),
      });
      alert('Additional AEs saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Save Basic Info
  document.getElementById('invBasicSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    try {
      await api('/investors/' + currentInvestorId, {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('invEditName').value.trim(),
          account_executive_name: document.getElementById('invEditAeName').value.trim() || null,
          account_executive_email: document.getElementById('invEditAeEmail').value.trim() || null,
          account_executive_mobile: document.getElementById('invEditAePhone').value.trim() || null,
          states: document.getElementById('invEditStates').value.trim() || null,
          best_programs: document.getElementById('invEditBestPrograms').value.trim() || null,
          minimum_fico: document.getElementById('invEditMinFico').value.trim() || null,
          in_house_dpa: document.getElementById('invEditDpa').value.trim() || null,
          epo: document.getElementById('invEditEpo').value.trim() || null,
          max_comp: document.getElementById('invEditMaxComp').value || null,
          underwriting_fee: document.getElementById('invEditUnderwritingFee').value.trim() || null,
          in_house_servicing: document.getElementById('invEditInHouseServicing').value.trim() || null,
          adverse_action_notice: document.getElementById('invEditAdverseActionNotice').value.trim() || null,
          credit_providers: document.getElementById('invEditCreditProviders').value.trim() || null,
          notes: document.getElementById('invEditNotes').value.trim() || null,
          // Agency/Gov
          conventional: document.getElementById('invToggleConventional').checked ? 1 : 0,
          fha: document.getElementById('invToggleFha').checked ? 1 : 0,
          va_loans: document.getElementById('invToggleVaLoans').checked ? 1 : 0,
          usda: document.getElementById('invToggleUsda').checked ? 1 : 0,
          jumbo: document.getElementById('invToggleJumbo').checked ? 1 : 0,
          // Non-Agency
          non_qm: document.getElementById('invToggleNonQm').checked ? 1 : 0,
          dscr: document.getElementById('invToggleDscr').checked ? 1 : 0,
          bank_statement: document.getElementById('invToggleBankStatement').checked ? 1 : 0,
          asset_depletion: document.getElementById('invToggleAssetDepletion').checked ? 1 : 0,
          interest_only: document.getElementById('invToggleInterestOnly').checked ? 1 : 0,
          itin_foreign_national: document.getElementById('invToggleItinForeignNational').checked ? 1 : 0,
          // Specialty
          bridge_loans: document.getElementById('invToggleBridgeLoans').checked ? 1 : 0,
          land_loans: document.getElementById('invToggleLandLoans').checked ? 1 : 0,
          construction: document.getElementById('invToggleConstruction').checked ? 1 : 0,
          renovation: document.getElementById('invToggleRenovation').checked ? 1 : 0,
          manufactured: document.getElementById('invToggleManufactured').checked ? 1 : 0,
          doctor: document.getElementById('invToggleDoctor').checked ? 1 : 0,
          condo_non_warrantable: document.getElementById('invToggleCondoNonWarrantable').checked ? 1 : 0,
          subordinate_financing: document.getElementById('invToggleSubFin').checked ? 1 : 0,
          heloc_second: document.getElementById('invToggleHelocSecond').checked ? 1 : 0,
          vantage_credit: document.getElementById('invToggleVantageCredit').checked ? 1 : 0,
          // Services
          manual_underwriting: document.getElementById('invToggleManualUw').checked ? 1 : 0,
          servicing: document.getElementById('invToggleServicing').checked ? 1 : 0,
          scenario_desk: document.getElementById('invToggleScenarioDesk').checked ? 1 : 0,
          condo_review: document.getElementById('invToggleCondoReview').checked ? 1 : 0,
          exception_desk: document.getElementById('invToggleExceptionDesk').checked ? 1 : 0,
          review_wire_release: document.getElementById('invToggleWireReview').checked ? 1 : 0,
        }),
      });
      document.getElementById('invProfileTitle').textContent = document.getElementById('invEditName').value.trim() + ' — Profile';
      document.getElementById('invProfileName').textContent = document.getElementById('invEditName').value.trim();
      alert('Basic info saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // (Removed) Save Document Form-Fill Data — replaced by per-document
  // Type tags in the Documents list above.

  // --- Logo ---
  function loadInvestorLogo(data) {
    const img = document.getElementById('invProfileLogoImg');
    const placeholder = document.getElementById('invProfileLogoPlaceholder');
    const removeBtn = document.getElementById('invLogoRemoveBtn2');

    if (data.logo_url) {
      img.src = data.logo_url;
      img.onerror = function() { this.onerror = null; this.src = '/assets/msfg-logo-fallback.svg'; };
      img.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = '';
    } else {
      img.style.display = 'none';
      img.src = '';
      placeholder.style.display = '';
      removeBtn.style.display = 'none';
    }
  }

  document.getElementById('invLogoUploadBtn2').addEventListener('click', () => {
    document.getElementById('invLogoFileInput2').click();
  });

  document.getElementById('invLogoFileInput2').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentInvestorId) return;

    // Client-side validation
    const ALLOWED = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!ALLOWED.includes(file.type)) {
      alert('Only PNG, JPG, and SVG images are allowed.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Logo must be under 5 MB.');
      e.target.value = '';
      return;
    }

    try {
      const { uploadUrl, fileKey } = await api('/investors/' + currentInvestorId + '/logo/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
      });
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const result = await api('/investors/' + currentInvestorId + '/logo/confirm', {
        method: 'PUT',
        body: JSON.stringify({ fileKey }),
      });
      loadInvestorLogo({ logo_url: result.logo_url });
    } catch (err) {
      alert('Logo upload failed: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('invLogoRemoveBtn2').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    if (!confirm('Remove logo?')) return;
    try {
      await api('/investors/' + currentInvestorId + '/logo', { method: 'DELETE' });
      loadInvestorLogo({});
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Team ---
  function populateInvestorTeam(team) {
    const container = document.getElementById('invTeamRows');
    container.innerHTML = '';
    if (team.length === 0) {
      addTeamMemberRow(container);
      return;
    }
    team.forEach(m => addTeamMemberRow(container, m));
  }

  function addTeamMemberRow(container, data) {
    container = container || document.getElementById('invTeamRows');
    const row = document.createElement('div');
    row.className = 'inv-repeatable-row';
    const photoUrl = (data && data.photo_url) || '';
    const photoKey = (data && data.photo_key) || ''; // S3 key stored in hidden input
    row.innerHTML =
      '<div class="inv-team-photo" title="Click to upload photo" style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:#f0f0f0;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;">' +
        '<img src="' + escHtml(photoUrl) + '" style="width:100%;height:100%;object-fit:cover;' + (photoUrl ? '' : 'display:none;') + '" />' +
        '<i class="fas fa-user" style="color:#bbb;font-size:14px;' + (photoUrl ? 'display:none;' : '') + '"></i>' +
      '</div>' +
      '<input type="hidden" data-field="photo_url" value="' + escHtml(photoKey) + '" />' +
      '<input type="text" placeholder="Role" value="' + escHtml((data && data.role) || '') + '" data-field="role" />' +
      '<input type="text" placeholder="Name" value="' + escHtml((data && data.name) || '') + '" data-field="name" />' +
      '<input type="tel" placeholder="Phone" value="' + escHtml((data && data.phone) || '') + '" data-field="phone" />' +
      '<input type="email" placeholder="Email" value="' + escHtml((data && data.email) || '') + '" data-field="email" />' +
      '<button class="btn btn-sm btn-danger" title="Remove"><i class="fas fa-times"></i></button>';
    row.querySelector('button').addEventListener('click', () => row.remove());
    // Photo click → upload
    row.querySelector('.inv-team-photo').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/svg+xml';
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentInvestorId) return;
        try {
          const { uploadUrl, fileKey } = await api('/investors/' + currentInvestorId + '/photo/upload-url', {
            method: 'POST',
            body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size, purpose: 'team' }),
          });
          await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
          const result = await api('/investors/' + currentInvestorId + '/photo/confirm', {
            method: 'PUT',
            body: JSON.stringify({ fileKey, purpose: 'team' }),
          });
          const img = row.querySelector('.inv-team-photo img');
          const icon = row.querySelector('.inv-team-photo i');
          img.src = result.photo_url;
          img.style.display = '';
          icon.style.display = 'none';
          row.querySelector('[data-field="photo_url"]').value = fileKey;
        } catch (err) {
          alert('Photo upload failed: ' + err.message);
        }
      });
      input.click();
    });
    container.appendChild(row);
  }

  document.getElementById('invAddTeamMemberBtn').addEventListener('click', () => addTeamMemberRow());

  document.getElementById('invTeamSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    const rows = document.querySelectorAll('#invTeamRows .inv-repeatable-row');
    const team = [];
    rows.forEach((row, i) => {
      const role = row.querySelector('[data-field="role"]').value.trim();
      const name = row.querySelector('[data-field="name"]').value.trim();
      const phone = row.querySelector('[data-field="phone"]').value.trim();
      const email = row.querySelector('[data-field="email"]').value.trim();
      const photo_url = row.querySelector('[data-field="photo_url"]').value.trim();
      if (name || role) team.push({ role, name, phone, email, photo_url: photo_url || null, sort_order: i });
    });
    try {
      await api('/investors/' + currentInvestorId + '/team', {
        method: 'PUT',
        body: JSON.stringify({ team }),
      });
      alert('Team saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Lender IDs ---
  function populateInvestorLenderIds(data) {
    document.getElementById('invEditFhaId').value = data.fha_id || '';
    document.getElementById('invEditVaId').value = data.va_id || '';
    document.getElementById('invEditRdId').value = data.rd_id || '';
  }

  document.getElementById('invLenderSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    try {
      await api('/investors/' + currentInvestorId + '/lender-ids', {
        method: 'PUT',
        body: JSON.stringify({
          fha_id: document.getElementById('invEditFhaId').value.trim() || null,
          va_id: document.getElementById('invEditVaId').value.trim() || null,
          rd_id: document.getElementById('invEditRdId').value.trim() || null,
        }),
      });
      alert('Lender IDs saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Mortgagee Clauses ---
  function populateInvestorClauses(clauses) {
    const container = document.getElementById('invClauseRows');
    container.innerHTML = '';
    if (clauses.length === 0) {
      addClauseRow(container);
      return;
    }
    clauses.forEach(c => addClauseRow(container, c));
  }

  function addClauseRow(container, data) {
    container = container || document.getElementById('invClauseRows');
    const row = document.createElement('div');
    row.className = 'inv-repeatable-row inv-clause-row';
    row.innerHTML =
      '<input type="text" placeholder="Label (e.g. FHA, Conv)" value="' + escHtml((data && data.label) || '') + '" data-field="label" style="max-width:140px;" />' +
      '<input type="text" placeholder="Name" value="' + escHtml((data && data.name) || '') + '" data-field="name" />' +
      '<input type="text" placeholder="ISAOA" value="' + escHtml((data && data.isaoa) || '') + '" data-field="isaoa" />' +
      '<input type="text" placeholder="Address" value="' + escHtml((data && data.address) || '') + '" data-field="address" />' +
      '<button class="btn btn-sm btn-danger" title="Remove"><i class="fas fa-times"></i></button>';
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.appendChild(row);
  }

  document.getElementById('invAddClauseBtn').addEventListener('click', () => addClauseRow());

  document.getElementById('invClausesSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    const rows = document.querySelectorAll('#invClauseRows .inv-repeatable-row');
    const clauses = [];
    rows.forEach(row => {
      const label = row.querySelector('[data-field="label"]').value.trim();
      const name = row.querySelector('[data-field="name"]').value.trim();
      const isaoa = row.querySelector('[data-field="isaoa"]').value.trim();
      const address = row.querySelector('[data-field="address"]').value.trim();
      if (name) clauses.push({ label, name, isaoa, address });
    });
    try {
      await api('/investors/' + currentInvestorId + '/mortgagee-clauses', {
        method: 'PUT',
        body: JSON.stringify({ clauses }),
      });
      alert('Mortgagee clauses saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Links ---
  const LINK_TYPE_OPTIONS = [
    { value: 'website', label: 'Website' },
    { value: 'login', label: 'Login Portal' },
    { value: 'flex_site', label: 'Flex Site' },
    { value: 'faq', label: 'FAQ' },
    { value: 'appraisal_video', label: 'Appraisal Video' },
    { value: 'new_scenarios', label: 'New Scenarios' },
    { value: 'other', label: 'Other' },
  ];

  function populateInvestorLinks(links) {
    const container = document.getElementById('invLinkRows');
    container.innerHTML = '';
    if (links.length === 0) {
      addLinkRow(container);
      return;
    }
    links.forEach(l => addLinkRow(container, l));
  }

  function addLinkRow(container, data) {
    container = container || document.getElementById('invLinkRows');
    const row = document.createElement('div');
    row.className = 'inv-repeatable-row inv-link-row';
    const typeOptions = LINK_TYPE_OPTIONS.map(opt =>
      '<option value="' + opt.value + '"' + ((data && data.link_type === opt.value) ? ' selected' : '') + '>' + opt.label + '</option>'
    ).join('');
    row.innerHTML =
      '<select data-field="link_type" style="max-width:140px;">' + typeOptions + '</select>' +
      '<input type="text" placeholder="Label (optional)" value="' + escHtml((data && data.label) || '') + '" data-field="label" style="max-width:150px;" />' +
      '<input type="text" placeholder="URL or mailto:..." value="' + escHtml((data && data.url) || '') + '" data-field="url" style="flex:1;" />' +
      '<button class="btn btn-sm btn-danger" title="Remove"><i class="fas fa-times"></i></button>';
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.appendChild(row);
  }

  document.getElementById('invAddLinkBtn').addEventListener('click', () => addLinkRow());

  document.getElementById('invLinksSaveBtn').addEventListener('click', async () => {
    if (!currentInvestorId) return;
    const rows = document.querySelectorAll('#invLinkRows .inv-repeatable-row');
    const links = [];
    rows.forEach(row => {
      const link_type = row.querySelector('[data-field="link_type"]').value;
      const label = row.querySelector('[data-field="label"]').value.trim();
      const url = row.querySelector('[data-field="url"]').value.trim();
      if (url) links.push({ link_type, label: label || null, url });
    });
    try {
      await api('/investors/' + currentInvestorId + '/links', {
        method: 'PUT',
        body: JSON.stringify({ links }),
      });
      alert('Links saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // --- Investor Documents Tab ---
  const invDocDropZone = document.getElementById('invDocDropZone');
  const invDocFileInput = document.getElementById('invDocFileInput');

  invDocDropZone.addEventListener('click', () => invDocFileInput.click());
  invDocDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    invDocDropZone.style.borderColor = '#8cc63e';
    invDocDropZone.style.background = 'rgba(140,198,62,0.05)';
  });
  invDocDropZone.addEventListener('dragleave', () => {
    invDocDropZone.style.borderColor = '#ccc';
    invDocDropZone.style.background = '';
  });
  invDocDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    invDocDropZone.style.borderColor = '#ccc';
    invDocDropZone.style.background = '';
    if (e.dataTransfer.files.length) uploadInvestorDocs(e.dataTransfer.files);
  });
  invDocFileInput.addEventListener('change', () => {
    if (invDocFileInput.files.length) uploadInvestorDocs(invDocFileInput.files);
    invDocFileInput.value = '';
  });

  async function uploadInvestorDocs(files) {
    if (!currentInvestorId) return alert('No investor selected');
    const status = document.getElementById('invDocUploadStatus');
    const statusText = document.getElementById('invDocUploadText');
    status.style.display = 'block';

    // Default doc_type chosen from the dropdown above the dropzone.
    // Falls back to '' (unclassified) when the user doesn't pick one.
    const defaultTypeEl = document.getElementById('invDocDefaultType');
    const defaultDocType = defaultTypeEl ? (defaultTypeEl.value || '') : '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      statusText.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ': ' + file.name;
      try {
        // 1. Get presigned upload URL
        const urlResult = await api('/investors/' + currentInvestorId + '/documents/upload-url', {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
        });

        // 2. Upload to S3
        await fetch(urlResult.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        // 3. Confirm upload (with classification — backend whitelists & normalizes)
        await api('/investors/' + currentInvestorId + '/documents/confirm', {
          method: 'POST',
          body: JSON.stringify({
            fileKey: urlResult.fileKey,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            docType: defaultDocType,
          }),
        });
      } catch (err) {
        alert('Failed to upload ' + file.name + ': ' + err.message);
      }
    }

    status.style.display = 'none';
    loadInvestorDocs();
  }

  // ========== Custom Toggles ==========
  async function loadCustomToggles() {
    if (!currentInvestorId) return;
    const list = document.getElementById('invCustomTogglesList');
    list.innerHTML = '<span style="color:#999;font-size:0.85rem;">Loading...</span>';
    try {
      const toggles = await api('/investors/' + currentInvestorId + '/custom-toggles');
      renderCustomToggles(toggles || []);
    } catch (err) {
      list.innerHTML = '<span style="color:#e74c3c;font-size:0.85rem;">Failed to load</span>';
    }
  }

  function renderCustomToggles(toggles) {
    const list = document.getElementById('invCustomTogglesList');
    if (!toggles.length) {
      list.innerHTML = '<span style="color:#999;font-size:0.85rem;">No custom toggles. Click "Add Custom" to create one.</span>';
      return;
    }
    list.innerHTML = toggles.map(t =>
      '<label style="display:flex; align-items:center; gap:6px; padding:4px 10px; background:#f5f5f5; border-radius:6px; font-weight:400; cursor:pointer;">' +
        '<input type="checkbox" class="custom-toggle-cb" data-id="' + t.id + '"' + (t.enabled ? ' checked' : '') + '>' +
        '<span>' + escHtml(t.label) + '</span>' +
        '<button type="button" class="custom-toggle-del" data-id="' + t.id + '" title="Delete" style="background:none;border:none;color:#dc3545;cursor:pointer;padding:0 2px;font-size:0.85rem;"><i class="fas fa-times"></i></button>' +
      '</label>'
    ).join('');

    // Bind toggle change
    list.querySelectorAll('.custom-toggle-cb').forEach(cb => {
      cb.addEventListener('change', async () => {
        try {
          await api('/investors/' + currentInvestorId + '/custom-toggles/' + cb.dataset.id, {
            method: 'PUT',
            body: JSON.stringify({ enabled: cb.checked }),
          });
        } catch (err) { alert('Failed to update toggle'); cb.checked = !cb.checked; }
      });
    });

    // Bind delete
    list.querySelectorAll('.custom-toggle-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm('Delete this custom toggle?')) return;
        try {
          await api('/investors/' + currentInvestorId + '/custom-toggles/' + btn.dataset.id, { method: 'DELETE' });
          loadCustomToggles();
        } catch (err) { alert('Failed to delete'); }
      });
    });
  }

  document.getElementById('invAddCustomToggleBtn')?.addEventListener('click', async () => {
    if (!currentInvestorId) return alert('Save investor first');
    const label = prompt('Custom toggle label (e.g. "Foreign Borrowers", "Reverse Mortgage"):');
    if (!label || !label.trim()) return;
    try {
      await api('/investors/' + currentInvestorId + '/custom-toggles', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), enabled: true }),
      });
      loadCustomToggles();
    } catch (err) { alert('Failed to add toggle: ' + err.message); }
  });

  // Per-doc type options shown in the table dropdown — must match the
  // whitelist in backend/routes/investors/documents.js (ALLOWED_DOCUMENT_CLASSIFICATIONS).
  const INV_DOC_TYPE_OPTIONS = [
    { value: '',           label: '— Unclassified —' },
    { value: 'form-4506c', label: 'Form 4506-C' },
    { value: 'form-ssa89', label: 'Form SSA-89' },
    { value: 'form-condo', label: 'Condo Questionnaire' },
    { value: 'template',   label: 'Editable Template' },
    { value: 'reference',  label: 'Reference / static' },
  ];

  function renderDocTypeSelect(docId, current) {
    const cur = current || '';
    const opts = INV_DOC_TYPE_OPTIONS.map(o =>
      '<option value="' + o.value + '"' + (o.value === cur ? ' selected' : '') + '>' + escHtml(o.label) + '</option>'
    ).join('');
    return '<select class="inv-doc-type-select" data-doc-id="' + docId + '" style="font-size:12px; padding:2px 6px; border:1px solid #ddd; border-radius:4px; max-width:170px;">' + opts + '</select>';
  }

  async function loadInvestorDocs() {
    const list = document.getElementById('invDocList');
    if (!currentInvestorId) { list.innerHTML = ''; return; }
    try {
      const docs = await api('/investors/' + currentInvestorId + '/documents');
      if (!docs.length) {
        list.innerHTML = '<p style="color:#aaa; font-size:13px; font-style:italic;">No documents uploaded yet.</p>';
        return;
      }
      const DOC_ICONS = {
        'application/pdf': 'fa-file-pdf',
        'application/msword': 'fa-file-word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'fa-file-word',
        'application/vnd.ms-excel': 'fa-file-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'fa-file-excel',
        'image/png': 'fa-file-image', 'image/jpeg': 'fa-file-image',
        'text/plain': 'fa-file-alt', 'text/csv': 'fa-file-csv',
      };
      let html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
      html += '<thead><tr style="border-bottom:2px solid #eee; text-align:left;">'
        + '<th style="padding:6px 8px;">File</th>'
        + '<th style="padding:6px 8px; width:180px;">Type</th>'
        + '<th style="padding:6px 8px; width:80px;">Size</th>'
        + '<th style="padding:6px 8px; width:120px;">Uploaded</th>'
        + '<th style="padding:6px 8px; width:80px;"></th>'
        + '</tr></thead><tbody>';
      docs.forEach(doc => {
        const icon = DOC_ICONS[doc.file_type] || 'fa-file';
        const size = doc.file_size ? (doc.file_size < 1024 * 1024 ? (doc.file_size / 1024).toFixed(1) + ' KB' : (doc.file_size / (1024 * 1024)).toFixed(1) + ' MB') : '';
        const date = doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '';
        html += '<tr style="border-bottom:1px solid #f0f0f0;">';
        html += '<td style="padding:6px 8px;"><i class="fas ' + icon + '" style="color:#104547; margin-right:6px;"></i>' + escHtml(doc.file_name) + '</td>';
        html += '<td style="padding:6px 8px;">' + renderDocTypeSelect(doc.id, doc.doc_type) + '</td>';
        html += '<td style="padding:6px 8px; color:#666;">' + size + '</td>';
        html += '<td style="padding:6px 8px; color:#666;">' + date + '</td>';
        html += '<td style="padding:6px 8px; text-align:right;">';
        if (doc.download_url) html += '<a href="' + doc.download_url + '" target="_blank" style="color:#104547; margin-right:8px;" title="Download"><i class="fas fa-download"></i></a>';
        html += '<button onclick="deleteInvestorDoc(' + doc.id + ')" style="border:none; background:none; color:#c0392b; cursor:pointer;" title="Delete"><i class="fas fa-trash"></i></button>';
        html += '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;

      // Bind type-change handlers — saves immediately via PATCH.
      list.querySelectorAll('.inv-doc-type-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const docId = sel.dataset.docId;
          const prev = sel.dataset.prevValue || '';
          sel.disabled = true;
          try {
            await api('/investors/' + currentInvestorId + '/documents/' + docId, {
              method: 'PATCH',
              body: JSON.stringify({ docType: sel.value }),
            });
            sel.dataset.prevValue = sel.value;
          } catch (err) {
            alert('Failed to update document type: ' + err.message);
            sel.value = prev;
          } finally {
            sel.disabled = false;
          }
        });
        // Stash the initial value so we can revert on PATCH failure.
        sel.dataset.prevValue = sel.value;
      });
    } catch (err) {
      list.innerHTML = '<p style="color:#c0392b; font-size:13px;">Failed to load documents: ' + err.message + '</p>';
    }
  }

  window.deleteInvestorDoc = async function(docId) {
    if (!currentInvestorId) return;
    if (!confirm('Delete this document?')) return;
    try {
      await api('/investors/' + currentInvestorId + '/documents/' + docId, { method: 'DELETE' });
      loadInvestorDocs();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // --- Hash routing for deep-link ---
  function checkInvestorHash() {
    const hash = window.location.hash;
    if (hash === '#investors') {
      // Switch to investors tab
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="investors"]').classList.add('active');
      document.getElementById('panel-investors').classList.add('active');
      loadInvestors();
    }
  }

  /* ═══════════════════════════════════════
     FORMS LIBRARY UPLOAD TAB
  ═══════════════════════════════════════ */
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');

  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  async function handleFiles(files) {
    if (!files || files.length === 0) return;

    const folder = document.getElementById('uploadFolder').value.trim();
    const progressEl = document.getElementById('uploadProgress');
    const statusText = document.getElementById('uploadStatusText');
    const progressFill = document.getElementById('uploadProgressFill');
    const resultsEl = document.getElementById('uploadResults');

    progressEl.style.display = 'block';
    resultsEl.innerHTML = '';

    let completed = 0;
    const total = files.length;

    for (const file of files) {
      statusText.textContent = 'Uploading ' + file.name + ' (' + (completed + 1) + '/' + total + ')...';
      progressFill.style.width = ((completed / total) * 100) + '%';

      try {
        // Get presigned URL
        const urlData = await api('/admin/files/upload-url', {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            folder: folder,
          }),
        });

        if (!urlData) continue;

        // Upload to S3
        const uploadRes = await fetch(urlData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        if (!uploadRes.ok) throw new Error('Upload failed');

        resultsEl.innerHTML += '<p style="color:#2e7d32; font-size:13px;"><i class="fas fa-check-circle"></i> ' + escHtml(file.name) + ' uploaded successfully</p>';
      } catch (err) {
        resultsEl.innerHTML += '<p style="color:#e74c3c; font-size:13px;"><i class="fas fa-times-circle"></i> ' + escHtml(file.name) + ' failed: ' + escHtml(err.message) + '</p>';
      }

      completed++;
    }

    progressFill.style.width = '100%';
    statusText.textContent = 'Upload complete! ' + completed + '/' + total + ' files uploaded.';

    setTimeout(() => { progressEl.style.display = 'none'; }, 3000);
  }

  /* ═══════════════════════════════════════
     SYSTEM TAB
  ═══════════════════════════════════════ */
  async function loadSystem() {
    try {
      const info = await api('/admin/system');
      if (!info) return;

      const dbEl = document.getElementById('sysDb');
      dbEl.textContent = info.database === 'connected' ? 'Connected' : 'Error';
      dbEl.className = 'system-card-value ' + (info.database === 'connected' ? 'ok' : 'error');

      document.getElementById('sysUsers').textContent = info.activeUsers;
      document.getElementById('sysInvestors').textContent = info.totalInvestors;

      // Format uptime
      const hrs = Math.floor(info.uptime / 3600);
      const mins = Math.floor((info.uptime % 3600) / 60);
      document.getElementById('sysUptime').textContent = hrs + 'h ' + mins + 'm';

      document.getElementById('sysEnv').textContent = info.environment;
      document.getElementById('sysVersion').textContent = 'v' + info.version;
    } catch (err) {
      console.error('System info error:', err);
    }
  }

  document.getElementById('refreshSystemBtn').addEventListener('click', loadSystem);

  /* ═══════════════════════════════════════
     MONDAY.COM TAB
  ═══════════════════════════════════════ */
  let mondayBoards = [];
  let mondayBoardColumns = [];
  let mondayCurrentBoardId = null;
  let mondayEditingBoardId = null;

  function loadMondayTab() {
    loadMondayBoards();
    loadMondayTokenStatus();
    loadMondaySyncHistory();
    loadMondayDisplayConfig();
    loadMondayWebhooks();
  }

  // ── Token Management ──
  async function loadMondayTokenStatus() {
    try {
      const integrations = await api('/integrations');
      if (!integrations) return;
      const monday = integrations.find(i => i.service === 'monday');
      const status = document.getElementById('mondayTokenStatus');
      if (monday) {
        status.textContent = 'Token configured (' + (monday.maskedValue || '***') + '). Last tested: ' + (monday.last_tested_at ? new Date(monday.last_tested_at).toLocaleString() : 'Never');
        status.style.color = '#2e7d32';
      } else {
        status.textContent = 'No token configured. Paste your Monday.com API token below.';
        status.style.color = '#f39c12';
      }
    } catch (e) { /* non-critical */ }
  }

  async function saveMondayToken() {
    const input = document.getElementById('mondayTokenInput');
    const value = input.value.trim();
    if (!value) return alert('Please enter a token.');
    try {
      await api('/integrations', {
        method: 'POST',
        body: JSON.stringify({ service: 'monday', credential_type: 'api_key', value: value, label: 'Monday.com API Token' }),
      });
      input.value = '';
      loadMondayTokenStatus();
      alert('Token saved!');
    } catch (err) { alert('Failed to save token: ' + err.message); }
  }

  async function testMondayToken() {
    const status = document.getElementById('mondayTokenStatus');
    status.textContent = 'Testing connection...';
    status.style.color = '#888';
    try {
      const result = await api('/integrations/monday/test', { method: 'POST', body: '{}' });
      if (result && result.success) {
        status.textContent = result.message || 'Connection successful!';
        status.style.color = '#2e7d32';
      } else {
        status.textContent = 'Test failed: ' + (result ? result.message : 'Unknown error');
        status.style.color = '#e74c3c';
      }
    } catch (err) {
      status.textContent = 'Test failed: ' + err.message;
      status.style.color = '#e74c3c';
    }
  }

  document.getElementById('mondaySaveTokenBtn').addEventListener('click', saveMondayToken);
  document.getElementById('mondayTestTokenBtn').addEventListener('click', testMondayToken);

  // ── Board Management ──
  async function loadMondayBoards() {
    const tbody = document.getElementById('mondayBoardsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
      const data = await api('/monday/boards');
      if (!data) return;
      mondayBoards = data.boards || [];

      if (mondayBoards.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">No boards registered. Click "Add Board" to get started.</td></tr>';
        populateBoardSelect([]);
        return;
      }

      const sectionLabels = { pipeline: 'Loan Pipeline', pre_approvals: 'Pre-Approvals', funded_loans: 'Loans Funded' };
      const sectionClasses = { pipeline: 'section-pipeline', pre_approvals: 'section-preapprovals', funded_loans: 'section-funded' };

      tbody.innerHTML = mondayBoards.map(b => {
        const assignedNames = (b.assignedUsers || []).map(u => escHtml(u.name || u.email));
        const usersCell = assignedNames.length > 0
          ? assignedNames.join(', ')
          : '<span style="color:#999;">None</span>';
        return '<tr data-board-id="' + escHtml(b.board_id) + '">' +
        '<td><code style="font-size:12px;">' + escHtml(b.board_id) + '</code></td>' +
        '<td><strong>' + escHtml(b.board_name || 'Unnamed') + '</strong></td>' +
        '<td><span class="badge ' + (sectionClasses[b.target_section] || '') + '">' + escHtml(sectionLabels[b.target_section] || b.target_section) + '</span></td>' +
        '<td style="font-size:12px;">' + usersCell + '</td>' +
        '<td>' + (b.is_active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>') + '</td>' +
        '<td>' +
          '<button class="btn btn-sm btn-secondary monday-edit-board" data-bid="' + escHtml(b.board_id) + '" title="Edit"><i class="fas fa-edit"></i></button> ' +
          '<button class="btn btn-sm btn-danger monday-delete-board" data-bid="' + escHtml(b.board_id) + '" title="Remove"><i class="fas fa-trash"></i></button>' +
        '</td>' +
        '</tr>';
      }).join('');

      // Bind edit buttons
      tbody.querySelectorAll('.monday-edit-board').forEach(btn => {
        btn.addEventListener('click', () => {
          const board = mondayBoards.find(b => b.board_id === btn.dataset.bid);
          if (board) showBoardForm(board);
        });
      });

      // Bind delete buttons
      tbody.querySelectorAll('.monday-delete-board').forEach(btn => {
        btn.addEventListener('click', () => deleteMondayBoard(btn.dataset.bid));
      });

      populateBoardSelect(mondayBoards);
    } catch (err) {
      console.error('Load boards error:', err);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#e74c3c;">Failed to load boards.</td></tr>';
    }
  }

  function populateBoardSelect(boards) {
    const select = document.getElementById('mondayMappingBoardSelect');
    select.innerHTML = '<option value="">Select a board...</option>' +
      boards.map(b => '<option value="' + escHtml(b.board_id) + '">' + escHtml(b.board_name || b.board_id) + ' (' + escHtml(b.board_id) + ')</option>').join('');
  }

  async function showBoardForm(board) {
    const form = document.getElementById('mondayBoardForm');
    const title = document.getElementById('mondayBoardFormTitle');
    if (board) {
      mondayEditingBoardId = board.board_id;
      title.textContent = 'Edit Board';
      document.getElementById('mondayBoardIdInput').value = board.board_id;
      document.getElementById('mondayBoardIdInput').disabled = true;
      document.getElementById('mondayBoardNameInput').value = board.board_name || '';
      document.getElementById('mondayBoardSectionSelect').value = board.target_section || 'pipeline';
    } else {
      mondayEditingBoardId = null;
      title.textContent = 'Add Board';
      document.getElementById('mondayBoardIdInput').value = '';
      document.getElementById('mondayBoardIdInput').disabled = false;
      document.getElementById('mondayBoardNameInput').value = '';
      document.getElementById('mondayBoardSectionSelect').value = 'pipeline';
    }
    form.classList.add('active');

    // Populate user picker
    const picker = document.getElementById('mondayBoardUserPicker');
    picker.innerHTML = '<div style="color:#999; font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading users...</div>';
    try {
      const usersData = await api('/users/directory');
      const users = usersData || [];
      const assignedIds = (board && board.assignedUsers) ? board.assignedUsers.map(u => u.id) : [];
      if (users.length === 0) {
        picker.innerHTML = '<div style="color:#999; font-size:13px;">No users found.</div>';
      } else {
        picker.innerHTML = users.map(u =>
          '<label style="display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; font-size:13px;">' +
            '<input type="checkbox" class="board-user-cb" value="' + u.id + '"' + (assignedIds.includes(u.id) ? ' checked' : '') + '> ' +
            escHtml(u.name || u.email) +
            (u.role ? ' <span style="color:#666; font-size:11px;">(' + escHtml(u.role) + ')</span>' : '') +
          '</label>'
        ).join('');
      }
    } catch (err) {
      picker.innerHTML = '<div style="color:#e74c3c; font-size:13px;">Failed to load users.</div>';
    }
  }

  function hideBoardForm() {
    document.getElementById('mondayBoardForm').classList.remove('active');
    mondayEditingBoardId = null;
  }

  async function saveMondayBoard() {
    const boardId = document.getElementById('mondayBoardIdInput').value.trim();
    const boardName = document.getElementById('mondayBoardNameInput').value.trim();
    const targetSection = document.getElementById('mondayBoardSectionSelect').value;

    if (!boardId) return alert('Board ID is required');

    const assignedUsers = Array.from(document.querySelectorAll('#mondayBoardUserPicker .board-user-cb:checked'))
      .map(cb => parseInt(cb.value, 10));

    try {
      if (mondayEditingBoardId) {
        await api('/monday/boards/' + mondayEditingBoardId, {
          method: 'PUT',
          body: JSON.stringify({ boardName, targetSection, assignedUsers }),
        });
      } else {
        await api('/monday/boards', {
          method: 'POST',
          body: JSON.stringify({ boardId, boardName, targetSection, assignedUsers }),
        });
      }
      hideBoardForm();
      loadMondayBoards();
    } catch (err) { alert('Error saving board: ' + err.message); }
  }

  async function deleteMondayBoard(boardId) {
    if (!confirm('Remove board ' + boardId + '? This will also delete its column mappings and sync history.')) return;
    try {
      await api('/monday/boards/' + boardId, { method: 'DELETE' });
      loadMondayBoards();
    } catch (err) { alert('Error removing board: ' + err.message); }
  }

  document.getElementById('mondayAddBoardBtn').addEventListener('click', () => showBoardForm(null));
  document.getElementById('mondayBoardFormCancelBtn').addEventListener('click', hideBoardForm);
  document.getElementById('mondayBoardFormSaveBtn').addEventListener('click', saveMondayBoard);

  // ── Column Mappings ──
  async function loadMondayColumns() {
    const boardId = document.getElementById('mondayMappingBoardSelect').value;
    if (!boardId) return alert('Please select a board first.');

    mondayCurrentBoardId = boardId;
    const container = document.getElementById('mondayMappingsContainer');
    const saveBtn = document.getElementById('mondaySaveMappingsBtn');
    container.innerHTML = '<p style="color:#666; font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading columns from Monday.com...</p>';

    try {
      const data = await api('/monday/columns?board=' + boardId);
      if (!data) return;

      mondayBoardColumns = data.columns || [];
      const validFields = data.validPipelineFields || [];
      const fieldLabels = data.fieldLabels || {};
      const section = data.targetSection || 'pipeline';

      // Load existing mappings
      let existingMappings = {};
      try {
        const saved = await api('/monday/mappings?board=' + boardId);
        if (saved) saved.forEach(m => { existingMappings[m.monday_column_id] = m.pipeline_field; });
      } catch (e) { /* first time */ }

      if (mondayBoardColumns.length === 0) {
        container.innerHTML = '<p style="color:#666; font-size:13px;">No columns found on this board.</p>';
        return;
      }

      const sectionLabels = { pipeline: 'Pipeline', pre_approvals: 'Pre-Approvals', funded_loans: 'Funded Loans' };

      container.innerHTML =
        '<p style="font-size:12px; color:#666; margin:0 0 6px;">Board: <strong>' + escHtml(data.boardName) + '</strong> — ' + mondayBoardColumns.length + ' columns — Section: <span class="badge ' + (section === 'pipeline' ? 'section-pipeline' : section === 'pre_approvals' ? 'section-preapprovals' : 'section-funded') + '">' + escHtml(sectionLabels[section] || section) + '</span></p>' +
        '<div style="max-height:350px; overflow-y:auto; border:1px solid #eee; border-radius:8px;">' +
          '<table class="admin-table" style="margin:0; font-size:12px;">' +
            '<thead><tr><th>Monday.com Column</th><th>Type</th><th>Maps To</th></tr></thead>' +
            '<tbody>' +
              mondayBoardColumns.map(col => {
                const savedField = existingMappings[col.id] || col.suggestedField || '';
                return '<tr>' +
                  '<td>' + escHtml(col.title) + '</td>' +
                  '<td><code style="font-size:11px;">' + escHtml(col.type) + '</code></td>' +
                  '<td><select class="monday-mapping-select" data-col-id="' + escHtml(col.id) + '" data-col-title="' + escHtml(col.title) + '" style="padding:4px 8px; font-size:12px; border:1px solid #ddd; border-radius:6px; width:100%;">' +
                    '<option value="">— skip —</option>' +
                    validFields.map(f => '<option value="' + f + '"' + (f === savedField ? ' selected' : '') + '>' + escHtml(fieldLabels[f] || f) + '</option>').join('') +
                  '</select></td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>';

      saveBtn.style.display = '';
    } catch (err) {
      container.innerHTML = '<p style="color:#e74c3c; font-size:13px;">Failed to load columns: ' + escHtml(err.message) + '</p>';
    }
  }

  async function saveMondayMappings() {
    const selects = document.querySelectorAll('.monday-mapping-select');
    const mappings = [];
    selects.forEach(sel => {
      if (sel.value) {
        mappings.push({
          mondayColumnId: sel.dataset.colId,
          mondayColumnTitle: sel.dataset.colTitle,
          pipelineField: sel.value,
        });
      }
    });

    if (mappings.length === 0) return alert('Please map at least one column.');

    // Check for duplicates
    const fields = mappings.map(m => m.pipelineField);
    const dupes = fields.filter((f, i) => fields.indexOf(f) !== i);
    if (dupes.length > 0) return alert('Duplicate mapping: "' + dupes[0] + '" is mapped to multiple columns.');

    try {
      await api('/monday/mappings', {
        method: 'POST',
        body: JSON.stringify({ mappings, boardId: mondayCurrentBoardId }),
      });
      alert('Mappings saved for board ' + mondayCurrentBoardId + '! (' + mappings.length + ' columns mapped)');
      loadMondayDisplayConfig();
    } catch (err) { alert('Failed to save: ' + err.message); }
  }

  document.getElementById('mondayLoadColumnsBtn').addEventListener('click', loadMondayColumns);
  document.getElementById('mondaySaveMappingsBtn').addEventListener('click', saveMondayMappings);

  // ── Display Config (unified: one container, switch via dropdown) ──
  const UNIFIED_CONTAINER_ID = 'mondayDisplayConfigUnified';
  const UNIFIED_SAVE_BTN_ID = 'mondaySaveDisplayBtnUnified';
  const UNIFIED_TABLE_ID = 'displayConfigTableUnified';

  const DISPLAY_SECTIONS = [
    { key: 'pipeline',       containerId: UNIFIED_CONTAINER_ID, saveBtnId: UNIFIED_SAVE_BTN_ID, tableId: UNIFIED_TABLE_ID },
    { key: 'pre_approvals',  containerId: UNIFIED_CONTAINER_ID, saveBtnId: UNIFIED_SAVE_BTN_ID, tableId: UNIFIED_TABLE_ID },
    { key: 'funded_loans',   containerId: UNIFIED_CONTAINER_ID, saveBtnId: UNIFIED_SAVE_BTN_ID, tableId: UNIFIED_TABLE_ID },
  ];

  function getActiveDisplaySection() {
    const sel = document.getElementById('mondayDisplaySectionSelect');
    const key = sel ? sel.value : 'pipeline';
    return DISPLAY_SECTIONS.find(s => s.key === key) || DISPLAY_SECTIONS[0];
  }

  async function loadMondayDisplayConfig() {
    // Only load the currently-selected section into the unified container
    await loadSectionDisplayConfig(getActiveDisplaySection());
  }

  async function loadSectionDisplayConfig(sec) {
    const container = document.getElementById(sec.containerId);
    const saveBtn = document.getElementById(sec.saveBtnId);
    if (!container) return;

    try {
      const config = await api('/monday/view-config?section=' + sec.key);
      if (!config) return;
      const columns = config.columns || [];

      if (columns.length <= 1) {
        container.innerHTML = '<p style="font-size:13px; color:#666;">Save column mappings first, then configure display here.</p>';
        saveBtn.style.display = 'none';
        return;
      }

      container.innerHTML =
        '<div style="max-height:350px; overflow-y:auto; border:1px solid #eee; border-radius:8px;">' +
          '<table class="admin-table" style="margin:0; font-size:12px;" id="' + sec.tableId + '">' +
            '<thead><tr><th style="width:40px;">Show</th><th>Field</th><th>Label</th><th style="width:80px;">Order</th></tr></thead>' +
            '<tbody>' +
              columns.map((col, idx) => {
                const isLocked = col.locked;
                return '<tr data-field="' + col.field + '">' +
                  '<td style="text-align:center;"><input type="checkbox" class="dc-visible"' + (col.visible !== false ? ' checked' : '') + (isLocked ? ' disabled' : '') + ' /></td>' +
                  '<td><code style="font-size:11px;">' + escHtml(col.field) + '</code></td>' +
                  '<td><input type="text" class="dc-label" value="' + escHtml(col.label || '') + '"' + (isLocked ? ' disabled' : '') + ' style="padding:4px 8px; font-size:12px; border:1px solid #ddd; border-radius:6px; width:100%;" /></td>' +
                  '<td style="text-align:center;">' +
                    '<button type="button" class="btn btn-secondary btn-sm dc-move-up" style="padding:2px 6px; font-size:10px;"' + (idx === 0 ? ' disabled' : '') + '>&#9650;</button> ' +
                    '<button type="button" class="btn btn-secondary btn-sm dc-move-down" style="padding:2px 6px; font-size:10px;"' + (idx === columns.length - 1 ? ' disabled' : '') + '>&#9660;</button>' +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>';

      saveBtn.style.display = '';
      // Reflect active section in the unified save button label
      if (sec.saveBtnId === UNIFIED_SAVE_BTN_ID) {
        const niceName = sec.key === 'pre_approvals' ? 'Pre-Approvals'
          : sec.key === 'funded_loans' ? 'Funded Loans'
          : 'Pipeline';
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save ' + niceName + ' Display Settings';
      }

      // Wire move buttons
      container.querySelectorAll('.dc-move-up').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const row = e.target.closest('tr');
          const prev = row.previousElementSibling;
          if (prev) row.parentNode.insertBefore(row, prev);
          updateSectionMoveButtons(sec.tableId);
        });
      });
      container.querySelectorAll('.dc-move-down').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const row = e.target.closest('tr');
          const next = row.nextElementSibling;
          if (next) row.parentNode.insertBefore(next, row);
          updateSectionMoveButtons(sec.tableId);
        });
      });
    } catch (err) {
      container.innerHTML = '<p style="color:#e74c3c; font-size:13px;">Failed to load display config: ' + escHtml(err.message) + '</p>';
    }
  }

  function updateSectionMoveButtons(tableId) {
    const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
    rows.forEach((row, idx) => {
      const up = row.querySelector('.dc-move-up');
      const down = row.querySelector('.dc-move-down');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === rows.length - 1;
    });
  }

  async function saveSectionDisplaySettings(sec) {
    const rows = document.querySelectorAll('#' + sec.tableId + ' tbody tr');
    const displayConfig = {};
    let order = 0;
    rows.forEach(row => {
      const field = row.dataset.field;
      if (field === 'client_name') return;
      displayConfig[field] = {
        displayLabel: row.querySelector('.dc-label').value.trim() || null,
        displayOrder: order++,
        visible: row.querySelector('.dc-visible').checked,
      };
    });

    try {
      const data = await api('/monday/boards');
      if (!data) return;
      const boards = (data.boards || []).filter(b => b.is_active && b.target_section === sec.key);

      for (const board of boards) {
        let boardMappings = [];
        try { boardMappings = await api('/monday/mappings?board=' + board.board_id); } catch (e) { continue; }
        if (!boardMappings || boardMappings.length === 0) continue;

        const updated = boardMappings.map(m => ({
          mondayColumnId: m.monday_column_id,
          mondayColumnTitle: m.monday_column_title,
          pipelineField: m.pipeline_field,
          displayLabel: displayConfig[m.pipeline_field] ? displayConfig[m.pipeline_field].displayLabel : (m.display_label || null),
          displayOrder: displayConfig[m.pipeline_field] ? displayConfig[m.pipeline_field].displayOrder : (m.display_order || 99),
          visible: displayConfig[m.pipeline_field] ? displayConfig[m.pipeline_field].visible : (m.visible !== 0),
        }));

        await api('/monday/mappings', {
          method: 'POST',
          body: JSON.stringify({ mappings: updated, boardId: board.board_id }),
        });
      }

      alert('Display settings saved for ' + sec.key.replace(/_/g, ' ') + '!');
    } catch (err) { alert('Failed to save display settings: ' + err.message); }
  }

  // Wire single save button + section dropdown for unified Display Config UI
  const unifiedSaveBtn = document.getElementById(UNIFIED_SAVE_BTN_ID);
  if (unifiedSaveBtn) {
    unifiedSaveBtn.addEventListener('click', () => saveSectionDisplaySettings(getActiveDisplaySection()));
  }
  const displaySectionSel = document.getElementById('mondayDisplaySectionSelect');
  if (displaySectionSel) {
    displaySectionSel.addEventListener('change', () => loadSectionDisplayConfig(getActiveDisplaySection()));
  }

  // ── Sync Controls ──
  async function runMondaySync() {
    const btns = [
      document.getElementById('mondayRunSyncBtn'),
      document.getElementById('mondayHeaderSyncBtn'),
    ].filter(Boolean);
    const info = document.getElementById('mondaySyncInfo');
    const headerStatus = document.getElementById('mondayHeaderSyncStatus');

    btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...'; });
    if (info) info.textContent = 'Sync in progress...';
    if (headerStatus) headerStatus.innerHTML = '<em>Syncing…</em>';

    try {
      const result = await api('/monday/sync', { method: 'POST', body: '{}' });
      if (!result) {
        if (info) info.textContent = 'Sync failed.';
        if (headerStatus) headerStatus.innerHTML = '<span style="color:#e74c3c;">Last sync failed</span>';
        return;
      }
      const delMsg = result.deleted ? ', ' + result.deleted + ' removed' : '';
      const successMsg = 'Sync complete! ' + result.itemsFetched + ' items (' + result.created + ' new, ' + result.updated + ' updated' + delMsg + ')';
      if (info) info.innerHTML = '<span style="color:#2e7d32;">' + successMsg + '</span>';
      if (headerStatus) headerStatus.innerHTML = '<span style="color:#2e7d32;">Last sync: just now</span>';
      loadMondaySyncHistory();
    } catch (err) {
      if (info) info.innerHTML = '<span style="color:#e74c3c;">Sync failed: ' + escHtml(err.message) + '</span>';
      if (headerStatus) headerStatus.innerHTML = '<span style="color:#e74c3c;">Last sync failed</span>';
    } finally {
      btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="fas fa-play"></i> Run Sync Now'; });
    }
  }

  /** Update the sticky header sync status from the most recent sync log entry. */
  async function refreshHeaderSyncStatus() {
    const headerStatus = document.getElementById('mondayHeaderSyncStatus');
    if (!headerStatus) return;
    try {
      const logs = await api('/monday/sync/log');
      if (!logs || logs.length === 0) {
        headerStatus.textContent = 'Last sync: never';
        return;
      }
      const latest = logs[0];
      const when = latest.started_at ? new Date(latest.started_at) : null;
      const ago = when ? timeAgo(when) : 'recent';
      const color = latest.status === 'success' ? '#2e7d32'
        : latest.status === 'error' ? '#e74c3c'
        : latest.status === 'running' ? '#f39c12' : '#666';
      headerStatus.innerHTML = 'Last sync: <span style="color:' + color + '; font-weight:600;">' + escHtml(latest.status) + '</span> · ' + ago;
    } catch (e) {
      headerStatus.textContent = 'Last sync: unknown';
    }
  }

  function timeAgo(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /** Refresh setup-flow checklist in the sticky header (token / boards / mappings / webhooks). */
  async function refreshSetupFlow() {
    const flow = document.getElementById('mondaySetupFlow');
    if (!flow) return;
    const mark = (step, done) => {
      const el = flow.querySelector('[data-step="' + step + '"]');
      if (el) el.classList.toggle('done', !!done);
    };
    try {
      const tokenStatus = document.getElementById('mondayTokenStatus');
      const hasToken = tokenStatus && /connected|saved/i.test(tokenStatus.textContent || '');
      mark('token', hasToken);
      const data = await api('/monday/boards');
      const boards = (data && data.boards) || [];
      mark('boards', boards.length > 0);
      // Mappings: check that at least one board has saved mappings
      let hasMapping = false;
      for (const b of boards.slice(0, 5)) {
        try {
          const m = await api('/monday/mappings?board=' + b.board_id);
          if (m && m.length > 0) { hasMapping = true; break; }
        } catch (e) {}
      }
      mark('mappings', hasMapping);
      // Webhooks
      const anyWebhook = boards.some(b => b.webhook_id);
      mark('webhooks', anyWebhook);
    } catch (e) { /* silent — best-effort indicator */ }
  }

  async function loadMondaySyncHistory() {
    const container = document.getElementById('mondaySyncHistory');
    if (!container) return;

    try {
      const logs = await api('/monday/sync/log');
      if (!logs || logs.length === 0) {
        container.textContent = 'No syncs have been run yet.';
        return;
      }

      const statusColors = { success: '#2e7d32', error: '#e74c3c', running: '#f39c12' };

      container.innerHTML =
        '<table class="admin-table" style="margin:0; font-size:12px;">' +
          '<thead><tr><th>Date</th><th>Board</th><th>Section</th><th>Status</th><th>Items</th><th>New</th><th>Updated</th></tr></thead>' +
          '<tbody>' +
            logs.slice(0, 15).map(log =>
              '<tr>' +
              '<td style="white-space:nowrap;">' + new Date(log.started_at).toLocaleString() + '</td>' +
              '<td><code style="font-size:11px;">' + escHtml(log.board_name || log.board_id) + '</code></td>' +
              '<td>' + escHtml(log.target_section || 'pipeline') + '</td>' +
              '<td><span style="color:' + (statusColors[log.status] || '#888') + '; font-weight:600;">' + escHtml(log.status) + '</span></td>' +
              '<td>' + (log.items_synced || 0) + '</td>' +
              '<td>' + (log.items_created || 0) + '</td>' +
              '<td>' + (log.items_updated || 0) + '</td>' +
              '</tr>'
            ).join('') +
          '</tbody>' +
        '</table>';
    } catch (e) {
      container.textContent = 'Could not load sync history.';
    }
  }

  document.getElementById('mondayRunSyncBtn').addEventListener('click', runMondaySync);
  const headerSyncBtn = document.getElementById('mondayHeaderSyncBtn');
  if (headerSyncBtn) headerSyncBtn.addEventListener('click', runMondaySync);

  // Initial population of header status + setup flow (fire-and-forget)
  refreshHeaderSyncStatus();
  refreshSetupFlow();
  // Refresh setup flow whenever Monday tab is activated
  document.querySelectorAll('.admin-tab[data-tab="monday"]').forEach(tab => {
    tab.addEventListener('click', () => { refreshHeaderSyncStatus(); refreshSetupFlow(); });
  });

  // ── Webhook Management ──
  async function loadMondayWebhooks() {
    const tbody = document.getElementById('mondayWebhooksBody');
    if (!tbody) return;

    try {
      const data = await api('/monday/boards');
      if (!data || !data.boards) return;

      const sectionLabels = { pipeline: 'Pipeline', pre_approvals: 'Pre-Approvals', funded_loans: 'Funded Loans' };

      tbody.innerHTML = data.boards.map(b => {
        const hasWebhook = !!b.webhook_id;
        const statusHtml = hasWebhook
          ? '<span style="color:#2e7d32; font-weight:600;"><i class="fas fa-check-circle"></i> Active</span>'
          : '<span style="color:#666;"><i class="fas fa-minus-circle"></i> Not enabled</span>';
        const actionHtml = hasWebhook
          ? `<button class="btn btn-secondary btn-sm" onclick="unregisterWebhook('${b.board_id}')"><i class="fas fa-unlink"></i> Disable</button>`
          : `<button class="btn btn-primary btn-sm" onclick="registerWebhook('${b.board_id}')"><i class="fas fa-bolt"></i> Enable</button>`;
        return '<tr>' +
          '<td>' + escHtml(b.board_name || b.board_id) + '</td>' +
          '<td>' + (sectionLabels[b.target_section] || b.target_section) + '</td>' +
          '<td>' + statusHtml + '</td>' +
          '<td>' + actionHtml + '</td>' +
          '</tr>';
      }).join('');

      if (data.boards.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#999;">No boards registered. Add a board first.</td></tr>';
      }
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#e74c3c;">Could not load webhook status.</td></tr>';
    }
  }

  window.registerWebhook = async function(boardId) {
    try {
      const result = await api('/monday/webhooks/register', {
        method: 'POST',
        body: JSON.stringify({ boardId }),
      });
      if (result) {
        loadMondayWebhooks();
      }
    } catch (e) {
      alert('Failed to enable webhook: ' + e.message);
    }
  };

  window.unregisterWebhook = async function(boardId) {
    if (!confirm('Disable real-time webhook for this board?')) return;
    try {
      const result = await api('/monday/webhooks/' + boardId, { method: 'DELETE' });
      if (result) {
        loadMondayWebhooks();
      }
    } catch (e) {
      alert('Failed to disable webhook: ' + e.message);
    }
  };

  /* ═══════════════════════════════════════
     PROCESSORS TAB
  ═══════════════════════════════════════ */
  async function loadProcessorAssignments() {
    const container = document.getElementById('processorAssignmentsContainer');
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#999;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
      const data = await api('/admin/processor-assignments');
      if (!data) return;

      const { processors, los, assignments } = data;

      if (processors.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:#999;">No processors found. Add a user with the "processor" role first.</div>';
        return;
      }

      // Build a map of processor -> Set of assigned LO ids
      const assignmentMap = {};
      processors.forEach(p => { assignmentMap[p.id] = new Set(); });
      assignments.forEach(a => {
        if (assignmentMap[a.processor_user_id]) {
          assignmentMap[a.processor_user_id].add(a.lo_user_id);
        }
      });

      let html = '';
      for (const proc of processors) {
        const assignedSet = assignmentMap[proc.id] || new Set();
        const cleanProcName = proc.name.replace(/\b\w/g, c => c.toUpperCase());
        const assignedCount = assignedSet.size;

        html += '<div class="processor-card" data-processor-id="' + proc.id + '">' +
          '<div class="processor-header">' +
            '<div>' +
              '<div class="proc-name"><i class="fas fa-user-shield" style="margin-right:6px; opacity:.7;"></i>' + escHtml(cleanProcName) + '</div>' +
              '<div class="proc-email">' + escHtml(proc.email) + '</div>' +
            '</div>' +
            '<button class="btn btn-sm proc-save-btn" data-processor-id="' + proc.id + '">' +
              '<i class="fas fa-save"></i> Save Assignments' +
            '</button>' +
          '</div>' +
          '<div class="processor-body">' +
            '<input type="text" class="processor-search" data-processor-id="' + proc.id + '" placeholder="Search employees...">' +
            '<div class="processor-select-actions">' +
              '<a class="proc-select-all" data-processor-id="' + proc.id + '">Select All</a>' +
              '<a class="proc-deselect-all" data-processor-id="' + proc.id + '">Deselect All</a>' +
              '<span class="processor-count" data-processor-id="' + proc.id + '">' + assignedCount + ' of ' + los.length + ' selected</span>' +
            '</div>' +
            '<div class="processor-lo-grid" data-processor-id="' + proc.id + '">';

        for (const lo of los) {
          const isChecked = assignedSet.has(lo.id);
          const checked = isChecked ? ' checked' : '';
          const checkedClass = isChecked ? ' checked' : '';
          const cleanName = lo.name.replace(/\b\w/g, c => c.toUpperCase());
          const roleLabel = lo.role || '';
          html += '<label class="lo-checkbox-label' + checkedClass + '" data-name="' + escHtml(cleanName.toLowerCase()) + '">' +
            '<input type="checkbox" class="proc-lo-cb" data-processor-id="' + proc.id + '" data-lo-id="' + lo.id + '"' + checked + '>' +
            '<span class="lo-name">' + escHtml(cleanName) + '</span>' +
            (roleLabel ? '<span class="lo-role">' + escHtml(roleLabel) + '</span>' : '') +
          '</label>';
        }

        html += '</div></div></div>';
      }

      container.innerHTML = html;

      // Search filter
      container.querySelectorAll('.processor-search').forEach(input => {
        input.addEventListener('input', () => {
          const query = input.value.toLowerCase().trim();
          const pid = input.dataset.processorId;
          const grid = container.querySelector('.processor-lo-grid[data-processor-id="' + pid + '"]');
          grid.querySelectorAll('.lo-checkbox-label').forEach(label => {
            const name = label.dataset.name || '';
            label.style.display = name.includes(query) ? '' : 'none';
          });
        });
      });

      // Select All / Deselect All
      container.querySelectorAll('.proc-select-all').forEach(link => {
        link.addEventListener('click', () => {
          const pid = link.dataset.processorId;
          const grid = container.querySelector('.processor-lo-grid[data-processor-id="' + pid + '"]');
          grid.querySelectorAll('.proc-lo-cb').forEach(cb => {
            cb.checked = true;
            cb.closest('.lo-checkbox-label').classList.add('checked');
          });
          updateProcCount(container, pid, los.length);
        });
      });
      container.querySelectorAll('.proc-deselect-all').forEach(link => {
        link.addEventListener('click', () => {
          const pid = link.dataset.processorId;
          const grid = container.querySelector('.processor-lo-grid[data-processor-id="' + pid + '"]');
          grid.querySelectorAll('.proc-lo-cb').forEach(cb => {
            cb.checked = false;
            cb.closest('.lo-checkbox-label').classList.remove('checked');
          });
          updateProcCount(container, pid, los.length);
        });
      });

      // Toggle checked class + update count on checkbox change
      container.querySelectorAll('.proc-lo-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.lo-checkbox-label').classList.toggle('checked', cb.checked);
          updateProcCount(container, cb.dataset.processorId, los.length);
        });
      });

      function updateProcCount(container, pid, total) {
        const checked = container.querySelectorAll('.proc-lo-cb[data-processor-id="' + pid + '"]:checked').length;
        const counter = container.querySelector('.processor-count[data-processor-id="' + pid + '"]');
        if (counter) counter.textContent = checked + ' of ' + total + ' selected';
      }

      // Bind save buttons
      container.querySelectorAll('.proc-save-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const processorId = btn.dataset.processorId;
          const checkboxes = container.querySelectorAll('.proc-lo-cb[data-processor-id="' + processorId + '"]');
          const loIds = [];
          checkboxes.forEach(cb => { if (cb.checked) loIds.push(parseInt(cb.dataset.loId, 10)); });

          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

          try {
            const result = await api('/admin/processor-assignments/' + processorId, {
              method: 'PUT',
              body: JSON.stringify({ lo_ids: loIds }),
            });
            if (result) {
              btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
              btn.classList.add('btn-success');
              setTimeout(() => {
                btn.innerHTML = '<i class="fas fa-save"></i> Save Assignments';
                btn.classList.remove('btn-success');
                btn.disabled = false;
              }, 1500);
            } else {
              btn.innerHTML = '<i class="fas fa-save"></i> Save Assignments';
              btn.disabled = false;
            }
          } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.innerHTML = '<i class="fas fa-save"></i> Save Assignments';
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<div style="text-align:center; padding:30px; color:#e74c3c;"><i class="fas fa-exclamation-triangle"></i> Failed to load: ' + escHtml(err.message) + '</div>';
    }
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', () => {
    // Verify admin access
    api('/me').then(me => {
      if (!me || String(me.role).toLowerCase() !== 'admin') {
        document.body.innerHTML = '<div style="text-align:center; padding:80px 20px; color:#e74c3c;"><i class="fas fa-lock" style="font-size:48px; margin-bottom:12px; display:block;"></i><p style="font-size:16px;">Admin access required.</p></div>';
        return;
      }

      // Hash-based deep linking
      var hash = window.location.hash;
      if (hash === '#monday') {
        document.querySelector('[data-tab="monday"]').click();
      } else if (hash === '#investors') {
        document.querySelector('[data-tab="investors"]').click();
      } else if (hash === '#processors') {
        document.querySelector('[data-tab="processors"]').click();
      } else {
        loadUsers();
      }
    });
  });
})();
