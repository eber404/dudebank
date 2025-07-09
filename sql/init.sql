CREATE TABLE IF NOT EXISTS payments (
    correlation_id VARCHAR(36) PRIMARY KEY,
    amount DECIMAL(15,2) NOT NULL,
    processor VARCHAR(20) NOT NULL DEFAULT 'pending',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count SMALLINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payments_status_processor 
ON payments(status, processor, created_at) 
WHERE status = 'processed';

CREATE INDEX IF NOT EXISTS idx_payments_correlation_id ON payments(correlation_id);

CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

SELECT 'Database initialized successfully' AS status;
