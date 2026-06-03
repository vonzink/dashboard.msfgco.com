CREATE TABLE IF NOT EXISTS schedule_entry_viewers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  schedule_entry_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_schedule_entry_viewer_user (schedule_entry_id, user_id),
  INDEX idx_schedule_entry_viewers_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
