-- ============================================================================
-- Migration 001: PostgreSQL Extensions
-- Government Tender Verification & e-Signing System
-- ============================================================================
-- This migration installs the PostgreSQL extensions required by all
-- subsequent migrations and application code.
--
-- uuid-ossp  : Provides uuid_generate_v4() used for all primary keys.
-- pgcrypto   : Provides gen_random_bytes(), crypt(), pgp_sym_encrypt() etc.
--              Used for encrypting sensitive Aadhaar-related data at rest.
-- btree_gin  : Allows B-tree operator classes inside GIN indices so that
--              JSONB columns and ordinary scalar columns can share a single
--              composite GIN index for efficient combined queries.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
