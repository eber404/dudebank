import { Worker } from 'worker_threads'

import { PaymentProcessor } from '@/services/payment-processor'

export const paymentWorker = new Worker(
  new URL('./workers/payment-worker.ts', import.meta.url)
)
export const paymentProcessor = new PaymentProcessor()
