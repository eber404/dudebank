# DudeBank - Payment Processing System

Sistema de intermediação de pagamentos desenvolvido para a **Rinha de Backend 2025** usando Bun, TypeScript e arquitetura de microserviços.

## 🏗️ Arquitetura

```
┌─────────────┐    ┌─────────────┐
│   Nginx     │───▶│   API 1     │──┐
│Load Balancer│    │   API 2     │  │
└─────────────┘    └─────────────┘  │
                                    │ POST /payments
                                    ▼
                   ┌─────────────────────────┐
                   │     In-Memory Queue     │
                   │   (Thread-Safe Map)     │
                   └─────────────────────────┘
                                    │ Background Processor
                                    │ (Batches of 100/5ms)
                                    ▼
            ┌─────────────────────────────────────┐
            │         Payment Router              │
            │    (Health Check + Failover)        │
            └─────────────────────────────────────┘
                     │                   │
            ┌────────▼───────┐   ┌───────▼────────┐
            │   Default      │   │   Fallback     │
            │  Processor     │   │  Processor     │
            │ (Preferred)    │   │  (Backup)      │
            └────────────────┘   └────────────────┘
                     │                   │
                     └───────┬───────────┘
                             │ Successful payments
                             ▼
                   ┌─────────────────────────┐
                   │     SQLite MemoryDB     │
                   │   (Batch Persistence)   │
                   └─────────────────────────┘
                             ▲
                             │ GET /payments-summary
                   ┌─────────────────────────┐
                   │      API Response       │
                   └─────────────────────────┘
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

## 🚀 Tecnologias

### Stack Principal

- **Runtime**: Bun (JavaScript runtime)
- **Database**: SQLite (Bun built-in)
- **Validation**: Zod
- **Financial Math**: Decimal.js
- **Load Balancer**: Nginx Alpine

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

# Executar em modo desenvolvimento
bun run dev
```

### Testes de Performance

```bash
# Testar endpoint de pagamentos
curl -X POST -H "Content-Type: application/json" \
  -d '{"correlationId":"550e8400-e29b-41d4-a716-446655440000","amount":100.50}' \
  http://localhost:3000/payments

# Testar resumo de pagamentos
curl http://localhost:3000/payments-summary

# Limpar banco e cache
curl -X DELETE http://localhost:3000/admin/purge
```
