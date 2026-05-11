import type { IncomingMessage, ServerResponse } from 'node:http'
import { ASSISTANCE_STORE_PATH } from '../config.js'
import { readJsonBody, readJsonFile, saveJsonFile, sendJson } from '../utils.js'

type AssistanceStateMap = Record<string, unknown>

export async function handleAssistanceRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'GET' && req.url === '/api/assistance') {
    let states: AssistanceStateMap = {}
    try {
      states = await readJsonFile<AssistanceStateMap>(ASSISTANCE_STORE_PATH)
    } catch {
      // File may not exist yet — return empty store
    }
    sendJson(res, 200, { code: 0, stdout: '', stderr: '', states })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/assistance/save') {
    const body = await readJsonBody(req)
    const states = body.states
    if (!states || typeof states !== 'object' || Array.isArray(states)) {
      sendJson(res, 400, { error: 'Invalid states payload' })
      return true
    }
    await saveJsonFile(ASSISTANCE_STORE_PATH, states)
    sendJson(res, 200, { code: 0, stdout: 'États assistance sauvegardés.', stderr: '' })
    return true
  }

  return false
}
