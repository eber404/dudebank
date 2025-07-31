import { Worker } from 'worker_threads'

import { Queue } from '@/services/queue-service'
import { PaymentProcessor } from '@/services/payment-processor'

import type { PaymentRequest } from './types'

export const queue = new Queue<PaymentRequest>()
export const paymentWorker = new Worker(
  new URL('./workers/payment-worker.ts', import.meta.url)
)
export const paymentProcessor = new PaymentProcessor()
