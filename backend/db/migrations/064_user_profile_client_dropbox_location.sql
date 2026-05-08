ALTER TABLE user_profiles
  ADD COLUMN client_dropbox_location VARCHAR(500) DEFAULT NULL AFTER computer_id;
