import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export const nonceStore = {
  /**
   * Stores a nonce in the database.
   * If it already exists, it will throw a unique constraint error.
   */
  async storeNonce(value) {
    try {
      await pool.query('INSERT INTO nonces (value) VALUES ($1)', [value]);
    } catch (error) {
      if (error.code === '23505') { // Unique constraint violation
        throw new Error('Nonce already exists');
      }
      logger.error(`Database error storing nonce: ${error.message}`);
      throw error;
    }
  },

  /**
   * Marks a nonce as used to prevent replay attacks.
   */
  async markUsed(value) {
    try {
      const result = await pool.query(
        'UPDATE nonces SET used_at = NOW() WHERE value = $1 AND used_at IS NULL RETURNING value',
        [value]
      );
      if (result.rowCount === 0) {
        throw new Error('Nonce not found or already used');
      }
    } catch (error) {
      logger.error(`Database error marking nonce used: ${error.message}`);
      throw error;
    }
  },

  /**
   * Checks if a nonce is valid (exists and hasn't been used)
   */
  async isValid(value) {
    try {
      const result = await pool.query(
        'SELECT value FROM nonces WHERE value = $1 AND used_at IS NULL',
        [value]
      );
      return result.rowCount > 0;
    } catch (error) {
      logger.error(`Database error checking nonce validity: ${error.message}`);
      return false; // Fail secure
    }
  }
};
