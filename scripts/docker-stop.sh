#!/bin/bash
# scripts/docker-stop.sh
# Stops the development environment gracefully

cd "$(dirname "$0")/.."

echo "🛑 Stopping Government Tender Verification & e-Signing System..."

if [ "$1" == "--clean" ]; then
  echo "⚠️  Removing containers AND volumes (database data will be lost!)..."
  docker-compose --profile tools down -v
  echo "✅ Environment stopped and volumes removed."
else
  echo "🐳 Stopping containers..."
  docker-compose --profile tools down
  echo "✅ Environment stopped gracefully."
fi
