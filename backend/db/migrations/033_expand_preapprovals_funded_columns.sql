-- Migration 033: Add more columns to pre_approvals and funded_loans
-- to match Monday.com board data and give users more fields to display

-- ========================================
-- PRE_APPROVALS: New columns
-- ========================================
ALTER TABLE pre_approvals
  ADD COLUMN loan_number VARCHAR(50) NULL,
  ADD COLUMN lender VARCHAR(200) NULL,
  ADD COLUMN subject_property VARCHAR(500) NULL,
  ADD COLUMN loan_purpose VARCHAR(100) NULL,
  ADD COLUMN occupancy VARCHAR(100) NULL,
  ADD COLUMN rate VARCHAR(20) NULL,
  ADD COLUMN credit_score INT NULL,
  ADD COLUMN income DECIMAL(15,2) NULL,
  ADD COLUMN property_type VARCHAR(100) NULL,
  ADD COLUMN referring_agent VARCHAR(200) NULL,
  ADD COLUMN contact_date DATE NULL;

-- ========================================
-- FUNDED_LOANS: New columns
-- ========================================
ALTER TABLE funded_loans
  ADD COLUMN closing_date DATE NULL,
  ADD COLUMN loan_status VARCHAR(100) NULL,
  ADD COLUMN purchase_price DECIMAL(15,2) NULL,
  ADD COLUMN appraised_value DECIMAL(15,2) NULL,
  ADD COLUMN rate VARCHAR(20) NULL,
  ADD COLUMN occupancy VARCHAR(100) NULL,
  ADD COLUMN lender VARCHAR(200) NULL,
  ADD COLUMN loan_purpose VARCHAR(100) NULL,
  ADD COLUMN credit_score INT NULL,
  ADD COLUMN subject_property VARCHAR(500) NULL,
  ADD COLUMN referring_agent VARCHAR(200) NULL,
  ADD COLUMN loan_number VARCHAR(50) NULL;
