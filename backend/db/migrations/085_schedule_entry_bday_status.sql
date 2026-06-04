ALTER TABLE schedule_entries
  MODIFY COLUMN status ENUM('out','remote','traveling','meeting_event','busy','bday','other') NOT NULL;
