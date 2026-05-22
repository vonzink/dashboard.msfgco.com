-- Add vantage credit toggle to investors
ALTER TABLE investors
  ADD COLUMN vantage_credit TINYINT(1) NOT NULL DEFAULT 0 AFTER heloc_second;
