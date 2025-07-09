-- Arquivo de seed para ambiente de desenvolvimento
-- Este script adiciona dados de teste ao banco

-- Inserir dados de teste (apenas para desenvolvimento)
INSERT INTO users (name, email) VALUES 
    ('João Silva', 'joao@example.com'),
    ('Maria Santos', 'maria@example.com'),
    ('Pedro Costa', 'pedro@example.com')
ON CONFLICT (email) DO NOTHING;

-- Log da execução
SELECT 'Test data seeded successfully' AS status;
