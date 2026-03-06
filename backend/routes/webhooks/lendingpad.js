/**
 * routes/webhooks/lendingpad.js
 *
 * Webhook endpoint for LendingPad loan data ingestion.
 * Upserts by loan_id, syncs funded loans to Monday.com.
 */
const router = require('express').Router();
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const { syncToMonday, isFundedLoan } = require('../../services/lendingpadSync');

// POST /api/webhooks/lendingpad — Receive loan data from LendingPad
router.post('/', async (req, res, next) => {
  try {
    // LendingPad sends data wrapped in { loanData: { ... } } from Make
    // or as raw loan object directly
    const loanData = req.body.loanData || req.body;

    if (!loanData || (!loanData.loanId && !loanData.loanNumber)) {
      return res.status(400).json({ error: 'Invalid loan data: loanId or loanNumber required' });
    }

    const loan = {
      loan_id: loanData.loanId || null,
      company_id: loanData.companyId || null,
      loan_number: loanData.loanNumber || null,
      lender_loan_number: loanData.lenderLoanNumber || null,
      broker_loan_number: loanData.brokerLoanNumber || null,
      loan_amount: parseFloat(loanData.loanAmount) || null,
      total_loan_amount: parseFloat(loanData.totalLoanAmount) || null,
      purchase_price: parseFloat(loanData.purchasePrice) || null,
      appraisal_value: parseFloat(loanData.appraisalValue) || null,
      note_rate: parseFloat(loanData.noteRate) || null,
      apr: parseFloat(loanData.apr) || null,
      term: parseInt(loanData.term) || null,
      credit_score: parseInt(loanData.creditScore) || null,
      units: parseInt(loanData.units) || null,
      ltv_ratio: parseFloat(loanData.ltvRatioPercent) || null,
      combined_ltv: parseFloat(loanData.combinedLtvRatioPercent) || null,
      hc_ltv: parseFloat(loanData.hcLtv) || null,
      front_dti: parseFloat(loanData.frontDti) || null,
      back_dti: parseFloat(loanData.backDti) || null,
      pmi: parseFloat(loanData.pmi) || null,
      other_financing: parseFloat(loanData.otherFinancing) || null,
      total_liquid_assets: parseFloat(loanData.totalLiquidAssets) || null,
      total_liability_balance: parseFloat(loanData.totalLiabilityBalance) || null,
      total_liabilities_monthly: parseFloat(loanData.totalLiabilitiesNonReoMonthPaymentAmount) || null,
      positive_net_rental_income: parseFloat(loanData.positiveNetRentalIncome) || null,
      negative_net_rental_income: parseFloat(loanData.negativeNetRentalIncome) || null,
      lender: loanData.lender || null,
      broker: loanData.broker || null,
      campaign: loanData.campaign || null,
      channel_type: loanData.channelType || null,
      document_type: loanData.documentType || null,
      agency_case_number: loanData.agencyCaseNumber || null,
      escrow_waiver: loanData.escrowWaiver ? 1 : 0,
      property_legal_description: loanData.propertyLegalDescription || null,
      legal_description_abbreviation: loanData.legalDescriptionAbbreviation || null,
      underwriter_comments: loanData.underwriterComments || null,
      loan_reference_id: loanData.loanReferenceId || null,
      raw_json: JSON.stringify(loanData),
    };

    // Upsert by loan_id
    if (loan.loan_id) {
      const [existing] = await db.query(
        'SELECT id FROM lendingpad_loans WHERE loan_id = ? LIMIT 1',
        [loan.loan_id]
      );

      if (existing.length > 0) {
        const entries = Object.entries(loan).filter(([, v]) => v !== null);
        const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
        const setValues = entries.map(([, v]) => v);

        await db.query(
          `UPDATE lendingpad_loans SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
          [...setValues, existing[0].id]
        );

        const [updated] = await db.query('SELECT * FROM lendingpad_loans WHERE id = ?', [existing[0].id]);

        // Sync to Monday.com if this is a funded loan
        let mondayResult = null;
        if (isFundedLoan(loanData)) {
          mondayResult = await syncToMonday(loanData, existing[0].id);
          if (mondayResult.synced) {
            await db.query(
              'UPDATE lendingpad_loans SET monday_board_id = ?, monday_synced_at = NOW() WHERE id = ?',
              [mondayResult.boardId, existing[0].id]
            );
          }
        }

        return res.json({ success: true, data: updated[0], action: 'updated', monday: mondayResult });
      }
    }

    // Insert new
    const columns = Object.keys(loan).join(', ');
    const placeholders = Object.keys(loan).map(() => '?').join(', ');
    const values = Object.values(loan);

    const [result] = await db.query(
      `INSERT INTO lendingpad_loans (${columns}) VALUES (${placeholders})`,
      values
    );

    const [created] = await db.query('SELECT * FROM lendingpad_loans WHERE id = ?', [result.insertId]);

    // Sync to Monday.com if this is a funded loan
    let mondayResult = null;
    if (isFundedLoan(loanData)) {
      mondayResult = await syncToMonday(loanData, result.insertId);
      if (mondayResult.synced) {
        await db.query(
          'UPDATE lendingpad_loans SET monday_board_id = ?, monday_synced_at = NOW() WHERE id = ?',
          [mondayResult.boardId, result.insertId]
        );
      }
    }

    res.status(201).json({ success: true, data: created[0], action: 'created', monday: mondayResult });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
