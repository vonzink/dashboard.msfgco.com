-- Migration 034: Add investor toggles, turn times table, RD lender ID
-- Adds yes/no toggle columns, turn times sub-table, and RD to lender IDs
-- Removes doc_review_wire and remote_closing_review columns

-- New toggle columns (TINYINT 0/1, default NULL = not set)
ALTER TABLE investors ADD COLUMN servicing TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN manual_underwriting TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN non_qm TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN jumbo TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN subordinate_financing TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN review_wire_release TINYINT(1) DEFAULT NULL;

-- Drop removed columns
ALTER TABLE investors DROP COLUMN doc_review_wire;
ALTER TABLE investors DROP COLUMN remote_closing_review;

-- Add RD lender ID to existing lender_ids table
ALTER TABLE investor_lender_ids ADD COLUMN rd_id VARCHAR(100) DEFAULT NULL;

-- Turn times sub-table (multiple per investor)
CREATE TABLE IF NOT EXISTS investor_turn_times (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    label VARCHAR(255) NOT NULL,
    value DECIMAL(10,1) NOT NULL,
    unit ENUM('days', 'hours') NOT NULL DEFAULT 'days',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    INDEX idx_investor (investor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
