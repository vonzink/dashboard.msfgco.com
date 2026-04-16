-- Add doc_type to investor_documents so the msfg-docs document tool can tell
-- which uploaded files are editable AcroForm PDFs (and which workflow to use).
--
-- Values used by msfg-docs:
--   form-4506c       — investor's pre-filled IRS 4506-C
--   form-ssa89       — investor's pre-filled SSA-89
--   template         — generic editable AcroForm PDF (e.g. condo questionnaire)
--   reference        — non-editable / static PDF (rate sheet, guidelines)
--   NULL             — unclassified (legacy rows; treated as reference until set)

ALTER TABLE investor_documents
  ADD COLUMN doc_type VARCHAR(50) NULL AFTER file_type;

CREATE INDEX idx_investor_documents_doc_type ON investor_documents (doc_type);
