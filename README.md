# DudeBank - Payment Processing System

Sistema de intermediação de pagamentos desenvolvido para a **Rinha de Backend 2025** usando Bun, TypeScript e arquitetura de microserviços.

## 🏗️ Arquitetura

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Nginx     │───▶│   API 1     │───▶│ PostgreSQL  │
│Load Balancer│    │   API 2     │    │  Database   │
└─────────────┘    └─────────────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │    Redis    │
                   │    Cache    │
                   └─────────────┘
```

## 📋 Endpoints

### Pagamentos
- `POST /payments` - Processar pagamento
- `GET /payments-summary` - Resumo de pagamentos

### Administração
- `DELETE /admin/purge` - Limpar banco e cache

## 🎯 Estratégia

### Failover Inteligente
- **Processador Ótimo**: Prioriza o processador `default` (menor taxa) mas monitora continuamente o `fallback`
- **Health Check Distribuído**: Apenas uma instância de API executa health checks para evitar Rate Limiting (HTTP 429)
- **Decisão Dinâmica**: Troca para `fallback` apenas quando há vantagem significativa de velocidade (>11.76% mais rápido)
- **Retry com Fallback**: Se o processador primário falha, tenta o alternativo automaticamente
- **Race Condition**: Em caso de falha total, executa requisições paralelas para ambos os processadores

### Otimizações de Performance
- **Processamento em Lote**: Processa pagamentos em batches de 100 itens a cada 5ms
- **Cache Redis**: Armazena contadores em tempo real para evitar consultas ao banco
- **Connection Pooling**: Pool de conexões PostgreSQL otimizado (2-20 conexões)
- **Timeouts Agressivos**: Requisições com timeout de 1s para evitar latência alta

### Alocação de Recursos
- **APIs**: 2 instâncias com 0.6 CPU e 120MB RAM cada
- **Nginx**: 0.05 CPU e 15MB RAM (load balancer)
- **PostgreSQL**: 0.05 CPU e 70MB RAM
- **Redis**: 0.05 CPU e 50MB RAM com LRU eviction
- **Total**: 1.35 CPU e 325MB RAM (dentro do limite de 1.5 CPU e 350MB)

## 🛠️ Como Executar

### Pré-requisitos
- Bun >= 1.0
- Docker & Docker Compose

### Desenvolvimento
```bash
# Instalar dependências
bun install

# Executar aplicação com Docker
bun run docker:start:clean
```