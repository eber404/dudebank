import type { PaymentRequest } from '@/types'

import { paymentProcessor, paymentWorker } from '@/di-container'

async function handleRequest(req: Request): Promise<Response> {
  const { method, url } = req
  const { pathname, searchParams } = new URL(url)

  try {
    if (method === 'POST' && pathname === '/payments') {
      const paymentInput = (await req.json()) as PaymentRequest
      paymentWorker.postMessage(paymentInput)
      return new Response(null, {
        status: 200,
      })
    }

    if (method === 'GET' && pathname === '/payments-summary') {
      const from = searchParams.get('from') || undefined
      const to = searchParams.get('to') || undefined
      const summary = await paymentProcessor.getPaymentsSummary(from, to)
      return new Response(JSON.stringify(summary), {
        status: 200,
      })
    }

    if (method === 'DELETE' && pathname === '/admin/purge') {
      const results = paymentProcessor.purgeAll()
      const response = {
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify(response), {
        status: 200,
      })
    }

    return new Response('Not Found', {
      status: 404,
    })
  } catch (error: any) {
    console.error('Request handling error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
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
