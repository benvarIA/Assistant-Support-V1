export type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

export type MicrosoftLoginState = {
  stdout: string
  stderr: string
  code: number | null
  startedAt: string
  finishedAt: string | null
  isRunning: boolean
}

export type GraphEmailAddress = {
  name?: string
  address?: string
}

export type GraphEmailFrom = {
  emailAddress?: GraphEmailAddress
}

export type ClientTechInfo = {
  setup: string
  language: string
  status: string
}

export type GraphEmail = {
  id: string
  subject?: string
  from?: GraphEmailFrom
  conversationId?: string
  internetMessageId?: string
  parentFolderId?: string
  receivedDateTime?: string
  categories?: string[]
  jiraKey?: string | null
  jiraUrl?: string | null
  jiraMatches?: JiraIssueMatch[]
  clientInfo?: ClientTechInfo
  body?: {
    contentType?: string
    content?: string
  }
  uniqueBody?: {
    contentType?: string
    content?: string
  }
  hasAttachments?: boolean
}

export type EmailPreviewPayload = {
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

export type GraphEmailList = {
  value?: GraphEmail[]
  '@odata.nextLink'?: string
}

export type GraphMailFolder = {
  id?: string
}

export type JiraConfig = {
  base_url?: string
  email?: string
  api_token?: string
}

export type JiraAnalyzeInput = {
  id?: string
  messageId?: string
  conversationId?: string
  title?: string
  sender?: string
  jiraKey?: string | null
}

export type IdentificationCategory =
  | 'Assistance'
  | 'Question'
  | 'Intervention livraison'
  | 'Intervention administration'

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

export type JiraCreateInput = JiraProposal & {
  sender?: string
  title?: string
}

export type JiraCreateResponse = {
  key?: string
  attachmentReport?: {
    found: number
    uploaded: number
    skipped: number
    errors: string[]
  }
}

export type OrochimaruTraceResponse = {
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
}

export type JiraMyselfResponse = {
  accountId?: string
}

export type JiraFieldSuggestionsResponse = {
  results?: Array<{
    value?: string
    displayName?: string
  }>
}

export type JiraSearchResponse = {
  issues?: Array<{
    key?: string
    fields?: {
      summary?: string
      created?: string
      description?: Record<string, unknown> | null
    }
  }>
}

export type JiraIssueComment = {
  id?: string
  created?: string
  body?: Record<string, unknown> | null
  properties?: Array<{
    key?: string
    value?: unknown
  }>
}

export type JiraCommentsResponse = {
  comments?: JiraIssueComment[]
}

export type JiraSimpleTraceResult = {
  jiraKey: string
  added: number
  subjects: string[]
  lastMatchedEmailId: string | null
}

export type JiraTransitionsResponse = {
  transitions?: Array<{
    id?: string
    name?: string
    to?: {
      id?: string
      name?: string
      statusCategory?: {
        id?: number
        key?: string
        name?: string
      }
    }
  }>
}

export type GraphAttachment = {
  id?: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  contentId?: string
  '@odata.type'?: string
  contentBytes?: string
}

export type GraphAttachmentList = {
  value?: GraphAttachment[]
}

export type MimeInlineAttachment = {
  id: string
  name: string
  contentType: string
  contentId: string
  bytes: Buffer
}

export type UploadableAttachment = {
  filename: string
  contentType: string
  bytes: Buffer
  sourceKey?: string
  sourceKind?: 'attachment' | 'inline-image'
}

export type JiraUploadedAttachment = {
  id: string
  filename: string
  mimeType?: string
  sourceKey?: string
  sourceKind?: 'attachment' | 'inline-image'
}

export type AttachmentCandidate = {
  key: string
  name: string
  extension: string
  sizeBytes: number
  selected: boolean
  kind: 'attachment' | 'inline-image'
}

export type AttachmentCollectionReport = {
  found: number
  skipped: number
  errors: string[]
}

export type EmbeddedImageTarget = {
  id: string
  alt?: string
  width?: number
  height?: number
}

export type M365Config = {
  client_id?: string
  tenant_id?: string
}

export type M365Token = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  expires_in?: number
}

export type ThreadJiraMap = Record<string, string>
export type TreatmentProgressStore = Record<string, unknown>

export type JiraClientReferenceEntry = {
  id: string
  value: string
}

export type JiraClientsReference = {
  updatedAt?: string
  count?: number
  values?: string[]
  entries?: JiraClientReferenceEntry[]
}

export type JiraClientsRefreshStats = {
  added: number
  modified: number
  removed: number
  total: number
  addedNames: string[]
  modifiedNames: string[]
  removedNames: string[]
}

export type RankedClientHint = { option: string; score: number }

export type CodexClassification = {
  client?: string
  clientCandidates?: string[]
  warnings?: string[]
}

export type CodexIdentification = {
  identification?: string
  confidence?: number
  warnings?: string[]
}

export type KibaConfidenceLevel = 'faible' | 'moyen' | 'élevé'

export type KibaPreflightResult = {
  jiraOk: boolean
  jiraError: string | null
  to: string
  cc: string[]
  bcc: string[]
}

export type KibaProposalResult = {
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
