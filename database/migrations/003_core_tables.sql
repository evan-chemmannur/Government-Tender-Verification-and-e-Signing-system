-- ============================================================================
-- Migration 003: Core Tables
-- Government Tender Verification & e-Signing System
-- ============================================================================
-- Creates all application tables, constraints, and indices.
-- Every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS so this migration
-- is safe to re-run (idempotent).
--
-- Conventions:
--   • Primary keys  : UUID via uuid_generate_v4()
--   • Timestamps    : TIMESTAMPTZ (stores UTC, renders in session TZ)
--   • Monetary values: BIGINT in paisa (1 INR = 100 paisa) to avoid
--                      floating-point rounding errors
--   • Soft deletes  : Not used — rows are never deleted from audit_log;
--                      other tables use ON DELETE SET NULL / CASCADE as noted.
-- ============================================================================


-- ============================================================================
-- TABLE 1: officials
-- ============================================================================
-- Stores government officials who authenticate via MOSIP eSignet.
-- The aadhaar_sub column holds the `sub` claim from the eSignet id_token,
-- which is a PSUT (Partner-Specific User Token) — NOT the raw Aadhaar number.
-- ============================================================================
CREATE TABLE IF NOT EXISTS officials (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    aadhaar_sub     VARCHAR(500)    UNIQUE NOT NULL,       -- eSignet id_token.sub (PSUT)
    name            VARCHAR(255)    NOT NULL,
    designation     VARCHAR(255),
    department      VARCHAR(255),
    email           VARCHAR(255),
    phone           VARCHAR(20),
    role            official_role   DEFAULT 'OFFICER',
    loa_level       loa_level,
    is_active       BOOLEAN         DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE officials IS
    'Government officials who authenticate via MOSIP eSignet. '
    'aadhaar_sub stores the Partner-Specific User Token (PSUT) from the id_token.sub claim, not the raw Aadhaar number.';

-- aadhaar_sub already has a UNIQUE index from the constraint.
CREATE INDEX IF NOT EXISTS idx_officials_email
    ON officials (email);

CREATE INDEX IF NOT EXISTS idx_officials_department
    ON officials (department);

CREATE INDEX IF NOT EXISTS idx_officials_role
    ON officials (role);


-- ============================================================================
-- TABLE 2: sessions
-- ============================================================================
-- Session store compatible with the connect-pg-simple middleware.
-- Column names (sid, sess, expire) MUST match exactly what the library expects.
-- The library creates this table automatically, but we define it here so the
-- schema is version-controlled and the index is guaranteed to exist.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    sid     VARCHAR(255)    NOT NULL PRIMARY KEY,   -- session ID set by express-session
    sess    JSONB           NOT NULL,               -- serialised session payload
    expire  TIMESTAMPTZ     NOT NULL                -- absolute expiry timestamp
);

COMMENT ON TABLE sessions IS
    'Express session store for connect-pg-simple. '
    'Column names sid/sess/expire are required by the library and must not be renamed.';

-- Used by the periodic cleanup query: DELETE FROM sessions WHERE expire < NOW()
CREATE INDEX IF NOT EXISTS idx_sessions_expire
    ON sessions (expire);


-- ============================================================================
-- TABLE 3: tenders
-- ============================================================================
-- Central table representing a government tender throughout its lifecycle.
-- tender_id is the human-readable government reference number (e.g.
-- TENDER-2026-PWD-00001); id is the internal UUID primary key.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenders (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tender_id           VARCHAR(100)    UNIQUE NOT NULL,    -- govt reference number
    title               VARCHAR(500)    NOT NULL,
    description         TEXT,
    department          VARCHAR(255),
    category            VARCHAR(100),                       -- WORKS, GOODS, SERVICES, CONSULTANCY
    estimated_value     BIGINT          CHECK (estimated_value > 0),   -- paisa
    actual_value        BIGINT          CHECK (actual_value >= 0),     -- paisa, set on award
    currency            VARCHAR(10)     DEFAULT 'INR',
    status              tender_status   DEFAULT 'DRAFT',
    submission_deadline TIMESTAMPTZ,
    created_by          UUID            REFERENCES officials(id) ON DELETE SET NULL,
    reviewed_by         UUID            REFERENCES officials(id) ON DELETE SET NULL,
    approved_by         UUID            REFERENCES officials(id) ON DELETE SET NULL,
    awarded_to_name     VARCHAR(255),
    awarded_to_gstin    VARCHAR(50),
    awarded_to_email    VARCHAR(255),
    awarded_to_phone    VARCHAR(20),
    contract_start_date DATE,
    contract_end_date   DATE,
    created_at          TIMESTAMPTZ     DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     DEFAULT NOW(),

    -- End date must be after start date when both are provided
    CONSTRAINT chk_contract_dates
        CHECK (
            contract_start_date IS NULL
            OR contract_end_date IS NULL
            OR contract_end_date > contract_start_date
        )
);

COMMENT ON TABLE tenders IS
    'Government tenders tracked from DRAFT through AWARDED/REVOKED/EXPIRED. '
    'tender_id is the human-readable reference number; id is the internal UUID. '
    'All monetary values are stored in paisa (1 INR = 100 paisa).';

-- tender_id already has a UNIQUE index from the constraint.
CREATE INDEX IF NOT EXISTS idx_tenders_status
    ON tenders (status);

CREATE INDEX IF NOT EXISTS idx_tenders_department
    ON tenders (department);

CREATE INDEX IF NOT EXISTS idx_tenders_category
    ON tenders (category);

CREATE INDEX IF NOT EXISTS idx_tenders_created_at
    ON tenders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenders_estimated_value
    ON tenders (estimated_value);


-- ============================================================================
-- TABLE 4: vc_records
-- ============================================================================
-- Stores Verifiable Credentials (W3C VC Data Model) issued for tenders.
-- Each tender has at most one VC (enforced by UNIQUE on tender_id).
-- The full VC JSON is kept in vc_json; qr_encoded_payload holds the
-- PixelPass-encoded string for QR code generation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vc_records (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tender_id           UUID            REFERENCES tenders(id) ON DELETE CASCADE UNIQUE,  -- one VC per tender
    credential_id       VARCHAR(500)    UNIQUE NOT NULL,    -- globally unique credential identifier
    issuer_did          VARCHAR(500),
    holder_did          VARCHAR(500),
    status_list_url     VARCHAR(1000),
    status_list_index   INTEGER,
    vc_format           VARCHAR(50)     DEFAULT 'ldp_vc',
    vc_json             JSONB           NOT NULL,           -- full W3C VC as JSON
    qr_encoded_payload  TEXT,                               -- PixelPass encoded data for QR
    pdf_path            VARCHAR(1000),                      -- path to stamped PDF on disk / object store
    issued_at           TIMESTAMPTZ     DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID            REFERENCES officials(id) ON DELETE SET NULL,
    revoke_reason       revoke_reason,
    revoke_notes        TEXT,
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE vc_records IS
    'Verifiable Credentials (W3C VC Data Model) issued for awarded tenders. '
    'One VC per tender. Contains the full VC JSON, revocation metadata, and '
    'references into the W3C BitString Status List for revocation checks.';

-- credential_id and tender_id already have UNIQUE indexes from constraints.
CREATE INDEX IF NOT EXISTS idx_vc_records_status_list_index
    ON vc_records (status_list_index);

CREATE INDEX IF NOT EXISTS idx_vc_records_issued_at
    ON vc_records (issued_at);

CREATE INDEX IF NOT EXISTS idx_vc_records_revoked_at
    ON vc_records (revoked_at);


-- ============================================================================
-- TABLE 5: audit_log
-- ============================================================================
-- APPEND-ONLY audit trail. Application code must NEVER issue UPDATE or DELETE
-- against this table. A database trigger (created in a later migration) will
-- block any UPDATE/DELETE to enforce immutability at the DB level.
--
-- Uses BIGSERIAL (not UUID) for the primary key because:
--   1. Monotonically increasing IDs make range scans on recent events fast.
--   2. 8-byte BIGINT is more compact than 16-byte UUID for a high-volume table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL       PRIMARY KEY,
    official_id     UUID            REFERENCES officials(id) ON DELETE SET NULL,
    action          VARCHAR(200)    NOT NULL,
    tender_id       UUID            REFERENCES tenders(id) ON DELETE SET NULL,
    vc_id           UUID            REFERENCES vc_records(id) ON DELETE SET NULL,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    user_agent      TEXT,
    session_id      VARCHAR(255),
    timestamp       TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE audit_log IS
    'Immutable, append-only audit trail. UPDATE and DELETE operations on this '
    'table are forbidden and will be blocked by a trigger (see later migration). '
    'Every state change to tenders, VCs, and officials is recorded here for '
    'compliance and forensic analysis.';

CREATE INDEX IF NOT EXISTS idx_audit_log_official_id
    ON audit_log (official_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
    ON audit_log (action);

CREATE INDEX IF NOT EXISTS idx_audit_log_tender_id
    ON audit_log (tender_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
    ON audit_log (timestamp DESC);


-- ============================================================================
-- TABLE 6: tender_documents
-- ============================================================================
-- File metadata for documents attached to tenders (specifications, bid
-- evaluation reports, award letters, etc.). Actual file bytes live on disk
-- or in an object store; stored_path points to them.
-- sha256_hash enables integrity verification after download.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tender_documents (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tender_id           UUID            REFERENCES tenders(id) ON DELETE CASCADE,
    document_type       document_type,
    original_filename   VARCHAR(500),
    stored_path         VARCHAR(1000),
    file_size           BIGINT          CHECK (file_size > 0),
    mime_type           VARCHAR(100),
    sha256_hash         VARCHAR(64),            -- hex-encoded SHA-256 digest
    uploaded_by         UUID            REFERENCES officials(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE tender_documents IS
    'Metadata for files attached to tenders. The actual binary content is '
    'stored on disk or in an object store at stored_path. sha256_hash provides '
    'integrity verification.';

CREATE INDEX IF NOT EXISTS idx_tender_documents_tender_id
    ON tender_documents (tender_id);

CREATE INDEX IF NOT EXISTS idx_tender_documents_document_type
    ON tender_documents (document_type);


-- ============================================================================
-- TABLE 7: credential_offers
-- ============================================================================
-- Implements the OID4VCI Pre-Authorized Code flow for delivering Verifiable
-- Credentials to bidders via Inji Wallet. Each offer contains a one-time
-- pre_authorized_code that the wallet exchanges for the credential.
-- ============================================================================
CREATE TABLE IF NOT EXISTS credential_offers (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    vc_id                   UUID            REFERENCES vc_records(id) ON DELETE CASCADE,
    pre_authorized_code     VARCHAR(500)    UNIQUE,         -- one-time code for OID4VCI flow
    expires_at              TIMESTAMPTZ,
    redeemed_at             TIMESTAMPTZ,
    bidder_email            VARCHAR(255),
    created_at              TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE credential_offers IS
    'OID4VCI Pre-Authorized Code offers for delivering VCs to Inji Wallet. '
    'Each row represents a single-use offer; redeemed_at is set when the '
    'wallet successfully exchanges the code for a credential.';

-- pre_authorized_code already has a UNIQUE index from the constraint.
CREATE INDEX IF NOT EXISTS idx_credential_offers_expires_at
    ON credential_offers (expires_at);


-- ============================================================================
-- TABLE 8: status_list_credentials
-- ============================================================================
-- Implements W3C BitString Status List v2021 for credential revocation.
-- Each row represents one status list credential containing a compressed
-- bitstring. When a VC is revoked, the bit at its status_list_index is
-- flipped to 1 in the encoded_list.
-- ============================================================================
CREATE TABLE IF NOT EXISTS status_list_credentials (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_id                 VARCHAR(200)    UNIQUE,         -- public identifier for this list
    year                    INTEGER         NOT NULL,
    encoded_list            TEXT            NOT NULL,       -- GZIP compressed, base64url encoded bitstring
    vc_json                 JSONB,                          -- the status list credential itself as a VC
    next_available_index    INTEGER         DEFAULT 0,
    capacity                INTEGER         DEFAULT 100000,
    updated_at              TIMESTAMPTZ     DEFAULT NOW(),

    -- Ensure next_available_index stays within valid range
    CONSTRAINT chk_status_list_index_range
        CHECK (next_available_index >= 0 AND next_available_index <= capacity)
);

COMMENT ON TABLE status_list_credentials IS
    'W3C BitString Status List credentials for revocation. Each row is a '
    'compressed bitstring with capacity slots. Revoking a VC flips the bit '
    'at its status_list_index to 1.';

-- list_id already has a UNIQUE index from the constraint.
CREATE INDEX IF NOT EXISTS idx_status_list_credentials_year
    ON status_list_credentials (year);


-- ============================================================================
-- TABLE 9: notifications
-- ============================================================================
-- Outbound notifications (email / SMS) triggered by tender lifecycle events
-- such as award issuance or credential revocation. Supports retry logic
-- via retry_count and distinguishes transient failures from permanent bounces.
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id                  UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    tender_id           UUID                REFERENCES tenders(id) ON DELETE SET NULL,
    recipient_email     VARCHAR(255),
    recipient_phone     VARCHAR(20),
    notification_type   VARCHAR(100),                       -- e.g. AWARD_ISSUED, REVOCATION_NOTICE
    subject             VARCHAR(500),
    body                TEXT,
    status              notification_status DEFAULT 'PENDING',
    sent_at             TIMESTAMPTZ,
    error_message       TEXT,
    retry_count         INTEGER             DEFAULT 0 CHECK (retry_count >= 0),
    created_at          TIMESTAMPTZ         DEFAULT NOW()
);

COMMENT ON TABLE notifications IS
    'Outbound email and SMS notifications for tender lifecycle events. '
    'Supports retry logic (retry_count) and distinguishes transient FAILED '
    'deliveries from permanent BOUNCED ones.';

CREATE INDEX IF NOT EXISTS idx_notifications_tender_id
    ON notifications (tender_id);

CREATE INDEX IF NOT EXISTS idx_notifications_status
    ON notifications (status);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications (created_at DESC);
