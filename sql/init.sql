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

DROP INDEX IF EXISTS idx_payments_summary_ultra;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_covering_v2
ON payments(status, processor) 
INCLUDE (amount, created_at) 
WHERE status = 'processed' AND processor IN ('default', 'fallback');