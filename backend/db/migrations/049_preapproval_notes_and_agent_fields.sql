-- Migration 049: Add pre_approval_notes table + referring agent contact fields
-- Date: 2026-04-09

-- Notes system for pre-approvals (timestamped, editable, deletable)
CREATE TABLE IF NOT EXISTS pre_approval_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pre_approval_id INT NOT NULL,
    author_id INT NULL,
    author_name VARCHAR(200) NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pre_approval_id) REFERENCES pre_approvals(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_pre_approval_id (pre_approval_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Referring agent contact fields
ALTER TABLE pre_approvals
  ADD COLUMN IF NOT EXISTS referring_agent_email VARCHAR(200) NULL AFTER referring_agent,
  ADD COLUMN IF NOT EXISTS referring_agent_phone VARCHAR(50) NULL AFTER referring_agent_email;

ALTER TABLE funded_loans
  ADD COLUMN IF NOT EXISTS referring_agent_email VARCHAR(200) NULL AFTER referring_agent,
  ADD COLUMN IF NOT EXISTS referring_agent_phone VARCHAR(50) NULL AFTER referring_agent_email;
