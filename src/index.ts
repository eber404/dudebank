import { Elysia } from 'elysia'

import { config } from '@/config'
import { httpServer } from '@/http/server'

async function main() {
  new Elysia()
    .use(httpServer)
    .listen(config.server.port, () => console.log(`📞 Server is listening at http://localhost:${config.server.port}`))
}

main().catch(console.log)