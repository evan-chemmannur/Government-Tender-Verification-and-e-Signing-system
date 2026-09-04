# Government Tender Verification & e-Signing

A highly secure, court-admissible portal for government officials to review, approve, and cryptographically sign tender documents, integrated with the MOSIP ecosystem.

## Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Access to MOSIP sandbox or production environment

## Quick Start
```bash
# 1. Start infrastructure (DB, Redis)
docker-compose up -d db redis pgadmin

# 2. Copy environment files and configure
cp .env.example .env

# 3. Generate keys for backend
node scripts/generate-keys.js

# 4. Install backend and start
cd backend && npm install
npm run migrate
npm run dev

# 5. Install frontend and start (in a new terminal)
cd frontend && npm install
npm run dev
```

## Environment Setup
Make sure to fill out the `.env` file with proper values corresponding to your MOSIP environment.

## Testing
To run tests:
```bash
cd backend
npm test
```
