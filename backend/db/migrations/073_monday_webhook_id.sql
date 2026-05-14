-- Add webhook_id column to monday_boards for webhook registration tracking
ALTER TABLE monday_boards ADD COLUMN webhook_id VARCHAR(50) DEFAULT NULL;
ALTER TABLE monday_boards ADD COLUMN webhook_url VARCHAR(255) DEFAULT NULL;
