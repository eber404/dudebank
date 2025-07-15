import { PaymentService } from '@/services/payment-service'
import { PaymentRequestDTO } from '@/http/dtos/payment-request-dto'
import type { PaymentRequest } from '@/types'

const paymentService = new PaymentService()

async function handleRequest(req: Request): Promise<Response> {
  const { method, url } = req
  const { pathname, searchParams } = new URL(url)

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, })
  }

  try {
    if (method === 'POST' && pathname === '/payments') {
      const paymentInput = await req.json() as PaymentRequest
      const payment = PaymentRequestDTO.create(paymentInput)

      await paymentService.addPayment(payment)
      return new Response(null, { status: 200, })
    }

    if (method === 'GET' && pathname === '/payments-summary') {
      const from = searchParams.get('from') || undefined
      const to = searchParams.get('to') || undefined
      const summary = await paymentService.getPaymentsSummary(from, to)
      return new Response(JSON.stringify(summary), { status: 200, })
    }

    if (method === 'DELETE' && pathname === '/admin/purge') {
      const results = await paymentService.purgeAll()
      return new Response(JSON.stringify({
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString()
      }), { status: 200, })
    }

    return new Response('Not Found', { status: 404, })

  } catch (error: any) {
    console.error('Request handling error:', error)
    return new Response(null, {
      status: error.status || 500,

    })
  }
}

export const httpServer = {
  async listen(port: number = 3000) {
    const server = Bun.serve({
      port,
      fetch: handleRequest,
    })

    console.log(`🚀 Server running on http://localhost:${port}`)
    return server
  }
}