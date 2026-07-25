-- ========================================
-- 089: Manager → Loan Officer Assignments
-- Mirrors processor_lo_assignments (migration 002) but for the "manager" role.
-- Controls which employees' loans each Manager can view/edit/work on in the
-- pipeline, funded loans, and pre-approvals. Scoping mirrors processors, except
-- a manager always sees their own loans on top of whatever is assigned here.
-- One manager can have many LOs. One LO can be under many managers.
-- NOTE: never use a semicolon inside these comments. migrations.js splits the
-- file on the statement separator BEFORE stripping comments, so a semicolon in
-- a comment truncates the statement that follows and the migration fails.
-- ========================================
CREATE TABLE IF NOT EXISTS manager_lo_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    manager_user_id INT NOT NULL,
    lo_user_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INT,                   -- Admin who made the assignment

    -- Prevent duplicate assignments
    UNIQUE KEY unique_manager_assignment (manager_user_id, lo_user_id),

    -- Indexes
    INDEX idx_manager (manager_user_id),
    INDEX idx_manager_lo (lo_user_id),

    -- Foreign keys
    FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lo_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
