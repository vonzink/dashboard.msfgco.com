-- 023: Profile enhancements — YouTube, QR codes, custom links, licensing fields

ALTER TABLE user_profiles
  ADD COLUMN youtube_url VARCHAR(500) DEFAULT NULL AFTER tiktok_url;

ALTER TABLE user_profiles
  ADD COLUMN qr_code_1_s3_key VARCHAR(500) DEFAULT NULL AFTER youtube_url,
  ADD COLUMN qr_code_1_label VARCHAR(100) DEFAULT NULL AFTER qr_code_1_s3_key;

ALTER TABLE user_profiles
  ADD COLUMN qr_code_2_s3_key VARCHAR(500) DEFAULT NULL AFTER qr_code_1_label,
  ADD COLUMN qr_code_2_label VARCHAR(100) DEFAULT NULL AFTER qr_code_2_s3_key;

ALTER TABLE user_profiles
  ADD COLUMN nmls_number VARCHAR(50) DEFAULT NULL AFTER qr_code_2_label,
  ADD COLUMN insurance_provider VARCHAR(255) DEFAULT NULL AFTER nmls_number,
  ADD COLUMN insurance_policy_number VARCHAR(100) DEFAULT NULL AFTER insurance_provider,
  ADD COLUMN insurance_expiration DATE DEFAULT NULL AFTER insurance_policy_number,
  ADD COLUMN bond_company VARCHAR(255) DEFAULT NULL AFTER insurance_expiration,
  ADD COLUMN bond_number VARCHAR(100) DEFAULT NULL AFTER bond_company,
  ADD COLUMN bond_expiration DATE DEFAULT NULL AFTER bond_number;

CREATE TABLE IF NOT EXISTS employee_custom_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  url VARCHAR(500) NOT NULL,
  icon VARCHAR(50) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
