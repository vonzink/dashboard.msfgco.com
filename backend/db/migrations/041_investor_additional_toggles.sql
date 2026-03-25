-- Migration 041: Add additional investor product/service toggles
-- Adds USDA, Land Loans, VA Loans, Bridge Loans, DSCR toggle columns

ALTER TABLE investors ADD COLUMN usda TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN land_loans TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN va_loans TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN bridge_loans TINYINT(1) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN dscr TINYINT(1) DEFAULT NULL;
