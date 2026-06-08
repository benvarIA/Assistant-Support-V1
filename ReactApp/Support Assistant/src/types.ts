export type ModelProvider = 'claude' | 'codex'
export type EffortLevel = 'low' | 'medium' | 'high'

export type ModelConfig = {
  provider: ModelProvider
  model: string
  effort: EffortLevel
}

export type AppSettings = {
  tickets: ModelConfig
  treatment: ModelConfig
}

export type TerminalLine = {
  id: string
  type: 'command' | 'stdout' | 'stderr' | 'status'
  text: string
}

export type CommandResponse = {
  code: number
  stdout: string
  stderr: string
  error?: string
}

export type RenderOptions = {
  showExitCode?: boolean
  showStderrOnSuccess?: boolean
}

export type GraphEmail = {
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

export type EmailPreview = {
  subject: string
  sender: string
  receivedDateTime: string | null
  html: string
  hasInlineImages: boolean
}

export type JiraIssueMatch = {
  key: string
  url: string
  summary: string
  created: string
  score: number
  reason: string
}

export type PrisEmailsResponse = CommandResponse & {
  emails?: GraphEmail[]
  invalidatedThreadIds?: string[]
}

export type TreatmentsStoreResponse = CommandResponse & {
  treatments?: Record<string, TreatmentProgress>
}

export type ClientTechInfo = {
  setup: string
  language: string
  status: string
}

export type PrisEmailRow = {
  id: string
  messageId: string
  conversationId: string
  title: string
  sender: string
  receivedDateTime: string | null
  jiraKey: string | null
  jiraUrl: string | null
  jiraMatches: JiraIssueMatch[]
  clientInfo?: ClientTechInfo
}

export type DescriptionRenderMode = 'email-html' | 'plain-text'

export type JiraProposal = {
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

export type TreatmentProgress = {
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

export type IdentificationCategory =
  | 'Assistance'
  | 'Question'
  | 'Intervention livraison'
  | 'Intervention administration'

export type EmailPreviewResponse = CommandResponse & {
  preview?: EmailPreview
}

export type IdentificationResponse = CommandResponse & {
  identification?: IdentificationCategory
  warnings?: string[]
}

export type JiraProposalResponse = CommandResponse & {
  proposal?: JiraProposal
}

export type JiraCreateResponse = CommandResponse & {
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

export type OrochimaruTracePayload = {
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

export type TraceExecuteResponse = CommandResponse & {
  result?: {
    jiraKey: string
    added: number
    subjects: string[]
    lastMatchedEmailId: string | null
  }
}

export type CloseTicketResponse = CommandResponse & {
  result?: {
    jiraKey: string
    archivedCount: number
    worklogAdded: boolean
    worklogMinutes: number
    warnings: string[]
  }
}

export type WorklogResponse = CommandResponse & {
  result?: {
    jiraKey: string
    worklogAdded: boolean
    worklogMinutes: number
  }
}

export type JiraClientsRefreshResponse = CommandResponse & {
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

export type MicrosoftConnectResponse = CommandResponse & {
  running?: boolean
  startedAt?: string
  finishedAt?: string | null
}

export type KibaConfidenceLevel = 'faible' | 'moyen' | 'élevé'

export type KibaProposal = {
  clientType: 'ON-SITE' | 'ONLINE dédié' | 'Mutualisée'
  clientTypeConfidence: KibaConfidenceLevel
  clientTypeReason: string
  deliveryType: 'Renouvellement' | 'Nouvelle salle' | 'Nouveau client'
  deliveryTypeConfidence: KibaConfidenceLevel
  deliveryTypeReason: string
  language: 'FR' | 'EN'
  languageConfidence: KibaConfidenceLevel
  languageReason: string
  customerName: string
  customerEmail: string
}

export type KibaProposeResponse = CommandResponse & {
  proposal?: KibaProposal
}

export type KibaPreflightResult = {
  jiraOk: boolean
  jiraError: string | null
  to: string
  cc: string[]
  bcc: string[]
}

export type KibaPreflightResponse = CommandResponse & {
  preflight?: KibaPreflightResult
}

export type KibaDraftResponse = CommandResponse & {
  result?: {
    status: 'draft_created' | 'blocked' | 'needs_validation'
    subject?: string
    draftInfo?: string
    blockingReason?: string
  }
}

export type AgentId =
  | 'analyse'
  | 'web'
  | 'docs'
  | 'jira'
  | 'systeme'
  | 'logs'
  | 'har'
  | 'dcm'
  | 'qcd'
  | 'addon-jira'
  | 'addon-ado'

export type ExecutionMode = 'sequential' | 'parallel'

export type AgentReport = {
  agentId: AgentId
  status: 'pending' | 'running' | 'done' | 'error'
  report: string
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
}

export type AssistanceRun = {
  id: string
  agentLabel: string
  model: string | null
  effort: string | null
  guidance: string
  status: 'done' | 'error'
  summary: string
  report: string
  errorMessage: string | null
  startedAt: string
  finishedAt: string
}

export type AssistanceState = {
  status: 'none' | 'in_progress' | 'done'
  summary: string
  reports: AgentReport[]
  history?: AssistanceRun[]
  consolidation: string
  emailDraft: string
  followUpPrompt?: string
  updatedAt: string
}

export type AssistanceStateMap = Record<string, AssistanceState>

export type AssistanceStoreResponse = CommandResponse & {
  states?: AssistanceStateMap
}

export type AssistanceAgentRunResponse = CommandResponse & {
  runId?: string
  agentId?: AgentId
  status?: 'queued' | 'running' | 'done' | 'error'
  startedAt?: string | null
  finishedAt?: string | null
  summary?: string
  report?: string
}

export type AssistanceAgentStatusResponse = CommandResponse & {
  runId?: string
  agentId?: AgentId
  status?: 'queued' | 'running' | 'done' | 'error'
  startedAt?: string | null
  finishedAt?: string | null
  summary?: string
  report?: string
}

export type MicrosoftFeedback = {
  type: 'success' | 'error' | 'info'
  text: string
}

export type JiraClientsFeedback = {
  type: 'success' | 'error'
  text: string
  addedNames?: string[]
  modifiedNames?: string[]
}
