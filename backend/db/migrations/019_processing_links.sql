-- Migration 019: Processing Links table for VOE, AMC, Payoffs, Insurance quick links
CREATE TABLE IF NOT EXISTS processing_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_type VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  fax VARCHAR(50) DEFAULT NULL,
  agent_name VARCHAR(255) DEFAULT NULL,
  agent_email VARCHAR(255) DEFAULT NULL,
  icon VARCHAR(100) DEFAULT 'fa-link',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_section_type (section_type)
);

-- Add columns if table already exists (idempotent)
SET @dbname = DATABASE();
SET @tablename = 'processing_links';

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'email') = 0,
  'ALTER TABLE processing_links ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER url',
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'phone') = 0,
  'ALTER TABLE processing_links ADD COLUMN phone VARCHAR(50) DEFAULT NULL AFTER email',
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'fax') = 0,
  'ALTER TABLE processing_links ADD COLUMN fax VARCHAR(50) DEFAULT NULL AFTER phone',
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'agent_name') = 0,
  'ALTER TABLE processing_links ADD COLUMN agent_name VARCHAR(255) DEFAULT NULL AFTER fax',
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'agent_email') = 0,
  'ALTER TABLE processing_links ADD COLUMN agent_email VARCHAR(255) DEFAULT NULL AFTER agent_name',
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
