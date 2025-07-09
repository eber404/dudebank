#!/bin/bash

echo "🧹 Limpando containers e volumes..."

# Parar todos os containers
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down

# Remover volumes do PostgreSQL para garantir inicialização limpa
docker volume rm dudebank_postgres_data 2>/dev/null || true

# Remover containers órfãos
docker container prune -f

echo "✅ Limpeza concluída!"
echo "💡 Execute 'docker-compose -f docker-compose.yml -f docker-compose.dev.yml up' para reiniciar"
