-- Migration 011: Employee Profiles, Notes, and Documents
-- Adds comprehensive profile system for employee management

-- =========================================================
-- Table 1: user_profiles (1:1 with users)
-- Contact info, social media, avatar, email signature
-- =========================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,

    -- Contact / public-facing info
    team VARCHAR(100) NULL,
    phone VARCHAR(50) NULL,
    display_email VARCHAR(255) NULL,
    website VARCHAR(500) NULL,
    online_app_url VARCHAR(500) NULL,

    -- Social media URLs
    facebook_url VARCHAR(500) NULL,
    instagram_url VARCHAR(500) NULL,
    twitter_url VARCHAR(500) NULL,
    linkedin_url VARCHAR(500) NULL,
    tiktok_url VARCHAR(500) NULL,

    -- Avatar (S3 key on msfg-media bucket)
    avatar_s3_key VARCHAR(500) NULL,

    -- Email signature (HTML content)
    email_signature TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- Table 2: employee_notes (1:many with users)
-- Dated notes about employees, written by admins/managers
-- =========================================================
CREATE TABLE IF NOT EXISTS employee_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    author_id INT NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_en_user (user_id),
    INDEX idx_en_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- Table 3: employee_documents (1:many with users)
-- Contracts, performance reports, licenses stored in S3
-- =========================================================
CREATE TABLE IF NOT EXISTS employee_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_s3_key VARCHAR(500) NOT NULL,
    file_size INT NULL,
    file_type VARCHAR(100) NULL,
    category VARCHAR(100) NULL,
    description VARCHAR(500) NULL,
    uploaded_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ed_user (user_id),
    INDEX idx_ed_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
