import { Elysia } from 'elysia'
import { config } from './config'
import { routes } from './routes'

new Elysia()
  .use(routes)
  .listen(config.server.port)

console.log(`📞 Server is listening at http://localhost:${config.server.port}`)