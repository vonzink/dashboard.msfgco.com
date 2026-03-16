-- ============================================================
-- Migration 036 - Add all remaining Monday.com fields to funded_loans
-- Mirrors every column from funded loan Monday.com boards
-- ============================================================

-- borrower_email
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower_email');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower_email VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_phone
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower_phone');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower_phone VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_dob
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower_dob');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower_dob DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_email
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'coborrower_email');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN coborrower_email VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coborrower_dob
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'coborrower_dob');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN coborrower_dob DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sbj_city
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'sbj_city');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN sbj_city VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sbj_state
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'sbj_state');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN sbj_state VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sbj_county
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'sbj_county');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN sbj_county VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sbj_zip
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'sbj_zip');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN sbj_zip VARCHAR(20) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- buyer_agent
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'buyer_agent');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN buyer_agent VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- seller_agent
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'seller_agent');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN seller_agent VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- title_company
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'title_company');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN title_company VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hazard_insurance_company
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'hazard_insurance_company');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN hazard_insurance_company VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hazard_insurance_amount
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'hazard_insurance_amount');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN hazard_insurance_amount DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cltv
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'cltv');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN cltv VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ltv
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'ltv');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN ltv VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- first_payment_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'first_payment_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN first_payment_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- mortgage_payment
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'mortgage_payment');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN mortgage_payment DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- taxes
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'taxes');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN taxes VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_first_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower_first_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower_first_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower_last_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower_last_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower_last_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- term
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'term');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN term VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower2_first_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower2_first_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower2_first_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower2_last_name
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower2_last_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower2_last_name VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- borrower2_phone
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'borrower2_phone');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN borrower2_phone VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- seller_comp
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'seller_comp');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN seller_comp DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- mortgage_insurance
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'mortgage_insurance');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN mortgage_insurance DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- escrow_waiver
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'escrow_waiver');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN escrow_waiver VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- occupancy_type
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'occupancy_type');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN occupancy_type VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lp_loan_number
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'lp_loan_number');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN lp_loan_number VARCHAR(100) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- property_type
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'property_type');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN property_type VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lender_or_broker_pd
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'lender_or_broker_pd');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN lender_or_broker_pd VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- application_date
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'application_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN application_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lien_status
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'lien_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN lien_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- state
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'state');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN state VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- broker_fee
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'broker_fee');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN broker_fee DECIMAL(15,2) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
