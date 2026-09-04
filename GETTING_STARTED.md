# How to Run This Project (Step by Step)

## Step 1: Prerequisites
- Node.js 18+
- Docker Desktop
- Git

## Step 2: Clone and Install
npm install in `backend/` and `frontend/`

## Step 3: Configure Environment
Copy `.env.example` to `.env`
Fill in at minimum:
- `SESSION_SECRET=any-long-random-string-here`
- `DB_PASSWORD=tender_password` (matches docker-compose)
- `NODE_ENV=development`

## Step 4: Start Database
```bash
docker-compose up -d postgres redis
```
Wait 10 seconds for postgres to initialize.

## Step 5: Run Migrations
```bash
cd backend && node scripts/migrate.js
```

## Step 6: Seed Test Data
```bash
cd backend && NODE_ENV=development node scripts/seed.js
```

## Step 7: Start Backend
```bash
cd backend && npm run dev
```
Verify: `curl http://localhost:3001/health`

## Step 8: Start Frontend
```bash
cd frontend && npm run dev
```
Open: `http://localhost:3000`

## Step 9: Without eSignet (Mock Login)
The system cannot fully login without eSignet PMS registration.
To test the app WITHOUT eSignet:
Option A: Use the "Developer Login" card on the login page (only visible in `NODE_ENV=development`). It bypasses eSignet and logs you in instantly as a test Officer or Admin.
Option B: Register at https://pms.sandbox.mosip.net (takes ~30 minutes).

The Developer Login calls `POST /auth/dev-login` with:
`{ "aadhaar_sub": "TEST-SUB-ADMIN-001", "role": "ADMIN", "loa_level": "LOA_3_BIOMETRIC" }`

## Step 10: PMS Registration (For Real eSignet Login)
1. Go to https://pms.sandbox.mosip.net
2. Register an OAuth Client
3. Set Redirect URI to `http://localhost:3000/auth/callback`
4. Add `CLIENT_ID` and `KID` to your `.env`

## Step 11: Test Full Flow
```bash
node scripts/full-flow-test.js
```
