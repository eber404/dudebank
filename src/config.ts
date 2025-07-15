export const config = {
  server: {
    port: parseInt(process.env.SERVER_PORT || '8080'),
  },
  database: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'rinha_dev',
    user: process.env.DB_USER || 'dev',
    password: process.env.DB_PASSWORD || 'dev123',
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    acquireTimeoutMillis: 5000,
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  },
  paymentProcessors: {
    default: {
      url: process.env.PAYMENT_PROCESSOR_URL_DEFAULT || 'http://payment-processor-default:8080',
      type: 'default' as const,
    },
    fallback: {
      url: process.env.PAYMENT_PROCESSOR_URL_FALLBACK || 'http://payment-processor-fallback:8080',
      type: 'fallback' as const,
    },
  },
  processing: {
    batchSize: 50,
    batchIntervalMs: 5,
  },
  paymentRouter: {
    healthCheckTimeoutMs: 1000,
    healthCheckIntervalMs: 5000,
    requestTimeoutMs: 1250,
    processorScoreWeights: {
      fee: 0.6,
      responseTime: 0.3,
      availability: 0.1
    },
    raceProcessorsMaxAttempts: 50,
    fallbackSpeedAdvantageThreshold: 0.1176, // 11.76% faster required
  },
}