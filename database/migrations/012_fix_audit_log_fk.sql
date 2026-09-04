-- ============================================================================
-- Migration 012: Remove foreign key constraints from audit_log
-- ============================================================================
-- Rationale: An immutable audit log is a historical record. Deleted tenders,
-- officials, and VCs should still have their audit history preserved as-is.
-- Referential integrity on a write-once table is counter-productive and
-- conflicts with the append-only trigger when cascades fire.
-- ============================================================================
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_official_id_fkey;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_tender_id_fkey;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_vc_id_fkey;
