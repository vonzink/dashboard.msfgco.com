-- Migration 043: Chat message editing + file attachments
-- Adds edit tracking to chat_messages and a chat_attachments table for file uploads

-- Add edit tracking columns to chat_messages
ALTER TABLE chat_messages
  ADD COLUMN updated_at DATETIME NULL DEFAULT NULL AFTER created_at,
  ADD COLUMN is_edited TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_at;

-- Chat file attachments
CREATE TABLE IF NOT EXISTS chat_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INT NOT NULL DEFAULT 0,
  file_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  s3_key VARCHAR(500) NOT NULL,
  s3_bucket VARCHAR(100) NOT NULL DEFAULT 'msfg-media',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  INDEX idx_chat_attachments_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
