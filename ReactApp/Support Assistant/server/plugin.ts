import type { Plugin } from 'vite'
import { sendJson } from './utils.js'
import { handleConnectRoutes } from './routes/connect.js'
import { handleEmailRoutes } from './routes/emails.js'
import { handleTreatmentRoutes } from './routes/treatments.js'
import { handleAssistanceRoutes } from './routes/assistance.js'
import { handleSettingsRoutes } from './routes/settings.js'
import { handleCodexRoutes } from './routes/codex.js'
import { handleJirayahRoutes } from './routes/jirayah.js'
import { handleTraceRoutes } from './routes/trace.js'
import { handleTicketRoutes } from './routes/ticket.js'
import { handleKibaRoutes } from './routes/kiba.js'

const ROUTE_HANDLERS = [
  handleConnectRoutes,
  handleEmailRoutes,
  handleTreatmentRoutes,
  handleAssistanceRoutes,
  handleSettingsRoutes,
  handleCodexRoutes,
  handleJirayahRoutes,
  handleTraceRoutes,
  handleTicketRoutes,
  handleKibaRoutes,
]

export function supportAssistantApi(): Plugin {
  return {
    name: 'support-assistant-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          next()
          return
        }

        try {
          for (const handler of ROUTE_HANDLERS) {
            if (await handler(req, res)) return
          }
          sendJson(res, 404, { error: 'Route not found' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}
