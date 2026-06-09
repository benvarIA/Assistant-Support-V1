import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody, sendJson } from '../utils.js'
import {
  autoDetectAndUpdateLatestVersion,
  readClientKnowledge,
  refreshClientKnowledge,
  updateLatestVersion,
} from '../services/clientKnowledge.js'

export async function handleClientsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'GET' && req.url === '/api/clients/knowledge') {
    const knowledge = await readClientKnowledge()
    sendJson(res, 200, { code: 0, stdout: '', stderr: '', knowledge })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/clients/knowledge/refresh') {
    try {
      const knowledge = await refreshClientKnowledge()
      sendJson(res, 200, { code: 0, stdout: '', stderr: '', knowledge, stats: knowledge.stats })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rafraîchissement de la base clients impossible.'
      sendJson(res, 500, { error: message })
    }
    return true
  }

  if (req.method === 'POST' && req.url === '/api/clients/knowledge/latest-version') {
    const body = await readJsonBody(req)
    const version = typeof body.version === 'string' ? body.version : ''
    if (!version.trim()) {
      sendJson(res, 400, { error: 'Version invalide.' })
      return true
    }
    try {
      const knowledge = await updateLatestVersion(version)
      sendJson(res, 200, { code: 0, stdout: '', stderr: '', knowledge })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mise à jour de la version impossible.'
      sendJson(res, 500, { error: message })
    }
    return true
  }

  // Détecte la dernière version online depuis le dernier Roll-Out fermé sur IOBEXP.
  if (req.method === 'POST' && req.url === '/api/clients/knowledge/latest-version/detect') {
    try {
      const knowledge = await autoDetectAndUpdateLatestVersion()
      sendJson(res, 200, { code: 0, stdout: '', stderr: '', knowledge })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Détection de la version impossible.'
      sendJson(res, 500, { error: message })
    }
    return true
  }

  return false
}
