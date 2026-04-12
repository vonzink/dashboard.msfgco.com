-- Migration 055: Add purchase_price, ltv, dti, lp_loan_number, investor_loan_number
-- to pre_approvals table for richer Monday.com field mapping and detail view

SET @dbname = DATABASE();

-- purchase_price
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'purchase_price');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pre_approvals ADD COLUMN purchase_price DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ltv
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'ltv');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pre_approvals ADD COLUMN ltv VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dti
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'dti');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pre_approvals ADD COLUMN dti VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lp_loan_number
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'lp_loan_number');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pre_approvals ADD COLUMN lp_loan_number VARCHAR(100) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- investor_loan_number
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'investor_loan_number');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pre_approvals ADD COLUMN investor_loan_number VARCHAR(100) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
