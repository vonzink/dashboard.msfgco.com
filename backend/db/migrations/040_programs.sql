-- Programs feature: links + notes per category
CREATE TABLE IF NOT EXISTS program_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category ENUM('conventional','fha','va','usda','non-qm','other') NOT NULL,
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

CREATE TABLE IF NOT EXISTS program_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category ENUM('conventional','fha','va','usda','non-qm','other') NOT NULL,
    content TEXT NOT NULL,
    created_by INT,
    user_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_category (category),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed existing static links
INSERT IGNORE INTO program_links (category, url, label, description, sort_order) VALUES
('conventional', 'https://selling-guide.fanniemae.com/sel/b/origination-through-closing', 'Fannie Mae Selling Guide', 'Origination through closing guidelines', 1),
('conventional', 'https://yourhome.fanniemae.com/calculators-tools/loan-lookup', 'Fannie Mae Loan Lookup', 'Look up existing Fannie Mae loans', 2),
('conventional', 'https://ami-lookup-tool.fanniemae.com/', 'AMI Lookup Tool', 'Area Median Income lookup', 3),
('conventional', 'https://guide.freddiemac.com/', 'Freddie Mac Guide', 'Freddie Mac seller/servicer guide', 4),
('conventional', 'https://sf.freddiemac.com/working-with-us/affordable-lending/home-possible-eligibility-map', 'Home Possible Eligibility Map', 'Freddie Mac affordable lending eligibility', 5),
('va', 'https://www.benefits.va.gov/homeloans/index.asp', 'VA Home Loans', 'VA home loan benefits overview', 1),
('va', 'https://www.va.gov/vapubs/search_action.cfm?dType=2', 'VA Publications', 'VA publications and circulars', 2),
('va', 'https://lgy.va.gov/lgyhub/', 'LGY Hub', 'Loan Guaranty hub portal', 3),
('va', 'https://yourit.va.gov/csm?id=rlc_test_test&sysparam_card=lender_appraisal', 'VA Appraisal Portal', 'Submit and track VA appraisals', 4),
('usda', 'https://eligibility.sc.egov.usda.gov/eligibility/welcomeAction.do', 'USDA Eligibility Map', 'Property and income eligibility lookup', 1);
