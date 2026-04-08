-- Dedupe program_links and add unique constraint to prevent re-seeding duplicates
DELETE pl1 FROM program_links pl1
INNER JOIN program_links pl2
WHERE pl1.id > pl2.id
  AND pl1.category = pl2.category
  AND pl1.label = pl2.label
  AND pl1.url = pl2.url;

ALTER TABLE program_links
  ADD UNIQUE KEY uq_program_link (category, label, url(255));
