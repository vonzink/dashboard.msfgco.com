CREATE TABLE IF NOT EXISTS processing_records (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  type          VARCHAR(50)  NOT NULL,
  borrower      VARCHAR(255) NOT NULL,
  loan_number   VARCHAR(100),
  address       VARCHAR(500),
  vendor        VARCHAR(255),
  status        VARCHAR(50)  NOT NULL DEFAULT 'ordered',
  ordered_date  DATE,
  reference     VARCHAR(255),
  notes         TEXT,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_proc_user_type (user_id, type),
  INDEX idx_proc_type_status (type, status),
  INDEX idx_proc_borrower (borrower),
  INDEX idx_proc_loan_number (loan_number)
);
