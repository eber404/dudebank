import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'

import { PaymentService } from '@/services/payment-service'
import { PaymentRequestDTO } from '@/http/dtos/payment-request-dto'
import type { PaymentRequest } from '@/types'

const paymentService = new PaymentService()

export const httpServer = new Elysia()
  .use(cors())
  .post('/payments', async ({ body }) => {
    try {
      const paymentInput = body as PaymentRequest
      const payment = PaymentRequestDTO.create(paymentInput)
      await paymentService.addPayment(payment)
      return new Response('Payment accepted', { status: 202 })
    } catch (error: any) {
      return new Response(error, { status: 400 })
    }
  })
  .get('/payments-summary', async ({ query }) => {
    const { from, to } = query as { from?: string; to?: string }
    const summary = await paymentService.getPaymentsSummary(from, to)
    return summary
  })
  .delete('/admin/purge', async () => {
    try {
      const results = await paymentService.purgeAll()
      return {
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString()
      }
    } catch (error: any) {
      return new Response(`Purge failed: ${error.message}`, { status: 500 })
    }
  })
  .get('/admin/stats', async () => {
    try {
      const stats = await paymentService.getSystemStats()
      return {
        stats,
        timestamp: new Date().toISOString()
      }
    } catch (error: any) {
      return new Response(`Failed to get stats: ${error.message}`, { status: 500 })
    }
  })
