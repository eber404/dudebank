import { DatabaseService } from '@/db-server/database-service'
import type { ProcessedPayment, PaymentSummary } from '@/types'

const memoryDB = new DatabaseService()

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method
  const pathname = url.pathname

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    // POST /payments/batch - Insert batch of payments
    if (method === 'POST' && pathname === '/payments/batch') {
      const payments = (await req.json()) as ProcessedPayment[]
      await memoryDB.persistPayments(payments)
      return new Response(`${payments.length} payments stored`, {
        status: 200,
        headers: corsHeaders,
      })
    }

    // GET /payments-summary - Get payment summary
    if (method === 'GET' && pathname === '/payments-summary') {
      const from = url.searchParams.get('from') || undefined
      const to = url.searchParams.get('to') || undefined
      const summary = await memoryDB.getDatabaseSummary(from, to)
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    // DELETE /admin/purge - Purge database
    if (method === 'DELETE' && pathname === '/admin/purge') {
      await memoryDB.purgeDatabase()
      return new Response(
        JSON.stringify({
          message: 'MemoryDB purged successfully',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // GET /health - Health check
    if (method === 'GET' && pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          service: 'memorydb',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    })
  } catch (error: any) {
    console.error('MemoryDB request error:', error)
    return new Response(error.message || 'Internal Server Error', {
      status: 500,
      headers: corsHeaders,
    })
  }
}

export const memoryDBServer = {
  async listen(port: number = 8081) {
    const server = Bun.serve({
      port,
      fetch: handleRequest,
      development: false,
    })

    console.log(`🗄️  MemoryDB Server running on http://localhost:${port}`)
    return server
  },
}

// Start server if this file is run directly
if (import.meta.main) {
  memoryDBServer.listen(
    Bun.env.MEMORYDB_PORT ? Number(Bun.env.MEMORYDB_PORT) : 8081
  )
}
