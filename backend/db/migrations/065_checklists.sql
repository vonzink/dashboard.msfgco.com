-- Loan Checklists feature: templates + loan-specific checklist instances

-- ── Checklist Templates (user-specific) ─────────────────────
CREATE TABLE IF NOT EXISTS checklist_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS checklist_template_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    name VARCHAR(500) NOT NULL,
    default_status ENUM('not_started','in_progress','done','issue','na') DEFAULT 'not_started',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE,
    INDEX idx_template (template_id),
    INDEX idx_sort (template_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS checklist_template_subitems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    name VARCHAR(500) NOT NULL,
    default_status ENUM('not_started','in_progress','done','issue','na') DEFAULT 'not_started',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES checklist_template_items(id) ON DELETE CASCADE,
    INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Loan Checklists (instance per loan/item) ────────────────
CREATE TABLE IF NOT EXISTS loan_checklists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_type ENUM('pipeline','pre_approval','application') NOT NULL,
    source_item_id INT NOT NULL,
    source_template_id INT,
    assigned_by_user_id INT,
    client_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (source_template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_source (source_type, source_item_id),
    INDEX idx_source (source_type, source_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loan_checklist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    checklist_id INT NOT NULL,
    name VARCHAR(500) NOT NULL,
    status ENUM('not_started','in_progress','done','issue','na') DEFAULT 'not_started',
    date DATE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (checklist_id) REFERENCES loan_checklists(id) ON DELETE CASCADE,
    INDEX idx_checklist (checklist_id),
    INDEX idx_sort (checklist_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loan_checklist_subitems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    name VARCHAR(500) NOT NULL,
    status ENUM('not_started','in_progress','done','issue','na') DEFAULT 'not_started',
    date DATE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES loan_checklist_items(id) ON DELETE CASCADE,
    INDEX idx_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
