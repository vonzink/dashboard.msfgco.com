ALTER TABLE user_profiles
  ADD COLUMN computer_id VARCHAR(100) DEFAULT NULL AFTER bond_expiration;
