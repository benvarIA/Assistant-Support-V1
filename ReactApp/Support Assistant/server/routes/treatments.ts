import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TreatmentProgressStore } from '../types.js'
import { readJsonBody, sendJson } from '../utils.js'
import { readTreatmentsStore, writeTreatmentsStore } from '../services/jira.js'

export async function handleTreatmentRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'GET' && req.url === '/api/treatments') {
    const treatments = await readTreatmentsStore()
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      treatments,
    })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/treatments/save') {
    const body = await readJsonBody(req)
    const treatments = body.treatments
    if (!treatments || typeof treatments !== 'object' || Array.isArray(treatments)) {
      sendJson(res, 400, { error: 'Invalid treatments payload' })
      return true
    }

    await writeTreatmentsStore(treatments as TreatmentProgressStore)
    sendJson(res, 200, {
      code: 0,
      stdout: 'Traitements sauvegardés.',
      stderr: '',
    })
    return true
  }

  return false
}
