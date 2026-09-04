-- ============================================================================
-- Migration 004: Database Functions
-- ============================================================================
-- Project : Government Tender Verification and e-Signing System
-- Created : 2026-06-17
-- Purpose : Creates reusable PL/pgSQL functions for trigger automation,
--           audit-log integrity enforcement, and StatusList2021 index
--           management.
-- Depends : 001_initial.sql (base tables)
--           002/003 migrations (status_list_credentials table, extended
--           columns on officials / tenders / audit_log)
-- ============================================================================

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 1. update_updated_at_column()
--    Generic trigger function that stamps NEW.updated_at with the current
--    transaction time.  Attach it as a BEFORE UPDATE trigger on any table
--    that carries an `updated_at` column.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Overwrite the updated_at column with the current transaction timestamp.
    -- Using NOW() (equivalent to CURRENT_TIMESTAMP) ensures every row touched
    -- inside the same transaction receives an identical timestamp.
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION update_updated_at_column() IS
    'Trigger function – sets NEW.updated_at to the current transaction '
    'timestamp (NOW()).  Designed to be used as a BEFORE UPDATE trigger on '
    'any table that has an updated_at TIMESTAMPTZ column.';


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 2. prevent_audit_modifications()
--    Trigger function that unconditionally prevents UPDATE and DELETE on the
--    audit_log table, enforcing an append-only policy.  Any attempt to
--    modify or remove an existing audit row raises a hard exception.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
CREATE OR REPLACE FUNCTION prevent_audit_modifications()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- The audit_log table is strictly append-only.  No existing row may be
    -- updated or deleted – ever.  This is a fundamental integrity guarantee
    -- for the system's compliance trail.
    RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are prohibited';
    RETURN NULL;  -- Never reached, but required by PL/pgSQL syntax.
END;
$$;

COMMENT ON FUNCTION prevent_audit_modifications() IS
    'Trigger function – enforces an append-only policy on the audit_log '
    'table.  Raises an exception on any UPDATE or DELETE attempt, '
    'guaranteeing that historical audit entries cannot be tampered with.';


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 3. get_or_create_status_list(p_year INTEGER)
--    Looks up the StatusList2021 credential row for the given calendar year.
--    If no row exists yet, it atomically inserts one with sensible defaults
--    (empty encoded_list, capacity of 100 000 entries, starting index 0).
--    Returns the key columns needed by the caller.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
CREATE OR REPLACE FUNCTION get_or_create_status_list(p_year INTEGER)
RETURNS TABLE (
    id                   INTEGER,
    list_id              VARCHAR,
    next_available_index INTEGER,
    capacity             INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Attempt to fetch the existing row first (cheapest path).
    RETURN QUERY
        SELECT slc.id,
               slc.list_id,
               slc.next_available_index,
               slc.capacity
        FROM   status_list_credentials slc
        WHERE  slc.list_id = 'status-list-' || p_year;

    -- If the above returned a row, FOUND will be TRUE and we are done.
    IF FOUND THEN
        RETURN;  -- Row(s) already returned via RETURN QUERY.
    END IF;

    -- No row exists for this year – insert one with default values.
    -- encoded_list is left empty ('') because the actual bitstring is
    -- generated and maintained by the application layer.
    RETURN QUERY
        INSERT INTO status_list_credentials (
            list_id,
            encoded_list,
            next_available_index,
            capacity
        )
        VALUES (
            'status-list-' || p_year,
            '',          -- Populated later by the app layer.
            0,           -- First available index.
            100000       -- 100 000 credential slots per year.
        )
        RETURNING
            status_list_credentials.id,
            status_list_credentials.list_id,
            status_list_credentials.next_available_index,
            status_list_credentials.capacity;
END;
$$;

COMMENT ON FUNCTION get_or_create_status_list(INTEGER) IS
    'Returns the StatusList2021 credential row for the given calendar year, '
    'creating it on the fly if it does not yet exist.  The new row is '
    'initialised with an empty encoded_list (to be filled by the app '
    'layer), next_available_index = 0, and capacity = 100 000.';


-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- 4. allocate_status_list_index(p_year INTEGER)
--    Atomically allocates the next available index from the status list for
--    the specified year.  Uses get_or_create_status_list() to guarantee the
--    row exists.  Raises an exception when the list reaches capacity.
--
--    IMPORTANT: Callers should invoke this inside a transaction that also
--    inserts the vc_records row so the index is never "wasted" by a crash
--    between allocation and use.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
CREATE OR REPLACE FUNCTION allocate_status_list_index(p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_list_id              INTEGER;   -- PK of the status_list_credentials row.
    v_current_index        INTEGER;   -- The index we are about to hand out.
    v_capacity             INTEGER;   -- Maximum slots in this year's list.
BEGIN
    -- Step 1: Ensure the status-list row exists and fetch its state.
    SELECT goc.id,
           goc.next_available_index,
           goc.capacity
    INTO   v_list_id,
           v_current_index,
           v_capacity
    FROM   get_or_create_status_list(p_year) AS goc;

    -- Step 2: Guard against overflow.
    IF v_current_index >= v_capacity THEN
        RAISE EXCEPTION 'Status list for year % is full', p_year;
    END IF;

    -- Step 3: Atomically increment the counter.
    UPDATE status_list_credentials
    SET    next_available_index = next_available_index + 1
    WHERE  status_list_credentials.id = v_list_id;

    -- Step 4: Return the index we just consumed.
    RETURN v_current_index;
END;
$$;

COMMENT ON FUNCTION allocate_status_list_index(INTEGER) IS
    'Atomically allocates and returns the next free StatusList2021 index '
    'for the given calendar year.  Calls get_or_create_status_list() to '
    'ensure the list row exists, then increments next_available_index.  '
    'Raises an exception if the list has reached its capacity (100 000).';
