-- Time-stamped call notes / log entries on checklist items.
--
-- Each note carries an author (nullable — preserved if the user is deleted)
-- and a body up to 2000 chars. Notes are immutable from the UI's perspective
-- (no edit endpoint) so the timestamp keeps its audit-log meaning; users can
-- delete a note they own. Notes cascade-delete with their parent item.

CREATE TABLE IF NOT EXISTS loan_checklist_item_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    body TEXT NOT NULL,
    created_by_user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES loan_checklist_items(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_item (item_id),
    INDEX idx_created (item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
