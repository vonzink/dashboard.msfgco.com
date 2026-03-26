-- HR Resources feature: links + notes per category (mirrors program_links/notes pattern)
CREATE TABLE IF NOT EXISTS hr_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    url TEXT NOT NULL,
    label VARCHAR(255) NOT NULL,
    description VARCHAR(500),
    sort_order INT DEFAULT 0,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_category (category),
    INDEX idx_sort (category, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hr_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    created_by INT,
    user_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_category (category),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed FAMLI links
INSERT IGNORE INTO hr_links (category, url, label, description, sort_order) VALUES
('famli', 'https://famli.colorado.gov/employers/my-famli-employer/my-famli-employer-user-guide?utm_medium=govdelivery&utm_source=email', 'FAMLI Employer User Guide', 'My FAMLI+ Employer portal user guide', 1),
('famli', 'https://famli.colorado.gov/individuals-and-families', 'FAMLI Individuals & Families', 'Information for individuals and families', 2);
