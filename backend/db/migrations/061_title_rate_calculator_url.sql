-- Add rate calculator URL to title_companies
ALTER TABLE title_companies
  ADD COLUMN rate_calculator_url VARCHAR(500) AFTER website;
