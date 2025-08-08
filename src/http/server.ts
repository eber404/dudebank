import type { PaymentRequest } from '@/types'
import { paymentCommand, paymentQuery } from '@/di-container'

export const httpServer = {
  async listen(socketPath: string) {
    const server = Bun.serve({
      unix: socketPath,
      development: false,
      routes: {
        '/payments': {
          POST: async (req) => {
            const paymentInput = (await req.json()) as PaymentRequest
            paymentCommand.enqueue(paymentInput)
            return new Response(null, {
              status: 200,
            })
          },
        },
        '/payments-summary': {
          GET: async (req) => {
            const urlParams = req.url.split('?')[1] || ''
            const searchParams = new URLSearchParams(urlParams)
            const from = searchParams.get('from') ?? undefined
            const to = searchParams.get('to') ?? undefined
            const localOnly = searchParams.get('local') === 'true'

            const summary = await paymentQuery.getPaymentsSummary(from, to, localOnly)

            return new Response(JSON.stringify(summary), {
              status: 200,
            })
          },
        },
        '/admin/purge': {
          DELETE: async () => {
            await paymentCommand.purgeAll()
            const results = 'purged'
            const response = {
              message: 'Purge operation completed',
              results,
              timestamp: new Date().toISOString(),
            }
            return new Response(JSON.stringify(response), {
              status: 200,
            })
          },
        },
      },
      fetch() {
        return new Response('Not Found', { status: 404 })
      },
      error(error) {
        console.error(error)
        return new Response('Internal Server Error', { status: 500 })
      },
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
