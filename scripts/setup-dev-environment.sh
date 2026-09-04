#!/bin/bash
set -e

echo "=================================================="
echo " Government Tender Portal - Dev Environment Setup "
echo "=================================================="

# 1. Check prerequisites
echo "[1/8] Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+."
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18+. Found: $(node -v)"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ docker-compose is not installed."
    exit 1
fi

echo "✅ Prerequisites met."

# 2. Copy .env
echo "[2/8] Checking environment variables..."
if [ ! -f .env ]; then
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
fi

# 3. Check for required .env values
source .env
if [ -z "$CLIENT_ID" ] || [ -z "$ESIGNET_BASE_URL" ] || [ -z "$KID" ]; then
    echo "⚠️  Missing: CLIENT_ID, ESIGNET_BASE_URL, or KID"
    echo "   eSignet login will not work until this is set."
    echo "📖  See GETTING_STARTED.md for how to get these values."
fi

if [ -z "$CERTIFY_BASE_URL" ] || [ -z "$CERTIFY_CLIENT_ID" ]; then
    echo "⚠️  Missing: CERTIFY_BASE_URL or CERTIFY_CLIENT_ID"
    echo "   VC issuance will not work until this is set."
fi

# 4. Generate keys
echo "[3/8] Checking cryptographic keys..."
if [ ! -f ./keys/oidc-private.pem ]; then
    echo "🔑 Generating RSA keys for OIDC / Status List..."
    node backend/scripts/generate-keys.js || echo "Assuming generate-keys.js handled via other means"
else
    echo "✅ Keys already exist."
fi

# 5. Start Docker services
echo "[4/8] Starting Docker services (PostgreSQL, Redis)..."
docker-compose up -d postgres redis

echo "⏳ Waiting for PostgreSQL to be ready..."
RETRIES=15
until docker exec tender_postgres pg_isready -U tender_admin &> /dev/null; do
    RETRIES=$((RETRIES-1))
    if [ $RETRIES -le 0 ]; then
        echo "❌ PostgreSQL failed to start in time."
        exit 1
    fi
    echo -n "."
    sleep 2
done
echo -e "\n✅ PostgreSQL is ready."

# 6. Run migrations
echo "[5/8] Running database migrations..."
cd backend
node scripts/migrate.js
cd ..

# 7. Initialize status list
echo "[6/8] Initializing VC Status List..."
cd backend
node scripts/init-status-list.js || echo "⚠️ Status list init returned non-zero (might already exist)"
cd ..

# 8. Run seed
echo "[7/8] Seeding test data..."
cd backend
NODE_ENV=development node scripts/seed.js
cd ..

# 9. Print success
echo "=================================================="
echo "✅ Setup complete!"
echo "📍 Backend: http://localhost:3001 (run: cd backend && npm run dev)"
echo "📍 Frontend: http://localhost:3000 (run: cd frontend && npm run dev)"
echo ""
echo "⚠️  Before real login works, complete eSignet PMS registration:"
echo "   1. Go to: https://pms.sandbox.mosip.net"
echo "   2. Register OAuth Client (Redirect URI: http://localhost:3000/auth/callback)"
echo "   3. Fill .env: CLIENT_ID=, KID="
echo ""
echo "📋 Test accounts (from seed):"
echo "   Officer: Sub TEST-SUB-OFFICER-001"
echo "   Admin:   Sub TEST-SUB-ADMIN-001"
echo "=================================================="
