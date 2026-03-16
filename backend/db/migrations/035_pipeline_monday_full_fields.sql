-- ============================================================
-- Migration 035 - Add all remaining Monday.com fields to pipeline
-- Ensures dashboard can mirror every column from Monday.com boards
-- ============================================================

-- conditions
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'conditions');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN conditions TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lp_loan_number
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'lp_loan_number');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN lp_loan_number VARCHAR(100) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- property_type
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'property_type');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN property_type VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- assistant_mgr
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'assistant_mgr');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN assistant_mgr VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- initial_loan_amount
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'initial_loan_amount');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN initial_loan_amount DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- purchase_price
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'purchase_price');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN purchase_price DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- appraisal_deadline
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'appraisal_deadline');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN appraisal_deadline DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- appraisal_due_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'appraisal_due_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN appraisal_due_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- appraised_value
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'appraised_value');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN appraised_value DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- title_order_number
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'title_order_number');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN title_order_number VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payoffs
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'payoffs');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN payoffs VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payoff_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'payoff_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN payoff_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- wvoes
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'wvoes');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN wvoes VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vvoes
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'vvoes');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN vvoes VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hoa
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'hoa');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN hoa VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cd_info
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'cd_info');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN cd_info VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cd_signed
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'cd_signed');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN cd_signed VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dpa
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'dpa');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN dpa VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- closing_details
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'closing_details');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN closing_details TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- estimated_fund_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'estimated_fund_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN estimated_fund_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- closing_docs
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'closing_docs');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN closing_docs VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- send_to_compliance
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'send_to_compliance');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN send_to_compliance VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- Clear saved column mappings for pipeline boards so the
-- auto-mapper regenerates with all new fields on next sync.
-- Only clears pipeline-section boards; pre_approvals/funded_loans untouched.
-- ============================================================
DELETE mcm FROM monday_column_mappings mcm
  INNER JOIN monday_boards mb ON mcm.board_id = mb.board_id
  WHERE mb.target_section = 'pipeline';
