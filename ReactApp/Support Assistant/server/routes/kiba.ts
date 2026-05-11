import type { IncomingMessage, ServerResponse } from 'node:http'
import type { JiraAnalyzeInput } from '../types.js'
import { readJsonBody, sendJson } from '../utils.js'
import { createKibaOutlookDraft, kibaPreflightCheck, proposeKibaDelivery } from '../services/kiba.js'

export async function handleKibaRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/kiba/preflight') {
    const body = await readJsonBody(req)
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : ''
    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }
    const preflight = await kibaPreflightCheck(jiraKey, customerEmail)
    sendJson(res, 200, { code: 0, stdout: '', stderr: '', preflight })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/kiba/propose') {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }
    const proposal = await proposeKibaDelivery(email, jiraKey)
    sendJson(res, 200, { code: 0, stdout: '', stderr: '', proposal })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/kiba/draft') {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    const clientType = typeof body.clientType === 'string' ? body.clientType.trim() : ''
    const deliveryType = typeof body.deliveryType === 'string' ? body.deliveryType.trim() : ''
    const language = typeof body.language === 'string' ? body.language.trim() : ''
    const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : ''

    if (!jiraKey || !clientType || !deliveryType || !language) {
      sendJson(res, 400, { error: 'Missing jiraKey, clientType, deliveryType or language' })
      return true
    }

    const result = await createKibaOutlookDraft(email, jiraKey, clientType, deliveryType, language, customerEmail)
    sendJson(res, result.status === 'blocked' ? 422 : 200, {
      code: result.status === 'blocked' ? 1 : 0,
      stdout: result.draftInfo || '',
      stderr: result.blockingReason || '',
      result,
    })
    return true
  }

  return false
}
