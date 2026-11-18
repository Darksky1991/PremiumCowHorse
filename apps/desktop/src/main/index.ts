import { app } from 'electron'
import { bootstrap } from './bootstrap/bootstrap'

bootstrap().catch((e: unknown) => {
  console.error('[app] fatal error during bootstrap', e)
  app.exit(1)
})
