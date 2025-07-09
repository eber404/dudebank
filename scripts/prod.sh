#!/bin/bash
set -e

echo "🏭 Starting Production Environment..."

# Para o ambiente se estiver rodando
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Rebuild das imagens de produção
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache

# Sobe o ambiente
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo "✅ Production environment started!"
echo "📱 API: http://localhost:9999"
