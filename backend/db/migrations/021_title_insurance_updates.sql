-- Add missing columns to title_companies
ALTER TABLE title_companies
  ADD COLUMN nmls VARCHAR(50) AFTER license_number,
  ADD COLUMN state_license VARCHAR(100) AFTER nmls,
  ADD COLUMN contact_nmls VARCHAR(50) AFTER state_license,
  ADD COLUMN contact_email VARCHAR(255) AFTER contact_nmls,
  ADD COLUMN contact_phone VARCHAR(50) AFTER contact_email;

-- Insurance Companies lookup table
CREATE TABLE IF NOT EXISTS insurance_companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  point_of_contact VARCHAR(255),
  contact_phone VARCHAR(50),
  work_phone VARCHAR(50),
  fax VARCHAR(50),
  email VARCHAR(255),
  nmls VARCHAR(50),
  state_license VARCHAR(100),
  contact_nmls VARCHAR(50),
  street VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(10),
  zip_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_state (state),
  INDEX idx_company_name (company_name)
);
