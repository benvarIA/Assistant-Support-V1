import type { IncomingMessage, ServerResponse } from 'node:http'
import type { JiraAnalyzeInput } from '../types.js'
import { readJsonBody, sendJson } from '../utils.js'
import { buildEmailPreview, ensureMicrosoftAccessToken, listThreadMessages } from '../services/microsoft.js'
import { attachJiraCandidates, attachJiraKeys } from '../services/jira.js'
import { listPrisEmails } from '../services/microsoft.js'

export async function handleEmailRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'GET' && req.url === '/api/emails/pris') {
    const emails = await listPrisEmails()
    const withJira = await attachJiraKeys(emails)
    const emailsWithCandidates = await attachJiraCandidates(withJira.emails)
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      emails: emailsWithCandidates,
      invalidatedThreadIds: withJira.invalidatedThreadIds,
    })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/email/preview') {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const microsoftToken = await ensureMicrosoftAccessToken()
    const threadMessages = await listThreadMessages(email, microsoftToken)
    // Rule: preview must always render the original message (first chronological email of thread).
    const previewMessage = threadMessages[0]
    if (!previewMessage) {
      sendJson(res, 404, { error: 'Email introuvable.' })
      return true
    }
    const preview = await buildEmailPreview(previewMessage, microsoftToken, threadMessages)
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      preview,
    })
    return true
  }

  return false
}
