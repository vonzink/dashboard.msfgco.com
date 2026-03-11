-- 024: Add is_active toggle to investors table

ALTER TABLE investors
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 0 AFTER remote_closing_review;

-- Set active investors based on current active list
UPDATE investors SET is_active = 1 WHERE name IN (
  'SunWest',
  'AngelAI',
  'A Mortgage Boutique',
  'AD Mortgage',
  'ACC Mortgage',
  'ARC',
  'Carrington Mortgage',
  'EPM',
  'Freedom Mortgage',
  'Giant Lending',
  'Jet Mortgage',
  'Keystone Funding',
  'LoanStream',
  'Mutual of Omaha Mortgage',
  'Newfi Lending',
  'NewRez',
  'Orion',
  'Plaza',
  'Principle Lending',
  'PRMG',
  'Provident',
  'The Loan Store',
  'the Lender',
  'Towne Mortgage Company',
  'UWM',
  'Windsor Mortgage'
);
