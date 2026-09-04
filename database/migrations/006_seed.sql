-- ---------------------------------------------------------------------------
-- 006_seed.sql — Development / test seed data
-- ---------------------------------------------------------------------------
-- Inserts 3 test government officials and 5 sample tenders so developers can
-- exercise the full workflow without creating data manually.
--
-- Safe to re-run: all INSERTs use ON CONFLICT … DO NOTHING.
-- ---------------------------------------------------------------------------

BEGIN;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TEST OFFICIALS                                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

INSERT INTO officials (aadhaar_sub, name, designation, department, email, phone, role, loa_level)
VALUES
  (
    'test-aadhaar-sub-officer-001',
    'Rajesh Kumar (Test Officer)',
    'Executive Engineer',
    'Public Works Department',
    'rajesh.test@example.com',
    '+919876543210',
    'OFFICER',
    'LOA_3_BIOMETRIC'
  ),
  (
    'test-aadhaar-sub-senior-001',
    'Priya Sharma (Test Senior)',
    'Superintending Engineer',
    'Public Works Department',
    'priya.test@example.com',
    '+919876543211',
    'SENIOR_OFFICER',
    'LOA_3_BIOMETRIC'
  ),
  (
    'test-aadhaar-sub-admin-001',
    'Amit Patel (Test Admin)',
    'Chief Engineer',
    'Public Works Department',
    'amit.test@example.com',
    '+919876543212',
    'ADMIN',
    'LOA_3_BIOMETRIC'
  )
ON CONFLICT (aadhaar_sub) DO NOTHING;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  SAMPLE TENDERS                                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

WITH officer1 AS (SELECT id FROM officials WHERE aadhaar_sub = 'test-aadhaar-sub-officer-001'),
     officer2 AS (SELECT id FROM officials WHERE aadhaar_sub = 'test-aadhaar-sub-senior-001'),
     officer3 AS (SELECT id FROM officials WHERE aadhaar_sub = 'test-aadhaar-sub-admin-001')
INSERT INTO tenders (tender_id, title, department, category, estimated_value, actual_value, status, created_by, reviewed_by, approved_by, awarded_to_name, awarded_to_gstin, awarded_to_email)
VALUES
  (
    'TENDER-2026-PWD-00001',
    'Construction of District Hospital Wing B',
    'Public Works Department',
    'WORKS',
    5000000000,
    NULL,
    'DRAFT',
    (SELECT id FROM officer1),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  ),
  (
    'TENDER-2026-PWD-00002',
    'Supply of Office Equipment for Block Offices',
    'Public Works Department',
    'GOODS',
    1500000000,
    NULL,
    'UNDER_REVIEW',
    (SELECT id FROM officer1),
    (SELECT id FROM officer2),
    NULL,
    NULL,
    NULL,
    NULL
  ),
  (
    'TENDER-2026-PWD-00003',
    'Annual Road Maintenance Contract NH-48',
    'Public Works Department',
    'WORKS',
    25000000000,
    NULL,
    'APPROVED_PENDING_SIGN',
    (SELECT id FROM officer1),
    (SELECT id FROM officer2),
    (SELECT id FROM officer3),
    NULL,
    NULL,
    NULL
  ),
  (
    'TENDER-2026-PWD-00004',
    'IT Consultancy for e-Governance Portal',
    'Public Works Department',
    'SERVICES',
    800000000,
    750000000,
    'AWARDED',
    (SELECT id FROM officer1),
    (SELECT id FROM officer2),
    (SELECT id FROM officer3),
    'TechServ Solutions Pvt Ltd',
    '27AABCT1234F1ZH',
    'contracts@techserv.example.com'
  ),
  (
    'TENDER-2026-PWD-00005',
    'Bridge Repair on State Highway SH-12',
    'Public Works Department',
    'WORKS',
    3000000000,
    NULL,
    'REVOKED',
    (SELECT id FROM officer1),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
ON CONFLICT (tender_id) DO NOTHING;

COMMIT;
