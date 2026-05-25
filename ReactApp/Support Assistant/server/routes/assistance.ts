import type { IncomingMessage, ServerResponse } from 'node:http'
import { runAnalyseTicketAgent } from '../services/analyseTicket.js'
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

  if (req.method === 'POST' && req.url === '/api/assistance/agents/analyse/run') {
    const body = await readJsonBody(req)
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    const guidance = typeof body.guidance === 'string' ? body.guidance.trim() : ''
    const config = typeof body.config === 'object' && body.config && !Array.isArray(body.config)
      ? body.config as { model?: string; effort?: 'low' | 'medium' | 'high' }
      : undefined

    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }

    const analysis = await runAnalyseTicketAgent(jiraKey, config, guidance)
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      summary: analysis.summary,
      report: analysis.report,
    })
    return true
  }

  return false
}
