export const config = {
  server: {
    port: parseInt(Bun.env.SERVER_PORT || '8080'),
    socketPath: Bun.env.SERVER_SOCKET_PATH || '/tmp/api.sock',
  },
  databaseSocketPath: Bun.env.DATABASE_SOCKET_PATH || '/tmp/db.sock',
  paymentProcessors: {
    default: {
      url:
        Bun.env.PAYMENT_PROCESSOR_URL_DEFAULT ||
        'http://payment-processor-default:8080',
      type: 'default' as const,
    },
    fallback: {
      url:
        Bun.env.PAYMENT_PROCESSOR_URL_FALLBACK ||
        'http://payment-processor-fallback:8080',
      type: 'fallback' as const,
    },
  },
  paymentWorker: {
    batchSize: 200,
    processIntervalMs: 100,
  },
  paymentRouter: {
    requestTimeoutMs: 1500,
    maxRetries: 3,
  },
}
