export const config = {
  server: {
    port: parseInt(Bun.env.SERVER_PORT || '8080'),
    socketPath: Bun.env.SERVER_SOCKET_PATH || '/tmp/api.sock',
  },
  databaseSocketPath: Bun.env.MEMORYDB_SOCKET_PATH || '/tmp/memorydb.sock',
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
    batchSize: 500,
  },
  paymentRouter: {
    requestTimeoutMs: 5000,
  },
}
