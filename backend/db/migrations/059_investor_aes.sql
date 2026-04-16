-- Migration 059: Additional Account Executives per investor
-- Some investors have multiple AEs. The primary AE stays in the investors.account_executive_* columns
-- for backward compatibility; additional AEs live here.

CREATE TABLE IF NOT EXISTS investor_aes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  investor_id INT NOT NULL,
  name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  mobile VARCHAR(50) NULL,
  photo_url VARCHAR(500) NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
  INDEX idx_investor (investor_id),
  INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
