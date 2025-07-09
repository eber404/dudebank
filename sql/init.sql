-- Arquivo de inicialização do banco de dados
-- Este script é executado automaticamente quando o container PostgreSQL é criado

-- Exemplo de tabela para demonstração
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices se necessário
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Log da execução
SELECT 'Database initialized successfully' AS status;
