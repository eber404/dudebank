import { unlink } from 'fs/promises'

import { DatabaseService } from '@/db-server/database-service'
import type { ProcessedPayment, PaymentSummary } from '@/types'

const memoryDB = new DatabaseService()

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method
  const pathname = url.pathname

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200 })
  }

  try {
    if (method === 'POST' && pathname === '/payments/batch') {
      const payments = (await req.json()) as ProcessedPayment[]
      memoryDB.persistPayments(payments)
      return new Response(null, { status: 200 })
    }

    if (method === 'GET' && pathname === '/payments-summary') {
      const from = url.searchParams.get('from') || undefined
      const to = url.searchParams.get('to') || undefined
      const summary = memoryDB.getDatabaseSummary(from, to)
      return new Response(JSON.stringify(summary), { status: 200 })
    }

    if (method === 'DELETE' && pathname === '/admin/purge') {
      await memoryDB.purgeDatabase()
      return new Response(
        JSON.stringify({
          message: 'MemoryDB purged successfully',
          timestamp: new Date().toISOString(),
        }),
        { status: 200 }
      )
    }

    return new Response('Not Found', { status: 404 })
  } catch (error: any) {
    console.error('MemoryDB request error:', error)
    return new Response(error.message || 'Internal Server Error', {
      status: 500,
    })
  }
}

export const memoryDBServer = {
  async listen(socketPath: string = '/tmp/db.sock') {
    try {
      await unlink(socketPath)
    } catch (error) {
      // Socket file doesn't exist, ignore
    }

    const server = Bun.serve({
      unix: socketPath,
      fetch: handleRequest,
      development: false,
    })

    console.log(`🗄️  MemoryDB Server running on unix socket: ${socketPath}`)
    return server
  },
}

// Start server if this file is run directly
if (import.meta.main) {
  memoryDBServer.listen(Bun.env.DATABASE_SOCKET_PATH || '/tmp/db.sock')
}
