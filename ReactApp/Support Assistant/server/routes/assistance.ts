import type { IncomingMessage, ServerResponse } from 'node:http'
import { ASSISTANCE_STORE_PATH } from '../config.js'
import { getAssistanceAgentRun, isRegisteredAssistanceAgent, startAssistanceAgentRun } from '../services/assistanceAgents.js'
import { readJsonBody, readJsonFile, saveJsonFile, sendJson } from '../utils.js'

type AssistanceStateMap = Record<string, unknown>

export async function handleAssistanceRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : ''

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

  const runMatch = req.method === 'POST' ? pathname.match(/^\/api\/assistance\/agents\/([^/]+)\/run$/) : null
  if (runMatch) {
    const body = await readJsonBody(req)
    const agentId = decodeURIComponent(runMatch[1] ?? '').trim()

    if (!isRegisteredAssistanceAgent(agentId)) {
      sendJson(res, 404, { error: `Unknown or unimplemented agent: ${agentId}` })
      return true
    }

    const rawOptions = typeof body.options === 'object' && body.options && !Array.isArray(body.options)
      ? body.options as { ignoreAuthErrors?: unknown; skipPatterns?: unknown }
      : undefined

    const run = startAssistanceAgentRun(agentId, {
      jiraKey: typeof body.jiraKey === 'string' ? body.jiraKey.trim() : undefined,
      guidance: typeof body.guidance === 'string' ? body.guidance.trim() : undefined,
      config: typeof body.config === 'object' && body.config && !Array.isArray(body.config)
        ? body.config as { model?: string; effort?: 'low' | 'medium' | 'high' }
        : undefined,
      options: rawOptions
        ? {
            ignoreAuthErrors: rawOptions.ignoreAuthErrors === true,
            skipPatterns: Array.isArray(rawOptions.skipPatterns)
              ? rawOptions.skipPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
              : undefined,
          }
        : undefined,
    })

    sendJson(res, 202, {
      code: 0,
      stdout: '',
      stderr: '',
      runId: run.runId,
      agentId: run.agentId,
      status: run.status,
    })
    return true
  }

  const statusMatch = req.method === 'GET' ? pathname.match(/^\/api\/assistance\/agents\/([^/]+)\/status$/) : null
  if (statusMatch) {
    const runId = decodeURIComponent(statusMatch[1] ?? '').trim()
    const run = getAssistanceAgentRun(runId)
    if (!run) {
      sendJson(res, 404, { error: `Unknown runId: ${runId}` })
      return true
    }

    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      runId: run.runId,
      agentId: run.agentId,
      status: run.status,
      summary: run.summary,
      report: run.report,
      error: run.error ?? undefined,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })
    return true
  }

  return false
}
