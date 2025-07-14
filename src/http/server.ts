import { PaymentService } from '@/services/payment-service'
import { PaymentRequestDTO } from '@/http/dtos/payment-request-dto'
import type { PaymentRequest } from '@/types'

const paymentService = new PaymentService()

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method
  const pathname = url.pathname

  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    // POST /payments
    if (method === 'POST' && pathname === '/payments') {
      const paymentInput = await req.json() as PaymentRequest
      const payment = PaymentRequestDTO.create(paymentInput)
      
      try {
        await paymentService.addPayment(payment)
        return new Response('Payment processed', { 
          status: 200, 
          headers: corsHeaders 
        })
      } catch (error) {
        return new Response('Payment failed', { 
          status: 500, 
          headers: corsHeaders 
        })
      }
    }

    // GET /payments-summary
    if (method === 'GET' && pathname === '/payments-summary') {
      const from = url.searchParams.get('from') || undefined
      const to = url.searchParams.get('to') || undefined
      const summary = await paymentService.getPaymentsSummary(from, to)
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      })
    }

    // DELETE /admin/purge
    if (method === 'DELETE' && pathname === '/admin/purge') {
      const results = await paymentService.purgeAll()
      return new Response(JSON.stringify({
        message: 'Purge operation completed',
        results,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      })
    }

    // 404 Not Found
    return new Response('Not Found', { 
      status: 404, 
      headers: corsHeaders 
    })

  } catch (error: any) {
    console.error('Request handling error:', error)
    return new Response(error.message || 'Internal Server Error', { 
      status: error.status || 500, 
      headers: corsHeaders 
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