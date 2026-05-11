import { useState } from 'react'
import type {
  GraphEmail,
  JiraIssueMatch,
  PrisEmailRow,
  PrisEmailsResponse,
} from '../types'
import { stripReplyPrefixes } from '../utils'

function toEmailRows(emails: GraphEmail[]): PrisEmailRow[] {
  type ThreadAggregate = { latest: GraphEmail; oldest: GraphEmail }
  const threadMap = new Map<string, ThreadAggregate>()

  for (const email of emails) {
    const key = email.conversationId || email.id
    const existing = threadMap.get(key)
    if (!existing) {
      threadMap.set(key, { latest: email, oldest: email })
      continue
    }
    const latestDate = existing.latest.receivedDateTime ? Date.parse(existing.latest.receivedDateTime) : 0
    const oldestDate = existing.oldest.receivedDateTime ? Date.parse(existing.oldest.receivedDateTime) : Number.MAX_SAFE_INTEGER
    const currentDate = email.receivedDateTime ? Date.parse(email.receivedDateTime) : 0
    if (currentDate >= latestDate) existing.latest = email
    if (currentDate <= oldestDate) existing.oldest = email
  }

  return Array.from(threadMap.entries()).map(([threadId, aggregate]) => {
    const subject = stripReplyPrefixes(aggregate.latest.subject?.trim() || '') || '(Sans objet)'
    const senderName = aggregate.oldest.from?.emailAddress?.name?.trim()
    const senderAddress = aggregate.oldest.from?.emailAddress?.address?.trim()
    const sender = senderName || senderAddress || 'Inconnu'
    return {
      id: threadId,
      messageId: aggregate.latest.id,
      conversationId: aggregate.latest.conversationId ?? threadId,
      title: subject,
      sender,
      receivedDateTime: aggregate.oldest.receivedDateTime ?? null,
      jiraKey: aggregate.latest.jiraKey ?? null,
      jiraUrl: aggregate.latest.jiraUrl ?? null,
      jiraMatches: aggregate.latest.jiraMatches ?? [],
    }
  })
}

export function useEmails(
  setAgentWorkStatus: (status: string | null) => void,
  onInvalidatedThreads: (invalidatedSet: Set<string>) => void,
) {
  const [prisEmails, setPrisEmails] = useState<PrisEmailRow[]>([])
  const [isLoadingPrisEmails, setIsLoadingPrisEmails] = useState(false)
  const [loadEmailsError, setLoadEmailsError] = useState<string | null>(null)
  const [confirmJiraError, setConfirmJiraError] = useState<string | null>(null)
  const [pendingJiraValidationQueue, setPendingJiraValidationQueue] = useState<PrisEmailRow[]>([])

  const loadPrisEmails = async () => {
    setIsLoadingPrisEmails(true)
    setLoadEmailsError(null)
    setAgentWorkStatus('Synchronisation Microsoft: chargement des emails "Pris"...')
    try {
      const response = await fetch('/api/emails/pris')
      const data = await response.json() as PrisEmailsResponse
      if (!response.ok) {
        setLoadEmailsError(data.error ?? data.stderr ?? 'Échec du chargement des emails.')
        return
      }
      const rows = toEmailRows(data.emails ?? [])
      setPrisEmails(rows)
      setPendingJiraValidationQueue(rows.filter((email) => !email.jiraKey && email.jiraMatches.length > 0))
      const invalidatedThreadIds = Array.isArray(data.invalidatedThreadIds)
        ? data.invalidatedThreadIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : []
      if (invalidatedThreadIds.length > 0) {
        onInvalidatedThreads(new Set(invalidatedThreadIds))
      }
    } catch (error) {
      setLoadEmailsError(error instanceof Error ? error.message : 'Chargement des emails impossible.')
    } finally {
      setIsLoadingPrisEmails(false)
      setAgentWorkStatus(null)
    }
  }

  const dismissCurrentJiraValidation = () => {
    setPendingJiraValidationQueue((current) => current.slice(1))
  }

  const confirmJiraAssociation = async (
    email: PrisEmailRow,
    match: JiraIssueMatch,
    onThreadUpdated: (emailId: string, key: string, url: string) => void,
  ) => {
    try {
      const response = await fetch('/api/jira/association/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: email.id, jiraKey: match.key }),
      })
      const data = await response.json() as { code: number; stdout: string; stderr: string; error?: string }
      if (!response.ok) {
        setConfirmJiraError(data.error ?? data.stderr ?? 'Association Jira impossible.')
        return
      }
      setPrisEmails((current) =>
        current.map((item) =>
          item.id === email.id ? { ...item, jiraKey: match.key, jiraUrl: match.url, jiraMatches: [] } : item,
        ),
      )
      onThreadUpdated(email.id, match.key, match.url)
      dismissCurrentJiraValidation()
    } catch (error) {
      setConfirmJiraError(error instanceof Error ? error.message : 'Association Jira impossible.')
    }
  }

  return {
    prisEmails,
    setPrisEmails,
    isLoadingPrisEmails,
    loadEmailsError,
    confirmJiraError,
    setConfirmJiraError,
    pendingJiraValidationQueue,
    loadPrisEmails,
    dismissCurrentJiraValidation,
    confirmJiraAssociation,
  }
}
