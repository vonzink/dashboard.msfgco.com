-- Migration 019: Processing Links table for VOE, AMC, Payoffs, Insurance quick links
CREATE TABLE IF NOT EXISTS processing_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_type VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  icon VARCHAR(100) DEFAULT 'fa-link',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_section_type (section_type)
);
