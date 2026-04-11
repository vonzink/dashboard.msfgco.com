/* ============================================
   MSFG Dashboard - Investor Dropdown & Directory
   Nav dropdown rendering, search, All Investors modal
============================================ */

const InvestorDropdown = {
  // =========================================================
  // Nav dropdown
  // =========================================================
  refresh() {
    const container = document.getElementById('investorDropdownList');
    if (!container) return;

    const esc = Utils.escapeHtml;
    const data = Investors.data;

    const sorted = Object.entries(data)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    let html = '<div class="dropdown-header">Wholesale Partners (' + sorted.length + ')</div>' +
      '<div class="investor-dropdown-search">' +
        '<input type="text" id="investorDropdownSearch" class="form-input form-input-sm" placeholder="Search by name, product, service..." autocomplete="off" />' +
      '</div>' +
      '<div class="investor-card-grid" id="investorDropdownItems">';

    sorted.forEach(([key, inv]) => {
      let pillsHtml = '';
      const toggleDefs = [
        { val: inv.conventional,         label: 'Conv',         cat: 'agency' },
        { val: inv.fha,                  label: 'FHA',          cat: 'agency' },
        { val: inv.vaLoans,              label: 'VA',           cat: 'agency' },
        { val: inv.usda,                 label: 'USDA',         cat: 'agency' },
        { val: inv.jumbo,                label: 'Jumbo',        cat: 'nonagency' },
        { val: inv.nonQm,                label: 'Non-QM',       cat: 'nonagency' },
        { val: inv.dscr,                 label: 'DSCR',         cat: 'nonagency' },
        { val: inv.bankStatement,        label: 'Bank Stmt',    cat: 'nonagency' },
        { val: inv.assetDepletion,       label: 'Asset Depl.',  cat: 'nonagency' },
        { val: inv.interestOnly,         label: 'IO',           cat: 'nonagency' },
        { val: inv.itinForeignNational,  label: 'ITIN/FN',      cat: 'nonagency' },
        { val: inv.bridgeLoans,          label: 'Bridge',       cat: 'specialty' },
        { val: inv.landLoans,            label: 'Land',         cat: 'specialty' },
        { val: inv.construction,         label: 'Construction', cat: 'specialty' },
        { val: inv.renovation,           label: 'Renovation',   cat: 'specialty' },
        { val: inv.manufactured,         label: 'Manufactured', cat: 'specialty' },
        { val: inv.doctor,               label: 'Doctor',       cat: 'specialty' },
        { val: inv.condoNonWarrantable,  label: 'Condo/NW',     cat: 'specialty' },
        { val: inv.subordinateFinancing, label: 'Sub. Fin.',    cat: 'specialty' },
        { val: inv.helocSecond,          label: 'HELOC/2nd',    cat: 'specialty' },
        { val: inv.manualUnderwriting,   label: 'Manual UW',    cat: 'services' },
        { val: inv.servicing,            label: 'Servicing',    cat: 'services' },
        { val: inv.scenarioDesk,         label: 'Scenario',     cat: 'services' },
        { val: inv.condoReview,          label: 'Condo Rev.',   cat: 'services' },
        { val: inv.exceptionDesk,        label: 'Exception',    cat: 'services' },
        { val: inv.reviewWireRelease,    label: 'Wire Review',  cat: 'services' },
      ];
      (inv.customToggles || []).forEach(t => {
        if (Number(t.enabled) === 1) {
          toggleDefs.push({ val: 1, label: t.label, cat: 'custom' });
        }
      });
      const activePills = toggleDefs.filter(t => Number(t.val) === 1);
      if (activePills.length > 0) {
        pillsHtml = '<div class="investor-card-pills">';
        activePills.forEach(t => {
          pillsHtml += '<span class="dropdown-pill dropdown-pill-' + t.cat + '">' + esc(t.label) + '</span>';
        });
        pillsHtml += '</div>';
      }

      const aeNameStr = inv.accountExecutive?.name;
      const aeName = aeNameStr ? '<div class="investor-card-ae"><i class="fas fa-user-tie"></i> ' + esc(aeNameStr) + '</div>' : '';

      const logoHtml = inv.logoUrl
        ? '<img src="' + esc(inv.logoUrl) + '" alt="" class="investor-card-logo" />'
        : '<div class="investor-card-initials">' + esc((inv.name || key).charAt(0)) + '</div>';

      const noteTagNames = (Investors._investorNoteTagsMap[inv.id] || []).join(' ');
      const noteTagsHidden = noteTagNames ? '<span class="sr-only">' + esc(noteTagNames) + '</span>' : '';

      html += '<button type="button" class="investor-card-item" data-action="open-investor" data-investor="' + key + '">' +
        '<div class="investor-card-top">' +
          logoHtml +
          '<div class="investor-card-name">' + esc(inv.name || key) + '</div>' +
        '</div>' +
        aeName +
        pillsHtml +
        noteTagsHidden +
      '</button>';
    });

    html += '</div>';
    container.innerHTML = html;

    const searchInput = document.getElementById('investorDropdownSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const items = document.querySelectorAll('#investorDropdownItems .investor-card-item');
        items.forEach(btn => {
          const text = (btn.textContent || '').toLowerCase();
          btn.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
      });
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
  },

  // =========================================================
  // All Investors Directory modal
  // =========================================================
  async showAll() {
    const modal = document.getElementById('allInvestorsModal');
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    const closeBtn = document.getElementById('allInvestorsModalClose');
    if (closeBtn) closeBtn.onclick = () => this._hideAll();
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this._hideAll();
    });

    const tbody = document.getElementById('allInvestorsBody');
    const countsEl = document.getElementById('allInvestorsCounts');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
      const investors = await ServerAPI.getAllInvestors();
      if (!Array.isArray(investors) || investors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">No investors found.</td></tr>';
        return;
      }

      const esc = Utils.escapeHtml;
      const sorted = investors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const activeCount = sorted.filter(i => i.is_active === 1 || i.is_active === true).length;
      const inactiveCount = sorted.length - activeCount;
      if (countsEl) countsEl.textContent = sorted.length + ' investors (' + activeCount + ' active, ' + inactiveCount + ' inactive)';

      const toggleDefs = [
        { field: 'conventional',          label: 'Conv',         cat: 'agency' },
        { field: 'fha',                   label: 'FHA',          cat: 'agency' },
        { field: 'va_loans',              label: 'VA',           cat: 'agency' },
        { field: 'usda',                  label: 'USDA',         cat: 'agency' },
        { field: 'jumbo',                 label: 'Jumbo',        cat: 'nonagency' },
        { field: 'non_qm',               label: 'Non-QM',       cat: 'nonagency' },
        { field: 'dscr',                  label: 'DSCR',         cat: 'nonagency' },
        { field: 'bank_statement',        label: 'Bank Stmt',    cat: 'nonagency' },
        { field: 'asset_depletion',       label: 'Asset Depl.',  cat: 'nonagency' },
        { field: 'interest_only',         label: 'IO',           cat: 'nonagency' },
        { field: 'itin_foreign_national', label: 'ITIN/FN',      cat: 'nonagency' },
        { field: 'bridge_loans',          label: 'Bridge',       cat: 'specialty' },
        { field: 'land_loans',            label: 'Land',         cat: 'specialty' },
        { field: 'construction',          label: 'Construction', cat: 'specialty' },
        { field: 'renovation',            label: 'Renovation',   cat: 'specialty' },
        { field: 'manufactured',          label: 'Manufactured', cat: 'specialty' },
        { field: 'doctor',                label: 'Doctor',       cat: 'specialty' },
        { field: 'condo_non_warrantable', label: 'Condo/NW',     cat: 'specialty' },
        { field: 'subordinate_financing', label: 'Sub. Fin.',    cat: 'specialty' },
        { field: 'heloc_second',          label: 'HELOC/2nd',    cat: 'specialty' },
        { field: 'manual_underwriting',   label: 'Manual UW',    cat: 'services' },
        { field: 'servicing',             label: 'Servicing',    cat: 'services' },
        { field: 'scenario_desk',         label: 'Scenario',     cat: 'services' },
        { field: 'condo_review',          label: 'Condo Rev.',   cat: 'services' },
        { field: 'exception_desk',        label: 'Exception',    cat: 'services' },
        { field: 'review_wire_release',   label: 'Wire Review',  cat: 'services' },
      ];

      tbody.innerHTML = sorted.map(inv => {
        const active = inv.is_active === 1 || inv.is_active === true;

        let pillsHtml = '';
        const activePills = toggleDefs.filter(t => Number(inv[t.field]) === 1);
        (inv.customToggles || []).forEach(t => {
          if (Number(t.enabled) === 1) activePills.push({ label: t.label, cat: 'custom' });
        });
        if (activePills.length > 0) {
          pillsHtml = '<div class="inv-dir-pills">' +
            activePills.map(t => '<span class="dropdown-pill dropdown-pill-' + t.cat + '">' + esc(t.label) + '</span>').join('') +
          '</div>';
        }

        const noteTagNames = (Investors._investorNoteTagsMap[inv.id] || []).join(' ');
        const noteTagsHidden = noteTagNames ? '<span class="sr-only">' + esc(noteTagNames) + '</span>' : '';

        return '<tr style="' + (active ? '' : 'opacity:0.55;') + '">' +
          '<td><span class="inv-dir-name" data-investor-key="' + esc(inv.investor_key) + '">' + esc(inv.name) + '</span>' +
            (active ? '' : '<span class="inv-dir-inactive">(Inactive)</span>') + noteTagsHidden + '</td>' +
          '<td>' + esc(inv.account_executive_name || '--') + '</td>' +
          '<td>' + esc(inv.states || '--') + '</td>' +
          '<td>' + esc(inv.best_programs || '--') + '</td>' +
          '<td>' + (pillsHtml || '--') + '</td>' +
          '<td><div class="inv-dir-notes">' + esc(inv.notes || '--') + '</div></td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('.inv-dir-name').forEach(el => {
        el.addEventListener('click', () => {
          const key = el.dataset.investorKey;
          if (key) {
            this._hideAll();
            Investors.showModal(key);
          }
        });
      });

      const searchInput = document.getElementById('allInvestorsSearch');
      if (searchInput) {
        searchInput.value = '';
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase().trim();
          const rows = tbody.querySelectorAll('tr');
          rows.forEach(row => {
            const text = (row.textContent || '').toLowerCase();
            row.style.display = (!q || text.includes(q)) ? '' : 'none';
          });
        });
      }
    } catch (err) {
      console.error('Failed to load all investors:', err);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#e74c3c;">Failed to load investors.</td></tr>';
    }
  },

  _hideAll() {
    const modal = document.getElementById('allInvestorsModal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
  },
};

window.InvestorDropdown = InvestorDropdown;
