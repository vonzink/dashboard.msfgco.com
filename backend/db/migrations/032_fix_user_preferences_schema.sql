-- Fix user_preferences table schema
-- Old table had (user_id UNIQUE, theme, default_goal_period) — single row per user
-- New schema: key-value store with (user_id, preference_key) UNIQUE — multiple rows per user
-- Preserves nothing — old table had only 1 row with default values

DROP TABLE IF EXISTS user_preferences;

CREATE TABLE user_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  preference_key VARCHAR(100) NOT NULL,
  preference_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_pref (user_id, preference_key),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
