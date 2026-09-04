-- Migration 009: Probabilistic cleanup for nonces to prevent lock contention

CREATE OR REPLACE FUNCTION prune_old_nonces() RETURNS TRIGGER AS $$
BEGIN
    -- Execute cleanup probabilistically (~5% of inserts) to prevent 
    -- lock contention under high concurrent authentication load.
    IF random() < 0.05 THEN
        DELETE FROM nonces WHERE created_at < NOW() - INTERVAL '30 minutes';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
