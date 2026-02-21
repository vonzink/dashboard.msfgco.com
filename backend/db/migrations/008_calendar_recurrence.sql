-- Add recurrence columns to calendar_events
ALTER TABLE calendar_events ADD COLUMN recurrence_rule VARCHAR(20) DEFAULT 'none' AFTER color;
ALTER TABLE calendar_events ADD COLUMN recurrence_end DATE NULL AFTER recurrence_rule;
ALTER TABLE calendar_events ADD COLUMN recurrence_group_id VARCHAR(36) NULL AFTER recurrence_end;
ALTER TABLE calendar_events ADD INDEX idx_recurrence_group (recurrence_group_id);
