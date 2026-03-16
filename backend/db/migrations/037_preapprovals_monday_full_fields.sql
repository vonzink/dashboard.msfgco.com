-- ============================================================
-- Migration 037 - Add all remaining Monday.com fields to pre_approvals
-- Mirrors every column from pre-approval Monday.com boards
-- ============================================================

-- next_steps
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'next_steps');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN next_steps TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- special_request
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'special_request');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN special_request TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stage
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'stage');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN stage VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- partners
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'partners');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN partners VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_email
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'borrower_email');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN borrower_email VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_phone
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'borrower_phone');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN borrower_phone VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_first_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_first_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_first_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_last_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_last_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_last_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_phone
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_phone');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_phone VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_email
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_email');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_email VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- current_address
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'current_address');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN current_address VARCHAR(500) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- city
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'city');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN city VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- state
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'state');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN state VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- zip
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'zip');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN zip VARCHAR(20) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_dob
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'borrower_dob');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN borrower_dob DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- citizenship
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'citizenship');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN citizenship VARCHAR(100) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_first_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'borrower_first_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN borrower_first_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_last_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'borrower_last_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN borrower_last_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_dob
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_dob');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_dob DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- credit_report_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'credit_report_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN credit_report_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'coborrower_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN coborrower_name VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- campaign
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'campaign');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN campaign VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
