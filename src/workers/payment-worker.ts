import { parentPort } from 'worker_threads'
import { queue, paymentProcessor } from '@/di-container'

async function processPaymentWorker() {
  const payment = queue.dequeue()
  if (!payment) return
  await paymentProcessor.processPayment(payment)
}

parentPort?.on('message', processPaymentWorker)
