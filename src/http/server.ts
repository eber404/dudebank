import type { PaymentRequest } from '@/types'

import { paymentCommand, paymentQuery } from '@/di-container'

async function handleRequest(req: Request): Promise<Response> {
  const { method, url } = req
  const { pathname, searchParams } = new URL(url)

  const headers = {
    Connection: 'keep-alive',
    'Keep-Alive': 'timeout=5, max=100',
  }

  try {
    if (method === 'POST' && pathname === '/payments') {
      const paymentInput = (await req.json()) as PaymentRequest
      console.log(
        `[HTTP] Received payment: ${paymentInput.correlationId}, amount: ${paymentInput.amount}`
      )
      paymentCommand.enqueue(paymentInput)
      console.log(`[HTTP] Payment enqueued: ${paymentInput.correlationId}`)
      return new Response(null, {
        status: 200,
        headers,
      })
    }

    if (method === 'GET' && pathname === '/payments-summary') {
      const from = searchParams.get('from') || undefined
      const to = searchParams.get('to') || undefined

      const summary = await paymentQuery.getPaymentsSummary(from, to)
      console.log('/payments-summary', new Date().toISOString())
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers,
      })
    }

    if (method === 'DELETE' && pathname === '/admin/purge') {
      const results = await paymentCommand.purgeAll()
      const response = {
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers,
      })
    }

    return new Response('Not Found', {
      status: 404,
      headers,
    })
  } catch (error: any) {
    console.error('Request handling error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        headers,
      }),
      {
        status: error.status || 500,
      }
    )
  }
}

export const httpServer = {
  async listen(socketPath: string) {
    const server = Bun.serve({
      unix: socketPath,
      fetch: handleRequest,
      development: false,
    })

    // Set socket permissions so nginx can access it
    try {
      await Bun.spawn(['chmod', '666', socketPath]).exited
    } catch (error) {
      console.warn('Failed to set socket permissions:', error)
    }

    console.log(
      `🚀 [${Bun.env.HOSTNAME}] Server running on unix socket: ${socketPath}`
    )
    return server
  },
}
