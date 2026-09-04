-- Migration 010: Tender sequence table

CREATE TABLE IF NOT EXISTS tender_sequences (
    department VARCHAR(255) NOT NULL,
    year INTEGER NOT NULL,
    last_value INTEGER DEFAULT 0,
    PRIMARY KEY (department, year)
);

-- Helper function to generate an atomic sequence number for a department and year
CREATE OR REPLACE FUNCTION next_tender_sequence(p_department VARCHAR(255), p_year INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_next_val INTEGER;
BEGIN
    INSERT INTO tender_sequences (department, year, last_value)
    VALUES (p_department, p_year, 1)
    ON CONFLICT (department, year) DO UPDATE 
    SET last_value = tender_sequences.last_value + 1
    RETURNING last_value INTO v_next_val;
    
    RETURN v_next_val;
END;
$$ LANGUAGE plpgsql;
