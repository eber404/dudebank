export const config = {
  server: {
    port: parseInt(Bun.env.SERVER_PORT || '8080'),
  },
  databaseUrl: `${Bun.env.MEMORYDB_HOST || 'http://memorydb'}:${
    Bun.env.MEMORYDB_PORT || 8081
  }`,
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
  processing: {
    batchSize: 100,
    batchIntervalMs: 1,
  },
  paymentRouter: {
    requestTimeoutMs: 5000,
  },
}
