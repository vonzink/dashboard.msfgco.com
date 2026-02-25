-- ============================================================
-- MSFG Dashboard - Migration 010
-- Dynamic Monday.com Board Management
-- New monday_boards table, monday_item_id on pre_approvals/funded_loans,
-- target_section on monday_sync_log
-- ============================================================

-- ========================================
-- 1. MONDAY_BOARDS CONFIG TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS monday_boards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id VARCHAR(50) NOT NULL UNIQUE,
  board_name VARCHAR(255) NOT NULL DEFAULT '',
  target_section ENUM('pipeline','pre_approvals','funded_loans') NOT NULL DEFAULT 'pipeline',
  is_active TINYINT(1) DEFAULT 1,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 2. SEED EXISTING BOARDS
-- ========================================
INSERT IGNORE INTO monday_boards (board_id, board_name, target_section)
VALUES ('3946783498', 'Board 1', 'pipeline'), ('8225994434', 'Board 2', 'pipeline');

-- ========================================
-- 3. MONDAY_ITEM_ID on PRE_APPROVALS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'monday_item_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN monday_item_id VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unique index
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND INDEX_NAME = 'idx_pa_monday_item_id');
SET @sql = IF(@idx = 0,
    'ALTER TABLE pre_approvals ADD UNIQUE INDEX idx_pa_monday_item_id (monday_item_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- SOURCE_SYSTEM on PRE_APPROVALS
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'source_system');
SET @sql = IF(@col = 0,
    "ALTER TABLE pre_approvals ADD COLUMN source_system VARCHAR(50) DEFAULT 'manual'",
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- LAST_SYNCED_AT on PRE_APPROVALS
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'last_synced_at');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN last_synced_at TIMESTAMP NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 4. MONDAY_ITEM_ID on FUNDED_LOANS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'monday_item_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN monday_item_id VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unique index
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND INDEX_NAME = 'idx_fl_monday_item_id');
SET @sql = IF(@idx = 0,
    'ALTER TABLE funded_loans ADD UNIQUE INDEX idx_fl_monday_item_id (monday_item_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- LAST_SYNCED_AT on FUNDED_LOANS
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'last_synced_at');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN last_synced_at TIMESTAMP NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 5. TARGET_SECTION on MONDAY_SYNC_LOG
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monday_sync_log' AND COLUMN_NAME = 'target_section');
SET @sql = IF(@col = 0,
    'ALTER TABLE monday_sync_log ADD COLUMN target_section VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
