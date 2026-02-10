-- ============================================================
-- MSFG Monday.com Pipeline Integration
-- Migration 004 - Add columns to pipeline for Monday.com sync
-- ============================================================

-- ========================================
-- 1. ADD MONDAY.COM ITEM ID
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'monday_item_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN monday_item_id VARCHAR(50) NULL AFTER notes',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unique index so upserts work correctly
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND INDEX_NAME = 'idx_monday_item_id');
SET @sql = IF(@idx = 0,
    'ALTER TABLE pipeline ADD UNIQUE INDEX idx_monday_item_id (monday_item_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 2. LOAN NUMBER
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'loan_number');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN loan_number VARCHAR(100) NULL AFTER client_name',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 3. LOAN STATUS (from Monday — distinct from dashboard "status")
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'loan_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN loan_status VARCHAR(150) NULL AFTER loan_number',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 4. LENDER
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'lender');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN lender VARCHAR(255) NULL AFTER loan_status',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 5. SUBJECT PROPERTY
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'subject_property');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN subject_property VARCHAR(500) NULL AFTER lender',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 6. RATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'rate');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN rate VARCHAR(50) NULL AFTER loan_amount',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 7. APPRAISAL STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'appraisal_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN appraisal_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 8. LOAN PURPOSE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'loan_purpose');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN loan_purpose VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 9. OCCUPANCY
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'occupancy');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN occupancy VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 10. TITLE STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'title_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN title_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 11. HOI STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'hoi_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN hoi_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 12. LOAN ESTIMATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'loan_estimate');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN loan_estimate VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 13. APPLICATION DATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'application_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN application_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 14. LOCK EXPIRATION DATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'lock_expiration_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN lock_expiration_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 15. CLOSING DATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'closing_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN closing_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 16. FUNDING DATE
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'funding_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN funding_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 17. SOURCE SYSTEM + LAST SYNC TIMESTAMP
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'last_synced_at');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN last_synced_at TIMESTAMP NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 18. MONDAY.COM COLUMN MAPPING CONFIG TABLE
-- Stores the mapping between Monday.com column IDs and our DB columns.
-- Admin-configurable so column IDs can change without code changes.
-- ========================================
CREATE TABLE IF NOT EXISTS monday_column_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(50) NOT NULL,
    monday_column_id VARCHAR(100) NOT NULL,
    monday_column_title VARCHAR(255) NULL,
    pipeline_field VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_board_monday_col (board_id, monday_column_id),
    UNIQUE KEY uk_board_pipeline_field (board_id, pipeline_field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 19. MONDAY SYNC LOG
-- Audit trail of every sync run
-- ========================================
CREATE TABLE IF NOT EXISTS monday_sync_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(50) NOT NULL,
    triggered_by INT NULL,
    items_synced INT DEFAULT 0,
    items_created INT DEFAULT 0,
    items_updated INT DEFAULT 0,
    status ENUM('running','success','error') DEFAULT 'running',
    error_message TEXT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    INDEX idx_board (board_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
