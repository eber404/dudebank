#!/bin/bash
set -e

echo "🚀 Starting a clean development environment..."

docker compose -f docker-compose.yml down --remove-orphans
docker compose -f docker-compose.yml build --no-cache
docker compose -f docker-compose.yml up --remove-orphans -d

echo "✅ Development environment started!"
echo "📱 API: http://localhost:9999"
echo "🗄️  Database: localhost:5432"
echo "⚡ Redis: localhost:6379"

# docker compose logs -f