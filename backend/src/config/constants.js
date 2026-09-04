export const PORT = process.env.PORT || 3001;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
export const DATABASE_URL = process.env.DATABASE_URL;
export const SESSION_SECRET = process.env.SESSION_SECRET;
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// eSignet
export const ESIGNET_BASE_URL = process.env.ESIGNET_BASE_URL;
export const ESIGNET_AUTHORIZE_ENDPOINT = process.env.ESIGNET_AUTHORIZE_ENDPOINT || `${ESIGNET_BASE_URL}/authorize`;
export const ESIGNET_TOKEN_ENDPOINT = process.env.ESIGNET_TOKEN_ENDPOINT || `${ESIGNET_BASE_URL}/token`;
export const CLIENT_ID = process.env.CLIENT_ID;
export const REDIRECT_URI = process.env.REDIRECT_URI;
export const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH;
export const KID = process.env.KID;
export const ACR_VALUES = process.env.ACR_VALUES || 'mosip:idp:acr:generated-code';

// Inji Certify
export const INJI_CERTIFY_BASE_URL = process.env.INJI_CERTIFY_BASE_URL;
export const INJI_CLIENT_ID = process.env.INJI_CLIENT_ID;
export const INJI_CLIENT_SECRET = process.env.INJI_CLIENT_SECRET;

// SMTP / Email
export const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gov.in';
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
export const SMTP_USER = process.env.SMTP_USER || '';
export const SMTP_PASS = process.env.SMTP_PASS || '';
export const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@tender.maharashtra.gov.in';
