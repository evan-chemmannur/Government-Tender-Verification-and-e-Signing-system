import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from ../.env (relative to backend dir, or root .env)
dotenv.config({ path: path.join(process.cwd(), '../.env') });
// Fallback to local .env if root doesn't exist
dotenv.config();

const requiredEnvVars = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'FRONTEND_URL',
];

export function validateEnv() {
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// Validate immediately upon import
validateEnv();
