-- Add delivery method and recurrence to notifications
ALTER TABLE notifications ADD COLUMN delivery_method ENUM('email', 'text', 'both') DEFAULT 'email' AFTER note;
ALTER TABLE notifications ADD COLUMN recurrence ENUM('none', 'daily', 'weekly', 'monthly') DEFAULT 'none' AFTER delivery_method;
