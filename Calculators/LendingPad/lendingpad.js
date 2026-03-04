(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  const fmtMoney = (n) => n != null ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtPct = (n) => n != null ? Number(n).toFixed(3) + '%' : '—';

  async function loadLoans() {
    $('#loading').style.display = 'block';
    $('#loansContainer').style.display = 'none';
    $('#error').style.display = 'none';

    try {
      const res = await window.ApiServer.get('/api/lendingpad');
      const loans = res;

      $('#loading').style.display = 'none';
      $('#loansContainer').style.display = 'flex';
      $('#loanCount').textContent = loans.length + ' loan' + (loans.length !== 1 ? 's' : '');

      if (loans.length === 0) {
        $('#loansContainer').innerHTML = `
          <div class="empty-state">
            <h3>No Loans Yet</h3>
            <p>LendingPad data will appear here once your webhook starts sending data.</p>
          </div>`;
        return;
      }

      $('#loansContainer').innerHTML = loans.map(loan => `
        <div class="loan-card" data-id="${loan.id}">
          <div class="loan-card-header">
            <span class="loan-number">${loan.loan_number || 'No Loan #'}</span>
            <span class="loan-lender">${loan.lender || ''}</span>
          </div>
          <div class="loan-card-grid">
            <div class="loan-field">
              <span class="loan-field-label">Loan Amount</span>
              <span class="loan-field-value">${fmtMoney(loan.loan_amount)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Purchase Price</span>
              <span class="loan-field-value">${fmtMoney(loan.purchase_price)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Appraisal</span>
              <span class="loan-field-value">${fmtMoney(loan.appraisal_value)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Rate</span>
              <span class="loan-field-value">${loan.note_rate != null ? loan.note_rate + '%' : '—'}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">APR</span>
              <span class="loan-field-value">${loan.apr != null ? loan.apr + '%' : '—'}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Term</span>
              <span class="loan-field-value">${loan.term || '—'}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">LTV</span>
              <span class="loan-field-value">${fmtPct(loan.ltv_ratio)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">CLTV</span>
              <span class="loan-field-value">${fmtPct(loan.combined_ltv)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Credit Score</span>
              <span class="loan-field-value">${loan.credit_score || '—'}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Front DTI</span>
              <span class="loan-field-value">${fmtPct(loan.front_dti)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Back DTI</span>
              <span class="loan-field-value">${fmtPct(loan.back_dti)}</span>
            </div>
            <div class="loan-field">
              <span class="loan-field-label">Liquid Assets</span>
              <span class="loan-field-value">${fmtMoney(loan.total_liquid_assets)}</span>
            </div>
          </div>
          <div class="loan-card-footer">
            <span class="loan-timestamp">Received: ${new Date(loan.received_at).toLocaleString()}</span>
            <button class="btn-json" data-id="${loan.id}">View JSON</button>
          </div>
        </div>
      `).join('');

    } catch (err) {
      $('#loading').style.display = 'none';
      $('#error').style.display = 'block';
      $('#error').textContent = 'Failed to load loans: ' + (err.message || err);
    }
  }

  function showJsonModal(loan) {
    let rawData;
    try {
      rawData = typeof loan.raw_json === 'string' ? JSON.parse(loan.raw_json) : loan.raw_json;
    } catch {
      rawData = loan;
    }
    $('#jsonModalTitle').textContent = 'Loan ' + (loan.loan_number || loan.id);
    $('#jsonModalBody').textContent = JSON.stringify(rawData, null, 2);
    $('#jsonModal').style.display = 'flex';
  }

  // Event delegation
  document.addEventListener('click', async (e) => {
    const jsonBtn = e.target.closest('.btn-json');
    if (jsonBtn) {
      e.stopPropagation();
      const id = jsonBtn.dataset.id;
      try {
        const loan = await window.ApiServer.get('/api/lendingpad/' + id);
        showJsonModal(loan);
      } catch (err) {
        alert('Failed to load loan: ' + err.message);
      }
      return;
    }

    // Click on card to show JSON too
    const card = e.target.closest('.loan-card');
    if (card) {
      const id = card.dataset.id;
      try {
        const loan = await window.ApiServer.get('/api/lendingpad/' + id);
        showJsonModal(loan);
      } catch (err) {
        alert('Failed to load loan: ' + err.message);
      }
    }
  });

  // Close modal
  $('#jsonModalClose').addEventListener('click', () => {
    $('#jsonModal').style.display = 'none';
  });
  $('#jsonModal').addEventListener('click', (e) => {
    if (e.target === $('#jsonModal')) $('#jsonModal').style.display = 'none';
  });

  // Refresh button
  $('#btnRefresh').addEventListener('click', loadLoans);

  // Initial load
  loadLoans();
})();
