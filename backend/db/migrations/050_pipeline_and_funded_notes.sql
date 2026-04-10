-- Migration 050: Add notes tables for pipeline and funded loans
-- Date: 2026-04-10

-- Notes system for pipeline items
CREATE TABLE IF NOT EXISTS pipeline_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pipeline_id INT NOT NULL,
    author_id INT NULL,
    author_name VARCHAR(200) NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pipeline_id) REFERENCES pipeline(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_pipeline_id (pipeline_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Notes system for funded loans
CREATE TABLE IF NOT EXISTS funded_loan_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    funded_loan_id INT NOT NULL,
    author_id INT NULL,
    author_name VARCHAR(200) NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (funded_loan_id) REFERENCES funded_loans(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_funded_loan_id (funded_loan_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
