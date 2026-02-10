
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    initials VARCHAR(10),
    role VARCHAR(100) DEFAULT 'user',
    cognito_sub VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_cognito_sub (cognito_sub),
    INDEX idx_email (email),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    key_name VARCHAR(100),
    api_key VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN DEFAULT TRUE,
    expires_at DATETIME NULL,
    last_used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_active (active),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhook_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key_id INT NULL,
    endpoint VARCHAR(255),
    method VARCHAR(20),
    payload JSON NULL,
    response_code INT NULL,
    response_body JSON NULL,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
    INDEX idx_api_key (api_key_id),
    INDEX idx_endpoint (endpoint),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investors (
    id INT AUTO_INCREMENT PRIMARY KEY,

    investor_key VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,

    logo_url TEXT,
    login_url TEXT,

    account_executive_name VARCHAR(255),
    account_executive_mobile VARCHAR(50),
    account_executive_email VARCHAR(255),
    account_executive_address TEXT,

    notes TEXT,

    states TEXT,
    best_programs TEXT,
    minimum_fico VARCHAR(64),
    in_house_dpa VARCHAR(64),
    epo VARCHAR(128),
    doc_review_wire VARCHAR(64),
    remote_closing_review VARCHAR(64),

    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_key (investor_key),
    INDEX idx_active (is_active),
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investor_team (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    role VARCHAR(255),
    name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    INDEX idx_investor (investor_id),
    INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investor_lender_ids (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    fha_id VARCHAR(100),
    va_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    INDEX idx_investor (investor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investor_mortgagee_clauses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    name VARCHAR(255),
    isaoa VARCHAR(255),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    INDEX idx_investor (investor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investor_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investor_id INT NOT NULL,
    link_type VARCHAR(50) NOT NULL, -- website, flexSite, faq, appraisalVideo, newScenarios, login
    url TEXT NOT NULL,
    label VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    INDEX idx_investor (investor_id),
    INDEX idx_type (link_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS investor_notes (
    investor_id INT NOT NULL,
    user_id INT NOT NULL,
    notes TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (investor_id, user_id),
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_investor (investor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    link TEXT,
    icon VARCHAR(100),
    author_id INT,
    file_s3_key VARCHAR(500),
    file_name VARCHAR(255),
    file_size INT,
    file_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_created (created_at),
    INDEX idx_author (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    reminder_date DATE NOT NULL,
    reminder_time TIME NOT NULL,
    note TEXT NOT NULL,
    sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, reminder_date, reminder_time),
    INDEX idx_sent (sent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS goals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    period_type ENUM('weekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
    period_value VARCHAR(50) NOT NULL, -- e.g., '2024-12', '2024-Q4', '2024'
    goal_type VARCHAR(50) NOT NULL, -- loans-closed, volume-closed, pipeline, pull-through
    current_value DECIMAL(15, 2),
    target_value DECIMAL(15, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_goal (user_id, period_type, period_value, goal_type),
    INDEX idx_user_period (user_id, period_type, period_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_preferences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    theme VARCHAR(20) DEFAULT 'light', -- light, dark
    default_goal_period VARCHAR(20) DEFAULT 'monthly',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


INSERT INTO users (email, name, initials, role)
VALUES ('zachary.zink@msfg.us', 'Zachary Zink', 'ZZ', 'Loan Officer')
ON DUPLICATE KEY UPDATE
  name='Zachary Zink',
  initials='ZZ',
  role='Loan Officer';

INSERT INTO user_preferences (user_id, theme, default_goal_period)
SELECT id, 'light', 'monthly' FROM users WHERE email = 'zachary.zink@msfg.us'
ON DUPLICATE KEY UPDATE
  theme='light',
  default_goal_period='monthly';
