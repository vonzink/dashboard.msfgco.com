-- ============================================
-- CORRECTED MIGRATION - Run AFTER DATABASE_SCHEMA.sql
-- ============================================

USE msfg_mortgage_db;

-- ========================================
-- API KEYS TABLE (must be created before other tables reference it)
-- ========================================
CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    key_name VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    secret_key VARCHAR(255),
    user_id INT NOT NULL, -- User who owns this API key
    allowed_endpoints TEXT, -- JSON array of allowed endpoints, NULL = all
    active BOOLEAN DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_api_key (api_key),
    INDEX idx_user (user_id),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- TASKS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
    status ENUM('todo', 'in-progress', 'done') DEFAULT 'todo',
    due_date DATE,
    due_time TIME,
    assigned_to VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_user (user_id),
    INDEX idx_due_date (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- PRE-APPROVALS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS pre_approvals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    loan_amount DECIMAL(15, 2) NOT NULL,
    pre_approval_date DATE NOT NULL,
    expiration_date DATE NOT NULL,
    status ENUM('active', 'expired', 'converted', 'cancelled') DEFAULT 'active',
    assigned_lo_id INT,
    assigned_lo_name VARCHAR(255),
    property_address VARCHAR(500),
    loan_type VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_lo_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_assigned_lo (assigned_lo_id),
    INDEX idx_expiration (expiration_date),
    INDEX idx_pre_approval_date (pre_approval_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- PIPELINE TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS pipeline (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    loan_amount DECIMAL(15, 2) NOT NULL,
    loan_type VARCHAR(100),
    stage VARCHAR(100) NOT NULL,
    target_close_date DATE,
    assigned_lo_id INT,
    assigned_lo_name VARCHAR(255),
    investor VARCHAR(255),
    investor_id INT,
    status VARCHAR(100) DEFAULT 'On Track',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_lo_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE SET NULL,
    INDEX idx_stage (stage),
    INDEX idx_status (status),
    INDEX idx_assigned_lo (assigned_lo_id),
    INDEX idx_investor (investor_id),
    INDEX idx_target_close (target_close_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- WEBHOOK LOGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS webhook_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key_id INT,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    payload TEXT,
    response_code INT,
    response_body TEXT,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
    INDEX idx_api_key (api_key_id),
    INDEX idx_created (created_at DESC),
    INDEX idx_endpoint (endpoint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- UPDATE DEFAULT USER ROLE TO ADMIN
-- ========================================
UPDATE users SET role = 'admin' WHERE email = 'zachary.zink@msfg.us';

