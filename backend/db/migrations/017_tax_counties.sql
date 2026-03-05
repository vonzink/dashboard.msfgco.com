CREATE TABLE IF NOT EXISTS tax_counties (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  county              VARCHAR(100) NOT NULL,
  state               VARCHAR(2)   NOT NULL,
  assessor_url        VARCHAR(500),
  treasurer_url       VARCHAR(500),
  login_required      TINYINT(1)   NOT NULL DEFAULT 0,
  known_costs_fees    VARCHAR(500),
  online_portal       TINYINT(1)   NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_county_state (county, state),
  INDEX idx_state (state)
);
