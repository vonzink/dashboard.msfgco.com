-- Realtors lookup table
CREATE TABLE IF NOT EXISTS realtors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  agent_name VARCHAR(255),
  company_nmls_id VARCHAR(50),
  email VARCHAR(255),
  state_license_id VARCHAR(100),
  contact_nmls_id VARCHAR(50),
  work_phone VARCHAR(50),
  fax VARCHAR(50),
  street VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(10),
  zip_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_state (state),
  INDEX idx_company_name (company_name),
  INDEX idx_agent_name (agent_name)
);
