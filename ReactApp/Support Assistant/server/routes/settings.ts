import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody, sendJson } from '../utils.js'
import { readSettings, writeSettings } from '../services/settings.js'
import type { AppSettings } from '../services/settings.js'

export async function handleSettingsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'GET' && req.url === '/api/settings') {
    const settings = await readSettings()
    sendJson(res, 200, { code: 0, settings })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/settings') {
    const body = await readJsonBody(req)
    const incoming = body.settings as Partial<AppSettings> | undefined
    if (!incoming || typeof incoming !== 'object') {
      sendJson(res, 400, { error: 'Invalid settings payload' })
      return true
    }
    const current = await readSettings()
    const next: AppSettings = {
      tickets:   { ...current.tickets,   ...incoming.tickets },
      treatment: { ...current.treatment, ...incoming.treatment },
    }
    await writeSettings(next)
    sendJson(res, 200, { code: 0, settings: next })
    return true
  }

  return false
}
