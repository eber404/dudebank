import { parentPort } from 'worker_threads'
import { Mutex } from 'async-mutex'

import { PaymentProcessor } from '@/services/payment-processor'
import { Queue } from '@/services/queue-service'
import type { PaymentRequest } from '@/types'
import { config } from '@/config'

const paymentProcessor = new PaymentProcessor()
const queue = new Queue<PaymentRequest>()
const mutex = new Mutex()

async function processPayments() {
  try {
    await mutex.runExclusive(async () => {
      let remaining = queue.size
      while (remaining > 0) {
        const batch: PaymentRequest[] = []
        const batchSize = Math.min(config.paymentWorker.batchSize, remaining)
        for (let i = 0; i < batchSize; i++) {
          const item = queue.dequeue()
          if (item) batch.push(item)
        }
        if (batch.length === 0) break
        await paymentProcessor.processPaymentBatch(batch)
        remaining -= batch.length
      }
    })
  } catch (err) {
    console.log(`[worker] err`, err)
  }
}

function enqueue(input: PaymentRequest) {
  queue.enqueue(input)
  if (mutex.isLocked()) return
  void processPayments()
}

parentPort?.on('message', enqueue)
