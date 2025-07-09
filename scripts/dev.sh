#!/bin/bash
set -e

echo "🚀 Starting Development Environment..."

docker compose -f docker-compose.yml -f docker-compose.dev.yml down

docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

echo "✅ Development environment started!"
echo "📱 API: http://localhost:9999"
echo "🗄️  Database: localhost:5432"
echo "⚡ Redis: localhost:6379"
echo "🔧 Adminer: http://localhost:8080"