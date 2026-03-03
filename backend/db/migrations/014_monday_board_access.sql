-- ============================================================
-- MSFG Dashboard - Migration 014
-- Per-User Monday.com Board Access Control
-- ============================================================

-- 1. MONDAY_BOARD_ACCESS TABLE
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

-- 2. SOURCE_BOARD_ID on PRE_APPROVALS
ALTER TABLE pre_approvals ADD COLUMN source_board_id VARCHAR(50) NULL;

ALTER TABLE pre_approvals ADD INDEX idx_pa_source_board (source_board_id);

-- 3. GROUP_NAME on PRE_APPROVALS
ALTER TABLE pre_approvals ADD COLUMN group_name VARCHAR(255) NULL;

-- 4. SOURCE_BOARD_ID on FUNDED_LOANS
ALTER TABLE funded_loans ADD COLUMN source_board_id VARCHAR(50) NULL;

ALTER TABLE funded_loans ADD INDEX idx_fl_source_board (source_board_id);
