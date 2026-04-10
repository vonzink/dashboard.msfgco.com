-- Migration 052: Add tags for investor notes
-- Date: 2026-04-10

CREATE TABLE IF NOT EXISTS investor_note_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    note_id INT NOT NULL,
    tag VARCHAR(100) NOT NULL,
    FOREIGN KEY (note_id) REFERENCES investor_notes(id) ON DELETE CASCADE,
    INDEX idx_note_id (note_id),
    INDEX idx_tag (tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
