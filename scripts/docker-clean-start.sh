#!/bin/bash
set -e

echo "🚀 Starting Development Environment..."

docker compose -f docker-compose.yml -f docker-compose.dev.yml down --remove-orphans
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --remove-orphans -d

echo "✅ Development environment started!"
echo "📱 API: http://localhost:9999"
echo "🗄️ Database: localhost:5432"
echo "⚡ Redis: localhost:6379"

# docker compose logs -f