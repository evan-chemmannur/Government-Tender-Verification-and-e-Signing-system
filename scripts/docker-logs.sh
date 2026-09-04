#!/bin/bash
# scripts/docker-logs.sh
# Follow logs from Docker containers

cd "$(dirname "$0")/.."

if [ -z "$1" ]; then
  echo "📄 Following logs for all services..."
  docker-compose --profile tools logs -f
else
  echo "📄 Following logs for service: $1..."
  docker-compose --profile tools logs -f "$1"
fi
