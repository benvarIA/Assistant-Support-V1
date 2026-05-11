import type { IncomingMessage, ServerResponse } from 'node:http'
import type { JiraAnalyzeInput, JiraConfig } from '../types.js'
import { JIRA_CONFIG_CACHE } from '../config.js'
import { readJsonBody, readJsonFile, sendJson } from '../utils.js'
import { addJiraWorklog, closeTicketFromEmail, readTreatmentsStore, writeTreatmentsStore } from '../services/jira.js'

export async function handleTicketRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/ticket/worklog') {
    const body = await readJsonBody(req)
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim().toUpperCase() : ''
    const minutesRaw = Number(body.worklogMinutes)
    const worklogMinutes = Number.isFinite(minutesRaw) ? Math.floor(minutesRaw) : NaN

    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }
    if (!Number.isFinite(worklogMinutes) || worklogMinutes < 0) {
      sendJson(res, 400, { error: 'worklogMinutes doit être >= 0.' })
      return true
    }

    const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
    const added = await addJiraWorklog(jira, jiraKey, worklogMinutes)
    sendJson(res, 200, {
      code: 0,
      stdout: added ? `Worklog ajouté (${worklogMinutes} min) sur ${jiraKey}.` : `Aucun worklog ajouté sur ${jiraKey}.`,
      stderr: '',
      result: {
        jiraKey,
        worklogAdded: added,
        worklogMinutes,
      },
    })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/ticket/close') {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    const worklogMinutesRaw = typeof body.worklogMinutes === 'number' ? body.worklogMinutes : Number(body.worklogMinutes ?? 0)
    const worklogMinutes = Math.max(0, Math.floor(worklogMinutesRaw))

    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }

    const result = await closeTicketFromEmail(email, jiraKey, worklogMinutes)

    // Nettoyage immédiat du store — plus besoin de garder cet état
    const conversationId = typeof email.conversationId === 'string' ? email.conversationId.trim() : ''
    if (conversationId) {
      const store = await readTreatmentsStore()
      if (Object.prototype.hasOwnProperty.call(store, conversationId)) {
        delete store[conversationId]
        await writeTreatmentsStore(store)
      }
    }

    sendJson(res, 200, {
      code: 0,
      stdout: `Ticket ${result.jiraKey} clôturé.`,
      stderr: '',
      result,
    })
    return true
  }

  return false
}
