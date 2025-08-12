import { config } from '@/config'
import type { PaymentRequest, PaymentSummary } from '@/types'
import { paymentCommand, databaseClient } from '@/di-container'

function roundToComercialAmount(amount: number) {
  if (!amount) return 0
  return parseFloat(amount.toFixed(2))
}

const headers = {
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
}

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
              headers,
            })
          },
        },
        '/payments-summary': {
          GET: async (req) => {
            const urlParams = req.url.split('?')[1] || ''
            const searchParams = new URLSearchParams(urlParams)
            const from = searchParams.get('from') ?? undefined
            const to = searchParams.get('to') ?? undefined
            const res = await databaseClient.getDatabaseSummary(from, to)

            const summary: PaymentSummary = {
              default: {
                totalRequests: roundToComercialAmount(
                  res?.default?.totalRequests
                ),
                totalAmount: roundToComercialAmount(res?.default?.totalAmount),
              },
              fallback: {
                totalRequests: roundToComercialAmount(
                  res?.fallback?.totalRequests
                ),
                totalAmount: roundToComercialAmount(res?.fallback?.totalAmount),
              },
            }
            return new Response(JSON.stringify(summary), {
              status: 200,
              headers,
            })
          },
        },
        '/admin/purge': {
          DELETE: async () => {
            await paymentCommand.purgeAll()
            return new Response('Purge operation completed', {
              status: 200,
              headers,
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

httpServer.listen(config.server.socketPath).catch(console.error)
