import type { IncomingMessage, ServerResponse } from 'node:http'
import type { IdentificationCategory, JiraAnalyzeInput, JiraCreateInput } from '../types.js'
import { readJsonBody, sendJson, stripReplyPrefixes, getThreadIdFromAnalyzeInput } from '../utils.js'
import { cutAtSignatureAndQuote, ensureMicrosoftAccessToken, listThreadMessages, stripHtml } from '../services/microsoft.js'
import {
  createJiraIssue,
  readThreadJiraMap,
  refreshJiraClientsReference,
  writeThreadJiraMap,
} from '../services/jira.js'
import { buildJiraProposal, identifyDemandWithCodex } from '../services/jirayah.js'
import { extractClientDomains, learnClientDomains } from '../services/clientDomainMap.js'

const ALLOWED_IDENTIFICATIONS: IdentificationCategory[] = [
  'Assistance',
  'Question',
  'Intervention livraison',
  'Intervention administration',
]

export async function handleJirayahRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/jira/clients/refresh') {
    const stats = await refreshJiraClientsReference()
    sendJson(res, 200, {
      code: 0,
      stdout: `Référence clients Jira mise à jour: ${stats.added} ajoutés, ${stats.modified} modifiés, ${stats.removed} supprimés (total: ${stats.total}) dans data/jira-clients-reference.json`,
      stderr: '',
      stats: {
        added: stats.added,
        modified: stats.modified,
        removed: stats.removed,
        total: stats.total,
        addedNames: stats.addedNames,
        modifiedNames: stats.modifiedNames,
        removedNames: stats.removedNames,
      },
    })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/jira/association/confirm') {
    const body = await readJsonBody(req)
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    if (!threadId || !jiraKey) {
      sendJson(res, 400, { error: 'Missing threadId or jiraKey' })
      return true
    }

    const map = await readThreadJiraMap()
    map[threadId] = jiraKey
    await writeThreadJiraMap(map)
    sendJson(res, 200, {
      code: 0,
      stdout: 'Association Jira sauvegardée.',
      stderr: '',
    })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/issue/identify') {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const microsoftToken = await ensureMicrosoftAccessToken()
    const threadMessages = await listThreadMessages(email, microsoftToken)
    const firstMessage = threadMessages[0]
    const subject = stripReplyPrefixes(email.title?.trim() || firstMessage?.subject?.trim() || '') || '(Sans objet)'
    const sender =
      email.sender?.trim() ||
      firstMessage?.from?.emailAddress?.address?.trim() ||
      firstMessage?.from?.emailAddress?.name?.trim() ||
      'Inconnu'
    const bodyRaw = firstMessage?.body?.content?.trim() || ''
    const description = cutAtSignatureAndQuote(stripHtml(bodyRaw)) || '(Contenu email introuvable)'
    const identification = await identifyDemandWithCodex({ subject, sender, description })
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      identification: identification.identification,
      warnings: identification.warnings,
    })
    return true
  }

  if (req.method === 'POST' && (req.url === '/api/jira/analyze' || req.url === '/api/jirayah/propose')) {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    const identificationRaw = typeof body.identification === 'string' ? body.identification.trim() : ''
    if (!ALLOWED_IDENTIFICATIONS.includes(identificationRaw as IdentificationCategory)) {
      sendJson(res, 400, {
        error:
          'Identification invalide. Valeurs autorisées: Assistance, Question, Intervention livraison, Intervention administration.',
      })
      return true
    }
    const proposal = await buildJiraProposal(email, identificationRaw as IdentificationCategory)
    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      proposal,
    })
    return true
  }

  if (req.method === 'POST' && (req.url === '/api/jira/create' || req.url === '/api/jirayah/create')) {
    const body = await readJsonBody(req)
    const email = (body.email as JiraAnalyzeInput | undefined) ?? undefined
    const proposal = (body.proposal as JiraCreateInput | undefined) ?? undefined
    if (!proposal) {
      sendJson(res, 400, { error: 'Missing proposal' })
      return true
    }

    const created = await createJiraIssue(proposal, email)
    const threadId = getThreadIdFromAnalyzeInput(email)
    if (threadId) {
      const map = await readThreadJiraMap()
      map[threadId] = created.key
      await writeThreadJiraMap(map)
    }

    // Apprentissage : mémorise « domaine expéditeur → client validé » pour fiabiliser
    // les prochaines détections (ignore génériques/ambigus en interne). Best effort.
    try {
      const sender = proposal.sender?.trim() || email?.sender?.trim() || ''
      const domains = extractClientDomains([sender])
      if (proposal.client) await learnClientDomains(domains, proposal.client)
    } catch {
      // ne bloque jamais la création
    }

    sendJson(res, 200, {
      code: 0,
      stdout: '',
      stderr: '',
      issue: created,
    })
    return true
  }

  return false
}
