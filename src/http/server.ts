import { PaymentService } from '@/services/payment-service'
import type { PaymentRequest } from '@/types'

const paymentService = new PaymentService()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  ...corsHeaders,
}

const HTTP_STATUS_200 = new Response(null, {
  status: 200,
  headers: corsHeaders,
})

async function handleRequest(req: Request): Promise<Response> {
  const { method, url } = req
  const { pathname, searchParams } = new URL(url)

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    })
  }

  try {
    if (method === 'POST' && pathname === '/payments') {
      const paymentInput = (await req.json()) as PaymentRequest
      paymentService.addPayment(paymentInput)
      return HTTP_STATUS_200
    }

    if (method === 'GET' && pathname === '/payments-summary') {
      const from = searchParams.get('from') || undefined
      const to = searchParams.get('to') || undefined
      const summary = await paymentService.getPaymentsSummary(from, to)

      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: jsonHeaders,
      })
    }

    if (method === 'DELETE' && pathname === '/admin/purge') {
      const results = await paymentService.purgeAll()
      const response = {
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: jsonHeaders,
      })
    }

    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    })
  } catch (error: any) {
    console.error('Request handling error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
      }),
      {
        status: error.status || 500,
        headers: jsonHeaders,
      }
    )
  }
}

export const httpServer = {
  async listen(port: number = 3000) {
    const server = Bun.serve({
      port,
      fetch: handleRequest,
      development: false,
    })

    console.log(
      `🚀 [${Bun.env.HOSTNAME}] Server running on http://localhost:${port}`
    )
    return server
  },
}
