-- Migration 060: PMI (Private Mortgage Insurance) companies directory
CREATE TABLE IF NOT EXISTS pmi_companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  primary_quote_link TEXT DEFAULT NULL,
  backup_rate_link TEXT DEFAULT NULL,
  login_required VARCHAR(50) DEFAULT NULL,
  client_friendly VARCHAR(50) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pmi_company_name (company_name)
);

-- Seed initial PMI providers (idempotent via ON DUPLICATE KEY UPDATE on company_name)
INSERT INTO pmi_companies (company_name, primary_quote_link, backup_rate_link, login_required, client_friendly, notes, sort_order) VALUES
('Arch MI',      'https://ratestar.archmi.com/',               'https://mortgage.archgroup.com/us/rate-sheets/',                             'Likely', 'Maybe', 'RateStar portal plus published rate sheets', 1),
('Enact MI',     'https://enactmi.com/rate-express/',          'https://enactmi.com/Rate360',                                                'Likely', 'Maybe', 'Rate360 risk-based pricing and Rate Express access', 2),
('Essent',       'https://ratefinder.essent.us/',              'https://www.essent.us/mortgage-insurance/rates',                             'Likely', 'Maybe', 'EssentEDGE Rate Finder', 3),
('MGIC',         'https://www.mgic.com/rates/mortgage-insurance-rates-miq', NULL,                                                             'Likely', 'Maybe', 'MiQ rate quote platform', 4),
('National MI',  'https://rate-gps.nationalmi.com/',           'https://www.nationalmi.com/products-rates',                                  'Likely', 'Maybe', 'Rate GPS quote portal', 5),
('Radian',       'https://www.radian.com/mortgage-insurance/mi-rate-finder', 'https://www.radian.com/what-we-do/mortgage-insurance/mi-rates-and-guidelines', 'Likely', 'Maybe', 'MI Rate Finder powered by RADAR Rates', 6)
ON DUPLICATE KEY UPDATE
  primary_quote_link = VALUES(primary_quote_link),
  backup_rate_link   = VALUES(backup_rate_link),
  login_required     = VALUES(login_required),
  client_friendly    = VALUES(client_friendly),
  notes              = VALUES(notes),
  sort_order         = VALUES(sort_order);
