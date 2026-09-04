#!/bin/bash
# scripts/docker-start.sh
# Starts the development environment

set -e

# Change to the root of the project
cd "$(dirname "$0")/.."

echo "🚀 Starting Government Tender Verification & e-Signing System"

# 1. Check for .env file
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "⚠️ .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "✅ Created .env file. Please update it with real values if needed."
  else
    echo "❌ Error: Neither .env nor .env.example found."
    exit 1
  fi
fi

# 2. Check for keys directory and OIDC keys
if [ ! -d "keys" ] || [ ! -f "keys/private_key.pem" ]; then
  echo "⚠️ OIDC keys not found. Generating new keys..."
  mkdir -p keys
  if [ -f "backend/scripts/generate-keys.js" ]; then
    node backend/scripts/generate-keys.js
  else
    echo "❌ Error: generate-keys.js not found in backend/scripts/."
    exit 1
  fi
fi

# 3. Start docker-compose
echo "🐳 Starting Docker containers..."
# Use --profile tools to include pgadmin
docker-compose --profile tools up -d --build

echo ""
echo "✅ Environment started successfully!"
echo "--------------------------------------------------------"
echo "🌐 Frontend:   http://localhost:3000"
echo "🔌 Backend:    http://localhost:3001/health"
echo "🐘 pgAdmin:    http://localhost:5050 (admin@tenderportal.gov / admin)"
echo "--------------------------------------------------------"
echo "To view logs, run: ./scripts/docker-logs.sh"
echo "To stop, run: ./scripts/docker-stop.sh"
