-- Expanded product/service toggles + investor documents table

ALTER TABLE investors
  ADD COLUMN conventional TINYINT(1) DEFAULT NULL,
  ADD COLUMN fha TINYINT(1) DEFAULT NULL,
  ADD COLUMN bank_statement TINYINT(1) DEFAULT NULL,
  ADD COLUMN asset_depletion TINYINT(1) DEFAULT NULL,
  ADD COLUMN interest_only TINYINT(1) DEFAULT NULL,
  ADD COLUMN itin_foreign_national TINYINT(1) DEFAULT NULL,
  ADD COLUMN construction TINYINT(1) DEFAULT NULL,
  ADD COLUMN renovation TINYINT(1) DEFAULT NULL,
  ADD COLUMN manufactured TINYINT(1) DEFAULT NULL,
  ADD COLUMN condo_non_warrantable TINYINT(1) DEFAULT NULL,
  ADD COLUMN heloc_second TINYINT(1) DEFAULT NULL,
  ADD COLUMN scenario_desk TINYINT(1) DEFAULT NULL,
  ADD COLUMN condo_review TINYINT(1) DEFAULT NULL,
  ADD COLUMN exception_desk TINYINT(1) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS investor_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  investor_id INT NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  file_key VARCHAR(1000) NOT NULL,
  file_size INT UNSIGNED NULL,
  file_type VARCHAR(100) NULL,
  uploaded_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
  INDEX idx_investor_documents_investor (investor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
