-- ============================================================
-- Migration 028: Expand goals.period_type from ENUM to VARCHAR
-- Date: 2026-03-12
-- Reason: Frontend sends 'weekly' and 'all' period types that
--   the original ENUM('monthly','quarterly','yearly') rejects.
--   VARCHAR(20) accommodates all values; Zod validates server-side.
-- ============================================================

ALTER TABLE goals
  MODIFY COLUMN period_type VARCHAR(20) NOT NULL;
