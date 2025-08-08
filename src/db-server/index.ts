import { unlink } from 'fs/promises'

import { DatabaseService } from '@/db-server/database-service'
import type { ProcessedPayment } from '@/types'

const database = new DatabaseService()

export const memoryDBServer = {
  async listen(socketPath: string = '/tmp/db.sock') {
    try {
      await unlink(socketPath)
    } catch (error) {
      // Socket file doesn't exist, ignore
      console.error(error)
    }

    const server = Bun.serve({
      unix: socketPath,
      development: false,
      routes: {
        '/payments/batch': {
          POST: async (req) => {
            const payments = (await req.json()) as ProcessedPayment[]
            database.persistPayments(payments)
            return new Response(null, { status: 200 })
          },
        },
        '/payments-summary': {
          GET: async (req) => {
            const urlParams = req.url.split('?')[1] || ''
            const searchParams = new URLSearchParams(urlParams)
            const from = searchParams.get('from') ?? undefined
            const to = searchParams.get('to') ?? undefined
            const summary = database.getDatabaseSummary(from, to)
            return new Response(JSON.stringify(summary), { status: 200 })
          },
        },
        '/admin/purge': {
          DELETE: async () => {
            await database.purgeDatabase()
            return new Response(
              JSON.stringify({
                message: 'MemoryDB purged successfully',
                timestamp: new Date().toISOString(),
              }),
              { status: 200 }
            )
          },
        },
      },
      fetch() {
        return new Response('Not Found', { status: 404 })
      },
      error(error) {
        console.error('MemoryDB request error:', error)
        return new Response('Internal Server Error', { status: 500 })
      },
    })

    console.log(`🗄️  MemoryDB Server running on unix socket: ${socketPath}`)
    return server
  },
}

// Start server if this file is run directly
if (import.meta.main) {
  memoryDBServer.listen(Bun.env.DATABASE_SOCKET_PATH || '/tmp/db.sock')
}
