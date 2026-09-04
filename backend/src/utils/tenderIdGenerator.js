import { pool } from '../config/database.js';

/**
 * Generates an atomic, formatted Tender ID.
 * @param {string} department - The full department name
 * @param {object} dbClient - Optional pg pool/client (useful for transactions)
 * @returns {Promise<string>} The generated ID (e.g. MH-PWD-2025-0041)
 */
export async function generateTenderId(department, dbClient = pool) {
  const year = new Date().getFullYear();
  
  // Create an abbreviation logic for department. 
  // Examples: PUBLIC_WORKS_DEPARTMENT -> PWD
  let deptAbbr = 'GEN';
  if (department) {
    deptAbbr = department
      .toUpperCase()
      .split(/[\s_]+/)
      .map(word => word[0])
      .join('')
      .substring(0, 4);
  }

  // Atomically get next sequence
  const result = await dbClient.query(
    'SELECT next_tender_sequence($1, $2) as seq',
    [department || 'GENERAL', year]
  );
  
  const sequence = result.rows[0].seq;
  
  // Format: MH-[DEPT]-[YEAR]-[0000]
  const formattedSeq = sequence.toString().padStart(4, '0');
  
  return `MH-${deptAbbr}-${year}-${formattedSeq}`;
}
