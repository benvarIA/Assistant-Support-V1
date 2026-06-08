import {
  EXCLUDED_CLIENT_NAME_OPTIONS,
  JIRA_CLIENTS_REFERENCE_PATH,
  JIRA_CONFIG_CACHE,
  JIRAYAH_THREAD_JIRA_CACHE,
  DEFAULT_PROJECT_KEY,
  DEFAULT_PROJECT_ID,
  TREATMENTS_STORE_PATH,
} from '../config.js'
import type {
  AttachmentCandidate,
  DescriptionRenderMode,
  EmbeddedImageTarget,
  GraphEmail,
  JiraAnalyzeInput,
  JiraClientReferenceEntry,
  JiraClientsRefreshStats,
  JiraCommentsResponse,
  JiraConfig,
  JiraCreateInput,
  JiraCreateResponse,
  JiraFieldSuggestionsResponse,
  JiraIssueComment,
  JiraIssueMatch,
  JiraMyselfResponse,
  JiraSearchResponse,
  JiraSimpleTraceResult,
  JiraTransitionsResponse,
  JiraUploadedAttachment,
  ThreadJiraMap,
  TreatmentProgressStore,
  UploadableAttachment,
} from '../types.js'
import { readJsonFile, saveJsonFile, stripReplyPrefixes } from '../utils.js'
import {
  archiveThreadMessages,
  buildAdfFromEmailHtml,
  buildAdfFromText,
  buildAdfWithEmbeddedImages,
  collectThreadAttachments,
  cutAtSignatureAndQuote,
  ensureMicrosoftAccessToken,
  extractCidsFromUniqueBody,
  fetchFileAttachment,
  fetchFileAttachmentBytesViaValue,
  fetchMessageAttachmentRefs,
  getImageDimensions,
  listThreadMessages,
  normalizeContentId,
  sliceHtmlBeforeSignature,
  stripHtml,
  updateThreadMessagesCategories,
} from './microsoft.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ISSUE_TYPES = {
  Assistance: { id: '10161', subtypeFieldId: 'customfield_12413', subtypeFieldLabel: 'Type de deploiement' as const },
  Intervention: { id: '12', subtypeFieldId: 'customfield_11605', subtypeFieldLabel: "Type d'intervention" as const },
  Information: { id: '11', subtypeFieldId: 'customfield_11607', subtypeFieldLabel: "Type d'info" as const },
  Incident: { id: '10106', subtypeFieldId: null, subtypeFieldLabel: null },
} as const

export const SUBTYPE_OPTIONS = {
  Assistance: [
    { value: 'Onsite', id: '15917' },
    { value: 'Online', id: '15918' },
    { value: 'Mutualisee (Team+, Team, Partners)', id: '15919' },
    { value: 'TO BE DEFINED', id: '18119' },
  ],
  Intervention: [
    { value: 'Setup', id: '10847' },
    { value: 'Update', id: '10848' },
    { value: 'Administration', id: '10849' },
    { value: 'Exploitation', id: '15475' },
    { value: 'License delivery', id: '15847' },
  ],
  Information: [
    { value: 'Fonctionnelle', id: '10853' },
    { value: 'Technique', id: '10854' },
    { value: 'Business', id: '15242' },
  ],
  Incident: [],
} as const

// ---------------------------------------------------------------------------
// String normalization helpers (used for client/title matching)
// ---------------------------------------------------------------------------

export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

export function tokenizeForMatch(input: string, minLength = 3): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(input)
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= minLength),
    ),
  )
}

export function normalizeClientKey(input: string): string {
  return normalizeForMatch(input).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeStrictTitle(input: string): string {
  return normalizeForMatch(input).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeJqlText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function tokenizeForDescriptionDisambiguation(input: string): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(input)
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => {
          if (!t) return false
          if (/^\d+$/.test(t)) return t.length >= 2
          return t.length >= 4
        }),
    ),
  )
}

function scoreDescriptionSimilarity(emailText: string, jiraDescriptionText: string): { score: number; commonTokens: string[] } {
  const emailTokens = tokenizeForDescriptionDisambiguation(emailText)
  const jiraTokens = new Set(tokenizeForDescriptionDisambiguation(jiraDescriptionText))
  if (emailTokens.length === 0 || jiraTokens.size === 0) return { score: 0, commonTokens: [] }
  const commonTokens = emailTokens.filter((t) => jiraTokens.has(t))
  const ratio = commonTokens.length / Math.min(20, emailTokens.length)
  const score = Math.min(100, commonTokens.length * 12 + ratio * 40)
  return { score, commonTokens }
}

export function adfNodeToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : ''
  const content = Array.isArray(record.content) ? record.content.map((child) => adfNodeToText(child)).join(' ') : ''
  return `${text} ${content}`.trim()
}

const GENERIC_JIRA_TITLE_TOKENS = new Set([
  'iobeya', 'support', 'ticket', 'incident', 'probleme', 'issue', 'bug', 'demande', 'question',
])

function extractTitleTokensForJiraMatch(title: string): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(title)
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => {
          if (!t) return false
          if (GENERIC_JIRA_TITLE_TOKENS.has(t)) return false
          if (/^\d+$/.test(t)) return t.length >= 2
          return t.length >= 4
        }),
    ),
  )
}

// ---------------------------------------------------------------------------
// Client name filtering
// ---------------------------------------------------------------------------

function isExcludedClientNameOption(input: string): boolean {
  return EXCLUDED_CLIENT_NAME_OPTIONS.has(input.trim())
}

export function filterClientNameOptions(values: string[]): string[] {
  return Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0 && !isExcludedClientNameOption(v))),
  ).sort((a, b) => a.localeCompare(b, 'fr'))
}

export function filterClientNameEntries(entries: JiraClientReferenceEntry[]): JiraClientReferenceEntry[] {
  const dedup = new Map<string, string>()
  for (const entry of entries) {
    const id = entry.id?.trim()
    const value = entry.value?.trim()
    if (!id || !value || isExcludedClientNameOption(value)) continue
    dedup.set(id, value)
  }
  return Array.from(dedup.entries())
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => a.value.localeCompare(b.value, 'fr'))
}

// ---------------------------------------------------------------------------
// Persistent store helpers (thread->jira map, treatments, clients reference)
// ---------------------------------------------------------------------------

export async function readThreadJiraMap(): Promise<ThreadJiraMap> {
  try { return await readJsonFile<ThreadJiraMap>(JIRAYAH_THREAD_JIRA_CACHE) } catch { return {} }
}

export async function writeThreadJiraMap(next: ThreadJiraMap): Promise<void> {
  await saveJsonFile(JIRAYAH_THREAD_JIRA_CACHE, next)
}

const TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 jours

export async function readTreatmentsStore(): Promise<TreatmentProgressStore> {
  let store: TreatmentProgressStore
  try { store = await readJsonFile<TreatmentProgressStore>(TREATMENTS_STORE_PATH) } catch { return {} }

  const cutoff = Date.now() - TTL_MS
  let pruned = false
  for (const [id, entry] of Object.entries(store)) {
    const ts = (entry as { updatedAt?: string }).updatedAt
    if (ts && new Date(ts).getTime() < cutoff) {
      delete store[id]
      pruned = true
    }
  }
  if (pruned) await saveJsonFile(TREATMENTS_STORE_PATH, store)

  return store
}

export async function writeTreatmentsStore(next: TreatmentProgressStore): Promise<void> {
  await saveJsonFile(TREATMENTS_STORE_PATH, next)
}

export async function readJiraClientsReferenceValues(): Promise<string[]> {
  try {
    const parsed = await readJsonFile<{ values?: unknown[] }>(JIRA_CLIENTS_REFERENCE_PATH)
    const values = Array.isArray(parsed.values) ? parsed.values.filter((v): v is string => typeof v === 'string') : []
    return filterClientNameOptions(values)
  } catch { return [] }
}

export async function readJiraClientsReferenceEntries(): Promise<JiraClientReferenceEntry[]> {
  try {
    const parsed = await readJsonFile<{ entries?: unknown[] }>(JIRA_CLIENTS_REFERENCE_PATH)
    const rawEntries = Array.isArray(parsed.entries) ? (parsed.entries as JiraClientReferenceEntry[]) : []
    return filterClientNameEntries(rawEntries)
  } catch { return [] }
}

async function writeJiraClientsReferenceValues(values: string[], entries: JiraClientReferenceEntry[] = []): Promise<void> {
  const normalized = filterClientNameOptions(values)
  const normalizedEntries = filterClientNameEntries(entries)
  const payload = {
    updatedAt: new Date().toISOString(),
    count: normalized.length,
    values: normalized,
    entries: normalizedEntries,
  }
  await saveJsonFile(JIRA_CLIENTS_REFERENCE_PATH, payload)
}

// ---------------------------------------------------------------------------
// Jira auth helper
// ---------------------------------------------------------------------------

export function buildJiraAuth(jira: JiraConfig): { baseUrl: string; auth: string } {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }
  return { baseUrl, auth: Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64') }
}

// ---------------------------------------------------------------------------
// Jira user
// ---------------------------------------------------------------------------

async function getCurrentJiraUserAccountId(jira: JiraConfig): Promise<string> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Lecture utilisateur Jira impossible: ${response.status} ${body}`)
  }
  const parsed = (await response.json()) as JiraMyselfResponse
  const accountId = parsed.accountId?.trim()
  if (!accountId) throw new Error('accountId Jira introuvable pour reporter/assignee.')
  return accountId
}

// ---------------------------------------------------------------------------
// Jira issue operations
// ---------------------------------------------------------------------------

async function updateJiraDescription(jira: JiraConfig, issueKey: string, descriptionAdf: Record<string, unknown>): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { description: descriptionAdf } }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Mise a jour description Jira echouee (${response.status}): ${body}`)
  }
}

export async function removeJiraLabel(jira: JiraConfig, issueKey: string, label: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ update: { labels: [{ remove: label }] } }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Retrait label Jira echoue (${response.status}): ${body}`)
  }
}

async function addJiraWorklogWithComment(jira: JiraConfig, issueKey: string, worklogMinutes: number, commentText: string): Promise<boolean> {
  if (worklogMinutes <= 0) return false
  const { baseUrl, auth } = buildJiraAuth(jira)
  const started = new Date().toISOString().replace('Z', '+0000')
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeSpentSeconds: worklogMinutes * 60,
      started,
      comment: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ajout worklog Jira echoue (${response.status}): ${body}`)
  }
  return true
}

export async function addJiraWorklog(jira: JiraConfig, issueKey: string, worklogMinutes: number): Promise<boolean> {
  return addJiraWorklogWithComment(jira, issueKey, worklogMinutes, `Cloture depuis Support Assistant (${worklogMinutes} min).`)
}

function scoreCloseTransition(transition: NonNullable<JiraTransitionsResponse['transitions']>[number]): number {
  const name = transition.name?.trim().toLowerCase() || ''
  const toName = transition.to?.name?.trim().toLowerCase() || ''
  const statusCategoryKey = transition.to?.statusCategory?.key?.trim().toLowerCase() || ''
  const statusCategoryName = transition.to?.statusCategory?.name?.trim().toLowerCase() || ''
  let score = 0
  if (transition.to?.statusCategory?.id === 9 || statusCategoryKey === 'done' || statusCategoryName.includes('done')) score += 100
  if (name.includes('clot') || toName.includes('clot')) score += 50
  if (name.includes('close') || toName.includes('close')) score += 45
  if (name.includes('resolu') || toName.includes('resolu') || name.includes('resol') || toName.includes('resol')) score += 40
  if (name.includes('done') || toName.includes('done')) score += 35
  if (name.includes('termin') || toName.includes('termin')) score += 30
  return score
}

function scoreInProgressTransition(transition: NonNullable<JiraTransitionsResponse['transitions']>[number]): number {
  const name = transition.name?.trim().toLowerCase() || ''
  const toName = transition.to?.name?.trim().toLowerCase() || ''
  const statusCategoryKey = transition.to?.statusCategory?.key?.trim().toLowerCase() || ''
  const statusCategoryName = transition.to?.statusCategory?.name?.trim().toLowerCase() || ''
  let score = 0
  if (transition.to?.statusCategory?.id === 4 || statusCategoryKey === 'indeterminate' || statusCategoryName.includes('progress')) score += 100
  if (name.includes('in progress') || toName.includes('in progress')) score += 60
  if (name.includes('en cours') || toName.includes('en cours')) score += 55
  if (name.includes('start progress') || toName.includes('start progress')) score += 50
  if (name.includes('progress') || toName.includes('progress')) score += 40
  if (name.includes('ongoing') || toName.includes('ongoing')) score += 30
  return score
}

export async function closeJiraIssue(jira: JiraConfig, issueKey: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const transitionsResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  const transitionsText = await transitionsResponse.text()
  if (!transitionsResponse.ok) throw new Error(`Lecture transitions Jira echouee (${transitionsResponse.status}): ${transitionsText}`)
  const parsed = JSON.parse(transitionsText) as JiraTransitionsResponse
  const transitions = Array.isArray(parsed.transitions) ? parsed.transitions : []
  const bestTransition = transitions
    .filter((t) => t.id?.trim())
    .sort((l, r) => scoreCloseTransition(r) - scoreCloseTransition(l))[0]
  if (!bestTransition?.id || scoreCloseTransition(bestTransition) <= 0) {
    throw new Error(`Aucune transition de cloture exploitable trouvee pour ${issueKey}.`)
  }
  const transitionResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: bestTransition.id } }),
  })
  if (!transitionResponse.ok) {
    const body = await transitionResponse.text()
    throw new Error(`Transition Jira de cloture echouee (${transitionResponse.status}): ${body}`)
  }
}

async function moveJiraIssueToInProgress(jira: JiraConfig, issueKey: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const transitionsResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  const transitionsText = await transitionsResponse.text()
  if (!transitionsResponse.ok) throw new Error(`Lecture transitions Jira echouee (${transitionsResponse.status}): ${transitionsText}`)
  const parsed = JSON.parse(transitionsText) as JiraTransitionsResponse
  const transitions = Array.isArray(parsed.transitions) ? parsed.transitions : []
  const bestTransition = transitions
    .filter((t) => t.id?.trim())
    .sort((l, r) => scoreInProgressTransition(r) - scoreInProgressTransition(l))[0]
  if (!bestTransition?.id || scoreInProgressTransition(bestTransition) <= 0) {
    throw new Error(`Aucune transition "In Progress" exploitable trouvee pour ${issueKey}.`)
  }
  const transitionResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: bestTransition.id } }),
  })
  if (!transitionResponse.ok) {
    const body = await transitionResponse.text()
    throw new Error(`Transition Jira vers In Progress echouee (${transitionResponse.status}): ${body}`)
  }
}

// ---------------------------------------------------------------------------
// Attachment upload
// ---------------------------------------------------------------------------

export async function uploadJiraAttachments(
  jira: JiraConfig,
  issueKey: string,
  attachments: UploadableAttachment[],
): Promise<{ uploaded: number; errors: string[]; uploadedItems: JiraUploadedAttachment[] }> {
  if (attachments.length === 0) return { uploaded: 0, errors: [], uploadedItems: [] }
  const { baseUrl, auth } = buildJiraAuth(jira)
  let uploaded = 0
  const errors: string[] = []
  const uploadedItems: JiraUploadedAttachment[] = []
  for (const attachment of attachments) {
    const formData = new FormData()
    formData.append('file', new Blob([attachment.bytes], { type: attachment.contentType || 'application/octet-stream' }), attachment.filename)
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: formData,
    })
    if (!response.ok) {
      const body = await response.text()
      errors.push(`Upload echoue ${attachment.filename}: ${response.status} ${body}`)
      continue
    }
    try {
      const payload = (await response.json()) as Array<{ id?: string; filename?: string; mimeType?: string }>
      const first = Array.isArray(payload) ? payload[0] : undefined
      const id = first?.id?.trim()
      if (id) {
        uploadedItems.push({
          id,
          filename: first?.filename?.trim() || attachment.filename,
          mimeType: first?.mimeType?.trim() || attachment.contentType,
          sourceKey: attachment.sourceKey,
          sourceKind: attachment.sourceKind,
          contentId: attachment.contentId,
        })
      }
    } catch {
      // keep count even when Jira response body cannot be parsed
    }
    uploaded += 1
  }
  return { uploaded, errors, uploadedItems }
}

// ---------------------------------------------------------------------------
// Media Services UUID resolution (for embedding attachments inline in ADF)
// ---------------------------------------------------------------------------

function extractMediaUuid(url: string): string | null {
  // Match the Media Services UUID segment (e.g. .../file/<uuid>/binary). The
  // trailing boundary prevents capturing a 36-char prefix of a longer token.
  const match = url.match(/\/file\/([0-9a-fA-F-]{36})(?![0-9a-fA-F-])/)
  return match ? match[1] : null
}

// A Jira attachment cannot be embedded in ADF by its attachment id: the media
// node requires the underlying Media Services UUID. Fetching the attachment
// content redirects to the media file URL, from which the UUID is extracted.
// Returns null if it cannot be resolved (the image then stays a regular
// attachment instead of being embedded).
export async function resolveMediaIdForAttachment(jira: JiraConfig, attachmentId: string): Promise<string | null> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = `${baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`
  const headers = { Authorization: `Basic ${auth}` }
  // Preferred path: read the redirect Location without following it.
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'manual' })
    const location = response.headers.get('location')
    const fromLocation = location ? extractMediaUuid(location) : null
    try { await response.body?.cancel() } catch { /* nothing to drain */ }
    if (fromLocation) return fromLocation
  } catch {
    // fall through to the follow-redirect fallback
  }
  // Fallback: follow the redirect and read the resolved media URL. Covers
  // runtimes/proxies that drop the Location header or ignore redirect:'manual'.
  // The body is cancelled so the image bytes are not downloaded.
  try {
    const response = await fetch(url, { method: 'GET', headers })
    const fromUrl = response.url ? extractMediaUuid(response.url) : null
    try { await response.body?.cancel() } catch { /* avoid downloading the bytes */ }
    return fromUrl
  } catch {
    return null
  }
}

// Runs an async mapper over items with a bounded number of in-flight calls, so a
// screenshot-heavy email does not fire dozens of simultaneous Jira requests
// (which can trip rate limiting and leave images un-embedded).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Jira issue creation
// ---------------------------------------------------------------------------

export async function createJiraIssue(
  input: JiraCreateInput,
  sourceEmail?: JiraAnalyzeInput,
): Promise<{ key: string; url: string; attachmentReport: { found: number; uploaded: number; skipped: number; errors: string[] } }> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const { baseUrl, auth } = buildJiraAuth(jira)
  const summary = input.summary?.trim()
  const projectKey = input.projectKey?.trim().toUpperCase() || DEFAULT_PROJECT_KEY
  const issueTypeName = input.issueType
  const issueTypeMeta = ISSUE_TYPES[issueTypeName]
  if (!summary || !issueTypeMeta) throw new Error('Issue type et summary sont obligatoires.')

  const baseDescription = input.description?.trim() || ''
  const accountId = await getCurrentJiraUserAccountId(jira)
  const fields: Record<string, unknown> = {
    project: projectKey === DEFAULT_PROJECT_KEY ? { id: DEFAULT_PROJECT_ID } : { key: projectKey },
    summary,
    issuetype: { id: issueTypeMeta.id },
    reporter: { id: accountId },
    assignee: { id: accountId },
    description: buildAdfFromText(baseDescription),
    customfield_11500: input.client ? [{ value: input.client }] : [],
  }

  if (issueTypeMeta.subtypeFieldId) {
    const option = (SUBTYPE_OPTIONS[issueTypeName] as ReadonlyArray<{ value: string; id: string }>).find(
      (entry) => entry.value === input.subtypeValue,
    )
    if (!option) throw new Error(`Valeur de sous-type invalide pour ${issueTypeName}.`)
    fields[issueTypeMeta.subtypeFieldId] = { id: option.id }
  }

  const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const bodyText = await response.text()
  if (!response.ok) throw new Error(`Creation Jira a echoue: ${response.status} ${bodyText}`)

  const parsed = JSON.parse(bodyText) as JiraCreateResponse
  const key = parsed.key?.trim()
  if (!key) throw new Error('Reponse Jira invalide: cle ticket absente.')

  await moveJiraIssueToInProgress(jira, key)
  await addJiraWorklogWithComment(jira, key, 5, 'Demarrage ticket depuis Support Assistant (5 min).')

  let attachmentReport = { found: 0, uploaded: 0, skipped: 0, errors: [] as string[] }
  const descriptionRenderMode: DescriptionRenderMode = input.descriptionRenderMode === 'email-html' ? 'email-html' : 'plain-text'

  if (sourceEmail) {
    try {
      const microsoftToken = await ensureMicrosoftAccessToken()
      const threadMessages = await listThreadMessages(sourceEmail, microsoftToken)
      const firstMessage = threadMessages[0]
      const selectedAttachmentKeys = (() => {
        if (!Array.isArray(input.attachmentCandidates)) return undefined
        const keys = new Set(
          (input.attachmentCandidates as AttachmentCandidate[])
            .filter((c) => Boolean(c?.selected))
            .map((c) => c?.key)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        )
        return keys.size > 0 ? keys : undefined
      })()
      // Inline body images are collected only from the original email; real file
      // attachments are collected across the whole thread.
      const { attachments, report } = await collectThreadAttachments(
        threadMessages,
        microsoftToken,
        selectedAttachmentKeys,
        firstMessage?.id,
      )
      const upload = await uploadJiraAttachments(jira, key, attachments)
      const embedErrors: string[] = []

      // Build the CID -> embeddable-image map. The ADF media node id must be the
      // Media Services UUID (NOT the Jira attachment id), resolved per attachment.
      const inlineUploads = upload.uploadedItems.filter(
        (item) => item.sourceKind === 'inline-image' && item.contentId && item.id,
      )
      const bytesBySourceKey = new Map<string, Buffer>()
      for (const a of attachments) {
        if (a.sourceKey) bytesBySourceKey.set(a.sourceKey, a.bytes)
      }
      const resolvedMediaIds = await mapWithConcurrency(
        inlineUploads,
        4,
        (item) => resolveMediaIdForAttachment(jira, item.id),
      )
      const cidToTarget = new Map<string, EmbeddedImageTarget>()
      const inlineTargetsList: EmbeddedImageTarget[] = []
      for (let i = 0; i < inlineUploads.length; i += 1) {
        const item = inlineUploads[i]
        const mediaId = resolvedMediaIds[i]
        if (!mediaId) {
          embedErrors.push(`Image non intégrée à la description (média Jira non résolu): ${item.filename}`)
          continue
        }
        const bytes = item.sourceKey ? bytesBySourceKey.get(item.sourceKey) : undefined
        const dimensions = bytes ? getImageDimensions(bytes) : null
        const target: EmbeddedImageTarget = {
          id: mediaId,
          alt: item.filename?.trim() || 'image',
          width: dimensions?.width,
          height: dimensions?.height,
        }
        inlineTargetsList.push(target)
        const primaryCid = normalizeContentId(item.contentId)
        if (primaryCid) cidToTarget.set(primaryCid, target)
        const nameCid = normalizeContentId(item.filename)
        if (nameCid && !cidToTarget.has(nameCid)) cidToTarget.set(nameCid, target)
      }

      // Render the description from the original email body. uniqueBody excludes
      // the quoted reply history; sliceHtmlBeforeSignature drops the signature.
      // Inline body images are embedded in place by CID.
      const descriptionHtmlSource =
        firstMessage?.uniqueBody?.content?.trim() || firstMessage?.body?.content?.trim() || ''
      const bodyHtml = sliceHtmlBeforeSignature(descriptionHtmlSource)

      let descriptionAdf: Record<string, unknown> | null = null
      if (descriptionRenderMode === 'email-html' && bodyHtml) {
        descriptionAdf = buildAdfFromEmailHtml(bodyHtml, cidToTarget, baseDescription)
      }
      if (!descriptionAdf && inlineTargetsList.length > 0) {
        // Plain-text description (user edited it): keep their text, append images.
        descriptionAdf = buildAdfWithEmbeddedImages(baseDescription, inlineTargetsList)
      }

      if (descriptionAdf) {
        try {
          await updateJiraDescription(jira, key, descriptionAdf)
        } catch (embedError) {
          const embedMessage = embedError instanceof Error ? embedError.message : String(embedError)
          embedErrors.push(`Description Jira non mise à jour avec le rendu email: ${embedMessage}`)
        }
      }

      attachmentReport = {
        found: report.found,
        skipped: report.skipped + Math.max(0, attachments.length - upload.uploaded),
        uploaded: upload.uploaded,
        errors: [...report.errors, ...upload.errors, ...embedErrors],
      }
    } catch (attachmentError) {
      const message = attachmentError instanceof Error ? attachmentError.message : String(attachmentError)
      attachmentReport.errors.push(message)
      console.warn(`[JiraYah] Upload pieces jointes ignore: ${message}`)
    }
  }

  return { key, url: `${baseUrl}/browse/${key}`, attachmentReport }
}

// ---------------------------------------------------------------------------
// Jira issue existence check + thread map management
// ---------------------------------------------------------------------------

async function jiraIssueExists(jira: JiraConfig, issueKey: string): Promise<boolean | 'unknown'> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const jiraEmail = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !jiraEmail || !apiToken) return 'unknown'
  const auth = Buffer.from(`${jiraEmail}:${apiToken}`, 'utf-8').toString('base64')
  try {
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=key`, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    if (response.status === 404) return false
    if (!response.ok) return 'unknown'
    return true
  } catch { return 'unknown' }
}

async function removeInvalidatedTreatments(invalidatedThreadIds: string[]): Promise<void> {
  if (invalidatedThreadIds.length === 0) return
  const store = await readTreatmentsStore()
  let changed = false
  for (const threadId of invalidatedThreadIds) {
    if (Object.prototype.hasOwnProperty.call(store, threadId)) {
      delete store[threadId]
      changed = true
    }
  }
  if (changed) await writeTreatmentsStore(store)
}

export async function attachJiraKeys(emails: GraphEmail[]): Promise<{ emails: GraphEmail[]; invalidatedThreadIds: string[] }> {
  const threadMap = await readThreadJiraMap()
  let jiraConfig: JiraConfig = {}
  try { jiraConfig = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE) } catch { jiraConfig = {} }
  const baseUrl = jiraConfig.base_url?.trim().replace(/\/$/, '')
  const knownKeys = Array.from(new Set(Object.values(threadMap).map((v) => v?.trim()).filter(Boolean)))
  const keyStatus = new Map<string, boolean | 'unknown'>()
  await Promise.all(knownKeys.map(async (key) => { keyStatus.set(key, await jiraIssueExists(jiraConfig, key)) }))

  const invalidatedThreadIds: string[] = []
  let mapChanged = false
  for (const [threadId, jiraKey] of Object.entries(threadMap)) {
    const status = keyStatus.get(jiraKey) ?? 'unknown'
    if (status === false) {
      delete threadMap[threadId]
      invalidatedThreadIds.push(threadId)
      mapChanged = true
    }
  }

  if (mapChanged) {
    await writeThreadJiraMap(threadMap)
    await removeInvalidatedTreatments(invalidatedThreadIds)
  }

  return {
    invalidatedThreadIds,
    emails: emails.map((email) => {
      const threadId = (email.conversationId || email.id || '').trim()
      const jiraKey = threadId ? threadMap[threadId] ?? null : null
      return { ...email, jiraKey, jiraUrl: jiraKey && baseUrl ? `${baseUrl}/browse/${jiraKey}` : null }
    }),
  }
}

// ---------------------------------------------------------------------------
// Jira match scoring
// ---------------------------------------------------------------------------

function computeJiraMatchScore(
  email: GraphEmail,
  issue: JiraIssueMatch,
  descriptionText: string,
): { score: number; reason: string; hasStrongTitleSignal: boolean } {
  const title = stripReplyPrefixes(email.subject?.trim() || '')
  const senderName = email.from?.emailAddress?.name?.trim() || email.from?.emailAddress?.address?.trim() || ''
  const titleTokens = extractTitleTokensForJiraMatch(title)
  const senderTokens = tokenizeForMatch(senderName, 4)
  const titleNorm = normalizeForMatch(title).replace(/\s+/g, ' ').trim()
  const summaryNorm = normalizeForMatch(issue.summary)
  const descriptionNorm = normalizeForMatch(descriptionText)
  const searchableText = `${summaryNorm} ${descriptionNorm}`.trim()
  const reasonParts: string[] = []
  let score = 0
  let hasStrongTitleSignal = false

  if (titleNorm && summaryNorm && titleNorm === summaryNorm) {
    score += 45; hasStrongTitleSignal = true; reasonParts.push('titre: exact')
  }

  const matchedTitleTokens = titleTokens.filter((t) => summaryNorm.includes(t))
  if (matchedTitleTokens.length > 0) {
    score += Math.min(55, matchedTitleTokens.length * 18)
    reasonParts.push(`titre: ${matchedTitleTokens.join(', ')}`)
    if (matchedTitleTokens.some((t) => /^\d+$/.test(t) || t.length >= 5)) hasStrongTitleSignal = true
  }

  const createdDate = Date.parse(issue.created)
  const emailDate = Date.parse(email.receivedDateTime ?? '')
  if (Number.isFinite(createdDate) && Number.isFinite(emailDate)) {
    const dayDiff = Math.abs(createdDate - emailDate) / (1000 * 60 * 60 * 24)
    if (dayDiff <= 2) { score += 30; reasonParts.push('date: tres proche') }
    else if (dayDiff <= 7) { score += 18; reasonParts.push('date: proche') }
    else if (dayDiff <= 21) { score += 8; reasonParts.push('date: compatible') }
  }

  const senderMatched = senderTokens.filter((t) => searchableText.includes(t))
  if (senderMatched.length > 0) {
    score += Math.min(20, senderMatched.length * 10)
    reasonParts.push(`expediteur: ${senderMatched.join(', ')}`)
  }

  return { score, reason: reasonParts.join(' | ') || 'match faible', hasStrongTitleSignal }
}

async function searchJiraMatchesForEmail(email: GraphEmail, jira: JiraConfig): Promise<JiraIssueMatch[]> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const jiraEmail = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !jiraEmail || !apiToken) return []
  const auth = Buffer.from(`${jiraEmail}:${apiToken}`, 'utf-8').toString('base64')
  const title = stripReplyPrefixes(email.subject?.trim() || '')
  const strictEmailTitle = normalizeStrictTitle(title)
  if (!strictEmailTitle) return []

  const exactTitleForJql = escapeJqlText(title.trim())
  const jql = [`project = ${DEFAULT_PROJECT_KEY}`, `summary ~ "\\\"${exactTitleForJql}\\\""`].join(' AND ')
  const url = new URL(`${baseUrl}/rest/api/3/search/jql`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', '30')
  url.searchParams.set('fields', 'summary,created,description')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) return []

  const parsed = (await response.json()) as JiraSearchResponse
  const issues = Array.isArray(parsed.issues) ? parsed.issues : []

  type JiraIssueMatchCandidate = JiraIssueMatch & { hasStrongTitleSignal: boolean; descriptionText: string }

  const exactTitleMatches = issues
    .map((issue) => {
      const key = issue.key?.trim() || ''
      const summary = issue.fields?.summary?.trim() || ''
      const created = issue.fields?.created?.trim() || ''
      if (!key || !summary || !created) return null
      const descriptionText = adfNodeToText(issue.fields?.description)
      const match: JiraIssueMatch = { key, url: `${baseUrl}/browse/${key}`, summary, created, score: 0, reason: '' }
      const scored = computeJiraMatchScore(email, match, descriptionText)
      return { ...match, score: scored.score, reason: scored.reason, hasStrongTitleSignal: scored.hasStrongTitleSignal, descriptionText }
    })
    .filter((m): m is JiraIssueMatchCandidate => Boolean(m))
    .filter((m) => normalizeStrictTitle(m.summary) === strictEmailTitle)
    .sort((a, b) => b.score - a.score || Date.parse(b.created) - Date.parse(a.created))

  if (exactTitleMatches.length <= 1) {
    return exactTitleMatches
      .map((m) => ({ ...m, score: Math.max(m.score, 100), reason: 'titre: exact (regle absolue)' }))
      .slice(0, 3)
      .map(({ hasStrongTitleSignal: _, descriptionText: __, ...m }) => m)
  }

  const emailBodyRaw = email.uniqueBody?.content?.trim() || email.body?.content?.trim() || ''
  const emailBodyText = cutAtSignatureAndQuote(stripHtml(emailBodyRaw))
  if (!emailBodyText) {
    return exactTitleMatches
      .map((m) => ({ ...m, score: Math.max(m.score, 100), reason: 'titre: exact | description email indisponible' }))
      .slice(0, 3)
      .map(({ hasStrongTitleSignal: _, descriptionText: __, ...m }) => m)
  }

  const disambiguated = exactTitleMatches
    .map((m) => {
      const similarity = scoreDescriptionSimilarity(emailBodyText, m.descriptionText)
      return {
        ...m,
        contentOverlapCount: similarity.commonTokens.length,
        score: 100 + similarity.score,
        reason: similarity.commonTokens.length > 0
          ? `titre: exact | description: ${similarity.commonTokens.length} token(s) commun(s)`
          : 'titre: exact | description: aucun recouvrement clair',
      }
    })
    .filter((m) => m.contentOverlapCount >= 2)
    .sort((a, b) => b.score - a.score || Date.parse(b.created) - Date.parse(a.created))
    .slice(0, 3)
    .map(({ hasStrongTitleSignal: _, descriptionText: __, contentOverlapCount: ___, ...m }) => m)

  if (disambiguated.length > 0) return disambiguated

  return exactTitleMatches
    .map((m) => ({ ...m, score: Math.max(m.score, 100), reason: 'titre: exact | description non discriminante' }))
    .slice(0, 3)
    .map(({ hasStrongTitleSignal: _, descriptionText: __, ...m }) => m)
}

export async function attachJiraCandidates(emails: GraphEmail[]): Promise<GraphEmail[]> {
  let jiraConfig: JiraConfig = {}
  try { jiraConfig = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE) } catch { return emails }

  const threadEmails = new Map<string, { latest: GraphEmail; oldest: GraphEmail }>()
  for (const email of emails) {
    const threadId = (email.conversationId || email.id || '').trim()
    if (!threadId || email.jiraKey) continue
    const existing = threadEmails.get(threadId)
    if (!existing) { threadEmails.set(threadId, { latest: email, oldest: email }); continue }
    const currentDate = email.receivedDateTime ? Date.parse(email.receivedDateTime) : 0
    const latestDate = existing.latest.receivedDateTime ? Date.parse(existing.latest.receivedDateTime) : 0
    const oldestDate = existing.oldest.receivedDateTime ? Date.parse(existing.oldest.receivedDateTime) : Number.MAX_SAFE_INTEGER
    if (currentDate >= latestDate) existing.latest = email
    if (currentDate <= oldestDate) existing.oldest = email
  }

  const matchesByThread = new Map<string, JiraIssueMatch[]>()
  for (const [threadId, aggregate] of threadEmails.entries()) {
    const probeEmail: GraphEmail = { ...aggregate.latest, from: aggregate.oldest.from, receivedDateTime: aggregate.oldest.receivedDateTime }
    matchesByThread.set(threadId, await searchJiraMatchesForEmail(probeEmail, jiraConfig))
  }

  return emails.map((email) => {
    if (email.jiraKey) return email
    const threadId = (email.conversationId || email.id || '').trim()
    return { ...email, jiraMatches: matchesByThread.get(threadId) ?? [] }
  })
}

// ---------------------------------------------------------------------------
// Jira comments + trace
// ---------------------------------------------------------------------------

export async function fetchJiraComments(jira: JiraConfig, jiraKey: string): Promise<JiraIssueComment[]> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const comments: JiraIssueComment[] = []
  let startAt = 0
  const maxResults = 100

  while (true) {
    const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}/comment`)
    url.searchParams.set('startAt', String(startAt))
    url.searchParams.set('maxResults', String(maxResults))
    url.searchParams.set('expand', 'properties')
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Lecture commentaires Jira impossible (${jiraKey}): ${response.status} ${body}`)
    }
    const parsed = (await response.json()) as JiraCommentsResponse & { total?: number; maxResults?: number; startAt?: number }
    const batch = Array.isArray(parsed.comments) ? parsed.comments : []
    comments.push(...batch)
    const total = Number(parsed.total ?? comments.length)
    if (comments.length >= total || batch.length === 0) break
    startAt += Number(parsed.maxResults ?? batch.length)
  }

  return comments
}

function getTraceMessageKey(message: GraphEmail): string {
  const internetId = (message.internetMessageId ?? '').trim().toLowerCase()
  if (internetId) return `internet:${internetId}`
  return `graph:${(message.id ?? '').trim()}`
}

function getCommentTraceMessageKey(comment: JiraIssueComment): string | null {
  const properties = Array.isArray(comment.properties) ? comment.properties : []
  const traceProp = properties.find((p) => (p.key ?? '').trim() === 'assistant.trace.messageKey')
  const value = traceProp?.value
  if (!value || typeof value !== 'object') return null
  const messageKey = typeof (value as { messageKey?: unknown }).messageKey === 'string'
    ? ((value as { messageKey: string }).messageKey || '').trim()
    : ''
  return messageKey || null
}

async function setJiraCommentTraceProperty(
  jira: JiraConfig,
  commentId: string,
  payload: { messageKey: string; messageId?: string; internetMessageId?: string; conversationId?: string; receivedDateTime?: string },
): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(
    `${baseUrl}/rest/api/3/comment/${encodeURIComponent(commentId)}/properties/assistant.trace.messageKey`,
    {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ecriture propriete commentaire Jira echouee (${response.status}): ${body}`)
  }
}

function toAdfCommentBody(sender: string, body: string, isMine: boolean): Record<string, unknown> {
  const senderColor = isMine ? '#0052CC' : '#36B37E'
  const senderNode: Record<string, unknown> = {
    type: 'text',
    text: `${sender} :`,
    marks: [{ type: 'textColor', attrs: { color: senderColor } }],
  }
  const lines = body.split(/\r?\n/)
  const content: Array<Record<string, unknown>> = [senderNode, { type: 'hardBreak' }]
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.length > 0) content.push({ type: 'text', text: line })
    if (index < lines.length - 1) content.push({ type: 'hardBreak' })
  }
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] }
}

async function addJiraComment(jira: JiraConfig, jiraKey: string, bodyAdf: Record<string, unknown>): Promise<string> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}/comment`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: bodyAdf }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ajout commentaire Jira echoue (${response.status}): ${body}`)
  }
  const created = (await response.json()) as { id?: string }
  const commentId = created.id?.trim()
  if (!commentId) throw new Error('Ajout commentaire Jira echoue: id commentaire introuvable.')
  return commentId
}

function getEmailSenderDisplay(message: GraphEmail): string {
  return message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu'
}

function buildTraceComment(message: GraphEmail, isMine: boolean): Record<string, unknown> {
  const sender = getEmailSenderDisplay(message)
  const rawBody = message.uniqueBody?.content?.trim() || message.body?.content?.trim() || ''
  const content = cutAtSignatureAndQuote(stripHtml(rawBody)).trim() || '(Contenu email introuvable)'
  return toAdfCommentBody(sender, content, isMine)
}

function isJePrendsEmail(message: GraphEmail): boolean {
  const body = cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')).trim()
  const normalized = normalizeForMatch(body)
  return normalized === 'je prends' || normalized === 'je le prends'
}

function isTraceableEmail(message: GraphEmail): boolean {
  if (isJePrendsEmail(message)) return false
  const sender = getEmailSenderDisplay(message)
  const subject = message.subject?.trim() || ''
  const body = cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')).trim()
  const norm = normalizeForMatch(`${subject}\n${body}`)
  if (!norm) return false
  if (norm.includes('reacted to your message') || normalizeForMatch(sender).includes('microsoft outlook')) return false
  return true
}

function isLastJiraCommentMatchingLastEmail(commentText: string, message: GraphEmail): boolean {
  const commentNorm = normalizeForMatch(commentText)
  if (!commentNorm) return false
  const senderHeader = normalizeForMatch(`${getEmailSenderDisplay(message)} :`)
  if (!commentNorm.includes(senderHeader)) return false
  const emailBody = cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || ''))
  const emailBodyNorm = normalizeForMatch(emailBody)
  if (!emailBodyNorm) return true
  const excerpt = emailBodyNorm.slice(0, 180).trim()
  if (excerpt.length >= 30 && commentNorm.includes(excerpt)) return true
  const tokens = tokenizeForMatch(emailBodyNorm, 4).slice(0, 14)
  if (tokens.length === 0) return false
  const matched = tokens.filter((t) => commentNorm.includes(t)).length
  return matched >= Math.max(4, Math.ceil(tokens.length * 0.45))
}

export async function traceRemainingEmailsInJira(input: JiraAnalyzeInput, jiraKey: string): Promise<JiraSimpleTraceResult> {
  const microsoftToken = await ensureMicrosoftAccessToken()
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const rawThread = await listThreadMessages(input, microsoftToken)
  const seenMessageIds = new Set<string>()
  const seenInternetIds = new Set<string>()
  const seenFingerprints = new Set<string>()

  const thread = rawThread.filter((message) => {
    const id = message.id?.trim()
    if (!id || seenMessageIds.has(id)) return false
    seenMessageIds.add(id)
    const internetId = (message.internetMessageId ?? '').trim().toLowerCase()
    if (internetId) {
      if (seenInternetIds.has(internetId)) return false
      seenInternetIds.add(internetId)
    }
    const sender = normalizeForMatch(getEmailSenderDisplay(message))
    const subject = normalizeForMatch(message.subject?.trim() || '')
    const body = normalizeForMatch(cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')).trim())
    const dt = message.receivedDateTime ? new Date(message.receivedDateTime).toISOString().slice(0, 16) : ''
    const fingerprint = `${sender}|${subject}|${body.slice(0, 220)}|${dt}`
    if (seenFingerprints.has(fingerprint)) return false
    seenFingerprints.add(fingerprint)
    return true
  })

  if (thread.length === 0) throw new Error('Thread email introuvable.')

  const meResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    method: 'GET',
    headers: { Authorization: `Bearer ${microsoftToken}`, Accept: 'application/json' },
  })
  let myAddress = ''
  if (meResponse.ok) {
    const meBody = (await meResponse.json()) as { mail?: string; userPrincipalName?: string }
    myAddress = (meBody.mail?.trim() || meBody.userPrincipalName?.trim() || '').toLowerCase()
  }

  const jiraComments = await fetchJiraComments(jira, jiraKey)
  const messagesByTraceKey = new Map<string, number>()
  for (let index = 0; index < thread.length; index += 1) {
    messagesByTraceKey.set(getTraceMessageKey(thread[index]), index)
  }

  let startIndex = 0
  let matchedEmailId: string | null = null

  if (jiraComments.length > 0) {
    const sortedComments = jiraComments.slice().sort((a, b) => Date.parse(a.created ?? '') - Date.parse(b.created ?? ''))
    let foundIndex = -1
    for (let commentIndex = sortedComments.length - 1; commentIndex >= 0; commentIndex -= 1) {
      const comment = sortedComments[commentIndex]
      const propKey = getCommentTraceMessageKey(comment)
      if (propKey) {
        const messageIndex = messagesByTraceKey.get(propKey)
        if (typeof messageIndex === 'number') {
          foundIndex = messageIndex
          matchedEmailId = thread[messageIndex].id ?? null
          break
        }
      }
      const commentText = adfNodeToText(comment.body).trim()
      if (!commentText) continue
      for (let index = thread.length - 1; index >= 0; index -= 1) {
        if (isLastJiraCommentMatchingLastEmail(commentText, thread[index])) {
          foundIndex = index
          matchedEmailId = thread[index].id ?? null
          break
        }
      }
      if (foundIndex >= 0) break
    }
    startIndex = foundIndex >= 0 ? foundIndex + 1 : 0
  }

  const effectiveStartIndex = Math.max(startIndex, 1) // never trace the first email (original)
  const tracedMessageKeys = new Set(
    jiraComments
      .map((c) => getCommentTraceMessageKey(c))
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  )
  const toTrace = thread
    .slice(effectiveStartIndex)
    .filter((m) => isTraceableEmail(m))
    .filter((m) => !tracedMessageKeys.has(getTraceMessageKey(m)))

  const subjects: string[] = []
  for (const message of toTrace) {
    const senderAddress = message.from?.emailAddress?.address?.trim().toLowerCase() || ''
    const isMine = Boolean(myAddress) && senderAddress === myAddress
    const commentId = await addJiraComment(jira, jiraKey, buildTraceComment(message, isMine))
    try {
      await setJiraCommentTraceProperty(jira, commentId, {
        messageKey: getTraceMessageKey(message),
        messageId: message.id,
        internetMessageId: message.internetMessageId,
        conversationId: message.conversationId,
        receivedDateTime: message.receivedDateTime,
      })
    } catch (error) {
      console.warn('Unable to persist trace marker on Jira comment', { jiraKey, commentId, error })
    }
    subjects.push(message.subject?.trim() || '(Sans sujet)')
  }

  // Upload file attachments missing from the Jira ticket.
  // Scans the ENTIRE thread (including the first/original email) so HAR files and other
  // attachments from the initial customer email are not skipped.
  // Inline attachments (signature images, logos) are excluded unconditionally via isInline.
  try {
    const { baseUrl, auth } = buildJiraAuth(jira)
    const issueResponse = await fetch(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=attachment`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
    )
    const existingFilenames = new Set<string>()
    if (issueResponse.ok) {
      const issueBody = (await issueResponse.json()) as { fields?: { attachment?: Array<{ filename?: string }> } }
      for (const att of issueBody.fields?.attachment ?? []) {
        const name = att.filename?.trim()
        if (name) existingFilenames.add(name.toLowerCase())
      }
    }

    const uploadables: UploadableAttachment[] = []
    const seenFilenames = new Set<string>()
    for (const message of thread) {
      if (!message.id || !message.hasAttachments) continue
      const refs = await fetchMessageAttachmentRefs(message.id, microsoftToken)
      const uniqueBodyCids = extractCidsFromUniqueBody(message)
      for (const ref of refs) {
        if (!ref.id || !ref.name?.trim()) continue
        const isInlineImage = Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')
        if (isInlineImage) {
          const cid = normalizeContentId(ref.contentId)
          const refName = normalizeContentId(ref.name)
          const inUniqueBody = (cid && uniqueBodyCids.has(cid)) || (refName && uniqueBodyCids.has(refName))
          if (!inUniqueBody) continue
        } else if (ref.isInline) {
          continue
        }
        const nameLower = ref.name.trim().toLowerCase()
        if (existingFilenames.has(nameLower)) continue
        if (seenFilenames.has(nameLower)) continue
        seenFilenames.add(nameLower)
        const full = await fetchFileAttachment(message.id, ref.id, microsoftToken)
        const bytes = full?.contentBytes
          ? Buffer.from(full.contentBytes, 'base64')
          : await fetchFileAttachmentBytesViaValue(message.id, ref.id, microsoftToken)
        if (!bytes || bytes.length === 0 || bytes.length > 20 * 1024 * 1024) continue
        uploadables.push({
          filename: ref.name.trim(),
          contentType: full?.contentType?.trim() || ref.contentType?.trim() || 'application/octet-stream',
          bytes,
        })
      }
    }
    if (uploadables.length > 0) {
      await uploadJiraAttachments(jira, jiraKey, uploadables)
    }
  } catch (attachmentError) {
    console.warn('[Trace] Upload pièces jointes ignoré:', { jiraKey, attachmentError })
  }

  return { jiraKey, added: toTrace.length, subjects, lastMatchedEmailId: matchedEmailId }
}

// ---------------------------------------------------------------------------
// Jira clients reference refresh
// ---------------------------------------------------------------------------

async function fetchClientNameOptionsLive(jira: JiraConfig): Promise<{ values: string[]; entries: JiraClientReferenceEntry[] }> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' }
  const values = new Set<string>()
  const entriesById = new Map<string, string>()

  const contextUrl = new URL(`${baseUrl}/rest/api/3/field/customfield_11500/context`)
  contextUrl.searchParams.set('startAt', '0')
  contextUrl.searchParams.set('maxResults', '50')
  const contextResponse = await fetch(contextUrl.toString(), { method: 'GET', headers })
  if (!contextResponse.ok) throw new Error(`Lecture contextes Client name impossible (${contextResponse.status})`)
  const contextBody = (await contextResponse.json()) as { values?: Array<{ id?: string }> }
  const contextIds = (contextBody.values ?? []).map((ctx) => ctx.id?.trim()).filter((id): id is string => Boolean(id))

  for (const contextId of contextIds) {
    let startAt = 0
    let done = false
    while (!done) {
      const optionUrl = new URL(`${baseUrl}/rest/api/3/field/customfield_11500/context/${contextId}/option`)
      optionUrl.searchParams.set('startAt', String(startAt))
      optionUrl.searchParams.set('maxResults', '100')
      const optionResponse = await fetch(optionUrl.toString(), { method: 'GET', headers })
      if (!optionResponse.ok) throw new Error(`Lecture options Client name impossible (${optionResponse.status})`)
      const optionBody = (await optionResponse.json()) as {
        values?: Array<{ id?: string; value?: string; disabled?: boolean }>
        isLast?: boolean
        maxResults?: number
      }
      for (const option of optionBody.values ?? []) {
        if (option.disabled) continue
        const value = option.value?.trim()
        if (value) {
          values.add(value)
          const optionId = option.id?.trim()
          if (optionId) entriesById.set(optionId, value)
        }
      }
      const pageSize = Number(optionBody.maxResults ?? 100)
      startAt += pageSize
      done = Boolean(optionBody.isLast)
    }
  }

  if (values.size > 0) {
    return {
      values: Array.from(values).sort((a, b) => a.localeCompare(b, 'fr')),
      entries: Array.from(entriesById.entries()).map(([id, value]) => ({ id, value })).sort((a, b) => a.value.localeCompare(b.value, 'fr')),
    }
  }

  const fallbackUrl = new URL(`${baseUrl}/rest/api/3/jql/autocompletedata/suggestions`)
  fallbackUrl.searchParams.set('fieldName', 'cf[11500]')
  fallbackUrl.searchParams.set('fieldValue', '')
  const fallbackResponse = await fetch(fallbackUrl.toString(), { method: 'GET', headers })
  if (!fallbackResponse.ok) return { values: [], entries: [] }
  const fallbackBody = (await fallbackResponse.json()) as JiraFieldSuggestionsResponse
  for (const result of fallbackBody.results ?? []) {
    const value = result.value?.trim() || result.displayName?.trim()
    if (value) values.add(value.replace(/^"+|"+$/g, '').trim())
  }
  return { values: Array.from(values).sort((a, b) => a.localeCompare(b, 'fr')), entries: [] }
}

export async function refreshJiraClientsReference(): Promise<JiraClientsRefreshStats> {
  const previousValues = await readJiraClientsReferenceValues()
  const previousEntries = await readJiraClientsReferenceEntries()
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const liveValues = await fetchClientNameOptionsLive(jira)
  const nextValues = filterClientNameOptions(liveValues.values)
  const nextEntries = filterClientNameEntries(liveValues.entries)
  await writeJiraClientsReferenceValues(nextValues, nextEntries)

  const addedNames: string[] = []
  const modifiedNames: string[] = []
  const removedNames: string[] = []

  if (previousEntries.length > 0 && nextEntries.length > 0) {
    const previousById = new Map(previousEntries.map((e) => [e.id, e.value]))
    const nextById = new Map(nextEntries.map((e) => [e.id, e.value]))
    for (const [id, nextValue] of nextById.entries()) {
      const previousValue = previousById.get(id)
      if (previousValue === undefined) addedNames.push(nextValue)
      else if (previousValue !== nextValue) modifiedNames.push(`${previousValue} -> ${nextValue}`)
    }
    for (const [id, previousValue] of previousById.entries()) {
      if (!nextById.has(id)) removedNames.push(previousValue)
    }
  } else {
    const previousSet = new Set(previousValues)
    const nextSet = new Set(nextValues)
    for (const v of nextSet) { if (!previousSet.has(v)) addedNames.push(v) }
    for (const v of previousSet) { if (!nextSet.has(v)) removedNames.push(v) }
  }

  return {
    added: addedNames.length,
    modified: modifiedNames.length,
    removed: removedNames.length,
    total: nextValues.length,
    addedNames,
    modifiedNames,
    removedNames,
  }
}

export async function closeTicketFromEmail(
  email: JiraAnalyzeInput,
  jiraKey: string,
  worklogMinutes: number,
): Promise<{ jiraKey: string; archivedCount: number; worklogAdded: boolean; worklogMinutes: number; warnings: string[] }> {
  const normalizedJiraKey = jiraKey.trim().toUpperCase()
  if (!normalizedJiraKey) {
    throw new Error('jiraKey manquant pour la clôture.')
  }

  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const microsoftToken = await ensureMicrosoftAccessToken()
  const threadMessages = await listThreadMessages(email, microsoftToken)
  if (threadMessages.length === 0) {
    throw new Error("Thread email introuvable pour l'archivage.")
  }

  const warnings: string[] = []

  // Jira operations: each is isolated so a failure doesn't block the Outlook cleanup.
  // Label removal comes before close because some Jira configs lock closed tickets.
  let worklogAdded = false
  try {
    worklogAdded = await addJiraWorklog(jira, normalizedJiraKey, worklogMinutes)
  } catch (err) {
    warnings.push(`Worklog non ajouté: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    await removeJiraLabel(jira, normalizedJiraKey, 'PRIS')
  } catch (err) {
    warnings.push(`Label PRIS non retiré du ticket Jira: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    await closeJiraIssue(jira, normalizedJiraKey)
  } catch (err) {
    warnings.push(`Ticket Jira non clôturé: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Outlook operations: always run regardless of Jira failures.
  await updateThreadMessagesCategories(threadMessages, microsoftToken, (categories) =>
    categories.filter((category) => category.trim().toLowerCase() !== 'pris'),
  )

  const archivedCount = await archiveThreadMessages(threadMessages, microsoftToken)

  return {
    jiraKey: normalizedJiraKey,
    archivedCount,
    worklogAdded,
    worklogMinutes,
    warnings,
  }
}
