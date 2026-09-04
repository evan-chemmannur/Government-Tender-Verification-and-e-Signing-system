-- View 1: tender_summary_view
-- Joins tenders with official names and VC status
CREATE OR REPLACE VIEW tender_summary_view AS
SELECT
    t.id, 
    t.tender_id, 
    t.title, 
    t.department, 
    t.category,
    t.estimated_value, 
    t.actual_value, 
    t.currency, 
    t.status,
    t.submission_deadline,
    creator.name AS created_by_name,
    reviewer.name AS reviewed_by_name,
    approver.name AS approved_by_name,
    t.awarded_to_name, 
    t.awarded_to_gstin,
    vc.credential_id AS vc_credential_id,
    vc.issued_at AS vc_issued_at,
    vc.revoked_at AS vc_revoked_at,
    CASE 
        WHEN vc.id IS NOT NULL AND vc.revoked_at IS NULL THEN 'ACTIVE' 
        WHEN vc.revoked_at IS NOT NULL THEN 'REVOKED' 
        ELSE 'NONE' 
    END AS vc_status,
    t.created_at, 
    t.updated_at
FROM tenders t
LEFT JOIN officials creator ON t.created_by = creator.id
LEFT JOIN officials reviewer ON t.reviewed_by = reviewer.id
LEFT JOIN officials approver ON t.approved_by = approver.id
LEFT JOIN vc_records vc ON t.id = vc.tender_id;

COMMENT ON VIEW tender_summary_view IS 'Provides a comprehensive summary of tenders, including associated official names and Verifiable Credential status.';

-- View 2: recent_audit_view
-- Last 1000 audit entries with official names
CREATE OR REPLACE VIEW recent_audit_view AS
SELECT
    a.id, 
    a.action, 
    a.timestamp,
    o.name AS official_name, 
    o.designation,
    a.tender_id,
    t.tender_id AS tender_ref_id, 
    t.title AS tender_title,
    a.ip_address, 
    a.old_value, 
    a.new_value
FROM audit_log a
LEFT JOIN officials o ON a.official_id = o.id
LEFT JOIN tenders t ON a.tender_id = t.id
ORDER BY a.timestamp DESC
LIMIT 1000;

COMMENT ON VIEW recent_audit_view IS 'Shows the 1000 most recent audit log entries, enriching them with official names and tender reference IDs.';

-- View 3: pending_tenders_view
-- Tenders in APPROVED_PENDING_SIGN status
CREATE OR REPLACE VIEW pending_tenders_view AS
SELECT
    t.id, 
    t.tender_id, 
    t.title, 
    t.department, 
    t.estimated_value,
    t.status, 
    t.submission_deadline,
    approver.name AS approved_by_name,
    t.updated_at
FROM tenders t
LEFT JOIN officials approver ON t.approved_by = approver.id
WHERE t.status = 'APPROVED_PENDING_SIGN'
ORDER BY t.updated_at ASC;

COMMENT ON VIEW pending_tenders_view IS 'Lists tenders that have been approved and are awaiting cryptographic signature (VC issuance), ordered by the oldest updates first.';
