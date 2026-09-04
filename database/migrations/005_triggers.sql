-- ============================================================================
-- Migration 005: Triggers
-- ============================================================================
-- Project : Government Tender Verification and e-Signing System
-- Created : 2026-06-17
-- Purpose : Attaches trigger functions from 004_functions.sql to the
--           relevant tables:
--           • Auto-update `updated_at` on officials and tenders.
--           • Enforce append-only policy on audit_log.
-- Depends : 004_functions.sql (update_updated_at_column,
--           prevent_audit_modifications)
-- ============================================================================

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 1. updated_at auto-stamping — officials
--    Fires BEFORE UPDATE so that every modification to an officials row
--    automatically refreshes its updated_at timestamp.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
DROP TRIGGER IF EXISTS trg_officials_updated_at ON officials;

CREATE TRIGGER trg_officials_updated_at
    BEFORE UPDATE ON officials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER trg_officials_updated_at ON officials IS
    'Automatically sets updated_at = NOW() whenever an officials row is '
    'updated.  Uses the generic update_updated_at_column() trigger function.';


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 2. updated_at auto-stamping — tenders
--    Same behaviour as above, applied to the tenders table.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
DROP TRIGGER IF EXISTS trg_tenders_updated_at ON tenders;

CREATE TRIGGER trg_tenders_updated_at
    BEFORE UPDATE ON tenders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER trg_tenders_updated_at ON tenders IS
    'Automatically sets updated_at = NOW() whenever a tenders row is '
    'updated.  Uses the generic update_updated_at_column() trigger function.';


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 3. Append-only guard — audit_log
--    Prevents any UPDATE or DELETE from succeeding on the audit_log table.
--    The trigger function raises an exception unconditionally, so the
--    offending statement is always rolled back.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
DROP TRIGGER IF EXISTS trg_audit_log_no_modifications ON audit_log;

CREATE TRIGGER trg_audit_log_no_modifications
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modifications();

COMMENT ON TRIGGER trg_audit_log_no_modifications ON audit_log IS
    'Enforces the append-only invariant on audit_log.  Any attempt to '
    'UPDATE or DELETE an existing row will raise an exception and abort '
    'the transaction.';
