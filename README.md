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