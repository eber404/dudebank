export const config = {
  isMainInstance: Bun.env.IS_MAIN_INSTANCE === 'true',
  server: {
    port: parseInt(Bun.env.SERVER_PORT || '8080'),
  },
  databaseUrl: `${Bun.env.MEMORYDB_HOST || 'http://memorydb'}:${Bun.env.MEMORYDB_PORT || 8081}`,
  paymentProcessors: {
    default: {
      url: Bun.env.PAYMENT_PROCESSOR_URL_DEFAULT || 'http://payment-processor-default:8080',
      type: 'default' as const,
    },
    fallback: {
      url: Bun.env.PAYMENT_PROCESSOR_URL_FALLBACK || 'http://payment-processor-fallback:8080',
      type: 'fallback' as const,
    },
  },
  processing: {
    batchSize: 100,
    batchIntervalMs: 5,
  },
  paymentRouter: {
    healthCheckTimeoutMs: 5000,
    healthCheckIntervalMs: 5000,
    requestTimeoutMs: 5000,
    raceProcessorsTimeoutMs: 10_000,
    fallbackSpeedAdvantageThreshold: 0.1176,
  },
}