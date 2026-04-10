-- Migration 053: Refactor investor note tags to use a managed tags table
-- Date: 2026-04-10

-- Drop old string-based tags table
DROP TABLE IF EXISTS investor_note_tags;

-- Managed tags (like chat_tags)
CREATE TABLE IF NOT EXISTS investor_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(20) DEFAULT '#8cc63e',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Junction table referencing managed tags
CREATE TABLE IF NOT EXISTS investor_note_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    note_id INT NOT NULL,
    tag_id INT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES investor_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES investor_tags(id) ON DELETE CASCADE,
    UNIQUE KEY unique_note_tag (note_id, tag_id),
    INDEX idx_note_id (note_id),
    INDEX idx_tag_id (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pre-seed with common product/service tags
INSERT IGNORE INTO investor_tags (name, color) VALUES
    ('Conventional', '#4a90d9'),
    ('FHA', '#4a90d9'),
    ('VA', '#4a90d9'),
    ('USDA', '#4a90d9'),
    ('Jumbo', '#9b59b6'),
    ('Non-QM', '#9b59b6'),
    ('DSCR', '#9b59b6'),
    ('Bank Statement', '#9b59b6'),
    ('Asset Depletion', '#9b59b6'),
    ('Interest Only', '#9b59b6'),
    ('ITIN/FN', '#9b59b6'),
    ('Bridge', '#e67e22'),
    ('Land', '#e67e22'),
    ('Construction', '#e67e22'),
    ('Renovation', '#e67e22'),
    ('Manufactured', '#e67e22'),
    ('Doctor', '#e67e22'),
    ('Condo/NW', '#e67e22'),
    ('HELOC/2nd', '#e67e22'),
    ('Manual UW', '#27ae60'),
    ('Servicing', '#27ae60'),
    ('Scenario Desk', '#27ae60'),
    ('Condo Review', '#27ae60'),
    ('Exception Desk', '#27ae60'),
    ('Wire Review', '#27ae60');
