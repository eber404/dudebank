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
    mutex.acquire()
    while (queue.size) {
      console.log(`queue size`, queue.size)
      const batch = Array.from(
        { length: Math.min(config.paymentWorker.batchSize, queue.size) },
        () => queue.dequeue()
      ).filter((item) => !!item)
      if (!batch.length) continue
      console.log(`batch size`, batch.length)
      await paymentProcessor.processPaymentBatch(batch)
    }
  } finally {
    mutex.release()
  }
}

function enqueue(input: PaymentRequest) {
  queue.enqueue(input)
  if (mutex.isLocked()) return
  processPayments()
}

parentPort?.on('message', enqueue)
