-- Migration 007: Chat messages and tag system
-- Tables are created via direct SQL since CREATE TABLE with FK
-- requires all referenced tables to exist first.
-- The migration runner handles "already exists" errors gracefully.

CREATE TABLE IF NOT EXISTS chat_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#8cc63e',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_initials VARCHAR(10),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_message_tags (
    message_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (message_id, tag_id),
    INDEX idx_tag (tag_id),
    INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
