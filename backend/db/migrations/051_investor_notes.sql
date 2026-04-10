-- Migration 051: Add notes table for investors
-- Date: 2026-04-10

CREATE TABLE IF NOT EXISTS investor_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    author_id INT NULL,
    author_name VARCHAR(200) NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_investor_id (investor_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
