-- ============================================
-- ROLE-BASED ACCESS CONTROL UPDATES
-- Updates to support Admin vs User roles
-- ============================================

USE msfg_mortgage_db;

-- Update API keys table to include user_id (if not already present)
ALTER TABLE api_keys 
ADD COLUMN IF NOT EXISTS user_id INT,
ADD FOREIGN KEY IF NOT EXISTS (user_id) REFERENCES users(id) ON DELETE CASCADE,
ADD INDEX IF NOT EXISTS idx_user (user_id);

-- Update existing users to have proper roles
-- Set default user as Admin
UPDATE users SET role = 'admin' WHERE email = 'zachary.zink@msfg.us' AND (role IS NULL OR role = '');

-- Add any additional users you need (example)
-- INSERT INTO users (email, name, initials, role) 
-- VALUES ('user@example.com', 'Regular User', 'RU', 'user')
-- ON DUPLICATE KEY UPDATE role='user';

-- Note: For MySQL 8.0+, use this syntax instead:
-- ALTER TABLE api_keys ADD COLUMN user_id INT AFTER created_by;
-- ALTER TABLE api_keys ADD CONSTRAINT fk_api_key_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- CREATE INDEX idx_user ON api_keys(user_id);

