import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { PaymentService } from '@/services'
import { PaymentValidator } from '@/validators'
import type { PaymentRequest } from '@/types'

const paymentService = new PaymentService()

export const routes = new Elysia()
  .use(cors())
  .post('/payments', async ({ body }) => {
    const payment = body as PaymentRequest

    const error = PaymentValidator.validatePaymentRequest(payment)
    if (error) {
      return new Response(error, { status: 400 })
    }

    await paymentService.addPayment(payment)
    return new Response('Payment accepted', { status: 202 })
  })
  .get('/payments-summary', async ({ query }) => {
    const { from, to } = query as { from?: string; to?: string }
    const summary = await paymentService.getPaymentsSummary(from, to)
    return summary
  })