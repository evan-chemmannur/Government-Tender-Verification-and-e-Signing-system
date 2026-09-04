-- ============================================================================
-- Migration 011: Wallet Links
-- Government Tender Verification & e-Signing System
-- ============================================================================
-- Separates short URLs from the credential_offers table.

CREATE TABLE IF NOT EXISTS credential_offer_links (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id    UUID            REFERENCES credential_offers(id) ON DELETE CASCADE,
    short_code  VARCHAR(50)     UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE credential_offer_links IS
    'Stores short codes for OID4VCI credential offers, allowing email-friendly '
    'links to resolve to the full credential offer JSON.';

CREATE INDEX IF NOT EXISTS idx_credential_offer_links_short_code
    ON credential_offer_links (short_code);
