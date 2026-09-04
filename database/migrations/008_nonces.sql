-- Migration 008: Nonces table for replay prevention

CREATE TABLE IF NOT EXISTS nonces (
    value VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

-- Optimization: Composite index for lightning-fast verification queries
CREATE INDEX IF NOT EXISTS idx_nonces_value_used_at ON nonces(value, used_at);

-- Trigger function to prune old nonces
CREATE OR REPLACE FUNCTION prune_old_nonces() RETURNS TRIGGER AS $$
BEGIN
    -- Delete nonces older than 30 minutes
    DELETE FROM nonces WHERE created_at < NOW() - INTERVAL '30 minutes';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger runs on INSERT to keep table clean without a Node-level setInterval
DROP TRIGGER IF EXISTS trg_prune_nonces ON nonces;
CREATE TRIGGER trg_prune_nonces
    AFTER INSERT ON nonces
    EXECUTE FUNCTION prune_old_nonces();
