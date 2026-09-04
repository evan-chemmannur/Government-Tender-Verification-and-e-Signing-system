-- ============================================================================
-- Migration 002: ENUM Types
-- Government Tender Verification & e-Signing System
-- ============================================================================
-- Defines all custom ENUM types used by the core tables.
-- PostgreSQL ENUMs are stored as compact integers on disk but enforce strict
-- domain validation at the database level, preventing invalid state values
-- regardless of which client inserts data.
-- ============================================================================

-- tender_status: Tracks the lifecycle of a government tender from initial
-- draft through review, signing, award, and possible revocation or expiry.
CREATE TYPE tender_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED_PENDING_SIGN',
    'SIGNED',
    'AWARDED',
    'SUSPENDED',
    'REVOKED',
    'EXPIRED'
);

-- official_role: Role-based access control levels for government officials.
-- Follows the principle of least privilege — most users are OFFICERs.
CREATE TYPE official_role AS ENUM (
    'VIEWER',
    'OFFICER',
    'SENIOR_OFFICER',
    'ADMIN',
    'SUPER_ADMIN'
);

-- loa_level: Level of Assurance achieved during eSignet / MOSIP authentication.
-- Maps to the acr claim in the OIDC id_token.
-- LOA_2_OTP          – Knowledge factor (OTP to registered mobile)
-- LOA_2_DEMOGRAPHIC  – Demographic match (name + DOB + gender)
-- LOA_3_BIOMETRIC    – Biometric match (fingerprint / iris via SBI device)
CREATE TYPE loa_level AS ENUM (
    'LOA_2_OTP',
    'LOA_2_DEMOGRAPHIC',
    'LOA_3_BIOMETRIC'
);

-- revoke_reason: Enumerated reasons for revoking an issued Verifiable
-- Credential. Ensures every revocation carries a classifiable justification
-- for the audit trail.
CREATE TYPE revoke_reason AS ENUM (
    'COURT_ORDER',
    'ADMINISTRATIVE_ERROR',
    'FRAUD_DETECTED',
    'POLICY_CHANGE',
    'APPEAL_UPHELD',
    'OTHER'
);

-- document_type: Classification of documents attached to a tender.
-- Controls UI presentation and validation rules per type.
CREATE TYPE document_type AS ENUM (
    'TENDER_SPECIFICATION',
    'BID_EVALUATION',
    'AWARD_LETTER',
    'SUPPLEMENTARY'
);

-- notification_status: Delivery lifecycle of an outbound notification
-- (email or SMS). Supports retry logic by distinguishing transient
-- failures (FAILED → retry) from permanent ones (BOUNCED → stop).
CREATE TYPE notification_status AS ENUM (
    'PENDING',
    'SENT',
    'FAILED',
    'BOUNCED'
);
