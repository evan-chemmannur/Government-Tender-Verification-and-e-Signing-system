import { pool } from '../config/database.js';

export const models = {
    async query(text, params) {
        return pool.query(text, params);
    },
    
    async getOfficialById(id) {
        const res = await pool.query('SELECT * FROM officials WHERE id = $1', [id]);
        return res.rows[0];
    },

    async getTenderById(id) {
        const res = await pool.query('SELECT * FROM tenders WHERE tender_id = $1', [id]);
        return res.rows[0];
    }
};

export default models;
