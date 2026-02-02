-- ============================================
-- MIGRATION 002: Goals, Funded Loans, Permissions
-- Run this on your RDS database (msfg_mortgage_db)
-- ============================================

USE msfg_mortgage_db;

-- ========================================
-- 1. FUNDED LOANS TABLE
-- Loans move here when status = 'Funded'
-- ========================================
CREATE TABLE IF NOT EXISTS funded_loans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Loan data (copied from pipeline)
    client_name VARCHAR(255) NOT NULL,
    loan_amount DECIMAL(15,2) NOT NULL,
    loan_type VARCHAR(100),
    funded_date DATE NOT NULL,
    
    -- Assignment
    assigned_lo_id INT,
    assigned_lo_name VARCHAR(255),
    assigned_processor_id INT,
    
    -- Investor info
    investor VARCHAR(255),
    investor_id INT,
    
    -- Additional info
    property_address VARCHAR(500),
    notes TEXT,
    
    -- Tracking
    original_pipeline_id INT,
    source_system VARCHAR(100),        -- e.g., 'LendingPad', 'Zapier'
    external_loan_id VARCHAR(255),     -- ID from source system for deduplication
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_funded_date (funded_date),
    INDEX idx_lo (assigned_lo_id),
    INDEX idx_processor (assigned_processor_id),
    INDEX idx_external (external_loan_id),
    
    -- Foreign keys
    FOREIGN KEY (assigned_lo_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_processor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 2. PROCESSOR -> LO ASSIGNMENTS
-- One processor can have multiple LOs
-- One LO has one processor
-- ========================================
CREATE TABLE IF NOT EXISTS processor_lo_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    processor_user_id INT NOT NULL,
    lo_user_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INT,                   -- Admin/Manager who made the assignment
    
    -- Prevent duplicate assignments
    UNIQUE KEY unique_assignment (processor_user_id, lo_user_id),
    
    -- Indexes
    INDEX idx_processor (processor_user_id),
    INDEX idx_lo (lo_user_id),
    
    -- Foreign keys
    FOREIGN KEY (processor_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lo_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 3. DROP OLD GOALS TABLE (if exists)
-- We're replacing with new structure
-- ========================================
DROP TABLE IF EXISTS goals;

-- ========================================
-- 4. NEW GOALS TABLE
-- Supports calculated (units, total_amount) and activity goals
-- ========================================
CREATE TABLE goals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Goal category
    -- 'units' = count of funded loans (calculated)
    -- 'total_amount' = sum of funded loan amounts (calculated)
    -- 'activities' = user-managed goal
    category ENUM('units', 'total_amount', 'activities') NOT NULL,
    
    -- For calculated goals (units, total_amount)
    period_type ENUM('monthly', 'ytd') NULL,
    period_value VARCHAR(20) NULL,      -- e.g., '2025-01' for monthly, '2025' for YTD
    
    -- For activity goals
    title VARCHAR(500) NULL,            -- e.g., "Make 50 prospecting calls"
    due_date DATE NULL,
    notes TEXT NULL,
    
    -- Target and progress
    target_value DECIMAL(15,2) NOT NULL,
    current_value DECIMAL(15,2) DEFAULT 0,  -- For activities: user updates. For calculated: computed on read.
    
    -- Who set this goal
    created_by INT,                     -- Admin/Manager who set it (or self)
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_user (user_id),
    INDEX idx_category (category),
    INDEX idx_period (period_type, period_value),
    INDEX idx_due_date (due_date),
    
    -- Prevent duplicate calculated goals per user/period
    UNIQUE KEY unique_calculated_goal (user_id, category, period_type, period_value),
    
    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========================================
-- 5. ADD COGNITO GROUP TO USERS TABLE
-- Using procedure to check if column exists first
-- ========================================
SET @column_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'msfg_mortgage_db' 
    AND TABLE_NAME = 'users' 
    AND COLUMN_NAME = 'cognito_group'
);

SET @sql = IF(@column_exists = 0, 
    'ALTER TABLE users ADD COLUMN cognito_group VARCHAR(50) DEFAULT NULL',
    'SELECT "Column cognito_group already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ========================================
-- 6. ADD EXTERNAL_LOAN_ID TO PIPELINE
-- ========================================
SET @column_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'msfg_mortgage_db' 
    AND TABLE_NAME = 'pipeline' 
    AND COLUMN_NAME = 'external_loan_id'
);

SET @sql = IF(@column_exists = 0, 
    'ALTER TABLE pipeline ADD COLUMN external_loan_id VARCHAR(255) NULL',
    'SELECT "Column external_loan_id already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ========================================
-- 7. ADD SOURCE_SYSTEM TO PIPELINE
-- ========================================
SET @column_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'msfg_mortgage_db' 
    AND TABLE_NAME = 'pipeline' 
    AND COLUMN_NAME = 'source_system'
);

SET @sql = IF(@column_exists = 0, 
    'ALTER TABLE pipeline ADD COLUMN source_system VARCHAR(100) NULL',
    'SELECT "Column source_system already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ========================================
-- VERIFICATION
-- ========================================
SELECT 'Migration complete. Verify tables:' AS status;
SHOW TABLES LIKE 'funded_loans';
SHOW TABLES LIKE 'processor_lo_assignments';
SHOW TABLES LIKE 'goals';
