-- ============================================================
-- MSFG Dashboard - Migration 014
-- Per-User Monday.com Board Access Control
-- New monday_board_access table, source_board_id on pre_approvals/funded_loans,
-- group_name on pre_approvals
-- ============================================================

-- ========================================
-- 1. MONDAY_BOARD_ACCESS TABLE
-- Maps users to the Monday boards they can view
-- Multiple users can be assigned to the same board
-- ========================================
CREATE TABLE IF NOT EXISTS monday_board_access (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_board_user (board_id, user_id),
  INDEX idx_user (user_id),
  INDEX idx_board (board_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 2. SOURCE_BOARD_ID on PRE_APPROVALS
-- Tracks which Monday board each synced row came from
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'source_board_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN source_board_id VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND INDEX_NAME = 'idx_pa_source_board');
SET @sql = IF(@idx = 0,
    'ALTER TABLE pre_approvals ADD INDEX idx_pa_source_board (source_board_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 3. GROUP_NAME on PRE_APPROVALS
-- Monday.com group/stage for filtering
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'group_name');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN group_name VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 4. SOURCE_BOARD_ID on FUNDED_LOANS
-- Tracks which Monday board each synced row came from
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND COLUMN_NAME = 'source_board_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE funded_loans ADD COLUMN source_board_id VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funded_loans' AND INDEX_NAME = 'idx_fl_source_board');
SET @sql = IF(@idx = 0,
    'ALTER TABLE funded_loans ADD INDEX idx_fl_source_board (source_board_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
