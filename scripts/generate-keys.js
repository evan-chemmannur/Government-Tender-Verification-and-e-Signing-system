import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEYS_DIR = path.join(process.cwd(), 'keys');

// Ensure keys directory exists
if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
}

async function generateKeys() {
    console.log('Generating RSA-2048 key pair for OIDC private_key_jwt...');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    const privateKeyPath = path.join(KEYS_DIR, 'oidc-private.pem');
    const publicKeyPath = path.join(KEYS_DIR, 'oidc-public.pem');

    fs.writeFileSync(privateKeyPath, privateKey);
    fs.writeFileSync(publicKeyPath, publicKey);

    const kid = crypto.randomUUID();

    console.log('\n✅ Keys generated successfully!');
    console.log(`Private Key saved to: ${privateKeyPath} (DO NOT SHARE)`);
    console.log(`Public Key saved to: ${publicKeyPath}`);
    console.log(`\nYour generated KID (Key ID) is: ${kid}`);
    console.log('\nProvide this public key and KID to the PMS (Partner Management System) for registration.');
}

generateKeys().catch(console.error);
