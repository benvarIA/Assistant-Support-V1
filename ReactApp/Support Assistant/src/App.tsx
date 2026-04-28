import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type TerminalLine = {
  id: string
  type: 'command' | 'stdout' | 'stderr' | 'status'
  text: string
}

type CommandResponse = {
  code: number
  stdout: string
  stderr: string
  error?: string
}

type RenderOptions = {
  showExitCode?: boolean
  showStderrOnSuccess?: boolean
}

type GraphEmail = {
  id: string
  subject?: string
  conversationId?: string
  receivedDateTime?: string
  jiraKey?: string | null
  jiraUrl?: string | null
  jiraMatches?: JiraIssueMatch[]
  from?: {
    emailAddress?: {
      name?: string
      address?: string
    }
  }
}

type EmailPreview = {
  subject: string
  sender: string
  receivedDateTime: string | null
  html: string
  hasInlineImages: boolean
}

type JiraIssueMatch = {
  key: string
  url: string
  summary: string
  created: string
  score: number
  reason: string
}

type PrisEmailsResponse = CommandResponse & {
  emails?: GraphEmail[]
  invalidatedThreadIds?: string[]
}

type TreatmentsStoreResponse = CommandResponse & {
  treatments?: Record<string, TreatmentProgress>
}

type PrisEmailRow = {
  id: string
  messageId: string
  conversationId: string
  title: string
  sender: string
  receivedDateTime: string | null
  jiraKey: string | null
  jiraUrl: string | null
  jiraMatches: JiraIssueMatch[]
}

type TreatmentProgress = {
  selectedEmail: PrisEmailRow
  isAnalyzing: boolean
  isProposingJira: boolean
  analysisError: string | null
  jiraDraft: JiraProposal | null
  isCreatingJira: boolean
  createJiraError: string | null
  createdIssue: {
    key: string
    url: string
    attachmentReport?: {
      found: number
      uploaded: number
      skipped: number
      errors: string[]
    }
  } | null
  isRealTreatmentActive: boolean
  identificationCategoryText: string
  isIdentificationValidated: boolean
  identificationError: string | null
  identificationWarnings: string[]
}

type DescriptionRenderMode = 'email-html' | 'plain-text'

type JiraProposal = {
  projectKey: string
  issueType: 'Assistance' | 'Intervention' | 'Information' | 'Incident'
  subtypeField: "Type de déploiement" | "Type d'intervention" | "Type d'info" | null
  subtypeValue: string | null
  client: string
  clientCandidates: string[]
  summary: string
  description: string
  descriptionRenderMode?: DescriptionRenderMode
  clientOptions: string[]
  subtypeOptions: string[]
  attachmentCandidates: Array<{
    key: string
    name: string
    extension: string
    sizeBytes: number
    selected: boolean
    kind: 'attachment' | 'inline-image'
  }>
  warnings: string[]
}

type EmailPreviewResponse = CommandResponse & {
  preview?: EmailPreview
}

type IdentificationResponse = CommandResponse & {
  identification?: IdentificationCategory
  warnings?: string[]
}

type JiraProposalResponse = CommandResponse & {
  proposal?: JiraProposal
}

type JiraCreateResponse = CommandResponse & {
  issue?: {
    key: string
    url: string
    attachmentReport?: {
      found: number
      uploaded: number
      skipped: number
      errors: string[]
    }
  }
}

type OrochimaruTracePayload = {
  status?: 'needs_validation' | 'ready' | 'completed' | 'error'
  summary?: string
  preview_items?: Array<{
    sender?: string
    date?: string
    subject?: string
    excerpt?: string
    attachments?: string[]
  }>
  question?: string
  actions_taken?: string[]
  confidence?: number
  blocking_reason?: string
  needs_minutes?: boolean
  raw?: string
}

type TraceExecuteResponse = CommandResponse & {
  result?: {
    jiraKey: string
    added: number
    subjects: string[]
    lastMatchedEmailId: string | null
  }
}

type CloseTicketResponse = CommandResponse & {
  result?: {
    jiraKey: string
    archivedCount: number
    worklogAdded: boolean
    worklogMinutes: number
    warnings: string[]
  }
}

type WorklogResponse = CommandResponse & {
  result?: {
    jiraKey: string
    worklogAdded: boolean
    worklogMinutes: number
  }
}

type JiraClientsRefreshResponse = CommandResponse & {
  stats?: {
    added: number
    modified: number
    removed: number
    total: number
    addedNames?: string[]
    modifiedNames?: string[]
    removedNames?: string[]
  }
}

type MicrosoftConnectResponse = CommandResponse & {
  running?: boolean
  startedAt?: string
  finishedAt?: string | null
}

const MIN_ANALYSIS_DURATION_MS = 1800
const TREATMENTS_STORAGE_KEY = 'support-assistant:treatments:v1'

type IdentificationCategory = 'Assistance' | 'Question' | 'Intervention livraison' | 'Intervention administration'

const ISSUE_TYPE_OPTIONS: JiraProposal['issueType'][] = ['Assistance', 'Intervention', 'Information', 'Incident']
const ISSUE_SUBTYPE_MAP: Record<
  JiraProposal['issueType'],
  { field: JiraProposal['subtypeField']; options: string[] }
> = {
  Assistance: {
    field: 'Type de déploiement',
    options: ['Onsite', 'Online', 'Mutualisée (Team+, Team, Partners)', 'TO BE DEFINED'],
  },
  Intervention: {
    field: "Type d'intervention",
    options: ['Setup', 'Update', 'Administration', 'Exploitation', 'License delivery'],
  },
  Information: {
    field: "Type d'info",
    options: ['Fonctionnelle', 'Technique', 'Business'],
  },
  Incident: {
    field: null,
    options: [],
  },
}

function createLine(type: TerminalLine['type'], text: string): TerminalLine {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    text,
  }
}

function stripReplyPrefixes(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.replace(/^(?:(?:re|tr|fw|fwd)\s*:\s*)+/i, '').trim()
}

function normalizePersistedTreatments(input: Record<string, TreatmentProgress>): Record<string, TreatmentProgress> {
  const entries = Object.entries(input)
  const normalized = entries.map(([key, value]) => [
    key,
    {
      ...value,
      jiraDraft: value.jiraDraft
        ? {
            ...value.jiraDraft,
            descriptionRenderMode: value.jiraDraft.descriptionRenderMode ?? 'plain-text',
          }
        : null,
      // In-flight operations cannot survive page refresh/restart.
      isAnalyzing: false,
      isProposingJira: false,
      isCreatingJira: false,
    },
  ])
  return Object.fromEntries(normalized) as Record<string, TreatmentProgress>
}

function readStoredTreatments(): Record<string, TreatmentProgress> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(TREATMENTS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return normalizePersistedTreatments(parsed as Record<string, TreatmentProgress>)
  } catch {
    return {}
  }
}

function App() {
  const [, setLines] = useState<TerminalLine[]>([
    createLine('status', 'Terminal Codex prêt. Utilisez les boutons ou tapez une instruction.'),
  ])
  const [isConnectingJira, setIsConnectingJira] = useState(false)
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false)
  const [isLoadingPrisEmails, setIsLoadingPrisEmails] = useState(false)
  const [isRefreshingJiraClients, setIsRefreshingJiraClients] = useState(false)
  const [agentWorkStatus, setAgentWorkStatus] = useState<string | null>(null)
  const [isMicrosoftLoginRunning, setIsMicrosoftLoginRunning] = useState(false)
  const [microsoftConnectFeedback, setMicrosoftConnectFeedback] = useState<{
    type: 'success' | 'error' | 'info'
    text: string
  } | null>(null)
  const [jiraClientsRefreshFeedback, setJiraClientsRefreshFeedback] = useState<{
    type: 'success' | 'error'
    text: string
    addedNames?: string[]
    modifiedNames?: string[]
  } | null>(null)
  const [prisEmails, setPrisEmails] = useState<PrisEmailRow[]>([])
  const [selectedEmail, setSelectedEmail] = useState<PrisEmailRow | null>(null)
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false)
  const [ticketModalMode, setTicketModalMode] = useState<'analysis' | 'create' | null>(null)
  const [isTraceModalOpen, setIsTraceModalOpen] = useState(false)
  const [actionPlaceholderMessage, setActionPlaceholderMessage] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProposingJira, setIsProposingJira] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [jiraDraft, setJiraDraft] = useState<JiraProposal | null>(null)
  const [isCreatingJira, setIsCreatingJira] = useState(false)
  const [createJiraError, setCreateJiraError] = useState<string | null>(null)
  const [createdIssue, setCreatedIssue] = useState<{
    key: string
    url: string
    attachmentReport?: {
      found: number
      uploaded: number
      skipped: number
      errors: string[]
    }
  } | null>(null)
  const [isRealTreatmentActive, setIsRealTreatmentActive] = useState(false)
  const [identificationCategoryText, setIdentificationCategoryText] = useState('')
  const [isIdentificationValidated, setIsIdentificationValidated] = useState(false)
  const [identificationError, setIdentificationError] = useState<string | null>(null)
  const [identificationWarnings, setIdentificationWarnings] = useState<string[]>([])
  const [, setIsResumedTreatment] = useState(false)
  const [treatmentsByThread, setTreatmentsByThread] = useState<Record<string, TreatmentProgress>>(() => readStoredTreatments())
  const [isTreatmentsStoreReady, setIsTreatmentsStoreReady] = useState(false)
  const [pendingJiraValidationQueue, setPendingJiraValidationQueue] = useState<PrisEmailRow[]>([])
  const [, setEmailPreview] = useState<EmailPreview | null>(null)
  const [, setIsLoadingEmailPreview] = useState(false)
  const [, setEmailPreviewError] = useState<string | null>(null)
  const [isTracingOrochimaru, setIsTracingOrochimaru] = useState(false)
  const [orochimaruTraceResult, setOrochimaruTraceResult] = useState<OrochimaruTracePayload | null>(null)
  const [orochimaruTraceError, setOrochimaruTraceError] = useState<string | null>(null)
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
  const [closeWorklogMinutes, setCloseWorklogMinutes] = useState('0')
  const [closeTicketError, setCloseTicketError] = useState<string | null>(null)
  const [closeTicketSuccess, setCloseTicketSuccess] = useState<string | null>(null)
  const [isClosingTicket, setIsClosingTicket] = useState(false)
  const [isTraceWorklogModalOpen, setIsTraceWorklogModalOpen] = useState(false)
  const [traceWorklogMinutes, setTraceWorklogMinutes] = useState('0')
  const [traceWorklogError, setTraceWorklogError] = useState<string | null>(null)
  const [isAddingTraceWorklog, setIsAddingTraceWorklog] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const currentJiraValidation = pendingJiraValidationQueue[0] ?? null

  const pushLines = (...nextLines: TerminalLine[]) => {
    setLines((current) => [...current, ...nextLines])
  }

  const callApi = async (url: string, body?: unknown): Promise<CommandResponse> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = (await response.json()) as CommandResponse

    if (!response.ok) {
      return {
        code: data.code ?? 1,
        stdout: data.stdout ?? '',
        stderr: data.stderr ?? '',
        error: data.error ?? `La commande a échoué (${response.status}).`,
      }
    }

    return data
  }

  const toEmailRows = (emails: GraphEmail[]): PrisEmailRow[] => {
    type ThreadAggregate = {
      latest: GraphEmail
      oldest: GraphEmail
    }

    const threadMap = new Map<string, ThreadAggregate>()

    for (const email of emails) {
      const key = email.conversationId || email.id
      const existing = threadMap.get(key)

      if (!existing) {
        threadMap.set(key, {
          latest: email,
          oldest: email,
        })
        continue
      }

      const latestDate = existing.latest.receivedDateTime ? Date.parse(existing.latest.receivedDateTime) : 0
      const oldestDate = existing.oldest.receivedDateTime ? Date.parse(existing.oldest.receivedDateTime) : Number.MAX_SAFE_INTEGER
      const currentDate = email.receivedDateTime ? Date.parse(email.receivedDateTime) : 0

      if (currentDate >= latestDate) {
        existing.latest = email
      }
      if (currentDate <= oldestDate) {
        existing.oldest = email
      }
    }

    return Array.from(threadMap.entries()).map(([threadId, aggregate]) => {
      const subject = stripReplyPrefixes(aggregate.latest.subject?.trim() || '') || '(Sans objet)'
      // Rule: always display the sender from the first chronological email of the thread.
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

  const loadPrisEmails = async () => {
    setIsLoadingPrisEmails(true)
    setAgentWorkStatus('Synchronisation Microsoft: chargement des emails "Pris"...')

    try {
      const response = await fetch('/api/emails/pris')
      const data = (await response.json()) as PrisEmailsResponse

      if (!response.ok) {
        const errorMessage = data.error ?? data.stderr ?? 'Échec du chargement des emails "Pris".'
        pushLines(createLine('stderr', errorMessage))
        return
      }

      const rows = toEmailRows(data.emails ?? [])
      setPrisEmails(rows)
      setPendingJiraValidationQueue(rows.filter((email) => !email.jiraKey && email.jiraMatches.length > 0))
      const invalidatedThreadIds = Array.isArray(data.invalidatedThreadIds)
        ? data.invalidatedThreadIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
      if (invalidatedThreadIds.length > 0) {
        const invalidatedSet = new Set(invalidatedThreadIds)
        setTreatmentsByThread((current) => {
          const next = { ...current }
          for (const threadId of invalidatedSet) {
            delete next[threadId]
          }
          return next
        })
        setSelectedEmail((current) => (current && invalidatedSet.has(current.id) ? null : current))
        setIsTicketModalOpen(false)
        pushLines(
          createLine(
            'status',
            `${invalidatedThreadIds.length} association(s) Jira supprimée(s): ticket introuvable, traitement réinitialisé.`,
          ),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      pushLines(createLine('stderr', message))
    } finally {
      setIsLoadingPrisEmails(false)
      setAgentWorkStatus(null)
    }
  }

  const refreshJiraClientsReference = async () => {
    setIsRefreshingJiraClients(true)
    setAgentWorkStatus('Agent Jira: mise à jour de la référence clients...')
    setJiraClientsRefreshFeedback(null)
    pushLines(createLine('command', '$ refresh jira clients reference'))

    try {
      const response = await fetch('/api/jira/clients/refresh', {
        method: 'POST',
      })
      const result = (await response.json()) as JiraClientsRefreshResponse

      if (!response.ok) {
        const message = result.error ?? result.stderr ?? 'Mise à jour des clients Jira impossible.'
        setJiraClientsRefreshFeedback({ type: 'error', text: message })
        pushLines(createLine('stderr', message))
        return
      }

      renderResult(result, { showExitCode: false })
      if (result.stats) {
        setJiraClientsRefreshFeedback({
          type: 'success',
          text: `MAJ clients Jira: ${result.stats.added} ajoutés, ${result.stats.modified} modifiés, ${result.stats.removed} supprimés (total: ${result.stats.total}).`,
          addedNames: result.stats.addedNames ?? [],
          modifiedNames: result.stats.modifiedNames ?? [],
        })
      } else if (result.stdout.trim()) {
        setJiraClientsRefreshFeedback({
          type: 'success',
          text: result.stdout.trim(),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setJiraClientsRefreshFeedback({ type: 'error', text: message })
      pushLines(createLine('stderr', message))
    } finally {
      setIsRefreshingJiraClients(false)
      setAgentWorkStatus(null)
    }
  }

  const dismissCurrentJiraValidation = () => {
    setPendingJiraValidationQueue((current) => current.slice(1))
  }

  const confirmJiraAssociation = async (email: PrisEmailRow, match: JiraIssueMatch) => {
    try {
      const response = await fetch('/api/jira/association/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId: email.id,
          jiraKey: match.key,
        }),
      })
      const data = (await response.json()) as CommandResponse
      if (!response.ok) {
        pushLines(createLine('stderr', data.error ?? data.stderr ?? 'Association Jira impossible.'))
        return
      }

      setPrisEmails((current) =>
        current.map((item) =>
          item.id === email.id
            ? {
                ...item,
                jiraKey: match.key,
                jiraUrl: match.url,
                jiraMatches: [],
              }
            : item,
        ),
      )
      setTreatmentsByThread((current) => {
        const existing = current[email.id]
        if (!existing) {
          return current
        }
        return {
          ...current,
          [email.id]: {
            ...existing,
            selectedEmail: {
              ...existing.selectedEmail,
              jiraKey: match.key,
              jiraUrl: match.url,
              jiraMatches: [],
            },
          },
        }
      })
      dismissCurrentJiraValidation()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      pushLines(createLine('stderr', message))
    }
  }

  useEffect(() => {
    void loadPrisEmails()
  }, [])

  const renderResult = (result: CommandResponse, options: RenderOptions = {}) => {
    const showExitCode = options.showExitCode ?? true
    const showStderrOnSuccess = options.showStderrOnSuccess ?? true

    if (result.stdout.trim()) {
      pushLines(createLine('stdout', result.stdout.trimEnd()))
    }

    if (result.stderr.trim() && (result.code !== 0 || showStderrOnSuccess)) {
      pushLines(createLine('stderr', result.stderr.trimEnd()))
    }

    if (result.error) {
      pushLines(createLine('stderr', result.error))
    }

    if (showExitCode) {
      pushLines(createLine('status', `Exit code: ${result.code}`))
    }
  }

  const connectJira = async () => {
    setIsConnectingJira(true)
    pushLines(createLine('command', '$ skill jira: login'))

    try {
      const result = await callApi('/api/connect/jira')
      renderResult(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      pushLines(createLine('stderr', message))
    } finally {
      setIsConnectingJira(false)
    }
  }

  const connectMicrosoft = async () => {
    setIsConnectingMicrosoft(true)
    setAgentWorkStatus('Agent Microsoft: ouverture du flux de connexion...')
    setMicrosoftConnectFeedback({ type: 'info', text: 'Démarrage de la connexion Microsoft…' })
    pushLines(createLine('command', '$ skill microsoft: login'))

    try {
      const response = await fetch('/api/connect/microsoft', {
        method: 'POST',
      })
      const result = (await response.json()) as MicrosoftConnectResponse

      if (!response.ok) {
        const message = result.error ?? result.stderr ?? 'Connexion Microsoft impossible.'
        setMicrosoftConnectFeedback({ type: 'error', text: message })
        pushLines(createLine('stderr', message))
        setIsMicrosoftLoginRunning(false)
        return
      }

      renderResult(result)

      const firstMessage = result.stdout.trim()
      setMicrosoftConnectFeedback({
        type: 'info',
        text: firstMessage || 'Connexion Microsoft lancée. Suis les instructions de connexion.',
      })
      setIsMicrosoftLoginRunning(Boolean(result.running))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setMicrosoftConnectFeedback({ type: 'error', text: message })
      pushLines(createLine('stderr', message))
    } finally {
      setIsConnectingMicrosoft(false)
    }
  }

  useEffect(() => {
    if (!isMicrosoftLoginRunning) {
      return
    }

    let cancelled = false
    let lastStdout = ''
    let lastStderr = ''

    const poll = async () => {
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        try {
          const response = await fetch('/api/connect/microsoft/status')
          const result = (await response.json()) as MicrosoftConnectResponse

          const stdout = result.stdout ?? ''
          const stderr = result.stderr ?? ''
          if (stdout !== lastStdout) {
            lastStdout = stdout
            const latestLine = stdout.trim().split('\n').filter(Boolean).pop()
            if (latestLine) {
              setMicrosoftConnectFeedback({ type: 'info', text: latestLine })
            }
          }
          if (stderr !== lastStderr && stderr.trim()) {
            lastStderr = stderr
            const latestLine = stderr.trim().split('\n').filter(Boolean).pop()
            if (latestLine) {
              setMicrosoftConnectFeedback({ type: 'error', text: latestLine })
            }
          }

          if (!result.running) {
            setIsMicrosoftLoginRunning(false)
            setAgentWorkStatus(null)
            if (result.code === 0) {
              setMicrosoftConnectFeedback({ type: 'success', text: 'Connexion Microsoft réussie.' })
            } else {
              const message = result.error ?? result.stderr ?? 'Connexion Microsoft interrompue.'
              setMicrosoftConnectFeedback({ type: 'error', text: message })
            }
            return
          }
        } catch (error) {
          setIsMicrosoftLoginRunning(false)
          setAgentWorkStatus(null)
          const message = error instanceof Error ? error.message : 'Erreur de suivi de connexion Microsoft.'
          setMicrosoftConnectFeedback({ type: 'error', text: message })
          return
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [isMicrosoftLoginRunning])

  const openTreatment = (email: PrisEmailRow, options?: { forceIdentification?: boolean }) => {
    const forceIdentification = options?.forceIdentification ?? false
    setIsTicketModalOpen(true)

    if (forceIdentification) {
      setIsResumedTreatment(false)
      setAnalysisError(null)
      setJiraDraft(null)
      setIsCreatingJira(false)
      setCreateJiraError(null)
      setCreatedIssue(null)
      setIsRealTreatmentActive(false)
      setIdentificationCategoryText('')
      setIsIdentificationValidated(false)
      setIdentificationError(null)
      setIdentificationWarnings([])
      setSelectedEmail(email)
      void identifyEmail(email)
      return
    }

    const existingTreatment = treatmentsByThread[email.id]
    if (existingTreatment) {
      setIsResumedTreatment(true)
      setSelectedEmail({ ...existingTreatment.selectedEmail, ...email })
      // A restarted app cannot resume in-flight async calls; resume from last stable step instead.
      setIsAnalyzing(false)
      setIsProposingJira(false)
      setAnalysisError(existingTreatment.analysisError)
      setJiraDraft(existingTreatment.jiraDraft)
      setIsCreatingJira(false)
      setCreateJiraError(existingTreatment.createJiraError)
      setCreatedIssue(existingTreatment.createdIssue)
      setIsRealTreatmentActive(existingTreatment.isRealTreatmentActive)
      setIdentificationCategoryText(existingTreatment.identificationCategoryText)
      setIsIdentificationValidated(existingTreatment.isIdentificationValidated)
      setIdentificationError(existingTreatment.identificationError)
      setIdentificationWarnings(existingTreatment.identificationWarnings)
      return
    }

    const hasExistingJira = Boolean(email.jiraKey)

    setIsResumedTreatment(false)
    setAnalysisError(null)
    setJiraDraft(null)
    setIsCreatingJira(false)
    setCreateJiraError(null)
    setCreatedIssue(null)
    setIdentificationCategoryText('')
    setIsIdentificationValidated(false)
    setIdentificationError(null)
    setIdentificationWarnings([])
    setSelectedEmail(email)

    if (hasExistingJira) {
      setIsAnalyzing(false)
      setIsProposingJira(false)
      setIsRealTreatmentActive(true)
      return
    }

    setIsRealTreatmentActive(false)
    setIsProposingJira(false)
    setIsAnalyzing(true)
    void identifyEmail(email)
  }

  const closeTreatment = () => {
    setIsResumedTreatment(false)
    setIsTicketModalOpen(false)
    setTicketModalMode(null)
    setIsTraceModalOpen(false)
    setIsTraceWorklogModalOpen(false)
    setSelectedEmail(null)
  }

  const closeTraceModal = () => {
    if (isTracingOrochimaru) {
      return
    }
    setIsTraceModalOpen(false)
  }

  const openCloseModal = () => {
    if (!selectedEmail?.jiraKey) {
      setActionPlaceholderMessage("Clôture impossible: cet email n'a pas encore de ticket Jira associé.")
      return
    }
    setCloseWorklogMinutes('0')
    setCloseTicketError(null)
    setCloseTicketSuccess(null)
    setIsCloseModalOpen(true)
  }

  const closeCloseModal = () => {
    if (isClosingTicket) {
      return
    }
    setIsCloseModalOpen(false)
    setCloseTicketError(null)
  }

  useEffect(() => {
    if (!toastMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null)
    }, 3600)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [toastMessage])

  const closeTicketCreationModal = () => {
    setIsTicketModalOpen(false)
    setTicketModalMode(null)
  }

  useEffect(() => {
    if (!selectedEmail) {
      return
    }

    setTreatmentsByThread((current) => ({
      ...current,
      [selectedEmail.id]: {
        selectedEmail,
        isAnalyzing,
        isProposingJira,
        analysisError,
        jiraDraft,
        isCreatingJira,
        createJiraError,
        createdIssue,
        isRealTreatmentActive,
        identificationCategoryText,
        isIdentificationValidated,
        identificationError,
        identificationWarnings,
      },
    }))
  }, [
    selectedEmail,
    isAnalyzing,
    isProposingJira,
    analysisError,
    jiraDraft,
    isCreatingJira,
    createJiraError,
    createdIssue,
    isRealTreatmentActive,
    identificationCategoryText,
    isIdentificationValidated,
    identificationError,
    identificationWarnings,
  ])

  useEffect(() => {
    let isCancelled = false

    const loadPersistedTreatments = async () => {
      try {
        const response = await fetch('/api/treatments')
        const data = (await response.json()) as TreatmentsStoreResponse
        if (!response.ok) {
          return
        }
        const persisted = normalizePersistedTreatments(data.treatments ?? {})
        if (!isCancelled) {
          setTreatmentsByThread((current) => ({ ...current, ...persisted }))
        }
      } catch {
        // Keep local fallback when backend store is unavailable.
      } finally {
        if (!isCancelled) {
          setIsTreatmentsStoreReady(true)
        }
      }
    }

    void loadPersistedTreatments()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(TREATMENTS_STORAGE_KEY, JSON.stringify(treatmentsByThread))
    } catch {
      // Ignore storage quota / private mode errors and keep in-memory behavior.
    }
  }, [treatmentsByThread])

  useEffect(() => {
    if (!isTreatmentsStoreReady) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void fetch('/api/treatments/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ treatments: treatmentsByThread }),
      }).catch(() => {
        // Ignore backend persistence errors to avoid blocking the UI.
      })
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [treatmentsByThread, isTreatmentsStoreReady])

  const loadEmailPreview = async (email: PrisEmailRow) => {
    setIsLoadingEmailPreview(true)
    setEmailPreviewError(null)

    try {
      const response = await fetch('/api/email/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })
      const data = (await response.json()) as EmailPreviewResponse
      if (!response.ok || !data.preview) {
        setEmailPreviewError(data.error ?? data.stderr ?? "Prévisualisation de l'email impossible.")
        setEmailPreview(null)
        return
      }
      setEmailPreview(data.preview)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setEmailPreviewError(message)
      setEmailPreview(null)
    } finally {
      setIsLoadingEmailPreview(false)
    }
  }

  useEffect(() => {
    if (!selectedEmail) {
      setEmailPreview(null)
      setEmailPreviewError(null)
      setIsLoadingEmailPreview(false)
      setOrochimaruTraceResult(null)
      setOrochimaruTraceError(null)
      setIsTracingOrochimaru(false)
      return
    }

    void loadEmailPreview(selectedEmail)
  }, [selectedEmail?.id, selectedEmail?.messageId])

  const runTrace = async (): Promise<boolean> => {
    if (!selectedEmail?.jiraKey || isTracingOrochimaru) {
      return false
    }

    setIsTracingOrochimaru(true)
    setAgentWorkStatus(`Traçage en cours dans Jira (${selectedEmail.jiraKey})...`)
    setOrochimaruTraceError(null)

    try {
      const response = await fetch('/api/trace/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jiraKey: selectedEmail.jiraKey,
          email: selectedEmail,
        }),
      })

      const data = (await response.json()) as TraceExecuteResponse
      if (!response.ok || !data.result) {
        setOrochimaruTraceError(data.error ?? data.stderr ?? 'Traçage impossible.')
        return false
      }

      const added = data.result.added
      const summary = `Jira tracé: 1 · commentaires ajoutés: ${added}`
      setOrochimaruTraceResult({
        status: 'completed',
        summary,
      })
      setToastMessage(`Traçage terminé: ${summary}`)
      setActionPlaceholderMessage(summary)
      setIsTraceModalOpen(false)
      setTraceWorklogMinutes('0')
      setTraceWorklogError(null)
      setIsTraceWorklogModalOpen(true)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setOrochimaruTraceError(message)
      return false
    } finally {
      setIsTracingOrochimaru(false)
      setAgentWorkStatus(null)
    }
  }

  const identifyEmail = async (email: PrisEmailRow) => {
    setIsAnalyzing(true)
    setAgentWorkStatus("Agent d'identification: analyse de l'email en cours...")
    setAnalysisError(null)
    setJiraDraft(null)
    const analysisStartedAt = Date.now()

    try {
      const response = await fetch('/api/issue/identify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })
      const data = (await response.json()) as IdentificationResponse

      if (!response.ok || !data.identification) {
        setAnalysisError(data.error ?? data.stderr ?? 'Identification impossible.')
        return
      }
      setIdentificationCategoryText(data.identification)
      setIsIdentificationValidated(false)
      setIdentificationError(null)
      setIdentificationWarnings(data.warnings ?? [])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setAnalysisError(message)
    } finally {
      const elapsed = Date.now() - analysisStartedAt
      if (elapsed < MIN_ANALYSIS_DURATION_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_ANALYSIS_DURATION_MS - elapsed))
      }
      setIsAnalyzing(false)
      setAgentWorkStatus(null)
    }
  }

  const proposeJiraDraft = async (email: PrisEmailRow, identification: IdentificationCategory) => {
    setIsProposingJira(true)
    setAgentWorkStatus('Préparation de la proposition Jira...')
    setAnalysisError(null)
    setJiraDraft(null)

    try {
      const response = await fetch('/api/jirayah/propose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, identification }),
      })
      const data = (await response.json()) as JiraProposalResponse

      if (!response.ok || !data.proposal) {
        setAnalysisError(data.error ?? data.stderr ?? 'Proposition Jira impossible.')
        return
      }
      setJiraDraft(data.proposal)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setAnalysisError(message)
    } finally {
      setIsProposingJira(false)
      setAgentWorkStatus(null)
    }
  }

  const setDraftField = <K extends keyof JiraProposal>(field: K, value: JiraProposal[K]) => {
    setJiraDraft((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        [field]: value,
        ...(field === 'description' ? { descriptionRenderMode: 'plain-text' as DescriptionRenderMode } : {}),
      }
    })
  }

  const visibleAttachmentCandidates = jiraDraft?.attachmentCandidates.filter((attachment) => attachment.kind !== 'inline-image') ?? []
  const inlineImageCandidates = jiraDraft?.attachmentCandidates.filter((attachment) => attachment.kind === 'inline-image') ?? []

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B'
    }
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit += 1
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
  }

  const setAttachmentSelected = (key: string, selected: boolean) => {
    setJiraDraft((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        attachmentCandidates: current.attachmentCandidates.map((candidate) =>
          candidate.key === key ? { ...candidate, selected } : candidate,
        ),
      }
    })
  }

  const createJiraFromDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!jiraDraft || !selectedEmail || isCreatingJira) {
      return
    }

    setIsCreatingJira(true)
    setAgentWorkStatus('Agent Jira: création du ticket en cours...')
    setCreateJiraError(null)

    try {
      const response = await fetch('/api/jirayah/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: selectedEmail,
          proposal: jiraDraft,
        }),
      })
      const data = (await response.json()) as JiraCreateResponse

      if (!response.ok || !data.issue) {
        setCreateJiraError(data.error ?? data.stderr ?? 'Création Jira impossible.')
        return
      }

      const createdIssue = data.issue
      setCreatedIssue(createdIssue)
      setSelectedEmail((current) => (current ? { ...current, jiraKey: createdIssue.key, jiraUrl: createdIssue.url } : current))
      setPrisEmails((current) =>
        current.map((email) => {
          if (email.id !== selectedEmail.id) {
            return email
          }
          return {
            ...email,
            jiraKey: createdIssue.key,
            jiraUrl: createdIssue.url,
          }
        }),
      )
      setIsTicketModalOpen(false)
      setTicketModalMode(null)
      setIsRealTreatmentActive(false)
      window.location.reload()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setCreateJiraError(message)
    } finally {
      setIsCreatingJira(false)
      setAgentWorkStatus(null)
    }
  }

  const parseIdentificationCategory = (raw: string): IdentificationCategory | null => {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'assistance') {
      return 'Assistance'
    }
    if (normalized === 'question') {
      return 'Question'
    }
    if (normalized === 'intervention livraison') {
      return 'Intervention livraison'
    }
    if (normalized === 'intervention administration') {
      return 'Intervention administration'
    }
    return null
  }

  const validateIdentification = () => {
    const parsedCategory = parseIdentificationCategory(identificationCategoryText)
    if (!parsedCategory) {
      setIdentificationError(
        'Valeur invalide. Utiliser exactement: Assistance, Question, Intervention livraison, Intervention administration.',
      )
      return
    }
    if (!selectedEmail) {
      return
    }
    setIdentificationError(null)
    setIdentificationCategoryText(parsedCategory)
    setIsIdentificationValidated(true)
    setActionPlaceholderMessage('Identification sauvegardée.')
    setIsTicketModalOpen(false)
    setTicketModalMode(null)
  }

  const ticketModalContent = selectedEmail && isTicketModalOpen ? (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large" role="dialog" aria-modal="true" aria-label="Traitement ticket Jira">
        <header className="header">
          <h1>{ticketModalMode === 'analysis' ? 'Identification' : 'Créer le ticket JiraYah'}</h1>
          <p>
            <strong>{selectedEmail.title}</strong> · {selectedEmail.sender}
          </p>
        </header>

        {agentWorkStatus && <p className="info-text">{agentWorkStatus}</p>}

        {ticketModalMode === 'analysis' && (
          <section className="emails">
            <h2>Identification</h2>
            {isAnalyzing && <p>Identification en cours...</p>}
            {!isAnalyzing && analysisError && <p className="error-text">{analysisError}</p>}
            {!isAnalyzing && identificationCategoryText && (
              <div className="jira-form" style={{ marginBottom: 16 }}>
                <label className="full">
                  Identification de la demande
                  <input
                    type="text"
                    value={identificationCategoryText}
                    onChange={(event) => {
                      setIdentificationCategoryText(event.target.value)
                      setIsIdentificationValidated(false)
                      setIdentificationError(null)
                    }}
                  />
                </label>
                <p className="full">Valeurs autorisées: Assistance, Question, Intervention livraison, Intervention administration.</p>
                {identificationWarnings.length > 0 &&
                  identificationWarnings.map((warning) => (
                    <p key={warning} className="full error-text">
                      {warning}
                    </p>
                  ))}
                {identificationError && <p className="full error-text">{identificationError}</p>}
                <div className="full jira-form-actions">
                  <button
                    type="button"
                    className="btn jira"
                    onClick={validateIdentification}
                    disabled={!identificationCategoryText.trim()}
                  >
                    Valider
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {ticketModalMode === 'create' && (
          <section className="emails">
            <h2>JiraYah</h2>
            {analysisError && <p className="error-text">{analysisError}</p>}
            {!isProposingJira && jiraDraft && isIdentificationValidated && (
              <form className="jira-form" onSubmit={createJiraFromDraft}>
                <h3>Proposition du Jira</h3>
                <label>
                  Projet Jira
                  <input
                    type="text"
                    value={jiraDraft.projectKey}
                    onChange={(event) => setDraftField('projectKey', event.target.value)}
                    required
                  />
                </label>
                <label>
                  Type Jira (JiraYah)
                  <select
                    value={jiraDraft.issueType}
                    onChange={(event) => {
                      const issueType = event.target.value as JiraProposal['issueType']
                      const subtype = ISSUE_SUBTYPE_MAP[issueType]
                      setJiraDraft((current) => {
                        if (!current) {
                          return current
                        }
                        return {
                          ...current,
                          issueType,
                          subtypeField: subtype.field,
                          subtypeOptions: subtype.options,
                          subtypeValue: subtype.options[0] ?? null,
                        }
                      })
                    }}
                  >
                    {ISSUE_TYPE_OPTIONS.map((issueType) => (
                      <option key={issueType} value={issueType}>
                        {issueType}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Client
                  <input
                    type="text"
                    value={jiraDraft.client}
                    list="jirayah-clients"
                    onChange={(event) => setDraftField('client', event.target.value)}
                  />
                  <datalist id="jirayah-clients">
                    {jiraDraft.clientOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </label>
                <div>
                  <strong>3 propositions client</strong>
                  <div className="jira-form-actions" style={{ marginTop: 8 }}>
                    {jiraDraft.clientCandidates.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        className="btn neutral"
                        onClick={() => setDraftField('client', candidate)}
                      >
                        {candidate}
                      </button>
                    ))}
                  </div>
                </div>
                {jiraDraft.subtypeField && (
                  <label>
                    {jiraDraft.subtypeField}
                    <select
                      value={jiraDraft.subtypeValue ?? ''}
                      onChange={(event) => setDraftField('subtypeValue', event.target.value || null)}
                    >
                      {jiraDraft.subtypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="full">
                  Summary
                  <input
                    type="text"
                    value={jiraDraft.summary}
                    onChange={(event) => setDraftField('summary', event.target.value)}
                    required
                  />
                </label>
                <label className="full">
                  Description
                  <textarea
                    value={jiraDraft.description}
                    onChange={(event) => setDraftField('description', event.target.value)}
                    rows={8}
                  />
                </label>
                <div className="full">
                  <strong>Pièces jointes fichier à inclure</strong>
                  {inlineImageCandidates.length > 0 && (
                    <p style={{ marginTop: 8, marginBottom: visibleAttachmentCandidates.length > 0 ? 8 : 0 }}>
                      {inlineImageCandidates.length} image(s) inline seront incorporée(s) dans la description Jira.
                    </p>
                  )}
                  {visibleAttachmentCandidates.length === 0 ? (
                    <p>Les pièces jointes seront récupérées automatiquement à la création du ticket.</p>
                  ) : (
                    <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                      {visibleAttachmentCandidates.map((attachment) => (
                        <label key={attachment.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={attachment.selected}
                            onChange={(event) => setAttachmentSelected(attachment.key, event.target.checked)}
                          />
                          <span>
                            {attachment.name} {attachment.extension ? `(.${attachment.extension})` : ''} - {formatBytes(attachment.sizeBytes)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {jiraDraft.warnings.length > 0 && (
                  <div className="full">
                    {jiraDraft.warnings.map((warning) => (
                      <p key={warning} className="error-text">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
                <div className="full jira-form-actions">
                  <button type="submit" className="btn jira" disabled={isCreatingJira}>
                    {isCreatingJira ? 'Création Jira...' : 'Valider'}
                  </button>
                </div>
              </form>
            )}
            {createJiraError && <p className="error-text">{createJiraError}</p>}
          </section>
        )}

        <div className="actions">
          <button type="button" className="btn neutral" onClick={closeTicketCreationModal}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  ) : null

  const closeTicketModalContent = selectedEmail && isCloseModalOpen ? (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-compact" role="dialog" aria-modal="true" aria-label="Clôturer le ticket">
        <header className="header">
          <h1>Clôturer le ticket</h1>
          <p>
            <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
          </p>
        </header>

        <div className="jira-form">
          <label className="full">
            Temps passé (minutes)
            <input
              type="number"
              min="0"
              step="1"
              value={closeWorklogMinutes}
              onChange={(event) => {
                setCloseWorklogMinutes(event.target.value)
                setCloseTicketError(null)
              }}
            />
          </label>
          <p className="full" style={{ margin: 0 }}>
            0 par défaut. Si tu laisses 0, on clôture quand même le ticket mais on n’ajoute pas de worklog Jira.
          </p>
        </div>

        {closeTicketError && <p className="error-text">{closeTicketError}</p>}

        <div className="actions close-ticket-actions">
          <button type="button" className="btn neutral" onClick={closeCloseModal} disabled={isClosingTicket}>
            Annuler
          </button>
          <button type="button" className="btn danger" onClick={() => void confirmCloseTicket()} disabled={isClosingTicket}>
            {isClosingTicket ? 'Clôture...' : 'Valider et clôturer'}
          </button>
        </div>
      </section>
    </div>
  ) : null

  const traceWorklogModalContent = selectedEmail && selectedEmail.jiraKey && isTraceWorklogModalOpen ? (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-compact" role="dialog" aria-modal="true" aria-label="Ajouter temps passé">
        <header className="header">
          <h1>Temps passé après traçage</h1>
          <p>
            <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
          </p>
        </header>
        <div className="jira-form">
          <label className="full">
            Temps passé (minutes)
            <input
              type="number"
              min="0"
              step="1"
              value={traceWorklogMinutes}
              onChange={(event) => {
                setTraceWorklogMinutes(event.target.value)
                setTraceWorklogError(null)
              }}
            />
          </label>
          <p className="full" style={{ margin: 0 }}>
            0 = ne pas ajouter de worklog.
          </p>
        </div>
        {traceWorklogError && <p className="error-text">{traceWorklogError}</p>}
        <div className="actions close-ticket-actions">
          <button
            type="button"
            className="btn neutral"
            onClick={() => setIsTraceWorklogModalOpen(false)}
            disabled={isAddingTraceWorklog}
          >
            Plus tard
          </button>
          <button
            type="button"
            className="btn jira"
            onClick={() => {
              void (async () => {
                const parsedMinutes = Number(traceWorklogMinutes)
                if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
                  setTraceWorklogError('Le temps passé doit être un nombre supérieur ou égal à 0.')
                  return
                }
                setIsAddingTraceWorklog(true)
                setTraceWorklogError(null)
                try {
                  const response = await fetch('/api/ticket/worklog', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      jiraKey: selectedEmail.jiraKey,
                      worklogMinutes: Math.floor(parsedMinutes),
                    }),
                  })
                  const data = (await response.json()) as WorklogResponse
                  if (!response.ok || !data.result) {
                    setTraceWorklogError(data.error ?? data.stderr ?? 'Ajout worklog impossible.')
                    return
                  }
                  setIsTraceWorklogModalOpen(false)
                  setToastMessage(
                    data.result.worklogAdded
                      ? `Worklog ajouté: ${data.result.worklogMinutes} min sur ${data.result.jiraKey}.`
                      : `Aucun worklog ajouté sur ${data.result.jiraKey}.`,
                  )
                } catch (error) {
                  setTraceWorklogError(error instanceof Error ? error.message : 'Erreur inconnue')
                } finally {
                  setIsAddingTraceWorklog(false)
                }
              })()
            }}
            disabled={isAddingTraceWorklog}
          >
            {isAddingTraceWorklog ? 'Validation...' : 'Valider'}
          </button>
        </div>
      </section>
    </div>
  ) : null

  const traceModalContent = selectedEmail && isTraceModalOpen && selectedEmail.jiraKey ? (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large" role="dialog" aria-modal="true" aria-label="Orochimaru">
        <header className="header">
          <h1>Orochimaru</h1>
          <p>
            <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
          </p>
        </header>

        <section className="emails">
          <p style={{ marginTop: 0 }}>
            Analyse du fil puis ajout des emails manquants dans Jira, en ordre chronologique.
          </p>
          <div className="jira-form-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn jira"
              onClick={() => {
                void runTrace()
              }}
              disabled={isTracingOrochimaru}
            >
              {isTracingOrochimaru ? 'Traçage en cours...' : 'Orochimaru'}
            </button>
          </div>

          {orochimaruTraceError && <p className="error-text">{orochimaruTraceError}</p>}

          {orochimaruTraceResult && (
            <div className="jira-form" style={{ gap: 10 }}>
              <p className="full" style={{ margin: 0 }}>
                <strong>Statut:</strong> {orochimaruTraceResult.status ?? 'inconnu'}
              </p>
              {orochimaruTraceResult.summary && (
                <p className="full" style={{ margin: 0 }}>
                  {orochimaruTraceResult.summary}
                </p>
              )}
            </div>
          )}
        </section>

        <div className="actions">
          <button type="button" className="btn neutral" onClick={closeTraceModal} disabled={isTracingOrochimaru}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  ) : null

  const selectEmailFromTable = (email: PrisEmailRow) => {
    setSelectedEmail(email)
    setActionPlaceholderMessage(null)
    setCloseTicketSuccess(null)
  }

  const launchAnalysis = () => {
    if (!selectedEmail) {
      return
    }
    setActionPlaceholderMessage(null)
    setTicketModalMode('analysis')
    void openTreatment(selectedEmail, { forceIdentification: true })
  }

  const launchCreate = () => {
    if (!selectedEmail || selectedEmail.jiraKey) {
      return
    }
    if (!isIdentificationValidated) {
      setActionPlaceholderMessage("Identification non validée. Lance d'abord l'étape Identification.")
      return
    }
    const parsedCategory = parseIdentificationCategory(identificationCategoryText)
    if (!parsedCategory) {
      setActionPlaceholderMessage("Identification invalide. Refaire l'étape Identification.")
      return
    }
    setTicketModalMode('create')
    setIsTicketModalOpen(true)
    setCreateJiraError(null)
    if (!jiraDraft && !isProposingJira) {
      void proposeJiraDraft(selectedEmail, parsedCategory)
    }
  }

  const launchTraceAction = () => {
    if (!selectedEmail) {
      return
    }

    setActionPlaceholderMessage(null)

    if (!selectedEmail.jiraKey) {
      setActionPlaceholderMessage('Tracer impossible: aucun ticket Jira associé.')
      return
    }
    setOrochimaruTraceError(null)
    setIsTraceModalOpen(true)
  }

  const confirmCloseTicket = async () => {
    if (!selectedEmail?.jiraKey || isClosingTicket) {
      return
    }

    const parsedMinutes = Number(closeWorklogMinutes)
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
      setCloseTicketError('Le temps passé doit être un nombre supérieur ou égal à 0.')
      return
    }

    const worklogMinutes = Math.floor(parsedMinutes)
    setIsClosingTicket(true)
    setCloseTicketError(null)
    setCloseTicketSuccess(null)
    setAgentWorkStatus(`Clôture en cours pour ${selectedEmail.jiraKey}...`)

    try {
      const response = await fetch('/api/ticket/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: selectedEmail,
          jiraKey: selectedEmail.jiraKey,
          worklogMinutes,
        }),
      })
      const data = (await response.json()) as CloseTicketResponse

      if (!response.ok || !data.result) {
        setCloseTicketError(data.error ?? data.stderr ?? 'Clôture impossible.')
        return
      }

      setCloseTicketSuccess(
        `${data.result.jiraKey} clôturé · ${data.result.worklogAdded ? `${data.result.worklogMinutes} min loggées` : 'sans worklog'} · ${data.result.archivedCount} email(s) archivé(s)`,
      )
      setToastMessage(
        `${data.result.jiraKey} clôturé avec succès. ${data.result.archivedCount} email(s) archivé(s).`,
      )
      setActionPlaceholderMessage(`${data.result.jiraKey} clôturé. Email archivé et label PRIS retiré.`)
      setIsCloseModalOpen(false)
      setSelectedEmail(null)
      setIsTicketModalOpen(false)
      setTreatmentsByThread((current) => {
        if (!selectedEmail) {
          return current
        }
        const next = { ...current }
        delete next[selectedEmail.id]
        return next
      })
      await loadPrisEmails()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setCloseTicketError(message)
    } finally {
      setIsClosingTicket(false)
      setAgentWorkStatus(null)
    }
  }

  return (
    <main className="app">
      {ticketModalContent}
      {traceModalContent}
      {traceWorklogModalContent}
      {closeTicketModalContent}
      {toastMessage && (
        <div className="toast toast-success" role="status" aria-live="polite">
          <span>{toastMessage}</span>
          <button type="button" className="toast-close" onClick={() => setToastMessage(null)} aria-label="Fermer la notification">
            ×
          </button>
        </div>
      )}
      {currentJiraValidation && !isTicketModalOpen && !isTraceModalOpen && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="Validation ticket Jira trouvé">
            <h2>Validation ticket Jira trouvé</h2>
            <p>
              Un ou plusieurs tickets Jira ressemblent a cet email. Valide le bon ticket si la recherche est correcte.
            </p>
            <div className="detail-grid" style={{ marginBottom: 12 }}>
              <div>
                <strong>Titre:</strong> {currentJiraValidation.title}
              </div>
              <div>
                <strong>Expéditeur:</strong> {currentJiraValidation.sender}
              </div>
              <div>
                <strong>Date:</strong> {currentJiraValidation.receivedDateTime ?? 'Inconnue'}
              </div>
            </div>
            <div className="modal-match-list">
              {currentJiraValidation.jiraMatches.map((match) => (
                <div key={match.key} className="modal-match-card">
                  <div>
                    <strong>{match.key}</strong> - {match.summary}
                  </div>
                  <div className="modal-match-meta">
                    <span>Créé: {match.created}</span>
                    <span>Score: {match.score}</span>
                  </div>
                  <p>{match.reason}</p>
                  <div className="jira-form-actions">
                    <button
                      type="button"
                      className="btn jira"
                      onClick={() => {
                        void confirmJiraAssociation(currentJiraValidation, match)
                      }}
                    >
                      Associer ce ticket
                    </button>
                    <a className="btn neutral" href={match.url} target="_blank" rel="noreferrer">
                      Ouvrir Jira
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <div className="jira-form-actions">
              <button type="button" className="btn neutral" onClick={dismissCurrentJiraValidation}>
                Aucun de ces tickets
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="top-banner">
        <button type="button" className="app-title-link" onClick={closeTreatment}>
          Support Assistant
        </button>
        <div className="top-banner-actions">
          <button
            type="button"
            className="btn jira"
            onClick={connectJira}
            disabled={isConnectingJira || isConnectingMicrosoft}
          >
            Jira
          </button>
          <button
            type="button"
            className="btn microsoft"
            onClick={connectMicrosoft}
            disabled={isConnectingMicrosoft || isConnectingJira || isMicrosoftLoginRunning}
          >
            Outlook
          </button>
        </div>
      </header>
      <section className="panel">
        <header className="header">
          <h1>Accueil</h1>
        </header>
        {agentWorkStatus && <p className="info-text">{agentWorkStatus}</p>}

        <div className="actions">
          <button
            type="button"
            className="btn neutral"
            onClick={refreshJiraClientsReference}
            disabled={isRefreshingJiraClients || isLoadingPrisEmails}
          >
            {isRefreshingJiraClients ? 'MAJ clients...' : 'MAJ clients Jira'}
          </button>
        </div>
        {jiraClientsRefreshFeedback && (
          <div className={jiraClientsRefreshFeedback.type === 'error' ? 'error-text' : 'success-text'}>
            <p>{jiraClientsRefreshFeedback.text}</p>
            {jiraClientsRefreshFeedback.type === 'success' &&
              (jiraClientsRefreshFeedback.addedNames?.length || jiraClientsRefreshFeedback.modifiedNames?.length) ? (
              <ul>
                {(jiraClientsRefreshFeedback.addedNames ?? []).map((name) => (
                  <li key={`added-${name}`}>Ajouté: {name}</li>
                ))}
                {(jiraClientsRefreshFeedback.modifiedNames ?? []).map((name) => (
                  <li key={`modified-${name}`}>Modifié: {name}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {microsoftConnectFeedback && (
          <p
            className={
              microsoftConnectFeedback.type === 'error'
                ? 'error-text'
                : microsoftConnectFeedback.type === 'success'
                  ? 'success-text'
                  : 'info-text'
            }
          >
            {microsoftConnectFeedback.text}
          </p>
        )}

        <section className="emails">
          <h2>Actions sur l'email sélectionné</h2>
          {selectedEmail ? (
            <p className="selected-email-summary" title={`${selectedEmail.title} · ${selectedEmail.sender}`}>
              <strong>{selectedEmail.title}</strong> · {selectedEmail.sender}
            </p>
          ) : (
            <p style={{ marginTop: 0 }}>Sélectionne un email dans le tableau pour activer les actions.</p>
          )}
          {(() => {
            const hasSelectedEmail = Boolean(selectedEmail)
            const hasAssociatedJira = Boolean(selectedEmail?.jiraKey)
            const sequenceSteps = ['Identification', 'Créer', 'Tracer', 'Clôturer']
            const sequenceIndex = !isIdentificationValidated
              ? 0
              : !hasAssociatedJira
                ? 1
                : closeTicketSuccess
                  ? 3
                  : 2
            return (
              <>
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn neutral"
                    onClick={launchAnalysis}
                    disabled={!hasSelectedEmail || hasAssociatedJira}
                    title={
                      !hasSelectedEmail
                        ? 'Sélectionne un email pour lancer l’identification.'
                        : hasAssociatedJira
                          ? 'Identification indisponible: ticket Jira déjà associé.'
                          : undefined
                    }
                  >
                    Identification
                  </button>
                  <button
                    type="button"
                    className="btn jira"
                    onClick={launchCreate}
                    disabled={!hasSelectedEmail || hasAssociatedJira || !isIdentificationValidated}
                    title={
                      !hasSelectedEmail
                        ? 'Sélectionne un email pour créer un ticket.'
                        : hasAssociatedJira
                          ? 'Création indisponible: ticket Jira déjà associé.'
                          : !isIdentificationValidated
                            ? 'Valider l’identification avant de créer.'
                            : undefined
                    }
                  >
                    Créer
                  </button>
                  <button
                    type="button"
                    className="btn neutral"
                    onClick={() => {
                      void launchTraceAction()
                    }}
                    disabled={!hasSelectedEmail || isTracingOrochimaru}
                    title={!hasSelectedEmail ? 'Sélectionne un email pour tracer les réponses.' : undefined}
                  >
                    Tracer
                  </button>
                  <button
                    type="button"
                    className="btn danger close-ticket-button"
                    onClick={openCloseModal}
                    disabled={!hasSelectedEmail || !hasAssociatedJira}
                    title={
                      !hasSelectedEmail
                        ? 'Sélectionne un email pour clôturer.'
                        : !hasAssociatedJira
                          ? 'Un ticket Jira associé est requis pour clôturer.'
                          : undefined
                    }
                  >
                    Clôturer
                  </button>
                </div>
                <p className="actions-sequence">
                  <strong>Séquence:</strong> {sequenceSteps.map((step, index) => (index === sequenceIndex ? `[${step}]` : step)).join(' → ')}
                </p>
              </>
            )
          })()}
          {closeTicketSuccess && <p className="success-text">{closeTicketSuccess}</p>}
          {actionPlaceholderMessage && <p className="info-text">{actionPlaceholderMessage}</p>}
        </section>

        <section className="emails">
          <h2>Emails catégorisés "Pris"</h2>
          <div className="emails-table-wrap">
            <table className="emails-table">
              <thead>
                <tr>
                  <th>Titre Email</th>
                  <th>Expéditeur</th>
                  <th>Jira associé</th>
                </tr>
              </thead>
              <tbody>
                {prisEmails.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      Aucun email avec la catégorie "Pris".
                    </td>
                  </tr>
                ) : (
                  prisEmails.map((email) => (
                    <tr
                      key={email.id}
                      className={selectedEmail?.id === email.id ? 'selected-row' : undefined}
                      onClick={() => selectEmailFromTable(email)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{email.title}</td>
                      <td>{email.sender}</td>
                      <td>
                        {email.jiraKey && email.jiraUrl ? (
                          <a href={email.jiraUrl} target="_blank" rel="noreferrer">
                            {email.jiraKey}
                          </a>
                        ) : (
                          email.jiraKey ?? 'Non associé'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
