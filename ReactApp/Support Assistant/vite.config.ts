import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

type CommandResult = {
  code: number
  stdout: string
  stderr: string
}
type MicrosoftLoginState = {
  stdout: string
  stderr: string
  code: number | null
  startedAt: string
  finishedAt: string | null
  isRunning: boolean
}

type GraphEmailAddress = {
  name?: string
  address?: string
}

type GraphEmailFrom = {
  emailAddress?: GraphEmailAddress
}

type GraphEmail = {
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

type EmailPreviewPayload = {
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

type GraphEmailList = {
  value?: GraphEmail[]
  '@odata.nextLink'?: string
}

type GraphMailFolder = {
  id?: string
}

type JiraConfig = {
  base_url?: string
  email?: string
  api_token?: string
}

type JiraAnalyzeInput = {
  id?: string
  messageId?: string
  conversationId?: string
  title?: string
  sender?: string
  jiraKey?: string | null
}

type IdentificationCategory = 'Assistance' | 'Question' | 'Intervention livraison' | 'Intervention administration'

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

type JiraCreateInput = JiraProposal & {
  sender?: string
  title?: string
}

type JiraCreateResponse = {
  key?: string
  attachmentReport?: {
    found: number
    uploaded: number
    skipped: number
    errors: string[]
  }
}

type OrochimaruTraceResponse = {
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

type JiraMyselfResponse = {
  accountId?: string
}

type JiraFieldSuggestionsResponse = {
  results?: Array<{
    value?: string
    displayName?: string
  }>
}

type JiraSearchResponse = {
  issues?: Array<{
    key?: string
    fields?: {
      summary?: string
      created?: string
      description?: Record<string, unknown> | null
    }
  }>
}

type JiraIssueComment = {
  id?: string
  created?: string
  body?: Record<string, unknown> | null
  properties?: Array<{
    key?: string
    value?: unknown
  }>
}

type JiraCommentsResponse = {
  comments?: JiraIssueComment[]
}

type JiraSimpleTraceResult = {
  jiraKey: string
  added: number
  subjects: string[]
  lastMatchedEmailId: string | null
}

type JiraTransitionsResponse = {
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

type GraphAttachment = {
  id?: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  contentId?: string
  '@odata.type'?: string
  contentBytes?: string
}

type GraphAttachmentList = {
  value?: GraphAttachment[]
}

type MimeInlineAttachment = {
  id: string
  name: string
  contentType: string
  contentId: string
  bytes: Buffer
}

type UploadableAttachment = {
  filename: string
  contentType: string
  bytes: Buffer
  sourceKey?: string
  sourceKind?: 'attachment' | 'inline-image'
}

type JiraUploadedAttachment = {
  id: string
  filename: string
  mimeType?: string
  sourceKey?: string
  sourceKind?: 'attachment' | 'inline-image'
}

type AttachmentCandidate = {
  key: string
  name: string
  extension: string
  sizeBytes: number
  selected: boolean
  kind: 'attachment' | 'inline-image'
}

type AttachmentCollectionReport = {
  found: number
  skipped: number
  errors: string[]
}

type EmbeddedImageTarget = {
  id: string
  alt?: string
  width?: number
  height?: number
}

const APP_DIR = fileURLToPath(new URL('.', import.meta.url))
const ASSISTANT_PRO_DIR = path.resolve(APP_DIR, '..', '..')
const M365_CONFIG_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'm365_config.json')
const M365_TOKEN_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'm365_token.json')
const JIRA_CONFIG_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'jira_config.json')
const JIRAYAH_THREAD_JIRA_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'jirayah_thread_jira_map.json')
const JIRAYAH_RULES_PATH = path.join(APP_DIR, 'skills', 'jirayah', 'references', 'jira-mail-rules.md')
const TSUNADE_SKILL_PATH = path.join(APP_DIR, 'skills', 'tsunade')
const JIRA_CLIENTS_REFERENCE_PATH = path.join(APP_DIR, 'data', 'jira-clients-reference.json')
const CLIENT_DEPLOYMENT_MAPPING_PATH = path.join(APP_DIR, 'data', 'client-deployment-jira-mapping-unique.csv')
const TREATMENTS_STORE_PATH = path.join(APP_DIR, 'data', 'treatments-progress.json')
const OROCHIMARU_SKILL_PATH = path.join(APP_DIR, 'skills', 'orochimaru')
const EXCLUDED_CLIENT_NAME_OPTIONS = new Set(['_IOBEYA_', '_IOBEYA_ (SALES)'])
const TRACE_EXEC_LOCKS = new Set<string>()

const CONNECTOR_COMMANDS = {
  jira: {
    command: './scripts/connectors.sh',
    args: ['login', 'jira'],
  },
  microsoft: {
    command: './scripts/connectors.sh',
    args: ['login', 'outlook'],
  },
} as const
let microsoftLoginState: MicrosoftLoginState | null = null

function appendBounded(current: string, chunk: string, maxChars = 24_000): string {
  const next = current + chunk
  if (next.length <= maxChars) {
    return next
  }
  return next.slice(next.length - maxChars)
}

function startMicrosoftLoginProcess(): MicrosoftLoginState {
  if (microsoftLoginState?.isRunning) {
    return microsoftLoginState
  }

  const { command, args } = CONNECTOR_COMMANDS.microsoft
  const child = spawn(command, args, {
    cwd: ASSISTANT_PRO_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  microsoftLoginState = {
    stdout: '',
    stderr: '',
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    isRunning: true,
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (!microsoftLoginState) {
      return
    }
    microsoftLoginState.stdout = appendBounded(microsoftLoginState.stdout, chunk.toString('utf-8'))
  })

  child.stderr.on('data', (chunk: Buffer) => {
    if (!microsoftLoginState) {
      return
    }
    microsoftLoginState.stderr = appendBounded(microsoftLoginState.stderr, chunk.toString('utf-8'))
  })

  child.on('error', (error) => {
    if (!microsoftLoginState) {
      return
    }
    microsoftLoginState.stderr = appendBounded(
      microsoftLoginState.stderr,
      `\nErreur lancement connexion Microsoft: ${error.message}\n`,
    )
    microsoftLoginState.code = 1
    microsoftLoginState.finishedAt = new Date().toISOString()
    microsoftLoginState.isRunning = false
  })

  child.on('close', (code) => {
    if (!microsoftLoginState) {
      return
    }
    microsoftLoginState.code = code ?? 1
    microsoftLoginState.finishedAt = new Date().toISOString()
    microsoftLoginState.isRunning = false
  })

  return microsoftLoginState
}

function runCommand(command: string, args: readonly string[], cwd: string, timeoutMs = 0): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) {
              return
            }
            timedOut = true
            stderr += `\nCommand timeout after ${timeoutMs}ms`
            child.kill('SIGTERM')
            setTimeout(() => {
              if (!settled) {
                child.kill('SIGKILL')
              }
            }, 1500)
          }, timeoutMs)
        : null

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (error) => {
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      reject(error)
    })

    child.on('close', (code) => {
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      const effectiveCode = timedOut ? 124 : (code ?? 1)
      resolve({
        code: effectiveCode,
        stdout,
        stderr,
      })
    })
  })
}

function buildCodexPrompt(userPrompt: string, useSubagents: boolean): string {
  if (!useSubagents) {
    return userPrompt
  }

  return [
    'Mode subagents activé.',
    'Tu dois utiliser de vrais subagents pour exécuter cette demande (spawn_agent / délégation réelle).',
    'Travaille avec un découpage clair, délègue les tâches non bloquantes, puis consolide le résultat final.',
    '',
    `Demande utilisateur: ${userPrompt}`,
  ].join('\n')
}

function runBinaryCommand(command: string, args: readonly string[], cwd?: string): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
      })
    })
  })
}

function sendJson(res: { setHeader: (n: string, v: string) => void; end: (body: string) => void; statusCode: number }, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''

    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf-8')
    })

    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }

      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        resolve(parsed)
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })

    req.on('error', reject)
  })
}

type M365Config = {
  client_id?: string
  tenant_id?: string
}

type M365Token = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  expires_in?: number
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

async function saveJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

type ThreadJiraMap = Record<string, string>
type TreatmentProgressStore = Record<string, unknown>
type JiraClientReferenceEntry = {
  id: string
  value: string
}
type JiraClientsReference = {
  updatedAt: string
  count: number
  values: string[]
  entries?: JiraClientReferenceEntry[]
}
type JiraClientsRefreshStats = {
  values: string[]
  added: number
  modified: number
  removed: number
  total: number
  addedNames: string[]
  modifiedNames: string[]
  removedNames: string[]
}

async function readThreadJiraMap(): Promise<ThreadJiraMap> {
  try {
    return await readJsonFile<ThreadJiraMap>(JIRAYAH_THREAD_JIRA_CACHE)
  } catch {
    return {}
  }
}

async function writeThreadJiraMap(next: ThreadJiraMap): Promise<void> {
  await saveJsonFile(JIRAYAH_THREAD_JIRA_CACHE, next)
}

async function readTreatmentsStore(): Promise<TreatmentProgressStore> {
  try {
    return await readJsonFile<TreatmentProgressStore>(TREATMENTS_STORE_PATH)
  } catch {
    return {}
  }
}

async function writeTreatmentsStore(next: TreatmentProgressStore): Promise<void> {
  await saveJsonFile(TREATMENTS_STORE_PATH, next)
}

async function readJiraClientsReferenceValues(): Promise<string[]> {
  try {
    const parsed = await readJsonFile<JiraClientsReference>(JIRA_CLIENTS_REFERENCE_PATH)
    const values = Array.isArray(parsed.values) ? parsed.values.filter((value) => typeof value === 'string') : []
    return filterClientNameOptions(values)
  } catch {
    return []
  }
}

async function readJiraClientsReferenceEntries(): Promise<JiraClientReferenceEntry[]> {
  try {
    const parsed = await readJsonFile<JiraClientsReference>(JIRA_CLIENTS_REFERENCE_PATH)
    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : []
    return filterClientNameEntries(rawEntries)
  } catch {
    return []
  }
}

async function writeJiraClientsReferenceValues(values: string[], entries: JiraClientReferenceEntry[] = []): Promise<void> {
  const normalized = filterClientNameOptions(values)
  const normalizedEntries = filterClientNameEntries(entries)
  const payload: JiraClientsReference = {
    updatedAt: new Date().toISOString(),
    count: normalized.length,
    values: normalized,
    entries: normalizedEntries,
  }
  await saveJsonFile(JIRA_CLIENTS_REFERENCE_PATH, payload)
}

function getThreadIdFromAnalyzeInput(input: JiraAnalyzeInput | undefined): string | null {
  if (!input) {
    return null
  }
  const conversationId = input.conversationId?.trim()
  if (conversationId) {
    return conversationId
  }
  const id = input.id?.trim()
  if (id) {
    return id
  }
  return null
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

const DEFAULT_PROJECT_KEY = 'SUPIOBEYA'
const DEFAULT_PROJECT_ID = '10200'

const ISSUE_TYPES = {
  Assistance: { id: '10161', subtypeFieldId: 'customfield_12413', subtypeFieldLabel: 'Type de déploiement' as const },
  Intervention: { id: '12', subtypeFieldId: 'customfield_11605', subtypeFieldLabel: "Type d'intervention" as const },
  Information: { id: '11', subtypeFieldId: 'customfield_11607', subtypeFieldLabel: "Type d'info" as const },
  Incident: { id: '10106', subtypeFieldId: null, subtypeFieldLabel: null },
} as const

const SUBTYPE_OPTIONS = {
  Assistance: [
    { value: 'Onsite', id: '15917' },
    { value: 'Online', id: '15918' },
    { value: 'Mutualisée (Team+, Team, Partners)', id: '15919' },
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

let clientDeploymentMapCache: Map<string, string> | null = null
const mimeInlineAttachmentCache = new Map<string, Map<string, MimeInlineAttachment>>()

function normalizeForMatch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function tokenizeForMatch(input: string, minLength = 3): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(input)
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= minLength),
    ),
  )
}

const GENERIC_JIRA_TITLE_TOKENS = new Set([
  'iobeya',
  'support',
  'ticket',
  'incident',
  'probleme',
  'issue',
  'bug',
  'demande',
  'question',
])

function extractTitleTokensForJiraMatch(title: string): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(title)
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => {
          if (!token) {
            return false
          }
          if (GENERIC_JIRA_TITLE_TOKENS.has(token)) {
            return false
          }
          if (/^\d+$/.test(token)) {
            return token.length >= 2
          }
          return token.length >= 4
        }),
    ),
  )
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
        .map((token) => token.trim())
        .filter((token) => {
          if (!token) {
            return false
          }
          if (/^\d+$/.test(token)) {
            return token.length >= 2
          }
          return token.length >= 4
        }),
    ),
  )
}

function scoreDescriptionSimilarity(emailText: string, jiraDescriptionText: string): { score: number; commonTokens: string[] } {
  const emailTokens = tokenizeForDescriptionDisambiguation(emailText)
  const jiraTokens = new Set(tokenizeForDescriptionDisambiguation(jiraDescriptionText))
  if (emailTokens.length === 0 || jiraTokens.size === 0) {
    return { score: 0, commonTokens: [] }
  }
  const commonTokens = emailTokens.filter((token) => jiraTokens.has(token))
  const ratio = commonTokens.length / Math.min(20, emailTokens.length)
  const score = Math.min(100, commonTokens.length * 12 + ratio * 40)
  return { score, commonTokens }
}

function adfNodeToText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }

  const record = node as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : ''
  const content = Array.isArray(record.content) ? record.content.map((child) => adfNodeToText(child)).join(' ') : ''
  return `${text} ${content}`.trim()
}

function normalizeClientKey(input: string): string {
  return normalizeForMatch(input).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isExcludedClientNameOption(input: string): boolean {
  return EXCLUDED_CLIENT_NAME_OPTIONS.has(input.trim())
}

function filterClientNameOptions(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0 && !isExcludedClientNameOption(value))),
  ).sort((a, b) => a.localeCompare(b, 'fr'))
}

function filterClientNameEntries(entries: JiraClientReferenceEntry[]): JiraClientReferenceEntry[] {
  const dedup = new Map<string, string>()
  for (const entry of entries) {
    const id = entry.id?.trim()
    const value = entry.value?.trim()
    if (!id || !value || isExcludedClientNameOption(value)) {
      continue
    }
    dedup.set(id, value)
  }
  return Array.from(dedup.entries())
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => a.value.localeCompare(b.value, 'fr'))
}

function isIobeyaSender(sender: string): boolean {
  const raw = sender.toLowerCase()
  const normalized = normalizeForMatch(sender)
  return /@[^>\s]*iobeya\./.test(raw) || /@iobeya\.com/.test(raw) || /\biobeya\b/.test(normalized)
}

function extractEmailDomains(input: string): string[] {
  const matches = input.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)
  const domains = new Set<string>()
  for (const match of matches) {
    const domain = (match[1] || '').toLowerCase().trim().replace(/^\.+|\.+$/g, '')
    if (domain) {
      domains.add(domain)
    }
  }
  return Array.from(domains)
}

function tokenizeDomain(domain: string): string[] {
  const parts = domain
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
  if (parts.length === 0) {
    return []
  }
  // On ignore le TLD (fr/com/...) ; les indices utiles sont surtout les labels métier.
  return parts.slice(0, -1)
}

function inferClientHintsFromSenders(clientOptions: string[], senders: string[]): string[] {
  const domainTokens = new Set<string>()
  for (const sender of senders) {
    if (isIobeyaSender(sender)) {
      continue
    }
    for (const domain of extractEmailDomains(sender)) {
      for (const token of tokenizeDomain(domain)) {
        if (token.length >= 3) {
          domainTokens.add(token)
        }
      }
    }
  }

  if (domainTokens.size === 0) {
    return []
  }

  const ranked = clientOptions
    .map((option) => {
      const optionTokens = normalizeClientKey(option).split(' ').filter(Boolean)
      let score = 0
      for (const token of domainTokens) {
        if (optionTokens.includes(token)) {
          score += 12
        } else if (normalizeClientKey(option).includes(token)) {
          score += 4
        }
      }
      return { option, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.localeCompare(b.option))

  return ranked.slice(0, 5).map((item) => item.option)
}

type RankedClientHint = { option: string; score: number }

function rankClientHintsFromContext(clientOptions: string[], contextText: string, senders: string[]): RankedClientHint[] {
  const normalizedContext = normalizeClientKey(contextText)
  const contextTokens = new Set(tokenizeForMatch(contextText, 3))
  const domainTokens = new Set<string>()

  for (const sender of senders) {
    if (isIobeyaSender(sender)) {
      continue
    }
    for (const domain of extractEmailDomains(sender)) {
      for (const token of tokenizeDomain(domain)) {
        if (token.length >= 3) {
          domainTokens.add(token)
        }
      }
    }
  }

  const ranked = clientOptions
    .map((option) => {
      const normalizedOption = normalizeClientKey(option)
      const optionTokens = new Set(normalizedOption.split(' ').filter((token) => token.length >= 3))
      let score = 0

      if (normalizedContext.includes(normalizedOption) && normalizedOption.length >= 4) {
        score += 40
      }

      for (const token of domainTokens) {
        if (optionTokens.has(token)) {
          score += 28
        } else if (normalizedOption.includes(token)) {
          score += 10
        }
      }

      for (const token of contextTokens) {
        if (optionTokens.has(token)) {
          score += 6
        } else if (normalizedOption.includes(token)) {
          score += 2
        }
      }

      return { option, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.localeCompare(b.option))

  return ranked.slice(0, 8)
}

function pickStrongHeuristicClient(ranked: RankedClientHint[]): string | null {
  if (ranked.length === 0) {
    return null
  }
  const top = ranked[0]
  const second = ranked[1]
  if (!second) {
    return top.score >= 24 ? top.option : null
  }
  const delta = top.score - second.score
  if (top.score >= 30 && delta >= 8) {
    return top.option
  }
  return null
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

async function readClientDeploymentMap(): Promise<Map<string, string>> {
  if (clientDeploymentMapCache) {
    return clientDeploymentMapCache
  }

  const map = new Map<string, string>()
  try {
    const raw = await readFile(CLIENT_DEPLOYMENT_MAPPING_PATH, 'utf-8')
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length <= 1) {
      clientDeploymentMapCache = map
      return map
    }

    const header = parseCsvLine(lines[0])
    const clientIdx = header.indexOf('jira_client_name')
    const deploymentIdx = header.indexOf('jira_deploiement_field')
    const conflictIdx = header.indexOf('is_conflict')
    if (clientIdx < 0 || deploymentIdx < 0) {
      clientDeploymentMapCache = map
      return map
    }

    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i])
      const clientName = cells[clientIdx]?.trim()
      const deployment = cells[deploymentIdx]?.trim()
      const conflict = conflictIdx >= 0 ? cells[conflictIdx]?.trim().toLowerCase() : 'no'
      if (!clientName || !deployment || conflict === 'yes') {
        continue
      }
      map.set(normalizeClientKey(clientName), deployment)
    }
  } catch {
    // Mapping file is optional; keep default behavior when absent.
  }

  clientDeploymentMapCache = map
  return map
}

async function inferDeploymentSubtype(client: string, clientCandidates: string[]): Promise<string | null> {
  const deploymentMap = await readClientDeploymentMap()
  if (deploymentMap.size === 0) {
    return null
  }

  const orderedNames = [client, ...clientCandidates]
  for (const name of orderedNames) {
    const key = normalizeClientKey(name || '')
    if (!key) {
      continue
    }
    const match = deploymentMap.get(key)
    if (match) {
      return match
    }
  }
  return null
}

function fileExtension(name: string): string {
  const trimmed = name.trim()
  const index = trimmed.lastIndexOf('.')
  if (index <= 0 || index === trimmed.length - 1) {
    return ''
  }
  return trimmed.slice(index + 1).toLowerCase()
}

function stripReplyPrefixes(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.replace(/^(?:(?:re|tr|fw|fwd)\s*:\s*)+/i, '').trim()
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeContentId(value: string | undefined): string {
  const base = (value || '')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim()

  const decoded = (() => {
    try {
      return decodeURIComponent(base)
    } catch {
      return base
    }
  })()

  return decoded.toLowerCase()
}

function isLikelyNoisyInlineImage(attachment: GraphAttachment): boolean {
  if (!attachment.isInline) {
    return false
  }

  const name = (attachment.name || '').trim().toLowerCase()
  const contentType = (attachment.contentType || '').trim().toLowerCase()
  const size = Number(attachment.size ?? 0)
  const noisePattern =
    /(logo|icon|banner|signature|footer|header|facebook|twitter|linkedin|instagram|youtube|spacer|pixel|tracker)/i

  if (!contentType.startsWith('image/')) {
    return true
  }
  if (size > 0 && size <= 5 * 1024) {
    return true
  }
  return noisePattern.test(name)
}

function sanitizeEmailHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\shref\s*=\s*(['"])\s*javascript:.*?\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*(['"])\s*javascript:.*?\1/gi, '')
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildEmailPreviewFallback(message: GraphEmail): string {
  const subject = escapeHtml(stripReplyPrefixes(message.subject?.trim() || '') || '(Sans objet)')
  const sender =
    escapeHtml(
      message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu',
    )
  const bodyText = escapeHtml(cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')) || '(Contenu email introuvable)')
  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#17324d} img{max-width:100%;height:auto}</style>',
    '</head><body>',
    `<h2>${subject}</h2>`,
    `<p><strong>Expéditeur:</strong> ${sender}</p>`,
    `<pre style="white-space:pre-wrap;font:inherit">${bodyText}</pre>`,
    '</body></html>',
  ].join('')
}

function stripHtml(input: string): string {
  const withBreaks = input
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')

  return withBreaks
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cutAtSignatureAndQuote(input: string): string {
  const lines = input.split('\n')
  const kept: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.trim()
    const normalized = normalizeForMatch(line)
    if (!normalized) {
      kept.push(rawLine)
      continue
    }
    if (/^(de|from|envoye)\s*:/.test(normalized)) {
      break
    }
    if (/^(-{2,}|_{2,})/.test(normalized) || /^message original/.test(normalized)) {
      break
    }
    if (/^(tel|telephone|mobile|mail|email|www|http|sent from my)/.test(normalized)) {
      break
    }

    if (i > 0 && /^\p{Lu}[\p{L}'’.-]{1,40}\s+\p{Lu}[\p{L}'’.-]{1,40}$/u.test(line)) {
      break
    }

    kept.push(rawLine)
  }

  return kept.join('\n').trim()
}

function buildAdfParagraphFromText(input: string): Record<string, unknown> {
  const lines = input
    .split('\n')
    .map((line) => line.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+$/g, ''))
  const paragraphContent: Array<Record<string, unknown>> = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.length > 0) {
      paragraphContent.push({ type: 'text', text: line })
    }
    if (i < lines.length - 1) {
      paragraphContent.push({ type: 'hardBreak' })
    }
  }
  if (paragraphContent.length === 0) {
    paragraphContent.push({ type: 'text', text: ' ' })
  }

  return {
    type: 'paragraph',
    content: paragraphContent,
  }
}

function buildAdfFromText(input: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [buildAdfParagraphFromText(input)],
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (match, value: string) => {
      const codePoint = Number.parseInt(value, 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, value: string) => {
      const codePoint = Number.parseInt(value, 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
}

function extractHtmlAttribute(input: string, attribute: string): string {
  const pattern = new RegExp(`${attribute}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = input.match(pattern)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }
    if (offset >= bytes.length) {
      break
    }

    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd8 || marker === 0xd9) {
      continue
    }
    if (marker === 0xda) {
      break
    }
    if (offset + 2 > bytes.length) {
      break
    }

    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && offset + 7 < bytes.length) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    offset += segmentLength
  }

  return null
}

function getImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width > 0 && height > 0) {
      return { width, height }
    }
  }

  if (bytes.length >= 10) {
    const gifHeader = bytes.toString('ascii', 0, 6)
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      const width = bytes.readUInt16LE(6)
      const height = bytes.readUInt16LE(8)
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }
  }

  return readJpegDimensions(bytes)
}

function normalizeEmbeddedImageDimensions(width?: number, height?: number): { width: number; height: number } {
  const fallbackWidth = 760
  const fallbackHeight = 480
  const safeWidth = Number.isFinite(width) && typeof width === 'number' && width > 0 ? width : fallbackWidth
  const safeHeight = Number.isFinite(height) && typeof height === 'number' && height > 0 ? height : fallbackHeight
  const clampedWidth = Math.max(1, Math.min(760, Math.round(safeWidth)))
  if (safeWidth === clampedWidth) {
    return { width: clampedWidth, height: Math.max(1, Math.round(safeHeight)) }
  }
  return {
    width: clampedWidth,
    height: Math.max(1, Math.round((safeHeight * clampedWidth) / safeWidth)),
  }
}

function createAdfMediaSingle(target: EmbeddedImageTarget): Record<string, unknown> {
  const dimensions = normalizeEmbeddedImageDimensions(target.width, target.height)
  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [
      {
        type: 'media',
        attrs: {
          type: 'file',
          id: target.id,
          collection: '',
          alt: target.alt,
          width: dimensions.width,
          height: dimensions.height,
        },
      },
    ],
  }
}

function buildAdfWithEmbeddedImages(input: string, imageTargets: EmbeddedImageTarget[]): Record<string, unknown> {
  const base = buildAdfFromText(input) as { type: string; version: number; content: Array<Record<string, unknown>> }
  const mediaBlocks = imageTargets.map((target) => createAdfMediaSingle(target))

  return {
    ...base,
    content: [...(Array.isArray(base.content) ? base.content : []), ...mediaBlocks],
  }
}

function buildAdfFromEmailHtml(
  inputHtml: string,
  imageTargetsBySrc: Map<string, EmbeddedImageTarget>,
  fallbackText: string,
): Record<string, unknown> {
  const imagePlaceholders: Array<{ src: string; alt: string }> = []

  let normalized = inputHtml
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
      const src = extractHtmlAttribute(attrs, 'src')
      const alt = decodeHtmlEntities(extractHtmlAttribute(attrs, 'alt'))
      if (!src) {
        return alt ? `\n${alt}\n` : '\n'
      }
      const index = imagePlaceholders.push({ src: src.trim(), alt: alt.trim() }) - 1
      return `\n[[INLINE_IMAGE_${index}]]\n`
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n────────\n')
    .replace(/<(?:\/)?(?:html|body|section|article|header|footer|aside|main)[^>]*>/gi, '\n')
    .replace(/<(?:\/)?(?:p|div|blockquote|pre|h[1-6])[^>]*>/gi, '\n')
    .replace(/<(?:ul|ol)[^>]*>/gi, '\n')
    .replace(/<\/\s*(?:ul|ol)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<table[^>]*>/gi, '\n')
    .replace(/<\/table>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, '')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')

  normalized = decodeHtmlEntities(normalized)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(?:\s*\|\s*){2,}/g, ' | ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const blocks: Array<Record<string, unknown>> = []
  const parts = normalized.split(/(\[\[INLINE_IMAGE_\d+\]\])/g)

  for (const part of parts) {
    const imageMatch = part.match(/^\[\[INLINE_IMAGE_(\d+)\]\]$/)
    if (imageMatch) {
      const index = Number.parseInt(imageMatch[1] || '', 10)
      const placeholder = Number.isFinite(index) ? imagePlaceholders[index] : undefined
      if (!placeholder) {
        continue
      }
      const target = imageTargetsBySrc.get(placeholder.src)
      if (target) {
        blocks.push(createAdfMediaSingle({ ...target, alt: target.alt || placeholder.alt }))
      } else if (placeholder.alt) {
        blocks.push(buildAdfParagraphFromText(placeholder.alt))
      }
      continue
    }

    const paragraphs = part
      .split(/\n{2,}/)
      .map((paragraph) =>
        paragraph
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join('\n'),
      )
      .filter((paragraph) => paragraph.length > 0)

    for (const paragraph of paragraphs) {
      blocks.push(buildAdfParagraphFromText(paragraph))
    }
  }

  if (blocks.length === 0) {
    return buildAdfFromText(fallbackText)
  }

  return {
    type: 'doc',
    version: 1,
    content: blocks,
  }
}

function inferProjectKey(existingJiraKey: string | null | undefined): string {
  if (!existingJiraKey) {
    return DEFAULT_PROJECT_KEY
  }
  const project = existingJiraKey.split('-')[0]?.trim().toUpperCase()
  return project || DEFAULT_PROJECT_KEY
}

type CodexClassification = {
  issueType?: string
  subtypeValue?: string | null
  client?: string
  clientCandidates?: string[]
  warnings?: string[]
  confidence?: number
}

type CodexIdentification = {
  identification?: string
  confidence?: number
  warnings?: string[]
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('Réponse Codex sans JSON exploitable.')
  }
  return raw.slice(start, end + 1)
}

function parseCodexJson<T>(raw: string): T | null {
  try {
    const jsonChunk = extractJsonObject(raw)
    return JSON.parse(jsonChunk) as T
  } catch {
    return null
  }
}

function orochimaruAsksToChooseJira(payload: OrochimaruTraceResponse | null): boolean {
  if (!payload) {
    return false
  }

  const bucket = [
    payload.summary ?? '',
    payload.question ?? '',
    payload.blocking_reason ?? '',
  ]
    .join('\n')
    .toLowerCase()

  if (!bucket.trim()) {
    return false
  }

  const patterns = [
    /quel\s+jira/,
    /quel\s+ticket/,
    /sur\s+quel\s+(jira|ticket)/,
    /(jira|ticket)\s+prendre/,
    /(jira|ticket)\s+utiliser/,
    /choix\s+du\s+(jira|ticket)/,
    /choisir[\s\S]{0,30}(jira|ticket)/,
    /(jira|ticket)[\s\S]{0,30}choisir/,
    /confirmer[\s\S]{0,30}(jira|ticket)/,
  ]

  return patterns.some((pattern) => pattern.test(bucket))
}

function sanitizeOrochimaruTraceAgainstJiraChoice(payload: OrochimaruTraceResponse, jiraKey: string): OrochimaruTraceResponse {
  const asksChoice = orochimaruAsksToChooseJira(payload)
  if (!asksChoice) {
    return payload
  }

  const forcedMessage = `Ticket Jira imposé par le traitement en cours: ${jiraKey}.`
  const cleanedQuestion = payload.question && /(jira|ticket)/i.test(payload.question) ? '' : payload.question

  return {
    ...payload,
    status: payload.status === 'error' ? 'error' : 'needs_validation',
    summary: payload.summary ? `${forcedMessage} ${payload.summary}` : forcedMessage,
    question: cleanedQuestion || 'Valider uniquement l’aperçu de traçage (le ticket Jira est déjà fixé).',
    blocking_reason: payload.blocking_reason && !/(jira|ticket)/i.test(payload.blocking_reason) ? payload.blocking_reason : '',
  }
}

function resolveClientOption(candidate: string | undefined, options: string[]): string {
  const trimmed = candidate?.trim() || ''
  if (!trimmed) {
    return 'TBD'
  }
  if (trimmed.toLowerCase() === 'tbd') {
    return 'TBD'
  }
  const exact = options.find((option) => option === trimmed)
  if (exact) {
    return exact
  }
  const normalized = normalizeForMatch(trimmed)
  const close = options.find((option) => normalizeForMatch(option) === normalized)
  if (close) {
    return close
  }
  return 'TBD'
}

function normalizeClientCandidates(candidates: string[] | undefined, options: string[]): string[] {
  const resolved: string[] = []
  for (const candidate of candidates ?? []) {
    const mapped = resolveClientOption(candidate, options)
    if (mapped && !resolved.includes(mapped)) {
      resolved.push(mapped)
    }
    if (resolved.length >= 3) {
      break
    }
  }
  return resolved
}

function shortlistClientOptions(
  options: string[],
  context: { subject: string; description: string; sender: string; otherSenders: string[]; preferredClients: string[] },
  maxCount = 120,
): string[] {
  if (options.length <= maxCount) {
    return options
  }

  const rawContext = `${context.subject}\n${context.sender}\n${context.otherSenders.join('\n')}\n${context.description.slice(0, 1800)}`
  const tokens = Array.from(
    new Set(
      normalizeClientKey(rawContext)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  )
  const preferred = new Set(context.preferredClients)

  const scored = options.map((option, index) => {
    const normalizedOption = normalizeClientKey(option)
    let score = 0
    if (preferred.has(option)) {
      score += 40
    }
    for (const token of tokens) {
      if (!token) {
        continue
      }
      if (normalizedOption === token) {
        score += 8
      } else if (normalizedOption.startsWith(`${token} `) || normalizedOption.endsWith(` ${token}`)) {
        score += 4
      } else if (normalizedOption.includes(token)) {
        score += 2
      }
    }
    return { option, score, index }
  })

  const withSignals = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
  if (withSignals.length >= maxCount) {
    return withSignals.slice(0, maxCount).map((item) => item.option)
  }

  const selected = new Set(withSignals.map((item) => item.option))
  const result = withSignals.map((item) => item.option)
  for (const option of options) {
    if (selected.has(option)) {
      continue
    }
    result.push(option)
    if (result.length >= maxCount) {
      break
    }
  }
  return result
}

async function classifyWithCodex(input: {
  subject: string
  description: string
  sender: string
  otherSenders: string[]
  senderIsIobeya: boolean
  clientOptions: string[]
}): Promise<{
  issueType: JiraProposal['issueType']
  subtypeValue: string | null
  client: string
  clientCandidates: string[]
  warnings: string[]
}> {
  const rules = await readFile(JIRAYAH_RULES_PATH, 'utf-8')
  const outputFile = path.join('/tmp', `jirayah-classify-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  const hintedClients = inferClientHintsFromSenders(input.clientOptions, [input.sender, ...input.otherSenders])
  const shortlistedClientOptions = shortlistClientOptions(input.clientOptions, {
    subject: input.subject,
    description: input.description,
    sender: input.sender,
    otherSenders: input.otherSenders,
    preferredClients: hintedClients,
  })
  const clientOptionsBlock =
    shortlistedClientOptions.length > 0
      ? shortlistedClientOptions.map((option) => `- ${option}`).join('\n')
      : '- (aucune option disponible)'
  const otherSendersBlock =
    input.otherSenders.length > 0 ? input.otherSenders.map((sender) => `- ${sender}`).join('\n') : '- (aucun)'
  const hintedClientsBlock =
    hintedClients.length > 0 ? hintedClients.map((client) => `- ${client}`).join('\n') : '- (aucun indice domaine exploitable)'

  const prompt = [
    'Tu es JiraYah. Classe un email support en appliquant strictement le référentiel.',
    'Tu dois raisonner avec les règles et renvoyer uniquement un JSON valide.',
    '',
    'REFERENTIEL:',
    rules,
    '',
    'DONNEES EMAIL:',
    `Sujet: ${input.subject}`,
    `Expéditeur: ${input.sender}`,
    `Expéditeur iObeya: ${input.senderIsIobeya ? 'oui' : 'non'}`,
    'Autres expéditeurs du thread:',
    otherSendersBlock,
    'Clients suggérés par les domaines expéditeurs non-iObeya (indice fort):',
    hintedClientsBlock,
    'Description (copie client):',
    input.description,
    '',
    'OPTIONS CLIENT NAME JIRA (choisir exactement une valeur de cette liste si possible):',
    clientOptionsBlock,
    '',
    'CONTRAINTES:',
    '- issueType doit être exactement: Assistance, Intervention, Information, Incident.',
    '- subtypeValue doit être null pour Incident, sinon une valeur valide pour le type choisi.',
    '- clientCandidates doit contenir exactement 3 propositions classées (plus probable en premier).',
    '- Déduire d abord depuis le contenu email (sujet + description). Ne pas privilégier le domaine expéditeur si le texte mentionne explicitement une société.',
    "- Règle prioritaire: si l'expéditeur principal est iObeya, ne pas utiliser cet expéditeur pour déduire le client. Chercher le client dans le contenu email et les autres expéditeurs non-iObeya.",
    '- Si un client plausible est trouvé via domaine expéditeur non-iObeya, le prioriser fortement.',
    '- client doit être la proposition #1 de clientCandidates.',
    '- client et chaque candidat doivent être une valeur de la liste fournie (shortlist Jira) si possible, sinon "TBD".',
    '- warnings est un tableau de chaînes court, vide si confiance forte.',
    '',
    'FORMAT DE SORTIE (JSON uniquement, sans markdown):',
    '{"issueType":"...","subtypeValue":"...|null","client":"...","clientCandidates":["...","...","..."],"warnings":["..."],"confidence":0.0}',
  ].join('\n')

  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', '-c', 'model_reasoning_effort="low"', '-o', outputFile, prompt],
    APP_DIR,
  )

  let raw = ''
  try {
    raw = (await readFile(outputFile, 'utf-8')).trim()
  } catch {
    raw = result.stdout.trim()
  } finally {
    void unlink(outputFile).catch(() => undefined)
  }

  if (result.code !== 0) {
    throw new Error(`Classification JiraYah via Codex a échoué: ${result.stderr || raw || 'erreur inconnue'}`)
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as CodexClassification
  const issueTypeRaw = (parsed.issueType || '').trim()
  if (!Object.prototype.hasOwnProperty.call(ISSUE_TYPES, issueTypeRaw)) {
    throw new Error(`Issue type invalide renvoyé par Codex: "${issueTypeRaw || 'vide'}"`)
  }
  const issueType = issueTypeRaw as JiraProposal['issueType']
  const subtypeOptions = SUBTYPE_OPTIONS[issueType].map((option) => option.value) as string[]
  let subtypeValue = parsed.subtypeValue ?? null
  if (issueType === 'Incident') {
    subtypeValue = null
  } else if (!subtypeValue || !subtypeOptions.includes(subtypeValue)) {
    throw new Error(`Sous-type invalide renvoyé par Codex pour ${issueType}.`)
  }

  let client = resolveClientOption(parsed.client, shortlistedClientOptions)
  if (client === 'TBD' && hintedClients.length > 0) {
    client = hintedClients[0]
  }
  const clientCandidates = normalizeClientCandidates(parsed.clientCandidates, shortlistedClientOptions)
  if (!clientCandidates.includes(client)) {
    clientCandidates.unshift(client)
  }
  while (clientCandidates.length < 3 && shortlistedClientOptions.length > 0) {
    const filler = shortlistedClientOptions.find((option) => !clientCandidates.includes(option))
    if (!filler) {
      break
    }
    clientCandidates.push(filler)
  }
  const boundedCandidates = clientCandidates.slice(0, 3)
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((value) => typeof value === 'string') : []
  if (typeof parsed.confidence === 'number' && parsed.confidence < 0.6) {
    warnings.push('Confiance faible: vérifier la classification avant création.')
  }

  return {
    issueType,
    subtypeValue,
    client,
    clientCandidates: boundedCandidates,
    warnings,
  }
}

async function identifyDemandWithCodex(input: {
  subject: string
  description: string
  sender: string
}): Promise<{ identification: IdentificationCategory; warnings: string[] }> {
  const outputFile = path.join('/tmp', `jirayah-identify-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  const prompt = [
    `Utilise le skill $tsunade situé à ce chemin: ${TSUNADE_SKILL_PATH}.`,
    'Tu es Tsunade, spécialiste de l’identification initiale des emails support.',
    'Objectif: identifier rapidement le type de demande d un email support.',
    'Répondre uniquement en JSON valide.',
    '',
    'Categories autorisées (exactes):',
    '- Assistance',
    '- Question',
    '- Intervention livraison',
    '- Intervention administration',
    '',
    'Sujet:',
    input.subject,
    '',
    'Expéditeur:',
    input.sender,
    '',
    'Description:',
    input.description,
    '',
    'Règles:',
    '- Intervention administration: action opérationnelle admin/run (création/modification utilisateur, salle, droits, paramètres).',
    '- Intervention livraison: livraison/renouvellement/ajustement de licence.',
    '- Question: simple demande d information.',
    '- Assistance: accompagnement/aide hors cas ci-dessus.',
    '',
    'Sortie JSON uniquement:',
    '{"identification":"Assistance|Question|Intervention livraison|Intervention administration","confidence":0.0,"warnings":["..."]}',
  ].join('\n')

  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, prompt],
    APP_DIR,
  )

  let raw = ''
  try {
    raw = (await readFile(outputFile, 'utf-8')).trim()
  } catch {
    raw = result.stdout.trim()
  } finally {
    void unlink(outputFile).catch(() => undefined)
  }

  if (result.code !== 0) {
    throw new Error(`Identification main agent a échoué: ${result.stderr || raw || 'erreur inconnue'}`)
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as CodexIdentification
  const identification = (parsed.identification || '').trim() as IdentificationCategory
  const allowed: IdentificationCategory[] = [
    'Assistance',
    'Question',
    'Intervention livraison',
    'Intervention administration',
  ]
  if (!allowed.includes(identification)) {
    throw new Error(`Identification invalide renvoyée: "${parsed.identification || 'vide'}"`)
  }

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((value) => typeof value === 'string') : []
  if (typeof parsed.confidence === 'number' && parsed.confidence < 0.6) {
    warnings.push('Confiance faible: vérifier l identification.')
  }

  return { identification, warnings }
}


function mapIdentificationToJira(identification: IdentificationCategory): {
  issueType: JiraProposal['issueType']
  subtypeField: JiraProposal['subtypeField']
  subtypeValue: string | null
  subtypeOptions: string[]
} {
  if (identification === 'Question') {
    return {
      issueType: 'Information',
      subtypeField: "Type d'info",
      subtypeValue: 'Fonctionnelle',
      subtypeOptions: ['Fonctionnelle', 'Technique', 'Business'],
    }
  }
  if (identification === 'Intervention livraison') {
    return {
      issueType: 'Intervention',
      subtypeField: "Type d'intervention",
      subtypeValue: 'License delivery',
      subtypeOptions: ['Setup', 'Update', 'Administration', 'Exploitation', 'License delivery'],
    }
  }
  if (identification === 'Intervention administration') {
    return {
      issueType: 'Intervention',
      subtypeField: "Type d'intervention",
      subtypeValue: 'Administration',
      subtypeOptions: ['Setup', 'Update', 'Administration', 'Exploitation', 'License delivery'],
    }
  }
  return {
    issueType: 'Assistance',
    subtypeField: 'Type de déploiement',
    subtypeValue: 'TO BE DEFINED',
    subtypeOptions: ['Onsite', 'Online', 'Mutualisée (Team+, Team, Partners)', 'TO BE DEFINED'],
  }
}

async function listThreadMessages(input: JiraAnalyzeInput, token: string): Promise<GraphEmail[]> {
  const fetchByConversationId = async (conversationId: string): Promise<GraphEmail[]> => {
    const queryUrl = new URL('https://graph.microsoft.com/v1.0/me/messages')
    queryUrl.searchParams.set('$filter', `conversationId eq '${escapeODataString(conversationId)}'`)
    queryUrl.searchParams.set(
      '$select',
      'id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories',
    )
    queryUrl.searchParams.set('$top', '50')
    const response = await fetch(queryUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Lecture thread Outlook impossible: ${response.status} ${text}`)
    }
    const parsed = JSON.parse(text) as GraphEmailList
    return Array.isArray(parsed.value) ? parsed.value : []
  }

  const fetchByMessageId = async (id: string): Promise<GraphEmail | null> => {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as GraphEmail
  }

  const conversationId = input.conversationId?.trim()
  const selectedMessageId = input.messageId?.trim() || input.id?.trim()
  let messages: GraphEmail[] = []

  if (conversationId) {
    messages = await fetchByConversationId(conversationId)
  } else if (selectedMessageId) {
    const selected = await fetchByMessageId(selectedMessageId)
    if (selected?.conversationId) {
      messages = await fetchByConversationId(selected.conversationId)
    } else if (selected) {
      messages = [selected]
    }
  } else {
    const queryUrl = new URL('https://graph.microsoft.com/v1.0/me/messages')
    queryUrl.searchParams.set('$orderby', 'receivedDateTime desc')
    queryUrl.searchParams.set(
      '$select',
      'id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories',
    )
    queryUrl.searchParams.set('$top', '1')
    const response = await fetch(queryUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Lecture Outlook impossible: ${response.status} ${text}`)
    }
    const parsed = JSON.parse(text) as GraphEmailList
    messages = Array.isArray(parsed.value) ? parsed.value : []
  }

  if (messages.length === 0 && selectedMessageId) {
    const selected = await fetchByMessageId(selectedMessageId)
    if (selected) {
      if (selected.conversationId) {
        const fromConversation = await fetchByConversationId(selected.conversationId)
        messages = fromConversation.length > 0 ? fromConversation : [selected]
      } else {
        messages = [selected]
      }
    }
  }

  return messages.sort((a, b) => {
    const da = a.receivedDateTime ? Date.parse(a.receivedDateTime) : 0
    const db = b.receivedDateTime ? Date.parse(b.receivedDateTime) : 0
    return da - db
  })
}

async function fetchClientNameOptionsLive(jira: JiraConfig): Promise<{ values: string[]; entries: JiraClientReferenceEntry[] }> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }

  const auth = Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64')
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
  }

  const values = new Set<string>()
  const entriesById = new Map<string, string>()

  const contextUrl = new URL(`${baseUrl}/rest/api/3/field/customfield_11500/context`)
  contextUrl.searchParams.set('startAt', '0')
  contextUrl.searchParams.set('maxResults', '50')
  const contextResponse = await fetch(contextUrl.toString(), { method: 'GET', headers })
  if (!contextResponse.ok) {
    throw new Error(`Lecture contextes Client name impossible (${contextResponse.status})`)
  }
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
      if (!optionResponse.ok) {
        throw new Error(`Lecture options Client name impossible (${optionResponse.status})`)
      }
      const optionBody = (await optionResponse.json()) as {
        values?: Array<{ id?: string; value?: string; disabled?: boolean }>
        isLast?: boolean
        maxResults?: number
      }

      for (const option of optionBody.values ?? []) {
        if (option.disabled) {
          continue
        }
        const value = option.value?.trim()
        if (value) {
          values.add(value)
          const optionId = option.id?.trim()
          if (optionId) {
            entriesById.set(optionId, value)
          }
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
      entries: Array.from(entriesById.entries())
        .map(([id, value]) => ({ id, value }))
        .sort((a, b) => a.value.localeCompare(b.value, 'fr')),
    }
  }

  const fallbackUrl = new URL(`${baseUrl}/rest/api/3/jql/autocompletedata/suggestions`)
  fallbackUrl.searchParams.set('fieldName', 'cf[11500]')
  fallbackUrl.searchParams.set('fieldValue', '')
  const fallbackResponse = await fetch(fallbackUrl.toString(), { method: 'GET', headers })
  if (!fallbackResponse.ok) {
    return { values: [], entries: [] }
  }
  const fallbackBody = (await fallbackResponse.json()) as JiraFieldSuggestionsResponse
  for (const result of fallbackBody.results ?? []) {
    const value = result.value?.trim() || result.displayName?.trim()
    if (value) {
      values.add(value.replace(/^"+|"+$/g, '').trim())
    }
  }
  return {
    values: Array.from(values).sort((a, b) => a.localeCompare(b, 'fr')),
    entries: [],
  }
}

async function refreshJiraClientsReference(): Promise<JiraClientsRefreshStats> {
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
    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry.value]))
    const nextById = new Map(nextEntries.map((entry) => [entry.id, entry.value]))

    for (const [id, nextValue] of nextById.entries()) {
      const previousValue = previousById.get(id)
      if (previousValue === undefined) {
        addedNames.push(nextValue)
      } else if (previousValue !== nextValue) {
        modifiedNames.push(`${previousValue} → ${nextValue}`)
      }
    }

    for (const id of previousById.keys()) {
      if (!nextById.has(id)) {
        const removedValue = previousById.get(id)
        if (removedValue) {
          removedNames.push(removedValue)
        }
      }
    }
  } else {
    const previousSet = new Set(previousValues)
    const nextSet = new Set(nextValues)
    for (const value of nextSet) {
      if (!previousSet.has(value)) {
        addedNames.push(value)
      }
    }
    for (const value of previousSet) {
      if (!nextSet.has(value)) {
        removedNames.push(value)
      }
    }
  }

  addedNames.sort((a, b) => a.localeCompare(b, 'fr'))
  modifiedNames.sort((a, b) => a.localeCompare(b, 'fr'))
  removedNames.sort((a, b) => a.localeCompare(b, 'fr'))

  return {
    values: nextValues,
    added: addedNames.length,
    modified: modifiedNames.length,
    removed: removedNames.length,
    total: nextValues.length,
    addedNames,
    modifiedNames,
    removedNames,
  }
}

async function fetchClientNameOptions(jira: JiraConfig): Promise<string[]> {
  const referenceValues = await readJiraClientsReferenceValues()
  if (referenceValues.length > 0) {
    return referenceValues
  }

  const liveValues = await fetchClientNameOptionsLive(jira)
  if (liveValues.values.length > 0) {
    await writeJiraClientsReferenceValues(liveValues.values, liveValues.entries)
    return liveValues.values
  }
  throw new Error('Impossible de charger les clients Jira (référence + live).')
}

async function buildJiraProposal(input: JiraAnalyzeInput, identification: IdentificationCategory): Promise<JiraProposal> {
  const microsoftToken = await ensureMicrosoftAccessToken()
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const threadMessages = await listThreadMessages(input, microsoftToken)
  const attachmentCandidates =
    process.env.JIRAYAH_LIST_ATTACHMENTS_ON_PROPOSE === '1'
      ? await listThreadAttachmentCandidates(
          threadMessages,
          microsoftToken,
          input.messageId?.trim() || input.id?.trim() || undefined,
        )
      : []
  const firstMessage = threadMessages[0]

  const rawSubject = stripReplyPrefixes(input.title?.trim() || firstMessage?.subject?.trim() || '') || '(Sans objet)'
  const summary = rawSubject.slice(0, 255)
  const sender =
    input.sender?.trim() ||
    firstMessage?.from?.emailAddress?.address?.trim() ||
    firstMessage?.from?.emailAddress?.name?.trim() ||
    'Inconnu'
  const bodyRaw = firstMessage?.body?.content?.trim() || ''
  const bodyText = cutAtSignatureAndQuote(stripHtml(bodyRaw)) || '(Contenu email introuvable)'
  const threadSenders = Array.from(
    new Set(
      threadMessages
        .map((message) => {
          const senderName = message.from?.emailAddress?.name?.trim() || ''
          const senderAddress = message.from?.emailAddress?.address?.trim() || ''
          if (senderName && senderAddress) {
            return `${senderName} <${senderAddress}>`
          }
          return senderAddress || senderName
        })
        .filter((value): value is string => Boolean(value)),
    ),
  )
  const threadContextText = threadMessages
    .map((message) => cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')))
    .filter((value) => value.length > 0)
    .slice(0, 5)
    .join('\n\n')

  const clientOptions = await fetchClientNameOptions(jira)
  const heuristicHints = rankClientHintsFromContext(
    clientOptions,
    `${summary}\n${bodyText}\n${threadContextText}\n${threadSenders.join('\n')}`,
    threadSenders,
  )
  const strongHeuristicClient = pickStrongHeuristicClient(heuristicHints)
  const shortlistedClients = shortlistClientOptions(clientOptions, {
    subject: summary,
    description: bodyText,
    sender,
    otherSenders: threadSenders.filter((value) => normalizeForMatch(value) !== normalizeForMatch(sender)),
    preferredClients: heuristicHints.map((item) => item.option),
  })
  let client = strongHeuristicClient ?? heuristicHints[0]?.option ?? shortlistedClients[0] ?? 'TBD'
  let clientCandidates = Array.from(
    new Set([client, ...heuristicHints.map((item) => item.option), ...shortlistedClients].filter(Boolean)),
  ).slice(0, 3)
  const mapped = mapIdentificationToJira(identification)
  const subtypeOptions = mapped.subtypeOptions
  const subtypeField = mapped.subtypeField
  let validSubtype = mapped.subtypeValue
  const warnings: string[] = []

  if (process.env.JIRAYAH_DEEP_CLASSIFICATION === '1') {
    const classification = await classifyWithCodex({
      subject: summary,
      description: bodyText,
      sender,
      otherSenders: threadSenders.filter((value) => normalizeForMatch(value) !== normalizeForMatch(sender)),
      senderIsIobeya: isIobeyaSender(sender),
      clientOptions,
    })
    client = strongHeuristicClient ?? classification.client
    clientCandidates = Array.from(
      new Set([client, ...classification.clientCandidates, ...heuristicHints.map((item) => item.option)].filter(Boolean)),
    ).slice(0, 3)
    warnings.push(...classification.warnings)
  }

  if (!strongHeuristicClient && client !== 'TBD') {
    warnings.push('Client prérempli rapidement: à vérifier avant validation.')
  }

  if (mapped.issueType === 'Assistance') {
    const inferredDeployment = await inferDeploymentSubtype(client, clientCandidates)
    if (inferredDeployment && subtypeOptions.includes(inferredDeployment)) {
      validSubtype = inferredDeployment
      warnings.push(`Type de déploiement prérempli depuis la référence client: ${inferredDeployment}.`)
    }
  }

  return {
    projectKey: inferProjectKey(input.jiraKey),
    issueType: mapped.issueType,
    subtypeField,
    subtypeValue: validSubtype,
    client,
    clientCandidates: clientCandidates.length > 0 ? clientCandidates : ['TBD'],
    summary,
    description: bodyText,
    descriptionRenderMode: 'email-html',
    clientOptions,
    subtypeOptions,
    attachmentCandidates,
    warnings,
  }
}

function isLikelyNoisyInline(attachment: GraphAttachment): boolean {
  return isLikelyNoisyInlineImage(attachment)
}

async function fetchMessageAttachmentRefs(messageId: string, token: string): Promise<GraphAttachment[]> {
  const encodedMessageId = encodeURIComponent(messageId)
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/attachments`)
  url.searchParams.set('$select', 'id,name,contentType,size,isInline,contentId')
  url.searchParams.set('$top', '100')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  const parsed = response.ok ? ((await response.json()) as GraphAttachmentList) : { value: [] }
  const direct = Array.isArray(parsed.value) ? parsed.value : []
  const directHasInlineSignal = direct.some(
    (ref) =>
      normalizeContentId(ref.contentId).length > 0 ||
      (Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')),
  )
  if (direct.length > 0 && directHasInlineSignal) {
    return direct
  }

  // Fallback 1: some messages expose inline resources only through $expand=attachments.
  try {
    const expandedUrl = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}`)
    expandedUrl.searchParams.set('$select', 'id')
    expandedUrl.searchParams.set('$expand', 'attachments($select=id,name,contentType,size,isInline,contentId)')

    const expandedResponse = await fetch(expandedUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (expandedResponse.ok) {
      const expanded = (await expandedResponse.json()) as { attachments?: GraphAttachment[] }
      const expandedAttachments = Array.isArray(expanded.attachments) ? expanded.attachments : direct
      const expandedHasInlineSignal = expandedAttachments.some(
        (ref) =>
          normalizeContentId(ref.contentId).length > 0 ||
          (Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')),
      )
      if (expandedAttachments.length > 0 && expandedHasInlineSignal) {
        return expandedAttachments
      }
    }
  } catch {
    // Continue with MIME fallback below.
  }

  // Fallback 2: extract inline parts from raw MIME when Graph attachment list is empty.
  const mimeInline = await extractInlineImagesFromMime(messageId, token)
  if (mimeInline.length === 0) {
    return direct
  }
  mimeInlineAttachmentCache.set(
    messageId,
    new Map(mimeInline.map((item) => [item.id, item])),
  )
  const mimeRefs: GraphAttachment[] = mimeInline.map((item) => ({
    id: item.id,
    name: item.name,
    contentType: item.contentType,
    size: item.bytes.length,
    isInline: true,
    contentId: item.contentId,
  }))

  return [...direct, ...mimeRefs]
}

async function listThreadAttachmentCandidates(
  thread: GraphEmail[],
  token: string,
  selectedMessageId?: string,
): Promise<AttachmentCandidate[]> {
  const candidates: AttachmentCandidate[] = []
  const seenNames = new Set<string>()

  for (const message of thread) {
    if (!message.id) {
      continue
    }
    const refs = await fetchMessageAttachmentRefs(message.id, token)
    for (const ref of refs) {
      const name = ref.name?.trim() || ''
      if (!name || !ref.id) {
        continue
      }
      if (seenNames.has(name)) {
        continue
      }
      seenNames.add(name)
      const isInlineImage = Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')
      candidates.push({
        key: `${message.id}:${ref.id}`,
        name,
        extension: fileExtension(name),
        sizeBytes: Number(ref.size ?? 0),
        selected: isInlineImage ? !isLikelyNoisyInline(ref) : true,
        kind: isInlineImage ? 'inline-image' : 'attachment',
      })
    }
  }

  if (candidates.length === 0 && selectedMessageId) {
    const refs = await fetchMessageAttachmentRefs(selectedMessageId, token)
    for (const ref of refs) {
      const name = ref.name?.trim() || ''
      if (!name || !ref.id) {
        continue
      }
      if (seenNames.has(name)) {
        continue
      }
      seenNames.add(name)
      const isInlineImage = Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')
      candidates.push({
        key: `${selectedMessageId}:${ref.id}`,
        name,
        extension: fileExtension(name),
        sizeBytes: Number(ref.size ?? 0),
        selected: isInlineImage ? !isLikelyNoisyInline(ref) : true,
        kind: isInlineImage ? 'inline-image' : 'attachment',
      })
    }
  }

  return candidates
}

async function fetchFileAttachment(messageId: string, attachmentId: string, token: string): Promise<GraphAttachment | null> {
  const mimeCache = mimeInlineAttachmentCache.get(messageId)
  const mimeAttachment = mimeCache?.get(attachmentId)
  if (mimeAttachment) {
    return {
      id: mimeAttachment.id,
      name: mimeAttachment.name,
      contentType: mimeAttachment.contentType,
      size: mimeAttachment.bytes.length,
      isInline: true,
      contentId: mimeAttachment.contentId,
      contentBytes: mimeAttachment.bytes.toString('base64'),
    }
  }

  const encodedMessageId = encodeURIComponent(messageId)
  const encodedAttachmentId = encodeURIComponent(attachmentId)
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/attachments/${encodedAttachmentId}`)
  url.searchParams.set('$select', 'id,name,contentType,size,isInline,contentId,contentBytes')
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    return null
  }

  const parsed = (await response.json()) as GraphAttachment
  return parsed
}

async function fetchFileAttachmentBytesViaValue(messageId: string, attachmentId: string, token: string): Promise<Buffer | null> {
  const mimeCache = mimeInlineAttachmentCache.get(messageId)
  const mimeAttachment = mimeCache?.get(attachmentId)
  if (mimeAttachment) {
    return mimeAttachment.bytes
  }

  const encodedMessageId = encodeURIComponent(messageId)
  const encodedAttachmentId = encodeURIComponent(attachmentId)
  const url = `https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/attachments/${encodedAttachmentId}/$value`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    return null
  }
  return Buffer.from(arrayBuffer)
}

async function extractInlineImagesFromMime(messageId: string, token: string): Promise<MimeInlineAttachment[]> {
  const encodedMessageId = encodeURIComponent(messageId)
  const mimeUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/$value`
  const response = await fetch(mimeUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    return []
  }

  const raw = Buffer.from(await response.arrayBuffer()).toString('utf-8')
  const boundaryMatches = Array.from(raw.matchAll(/boundary="?([^"\r\n;]+)"?/gi))
  const boundaries = Array.from(
    new Set(boundaryMatches.map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value))),
  )
  if (boundaries.length === 0) {
    return []
  }

  const results: MimeInlineAttachment[] = []
  const seenByContentId = new Set<string>()

  const parseHeaderValue = (headers: string, pattern: RegExp): string => {
    const match = headers.match(pattern)
    return match?.[1]?.trim() ?? ''
  }

  for (const boundary of boundaries) {
    const marker = `--${boundary}`
    const parts = raw.split(marker)

    for (const part of parts) {
      if (!part || part.startsWith('--')) {
        continue
      }

      const separatorIndex = part.search(/\r?\n\r?\n/)
      if (separatorIndex < 0) {
        continue
      }

      const headers = part.slice(0, separatorIndex)
      const body = part.slice(separatorIndex).replace(/^\r?\n\r?\n/, '')

      const contentType = parseHeaderValue(headers, /content-type:\s*([^\r\n;]+)/i).toLowerCase()
      const contentId = normalizeContentId(parseHeaderValue(headers, /content-id:\s*<?([^>\r\n]+)>?/i))
      const transferEncoding = parseHeaderValue(headers, /content-transfer-encoding:\s*([^\r\n]+)/i).toLowerCase()
      const contentDisposition = parseHeaderValue(headers, /content-disposition:\s*([^\r\n]+)/i).toLowerCase()
      if (!contentId || !contentType.startsWith('image/')) {
        continue
      }
      if (transferEncoding !== 'base64') {
        continue
      }
      if (seenByContentId.has(contentId)) {
        continue
      }
      if (contentDisposition && !contentDisposition.includes('inline') && !headers.toLowerCase().includes('content-id')) {
        continue
      }

      const filename =
        parseHeaderValue(headers, /filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i) ||
        `${contentId}.${contentType.split('/')[1] || 'img'}`
      const normalizedBase64 = body.replace(/\r?\n/g, '').replace(/\s+/g, '').trim()
      if (!normalizedBase64) {
        continue
      }

      let bytes: Buffer
      try {
        bytes = Buffer.from(normalizedBase64, 'base64')
      } catch {
        continue
      }
      if (bytes.length === 0) {
        continue
      }

      const id = `mime-inline:${results.length + 1}:${contentId}`
      results.push({
        id,
        name: filename.replace(/^utf-8''/i, ''),
        contentType,
        contentId,
        bytes,
      })
      seenByContentId.add(contentId)
    }
  }

  return results
}

async function buildEmailPreview(message: GraphEmail, token: string, threadMessages: GraphEmail[] = []): Promise<EmailPreviewPayload> {
  const subject = stripReplyPrefixes(message.subject?.trim() || '') || '(Sans objet)'
  const sender =
    message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu'
  const receivedDateTime = message.receivedDateTime?.trim() || null
  const rawHtml = message.body?.content?.trim() || ''

  if (!rawHtml) {
    return {
      subject,
      sender,
      receivedDateTime,
      html: buildEmailPreviewFallback(message),
      hasInlineImages: false,
    }
  }

  let html = sanitizeEmailHtml(rawHtml)
  let hasInlineImages = false
  const inlineImageDataUrls: string[] = []

  const hydrateInlineImagesFromMessage = async (messageId: string, currentHtml: string): Promise<string> => {
    const refs = await fetchMessageAttachmentRefs(messageId, token)
    const inlineRefs = refs.filter(
      (ref) => Boolean(ref.id) && (Boolean(ref.isInline) || Boolean(ref.contentId) || Boolean(ref.name)),
    )
    let nextHtml = currentHtml

    for (const ref of inlineRefs) {
      const normalizedContentId = normalizeContentId(ref.contentId)
      const normalizedName = normalizeContentId(ref.name)
      const candidates = [normalizedContentId, normalizedName].filter((value): value is string => Boolean(value))
      if (candidates.length === 0 || !ref.id) {
        continue
      }
      const full = await fetchFileAttachment(messageId, ref.id, token)
      const contentType = full?.contentType?.trim() || ref.contentType?.trim() || 'application/octet-stream'
      const contentBytes = full?.contentBytes
      const bytes = contentBytes
        ? Buffer.from(contentBytes, 'base64')
        : await fetchFileAttachmentBytesViaValue(messageId, ref.id, token)
      if (!bytes || bytes.length === 0) {
        continue
      }

      const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`
      if (contentType.toLowerCase().startsWith('image/')) {
        inlineImageDataUrls.push(dataUrl)
      }
      // Exact replacements first (cid:<content-id> and bare content-id).
      for (const candidate of candidates) {
        const cidPattern = new RegExp(`(["'])cid:${escapeRegExp(candidate)}\\1`, 'gi')
        const bareCidPattern = new RegExp(`(["'])${escapeRegExp(candidate)}\\1`, 'gi')
        nextHtml = nextHtml.replace(cidPattern, `$1${dataUrl}$1`).replace(bareCidPattern, `$1${dataUrl}$1`)
      }

      // Fallback: replace any src="cid:..." containing candidate fragment (handles variants like cid:image001.png@...).
      nextHtml = nextHtml.replace(
        /(src\s*=\s*["'])(cid:[^"']+)(["'])/gi,
        (fullMatch, prefix: string, srcValue: string, suffix: string) => {
          const normalizedSrc = normalizeContentId(srcValue)
          const matched = candidates.some(
            (candidate) => normalizedSrc.includes(candidate) || candidate.includes(normalizedSrc),
          )
          if (!matched) {
            return fullMatch
          }
          return `${prefix}${dataUrl}${suffix}`
        },
      )

      if (nextHtml !== currentHtml) {
        hasInlineImages = true
      }
    }

    return nextHtml
  }

  if (message.id) {
    html = await hydrateInlineImagesFromMessage(message.id, html)
  }

  // Fallback: unresolved CID can reference inline images present in another email of the same thread.
  if (threadMessages.length > 0 && /cid:/i.test(html)) {
    for (const threadMessage of threadMessages) {
      if (!threadMessage.id || threadMessage.id === message.id) {
        continue
      }
      const nextHtml = await hydrateInlineImagesFromMessage(threadMessage.id, html)
      if (nextHtml !== html) {
        hasInlineImages = true
        html = nextHtml
      }
      if (!/cid:/i.test(html)) {
        break
      }
    }
  }

  // Fallback: if CID images remain unresolved, replace them in order with available inline images.
  // This is less precise but avoids broken-image previews when content-id matching is inconsistent.
  if (inlineImageDataUrls.length > 0) {
    let inlineIndex = 0
    let hasCidLeft = false
    const nextHtml = html.replace(
      /(src\s*=\s*["'])(cid:[^"']+)(["'])/gi,
      (_full, prefix: string, _srcValue: string, suffix: string) => {
        hasCidLeft = true
        const replacement = inlineImageDataUrls[Math.min(inlineIndex, inlineImageDataUrls.length - 1)]
        inlineIndex += 1
        return `${prefix}${replacement}${suffix}`
      },
    )
    if (hasCidLeft && nextHtml !== html) {
      hasInlineImages = true
      html = nextHtml
    }
  }

  const wrappedHtml = [
    '<!doctype html><html><head><meta charset="utf-8" />',
    '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#17324d;overflow-wrap:anywhere} img{max-width:100%;height:auto} table{max-width:100%}</style>',
    '</head><body>',
    html,
    '</body></html>',
  ].join('')

  return {
    subject,
    sender,
    receivedDateTime,
    html: wrappedHtml,
    hasInlineImages,
  }
}

async function extractUsefulFileFromZip(zipFilename: string, zipBytes: Buffer): Promise<UploadableAttachment | null> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jirayah-zip-'))
  const zipPath = path.join(tempDir, zipFilename || 'attachment.zip')

  try {
    await writeFile(zipPath, zipBytes)
    const listing = await runBinaryCommand('unzip', ['-Z1', zipPath])
    if (listing.code !== 0) {
      return null
    }

    const entries = listing.stdout
      .toString('utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.endsWith('/'))

    if (entries.length === 0) {
      return null
    }

    const priority = [
      /\.log$/i,
      /\.txt$/i,
      /\.csv$/i,
      /\.json$/i,
      /\.xml$/i,
      /\.ya?ml$/i,
      /.*/,
    ]
    let selected = entries[0]
    for (const matcher of priority) {
      const found = entries.find((entry) => matcher.test(entry))
      if (found) {
        selected = found
        break
      }
    }

    const extracted = await runBinaryCommand('unzip', ['-p', zipPath, selected])
    if (extracted.code !== 0 || extracted.stdout.length === 0) {
      return null
    }

    return {
      filename: path.basename(selected),
      contentType: 'application/octet-stream',
      bytes: extracted.stdout,
    }
  } catch {
    return null
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function collectThreadAttachments(
  input: JiraAnalyzeInput,
  token: string,
  selectedAttachmentKeys?: Set<string>,
): Promise<{ attachments: UploadableAttachment[]; report: AttachmentCollectionReport }> {
  const thread = await listThreadMessages(input, token)
  const collected: UploadableAttachment[] = []
  const seenNames = new Set<string>()
  const report: AttachmentCollectionReport = {
    found: 0,
    skipped: 0,
    errors: [],
  }

  for (const message of thread) {
    if (!message.id) {
      continue
    }

    const refs = await fetchMessageAttachmentRefs(message.id, token)
    for (const ref of refs) {
      report.found += 1
      const name = ref.name?.trim() || ''
      if (!name) {
        report.skipped += 1
        continue
      }
      if (!ref.id) {
        report.skipped += 1
        continue
      }
      const attachmentKey = `${message.id}:${ref.id}`
      if (!selectedAttachmentKeys && isLikelyNoisyInline(ref)) {
        report.skipped += 1
        continue
      }
      if (selectedAttachmentKeys && !selectedAttachmentKeys.has(attachmentKey)) {
        report.skipped += 1
        continue
      }

      const full = await fetchFileAttachment(message.id, ref.id, token)
      const contentBytes = full?.contentBytes
      const bytes = contentBytes
        ? Buffer.from(contentBytes, 'base64')
        : await fetchFileAttachmentBytesViaValue(message.id, ref.id, token)
      if (!bytes) {
        report.skipped += 1
        report.errors.push(`Lecture binaire impossible: ${name}`)
        continue
      }
      if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
        report.skipped += 1
        continue
      }

      if (name.toLowerCase().endsWith('.zip')) {
        const extracted = await extractUsefulFileFromZip(name, bytes)
        if (!extracted) {
          if (!seenNames.has(name)) {
            seenNames.add(name)
            collected.push({
              filename: name,
              contentType: full?.contentType?.trim() || 'application/zip',
              bytes,
              sourceKey: attachmentKey,
              sourceKind: Boolean(ref.isInline) ? 'inline-image' : 'attachment',
            })
          }
          report.errors.push(`Zip non extractible, zip joint tel quel: ${name}`)
          continue
        }
        if (!seenNames.has(extracted.filename)) {
          seenNames.add(extracted.filename)
          collected.push(extracted)
        }
        continue
      }

      if (!seenNames.has(name)) {
        seenNames.add(name)
        collected.push({
          filename: name,
          contentType: full?.contentType?.trim() || 'application/octet-stream',
          bytes,
          sourceKey: attachmentKey,
          sourceKind: Boolean(ref.isInline) ? 'inline-image' : 'attachment',
        })
      }
    }
  }

  return { attachments: collected, report }
}

async function uploadJiraAttachments(
  jira: JiraConfig,
  issueKey: string,
  attachments: UploadableAttachment[],
): Promise<{ uploaded: number; errors: string[]; uploadedItems: JiraUploadedAttachment[] }> {
  if (attachments.length === 0) {
    return { uploaded: 0, errors: [], uploadedItems: [] }
  }

  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    return { uploaded: 0, errors: ['Configuration Jira absente pour upload pièces jointes.'], uploadedItems: [] }
  }

  const auth = Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64')

  let uploaded = 0
  const errors: string[] = []
  const uploadedItems: JiraUploadedAttachment[] = []
  for (const attachment of attachments) {
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([attachment.bytes], {
        type: attachment.contentType || 'application/octet-stream',
      }),
      attachment.filename,
    )

    const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: formData,
    })

    if (!response.ok) {
      const body = await response.text()
      errors.push(`Upload échoué ${attachment.filename}: ${response.status} ${body}`)
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
        })
      }
    } catch {
      // keep count even when Jira response body cannot be parsed
    }
    uploaded += 1
  }

  return { uploaded, errors, uploadedItems }
}

async function updateJiraDescription(
  jira: JiraConfig,
  issueKey: string,
  descriptionAdf: Record<string, unknown>,
): Promise<void> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente pour mise à jour de description.')
  }

  const auth = Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64')
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        description: descriptionAdf,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Mise à jour description Jira échouée (${response.status}): ${body}`)
  }
}

async function getCurrentJiraUserAccountId(jira: JiraConfig): Promise<string> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }
  const auth = Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64')
  const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Lecture utilisateur Jira impossible: ${response.status} ${body}`)
  }
  const parsed = (await response.json()) as JiraMyselfResponse
  const accountId = parsed.accountId?.trim()
  if (!accountId) {
    throw new Error('accountId Jira introuvable pour reporter/assignee.')
  }
  return accountId
}

function buildJiraAuth(jira: JiraConfig): { baseUrl: string; auth: string } {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }
  return {
    baseUrl,
    auth: Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64'),
  }
}

async function removeJiraLabel(jira: JiraConfig, issueKey: string, label: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      update: {
        labels: [{ remove: label }],
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Retrait label Jira échoué (${response.status}): ${body}`)
  }
}

async function addJiraWorklogWithComment(
  jira: JiraConfig,
  issueKey: string,
  worklogMinutes: number,
  commentText: string,
): Promise<boolean> {
  if (worklogMinutes <= 0) {
    return false
  }

  const { baseUrl, auth } = buildJiraAuth(jira)
  const started = new Date().toISOString().replace('Z', '+0000')
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeSpentSeconds: worklogMinutes * 60,
      started,
      comment: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: commentText,
              },
            ],
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ajout worklog Jira échoué (${response.status}): ${body}`)
  }

  return true
}

async function addJiraWorklog(jira: JiraConfig, issueKey: string, worklogMinutes: number): Promise<boolean> {
  return addJiraWorklogWithComment(jira, issueKey, worklogMinutes, `Clôture depuis Support Assistant (${worklogMinutes} min).`)
}

function scoreInProgressTransition(transition: NonNullable<JiraTransitionsResponse['transitions']>[number]): number {
  const name = transition.name?.trim().toLowerCase() || ''
  const toName = transition.to?.name?.trim().toLowerCase() || ''
  const statusCategoryKey = transition.to?.statusCategory?.key?.trim().toLowerCase() || ''
  const statusCategoryName = transition.to?.statusCategory?.name?.trim().toLowerCase() || ''
  let score = 0

  if (transition.to?.statusCategory?.id === 4 || statusCategoryKey === 'indeterminate' || statusCategoryName.includes('progress')) {
    score += 100
  }
  if (name.includes('in progress') || toName.includes('in progress')) {
    score += 60
  }
  if (name.includes('en cours') || toName.includes('en cours')) {
    score += 55
  }
  if (name.includes('start progress') || toName.includes('start progress')) {
    score += 50
  }
  if (name.includes('progress') || toName.includes('progress')) {
    score += 40
  }
  if (name.includes('ongoing') || toName.includes('ongoing')) {
    score += 30
  }

  return score
}

function scoreCloseTransition(transition: NonNullable<JiraTransitionsResponse['transitions']>[number]): number {
  const name = transition.name?.trim().toLowerCase() || ''
  const toName = transition.to?.name?.trim().toLowerCase() || ''
  const statusCategoryKey = transition.to?.statusCategory?.key?.trim().toLowerCase() || ''
  const statusCategoryName = transition.to?.statusCategory?.name?.trim().toLowerCase() || ''
  let score = 0

  if (transition.to?.statusCategory?.id === 9 || statusCategoryKey === 'done' || statusCategoryName.includes('done')) {
    score += 100
  }
  if (name.includes('clôt') || toName.includes('clôt')) {
    score += 50
  }
  if (name.includes('close') || toName.includes('close')) {
    score += 45
  }
  if (name.includes('résolu') || toName.includes('résolu') || name.includes('resol') || toName.includes('resol')) {
    score += 40
  }
  if (name.includes('done') || toName.includes('done')) {
    score += 35
  }
  if (name.includes('termin') || toName.includes('termin')) {
    score += 30
  }
  return score
}

async function closeJiraIssue(jira: JiraConfig, issueKey: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const transitionsResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })

  const transitionsText = await transitionsResponse.text()
  if (!transitionsResponse.ok) {
    throw new Error(`Lecture transitions Jira échouée (${transitionsResponse.status}): ${transitionsText}`)
  }

  const parsed = JSON.parse(transitionsText) as JiraTransitionsResponse
  const transitions = Array.isArray(parsed.transitions) ? parsed.transitions : []
  const bestTransition = transitions
    .filter((transition) => transition.id?.trim())
    .sort((left, right) => scoreCloseTransition(right) - scoreCloseTransition(left))[0]

  if (!bestTransition?.id || scoreCloseTransition(bestTransition) <= 0) {
    throw new Error(`Aucune transition de clôture exploitable trouvée pour ${issueKey}.`)
  }

  const transitionResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transition: {
        id: bestTransition.id,
      },
    }),
  })

  if (!transitionResponse.ok) {
    const body = await transitionResponse.text()
    throw new Error(`Transition Jira de clôture échouée (${transitionResponse.status}): ${body}`)
  }
}

async function moveJiraIssueToInProgress(jira: JiraConfig, issueKey: string): Promise<void> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const transitionsResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })

  const transitionsText = await transitionsResponse.text()
  if (!transitionsResponse.ok) {
    throw new Error(`Lecture transitions Jira échouée (${transitionsResponse.status}): ${transitionsText}`)
  }

  const parsed = JSON.parse(transitionsText) as JiraTransitionsResponse
  const transitions = Array.isArray(parsed.transitions) ? parsed.transitions : []
  const bestTransition = transitions
    .filter((transition) => transition.id?.trim())
    .sort((left, right) => scoreInProgressTransition(right) - scoreInProgressTransition(left))[0]

  if (!bestTransition?.id || scoreInProgressTransition(bestTransition) <= 0) {
    throw new Error(`Aucune transition "In Progress" exploitable trouvée pour ${issueKey}.`)
  }

  const transitionResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transition: {
        id: bestTransition.id,
      },
    }),
  })

  if (!transitionResponse.ok) {
    const body = await transitionResponse.text()
    throw new Error(`Transition Jira vers In Progress échouée (${transitionResponse.status}): ${body}`)
  }
}

async function createJiraIssue(
  input: JiraCreateInput,
  sourceEmail?: JiraAnalyzeInput,
): Promise<{ key: string; url: string; attachmentReport: { found: number; uploaded: number; skipped: number; errors: string[] } }> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const email = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !email || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }

  const summary = input.summary?.trim()
  const projectKey = input.projectKey?.trim().toUpperCase() || DEFAULT_PROJECT_KEY
  const issueTypeName = input.issueType
  const issueTypeMeta = ISSUE_TYPES[issueTypeName]
  if (!summary || !issueTypeMeta) {
    throw new Error('Issue type et summary sont obligatoires.')
  }

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
    const option = SUBTYPE_OPTIONS[issueTypeName].find((entry) => entry.value === input.subtypeValue)
    if (!option) {
      throw new Error(`Valeur de sous-type invalide pour ${issueTypeName}.`)
    }
    fields[issueTypeMeta.subtypeFieldId] = { id: option.id }
  }

  const payload = { fields }
  const auth = Buffer.from(`${email}:${apiToken}`, 'utf-8').toString('base64')
  const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`Création Jira a échoué: ${response.status} ${bodyText}`)
  }

  const parsed = JSON.parse(bodyText) as JiraCreateResponse
  const key = parsed.key?.trim()
  if (!key) {
    throw new Error('Réponse Jira invalide: clé ticket absente.')
  }

  await moveJiraIssueToInProgress(jira, key)
  await addJiraWorklogWithComment(jira, key, 5, 'Démarrage ticket depuis Support Assistant (5 min).')

  let attachmentReport = {
    found: 0,
    uploaded: 0,
    skipped: 0,
    errors: [] as string[],
  }
  const descriptionRenderMode: DescriptionRenderMode = input.descriptionRenderMode === 'email-html' ? 'email-html' : 'plain-text'

  if (sourceEmail) {
    try {
      const microsoftToken = await ensureMicrosoftAccessToken()
      const threadMessages = await listThreadMessages(sourceEmail, microsoftToken)
      const firstMessage = threadMessages[0]
      const selectedAttachmentKeys = (() => {
        if (!Array.isArray(input.attachmentCandidates)) {
          return undefined
        }
        const keys = new Set(
          input.attachmentCandidates
            .filter((candidate) => Boolean(candidate?.selected))
            .map((candidate) => candidate?.key)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        )
        return keys.size > 0 ? keys : undefined
      })()
      const { attachments, report } = await collectThreadAttachments(sourceEmail, microsoftToken, selectedAttachmentKeys)
      const upload = await uploadJiraAttachments(jira, key, attachments)
      const embedErrors: string[] = []
      const inlineTargetsBySrc = new Map<string, EmbeddedImageTarget>()

      for (const attachment of attachments) {
        if (attachment.sourceKind !== 'inline-image' || !attachment.sourceKey) {
          continue
        }
        const uploadedItem = upload.uploadedItems.find((item) => item.id && item.sourceKey === attachment.sourceKey)
        if (!uploadedItem?.id) {
          continue
        }
        const dimensions = getImageDimensions(attachment.bytes)
        const dataUrl = `data:${attachment.contentType || 'application/octet-stream'};base64,${attachment.bytes.toString('base64')}`
        inlineTargetsBySrc.set(dataUrl, {
          id: uploadedItem.id,
          alt: uploadedItem.filename?.trim() || attachment.filename,
          width: dimensions?.width,
          height: dimensions?.height,
        })
      }

      let descriptionAdf: Record<string, unknown> | null = null
      if (descriptionRenderMode === 'email-html' && firstMessage) {
        try {
          const preview = await buildEmailPreview(firstMessage, microsoftToken, threadMessages)
          descriptionAdf = buildAdfFromEmailHtml(preview.html, inlineTargetsBySrc, baseDescription)
        } catch (previewError) {
          const previewMessage = previewError instanceof Error ? previewError.message : String(previewError)
          embedErrors.push(`Rendu HTML email non repris dans la description: ${previewMessage}`)
        }
      }

      if (!descriptionAdf) {
        const inlineTargets = Array.from(inlineTargetsBySrc.values())
        if (inlineTargets.length > 0) {
          descriptionAdf = buildAdfWithEmbeddedImages(baseDescription, inlineTargets)
        }
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
      console.warn(`[JiraYah] Upload pièces jointes ignoré: ${message}`)
    }
  }

  return {
    key,
    url: `${baseUrl}/browse/${key}`,
    attachmentReport,
  }
}

async function jiraIssueExists(jira: JiraConfig, issueKey: string): Promise<boolean | 'unknown'> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const jiraEmail = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !jiraEmail || !apiToken) {
    return 'unknown'
  }

  const auth = Buffer.from(`${jiraEmail}:${apiToken}`, 'utf-8').toString('base64')
  try {
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=key`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    })
    if (response.status === 404) {
      return false
    }
    if (!response.ok) {
      return 'unknown'
    }
    return true
  } catch {
    return 'unknown'
  }
}

async function removeInvalidatedTreatments(invalidatedThreadIds: string[]): Promise<void> {
  if (invalidatedThreadIds.length === 0) {
    return
  }
  const store = await readTreatmentsStore()
  let changed = false
  for (const threadId of invalidatedThreadIds) {
    if (Object.prototype.hasOwnProperty.call(store, threadId)) {
      delete store[threadId]
      changed = true
    }
  }
  if (changed) {
    await writeTreatmentsStore(store)
  }
}

async function attachJiraKeys(
  emails: GraphEmail[],
): Promise<{ emails: GraphEmail[]; invalidatedThreadIds: string[] }> {
  const threadMap = await readThreadJiraMap()
  let jiraConfig: JiraConfig = {}
  try {
    jiraConfig = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  } catch {
    jiraConfig = {}
  }
  const baseUrl = jiraConfig.base_url?.trim().replace(/\/$/, '')
  const knownKeys = Array.from(new Set(Object.values(threadMap).map((value) => value?.trim()).filter(Boolean)))
  const keyStatus = new Map<string, boolean | 'unknown'>()
  await Promise.all(
    knownKeys.map(async (key) => {
      keyStatus.set(key, await jiraIssueExists(jiraConfig, key))
    }),
  )

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
    return {
      ...email,
      jiraKey,
      jiraUrl: jiraKey && baseUrl ? `${baseUrl}/browse/${jiraKey}` : null,
    }
    }),
  }
}

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
    score += 45
    hasStrongTitleSignal = true
    reasonParts.push('titre: exact')
  }

  const matchedTitleTokens = titleTokens.filter((token) => summaryNorm.includes(token))
  if (matchedTitleTokens.length > 0) {
    score += Math.min(55, matchedTitleTokens.length * 18)
    reasonParts.push(`titre: ${matchedTitleTokens.join(', ')}`)
    if (matchedTitleTokens.some((token) => /^\d+$/.test(token) || token.length >= 5)) {
      hasStrongTitleSignal = true
    }
  }

  const createdDate = Date.parse(issue.created)
  const emailDate = Date.parse(email.receivedDateTime ?? '')
  if (Number.isFinite(createdDate) && Number.isFinite(emailDate)) {
    const dayDiff = Math.abs(createdDate - emailDate) / (1000 * 60 * 60 * 24)
    if (dayDiff <= 2) {
      score += 30
      reasonParts.push('date: tres proche')
    } else if (dayDiff <= 7) {
      score += 18
      reasonParts.push('date: proche')
    } else if (dayDiff <= 21) {
      score += 8
      reasonParts.push('date: compatible')
    }
  }

  const senderMatched = senderTokens.filter((token) => searchableText.includes(token))
  if (senderMatched.length > 0) {
    score += Math.min(20, senderMatched.length * 10)
    reasonParts.push(`expediteur: ${senderMatched.join(', ')}`)
  }

  return {
    score,
    reason: reasonParts.join(' | ') || 'match faible',
    hasStrongTitleSignal,
  }
}

async function searchJiraMatchesForEmail(email: GraphEmail, jira: JiraConfig): Promise<JiraIssueMatch[]> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const jiraEmail = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !jiraEmail || !apiToken) {
    return []
  }

  const auth = Buffer.from(`${jiraEmail}:${apiToken}`, 'utf-8').toString('base64')
  const title = stripReplyPrefixes(email.subject?.trim() || '')
  const strictEmailTitle = normalizeStrictTitle(title)
  if (!strictEmailTitle) {
    return []
  }

  const exactTitleForJql = escapeJqlText(title.trim())
  const jql = [`project = ${DEFAULT_PROJECT_KEY}`, `summary ~ "\\\"${exactTitleForJql}\\\""`].join(' AND ')

  const url = new URL(`${baseUrl}/rest/api/3/search/jql`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', '30')
  url.searchParams.set('fields', 'summary,created,description')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    return []
  }

  const parsed = (await response.json()) as JiraSearchResponse
  const issues = Array.isArray(parsed.issues) ? parsed.issues : []

  type JiraIssueMatchCandidate = JiraIssueMatch & { hasStrongTitleSignal: boolean; descriptionText: string }

  const exactTitleMatches = issues
    .map((issue) => {
      const key = issue.key?.trim() || ''
      const summary = issue.fields?.summary?.trim() || ''
      const created = issue.fields?.created?.trim() || ''
      if (!key || !summary || !created) {
        return null
      }
      const descriptionText = adfNodeToText(issue.fields?.description)
      const match: JiraIssueMatch = {
        key,
        url: `${baseUrl}/browse/${key}`,
        summary,
        created,
        score: 0,
        reason: '',
      }
      const scored = computeJiraMatchScore(email, match, descriptionText)
      return {
        ...match,
        score: scored.score,
        reason: scored.reason,
        hasStrongTitleSignal: scored.hasStrongTitleSignal,
        descriptionText,
      }
    })
    .filter((match): match is JiraIssueMatchCandidate => Boolean(match))
    .filter((match) => normalizeStrictTitle(match.summary) === strictEmailTitle)
    .sort((a, b) => b.score - a.score || Date.parse(b.created) - Date.parse(a.created))

  if (exactTitleMatches.length <= 1) {
    return exactTitleMatches
      .map((match) => ({
        ...match,
        score: Math.max(match.score, 100),
        reason: 'titre: exact (règle absolue)',
      }))
      .slice(0, 3)
      .map(({ hasStrongTitleSignal: _hasStrongTitleSignal, descriptionText: _descriptionText, ...match }) => match)
  }

  const emailBodyRaw = email.uniqueBody?.content?.trim() || email.body?.content?.trim() || ''
  const emailBodyText = cutAtSignatureAndQuote(stripHtml(emailBodyRaw))
  if (!emailBodyText) {
    return exactTitleMatches
      .map((match) => ({
        ...match,
        score: Math.max(match.score, 100),
        reason: 'titre: exact | description email indisponible',
      }))
      .slice(0, 3)
      .map(({ hasStrongTitleSignal: _hasStrongTitleSignal, descriptionText: _descriptionText, ...match }) => match)
  }

  const disambiguated = exactTitleMatches
    .map((match) => {
      const similarity = scoreDescriptionSimilarity(emailBodyText, match.descriptionText)
      return {
        ...match,
        contentOverlapCount: similarity.commonTokens.length,
        score: 100 + similarity.score,
        reason:
          similarity.commonTokens.length > 0
            ? `titre: exact | description: ${similarity.commonTokens.length} token(s) commun(s)`
            : 'titre: exact | description: aucun recouvrement clair',
      }
    })
    .filter((match) => match.contentOverlapCount >= 2)
    .sort((a, b) => b.score - a.score || Date.parse(b.created) - Date.parse(a.created))
    .slice(0, 3)
    .map(({ hasStrongTitleSignal: _hasStrongTitleSignal, descriptionText: _descriptionText, contentOverlapCount: _contentOverlapCount, ...match }) => match)

  if (disambiguated.length > 0) {
    return disambiguated
  }

  return exactTitleMatches
    .map((match) => ({
      ...match,
      score: Math.max(match.score, 100),
      reason: 'titre: exact | description non discriminante',
    }))
    .slice(0, 3)
    .map(({ hasStrongTitleSignal: _hasStrongTitleSignal, descriptionText: _descriptionText, ...match }) => match)
}

async function attachJiraCandidates(emails: GraphEmail[]): Promise<GraphEmail[]> {
  let jiraConfig: JiraConfig = {}
  try {
    jiraConfig = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  } catch {
    return emails
  }

  const threadEmails = new Map<string, { latest: GraphEmail; oldest: GraphEmail }>()
  for (const email of emails) {
    const threadId = (email.conversationId || email.id || '').trim()
    if (!threadId || email.jiraKey) {
      continue
    }
    const existing = threadEmails.get(threadId)
    if (!existing) {
      threadEmails.set(threadId, { latest: email, oldest: email })
      continue
    }
    const currentDate = email.receivedDateTime ? Date.parse(email.receivedDateTime) : 0
    const latestDate = existing.latest.receivedDateTime ? Date.parse(existing.latest.receivedDateTime) : 0
    const oldestDate = existing.oldest.receivedDateTime ? Date.parse(existing.oldest.receivedDateTime) : Number.MAX_SAFE_INTEGER
    if (currentDate >= latestDate) {
      existing.latest = email
    }
    if (currentDate <= oldestDate) {
      existing.oldest = email
    }
  }

  const matchesByThread = new Map<string, JiraIssueMatch[]>()
  for (const [threadId, aggregate] of threadEmails.entries()) {
    const probeEmail: GraphEmail = {
      ...aggregate.latest,
      from: aggregate.oldest.from,
      receivedDateTime: aggregate.oldest.receivedDateTime,
    }
    matchesByThread.set(threadId, await searchJiraMatchesForEmail(probeEmail, jiraConfig))
  }

  return emails.map((email) => {
    if (email.jiraKey) {
      return email
    }
    const threadId = (email.conversationId || email.id || '').trim()
    return {
      ...email,
      jiraMatches: matchesByThread.get(threadId) ?? [],
    }
  })
}

function getEmailSenderDisplay(message: GraphEmail): string {
  return message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu'
}

function isLastJiraCommentMatchingLastEmail(commentText: string, message: GraphEmail): boolean {
  const commentNorm = normalizeForMatch(commentText)
  if (!commentNorm) {
    return false
  }

  const senderHeader = normalizeForMatch(`${getEmailSenderDisplay(message)} :`)
  if (!commentNorm.includes(senderHeader)) {
    return false
  }

  const emailBody = cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || ''))
  const emailBodyNorm = normalizeForMatch(emailBody)
  if (!emailBodyNorm) {
    return true
  }

  const excerpt = emailBodyNorm.slice(0, 180).trim()
  if (excerpt.length >= 30 && commentNorm.includes(excerpt)) {
    return true
  }

  const tokens = tokenizeForMatch(emailBodyNorm, 4).slice(0, 14)
  if (tokens.length === 0) {
    return false
  }
  const matched = tokens.filter((token) => commentNorm.includes(token)).length
  return matched >= Math.max(4, Math.ceil(tokens.length * 0.45))
}

async function fetchJiraComments(jira: JiraConfig, jiraKey: string): Promise<JiraIssueComment[]> {
  const baseUrl = jira.base_url?.trim().replace(/\/$/, '')
  const jiraEmail = jira.email?.trim()
  const apiToken = jira.api_token?.trim()
  if (!baseUrl || !jiraEmail || !apiToken) {
    throw new Error('Configuration Jira absente. Lance la connexion Jira.')
  }

  const auth = Buffer.from(`${jiraEmail}:${apiToken}`, 'utf-8').toString('base64')
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
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Lecture commentaires Jira impossible (${jiraKey}): ${response.status} ${body}`)
    }

    const parsed = (await response.json()) as JiraCommentsResponse & { total?: number; maxResults?: number; startAt?: number }
    const batch = Array.isArray(parsed.comments) ? parsed.comments : []
    comments.push(...batch)

    const total = Number(parsed.total ?? comments.length)
    if (comments.length >= total || batch.length === 0) {
      break
    }
    startAt += Number(parsed.maxResults ?? batch.length)
  }

  return comments
}

function getTraceMessageKey(message: GraphEmail): string {
  const internetId = (message.internetMessageId ?? '').trim().toLowerCase()
  if (internetId) {
    return `internet:${internetId}`
  }
  const graphId = (message.id ?? '').trim()
  return `graph:${graphId}`
}

function getCommentTraceMessageKey(comment: JiraIssueComment): string | null {
  const properties = Array.isArray(comment.properties) ? comment.properties : []
  const traceProp = properties.find((property) => (property.key ?? '').trim() === 'assistant.trace.messageKey')
  const value = traceProp?.value
  if (!value || typeof value !== 'object') {
    return null
  }
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
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ecriture propriété commentaire Jira échouée (${response.status}): ${body}`)
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
    if (line.length > 0) {
      content.push({ type: 'text', text: line })
    }
    if (index < lines.length - 1) {
      content.push({ type: 'hardBreak' })
    }
  }

  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content }],
  }
}

async function addJiraComment(jira: JiraConfig, jiraKey: string, bodyAdf: Record<string, unknown>): Promise<string> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: bodyAdf,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ajout commentaire Jira échoué (${response.status}): ${body}`)
  }

  const created = (await response.json()) as { id?: string }
  const commentId = created.id?.trim()
  if (!commentId) {
    throw new Error('Ajout commentaire Jira échoué: id commentaire introuvable.')
  }
  return commentId
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
  if (isJePrendsEmail(message)) {
    return false
  }
  const sender = getEmailSenderDisplay(message)
  const subject = message.subject?.trim() || ''
  const body = cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')).trim()
  const norm = normalizeForMatch(`${subject}\n${body}`)
  if (!norm) {
    return false
  }
  if (norm.includes('reacted to your message') || normalizeForMatch(sender).includes('microsoft outlook')) {
    return false
  }
  return true
}

async function traceRemainingEmailsInJira(input: JiraAnalyzeInput, jiraKey: string): Promise<JiraSimpleTraceResult> {
  const microsoftToken = await ensureMicrosoftAccessToken()
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const rawThread = await listThreadMessages(input, microsoftToken)
  const seenMessageIds = new Set<string>()
  const seenInternetIds = new Set<string>()
  const seenFingerprints = new Set<string>()
  const thread = rawThread.filter((message) => {
    const id = message.id?.trim()
    if (!id) {
      return false
    }
    if (seenMessageIds.has(id)) {
      return false
    }
    seenMessageIds.add(id)
    const internetId = (message.internetMessageId ?? '').trim().toLowerCase()
    if (internetId) {
      if (seenInternetIds.has(internetId)) {
        return false
      }
      seenInternetIds.add(internetId)
    }
    const sender = normalizeForMatch(getEmailSenderDisplay(message))
    const subject = normalizeForMatch(message.subject?.trim() || '')
    const body = normalizeForMatch(cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')).trim())
    const dt = message.receivedDateTime ? new Date(message.receivedDateTime).toISOString().slice(0, 16) : ''
    const fingerprint = `${sender}|${subject}|${body.slice(0, 220)}|${dt}`
    if (seenFingerprints.has(fingerprint)) {
      return false
    }
    seenFingerprints.add(fingerprint)
    return true
  })
  if (thread.length === 0) {
    throw new Error('Thread email introuvable.')
  }

  const meResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${microsoftToken}`,
      Accept: 'application/json',
    },
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
    const sortedComments = jiraComments
      .slice()
      .sort((a, b) => Date.parse(a.created ?? '') - Date.parse(b.created ?? ''))

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
      if (!commentText) {
        continue
      }
      for (let index = thread.length - 1; index >= 0; index -= 1) {
        if (isLastJiraCommentMatchingLastEmail(commentText, thread[index])) {
          foundIndex = index
          matchedEmailId = thread[index].id ?? null
          break
        }
      }
      if (foundIndex >= 0) {
        break
      }
    }
    startIndex = foundIndex >= 0 ? foundIndex + 1 : 0
  }

  // Règle métier: ne jamais tracer l'email original (premier email du thread) en commentaire.
  const effectiveStartIndex = Math.max(startIndex, 1)
  const tracedMessageKeys = new Set(
    jiraComments
      .map((comment) => getCommentTraceMessageKey(comment))
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
  const toTrace = thread
    .slice(effectiveStartIndex)
    .filter((message) => isTraceableEmail(message))
    .filter((message) => !tracedMessageKeys.has(getTraceMessageKey(message)))
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

  return {
    jiraKey,
    added: toTrace.length,
    subjects,
    lastMatchedEmailId: matchedEmailId,
  }
}

async function ensureMicrosoftAccessToken(): Promise<string> {
  const config = await readJsonFile<M365Config>(M365_CONFIG_CACHE)
  const token = await readJsonFile<M365Token>(M365_TOKEN_CACHE)

  if (token.access_token && Number(token.expires_at ?? 0) > nowEpoch()) {
    return token.access_token
  }

  if (!token.refresh_token || !config.client_id) {
    throw new Error('Token Microsoft expiré/non disponible. Refaire la connexion Microsoft.')
  }

  const tenant = config.tenant_id || 'common'
  const refreshPayload = new URLSearchParams({
    client_id: config.client_id,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    scope: 'User.Read offline_access Calendars.ReadWrite Mail.ReadWrite MailboxSettings.Read Sites.ReadWrite.All Files.ReadWrite.All',
  })

  const refreshResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: refreshPayload,
  })

  const refreshText = await refreshResponse.text()
  if (!refreshResponse.ok) {
    throw new Error(`Échec refresh token Microsoft: ${refreshResponse.status} ${refreshText}`)
  }

  const refreshed = JSON.parse(refreshText) as M365Token
  if (!refreshed.access_token) {
    throw new Error('Refresh Microsoft invalide: access_token absent.')
  }

  const refreshedWithExpiry = {
    ...token,
    ...refreshed,
    expires_at: nowEpoch() + Number(refreshed.expires_in ?? 0) - 60,
  }

  await saveJsonFile(M365_TOKEN_CACHE, refreshedWithExpiry)
  return refreshed.access_token
}

async function getGraphArchiveFolderId(token: string): Promise<string> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/archive?$select=id', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`Lecture dossier Archive impossible: ${response.status} ${bodyText}`)
  }

  const parsed = JSON.parse(bodyText) as GraphMailFolder
  const folderId = parsed.id?.trim()
  if (!folderId) {
    throw new Error("Dossier Archive Outlook introuvable.")
  }
  return folderId
}

async function updateThreadMessagesCategories(
  threadMessages: GraphEmail[],
  token: string,
  updater: (categories: string[]) => string[],
): Promise<void> {
  for (const message of threadMessages) {
    const messageId = message.id?.trim()
    if (!messageId) {
      continue
    }
    const currentCategories = Array.isArray(message.categories)
      ? message.categories.filter((value): value is string => typeof value === 'string')
      : []
    const nextCategories = updater(currentCategories)
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        categories: nextCategories,
      }),
    })
    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`Mise à jour catégories Outlook impossible (${messageId}): ${response.status} ${bodyText}`)
    }
  }
}

async function archiveThreadMessages(threadMessages: GraphEmail[], token: string): Promise<number> {
  const archiveFolderId = await getGraphArchiveFolderId(token)
  let archivedCount = 0

  for (const message of threadMessages) {
    const messageId = message.id?.trim()
    if (!messageId) {
      continue
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destinationId: archiveFolderId,
      }),
    })
    const bodyText = await response.text()
    if (!response.ok) {
      throw new Error(`Archivage Outlook impossible (${messageId}): ${response.status} ${bodyText}`)
    }
    archivedCount += 1
  }

  return archivedCount
}

async function listPrisEmails(): Promise<GraphEmail[]> {
  const token = await ensureMicrosoftAccessToken()
  const emails: GraphEmail[] = []
  let deletedItemsFolderId: string | null = null

  try {
    const deletedFolderResponse = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/deleteditems?$select=id', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (deletedFolderResponse.ok) {
      const deletedFolder = (await deletedFolderResponse.json()) as { id?: string }
      deletedItemsFolderId = deletedFolder.id?.trim() ?? null
    }
  } catch {
    deletedItemsFolderId = null
  }

  let nextUrl: URL | null = new URL('https://graph.microsoft.com/v1.0/me/messages')
  nextUrl.searchParams.set('$top', '200')
  nextUrl.searchParams.set('$select', 'id,subject,from,conversationId,parentFolderId,receivedDateTime,categories')

  let pageCount = 0
  while (nextUrl && pageCount < 50) {
    pageCount += 1
    const response = await fetch(nextUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    const bodyText = await response.text()
    if (!response.ok) {
      throw new Error(`Microsoft Graph mail list a échoué: ${response.status} ${bodyText}`)
    }

    const parsed = JSON.parse(bodyText) as GraphEmailList
    if (Array.isArray(parsed.value)) {
      emails.push(...parsed.value)
    }

    nextUrl = parsed['@odata.nextLink'] ? new URL(parsed['@odata.nextLink']) : null
  }

  return emails.filter((email) => {
    const hasPrisCategory = (email.categories ?? []).some((category) => category.trim().toLowerCase() === 'pris')
    if (!hasPrisCategory) {
      return false
    }
    if (deletedItemsFolderId && email.parentFolderId === deletedItemsFolderId) {
      return false
    }
    return true
  })
}

async function closeTicketFromEmail(
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
  const worklogAdded = await addJiraWorklog(jira, normalizedJiraKey, worklogMinutes)
  await closeJiraIssue(jira, normalizedJiraKey)
  await removeJiraLabel(jira, normalizedJiraKey, 'PRIS')

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

function supportAssistantApi(): Plugin {
  return {
    name: 'support-assistant-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          next()
          return
        }

        try {
          if (req.method === 'POST' && req.url === '/api/connect/jira') {
            const { command, args } = CONNECTOR_COMMANDS.jira
            const result = await runCommand(command, args, ASSISTANT_PRO_DIR)
            sendJson(res, result.code === 0 ? 200 : 500, result)
            return
          }

          if (req.method === 'POST' && req.url === '/api/connect/microsoft') {
            const state = startMicrosoftLoginProcess()
            await new Promise((resolve) => setTimeout(resolve, 350))
            sendJson(res, 200, {
              code: state.code ?? 0,
              stdout:
                state.stdout.trim() ||
                'Connexion Microsoft lancée. Ouvre https://login.microsoft.com/device et saisis le code affiché.',
              stderr: state.stderr,
              running: state.isRunning,
              startedAt: state.startedAt,
              finishedAt: state.finishedAt,
            })
            return
          }

          if (req.method === 'GET' && req.url === '/api/connect/microsoft/status') {
            if (!microsoftLoginState) {
              sendJson(res, 404, {
                code: 1,
                stdout: '',
                stderr: '',
                error: "Aucune connexion Microsoft en cours. Clique d'abord sur 'Connecter Microsoft (skill)'.",
                running: false,
              })
              return
            }

            sendJson(res, 200, {
              code: microsoftLoginState.code ?? 0,
              stdout: microsoftLoginState.stdout,
              stderr: microsoftLoginState.stderr,
              running: microsoftLoginState.isRunning,
              startedAt: microsoftLoginState.startedAt,
              finishedAt: microsoftLoginState.finishedAt,
            })
            return
          }

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
            return
          }

          if (req.method === 'GET' && req.url === '/api/treatments') {
            const treatments = await readTreatmentsStore()
            sendJson(res, 200, {
              code: 0,
              stdout: '',
              stderr: '',
              treatments,
            })
            return
          }

          if (req.method === 'POST' && req.url === '/api/treatments/save') {
            const body = await readJsonBody(req)
            const treatments = body.treatments
            if (!treatments || typeof treatments !== 'object' || Array.isArray(treatments)) {
              sendJson(res, 400, { error: 'Invalid treatments payload' })
              return
            }

            await writeTreatmentsStore(treatments as TreatmentProgressStore)
            sendJson(res, 200, {
              code: 0,
              stdout: 'Traitements sauvegardés.',
              stderr: '',
            })
            return
          }

          if (req.method === 'POST' && req.url === '/api/codex/exec') {
            const body = await readJsonBody(req)
            const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
            const useSubagents = body.useSubagents === true

            if (!prompt) {
              sendJson(res, 400, { error: 'Missing prompt' })
              return
            }

            const finalPrompt = buildCodexPrompt(prompt, useSubagents)

            const outputFile = path.join('/tmp', `codex-last-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
            const result = await runCommand(
              'codex',
              ['exec', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, finalPrompt],
              APP_DIR,
              120000,
            )

            let lastMessage = ''
            try {
              lastMessage = (await readFile(outputFile, 'utf-8')).trimEnd()
            } catch {
              lastMessage = ''
            } finally {
              void unlink(outputFile).catch(() => undefined)
            }

            sendJson(res, result.code === 0 ? 200 : 500, {
              ...result,
              stdout: lastMessage || result.stdout,
              stderr: result.code === 0 ? '' : result.stderr,
            })
            return
          }

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
            return
          }

          if (req.method === 'POST' && req.url === '/api/jira/association/confirm') {
            const body = await readJsonBody(req)
            const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
            const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
            if (!threadId || !jiraKey) {
              sendJson(res, 400, { error: 'Missing threadId or jiraKey' })
              return
            }

            const map = await readThreadJiraMap()
            map[threadId] = jiraKey
            await writeThreadJiraMap(map)
            sendJson(res, 200, {
              code: 0,
              stdout: 'Association Jira sauvegardée.',
              stderr: '',
            })
            return
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
            const identification = await identifyDemandWithCodex({
              subject,
              sender,
              description,
            })
            sendJson(res, 200, {
              code: 0,
              stdout: '',
              stderr: '',
              identification: identification.identification,
              warnings: identification.warnings,
            })
            return
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
              return
            }
            const preview = await buildEmailPreview(previewMessage, microsoftToken, threadMessages)
            sendJson(res, 200, {
              code: 0,
              stdout: '',
              stderr: '',
              preview,
            })
            return
          }

          if (req.method === 'POST' && req.url === '/api/trace/execute') {
            const body = await readJsonBody(req)
            const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
            const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
            if (!jiraKey) {
              sendJson(res, 400, { error: 'Missing jiraKey' })
              return
            }
            const lockKey = `${jiraKey}::${email.conversationId?.trim() || email.id?.trim() || 'no-thread'}`
            if (TRACE_EXEC_LOCKS.has(lockKey)) {
              sendJson(res, 409, { error: 'Traçage déjà en cours pour ce ticket/thread.' })
              return
            }

            TRACE_EXEC_LOCKS.add(lockKey)
            try {
              const result = await traceRemainingEmailsInJira(email, jiraKey)
              sendJson(res, 200, {
                code: 0,
                stdout: `Traçage Jira terminé: ${result.added} commentaire(s) ajouté(s).`,
                stderr: '',
                result,
              })
            } finally {
              TRACE_EXEC_LOCKS.delete(lockKey)
            }
            return
          }

          if (req.method === 'POST' && req.url === '/api/ticket/worklog') {
            const body = await readJsonBody(req)
            const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim().toUpperCase() : ''
            const minutesRaw = Number(body.worklogMinutes)
            const worklogMinutes = Number.isFinite(minutesRaw) ? Math.floor(minutesRaw) : NaN
            if (!jiraKey) {
              sendJson(res, 400, { error: 'Missing jiraKey' })
              return
            }
            if (!Number.isFinite(worklogMinutes) || worklogMinutes < 0) {
              sendJson(res, 400, { error: 'worklogMinutes doit être >= 0.' })
              return
            }

            const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
            const added = await addJiraWorklog(jira, jiraKey, worklogMinutes)
            sendJson(res, 200, {
              code: 0,
              stdout: added ? `Worklog ajouté (${worklogMinutes} min) sur ${jiraKey}.` : `Aucun worklog ajouté sur ${jiraKey}.`,
              stderr: '',
              result: {
                jiraKey,
                worklogAdded: added,
                worklogMinutes,
              },
            })
            return
          }

          if (req.method === 'POST' && req.url === '/api/orochimaru/trace') {
            const body = await readJsonBody(req)
            const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
            const mode = body.mode === 'execute' ? 'execute' : 'analyze'
            const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
            const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
            const title = typeof body.title === 'string' ? body.title.trim() : ''
            const sender = typeof body.sender === 'string' ? body.sender.trim() : ''
            const guidance = typeof body.guidance === 'string' ? body.guidance.trim() : ''
            const email = (body.email as JiraAnalyzeInput | undefined) ?? {
              id: messageId || undefined,
              messageId: messageId || undefined,
              conversationId: threadId || undefined,
              title: title || undefined,
              sender: sender || undefined,
            }

            if (!jiraKey) {
              sendJson(res, 400, { error: 'Missing jiraKey' })
              return
            }

            if (mode === 'execute') {
              const result = await traceRemainingEmailsInJira(email, jiraKey)
              sendJson(res, 200, {
                code: 0,
                stdout: `Traçage Jira terminé: ${result.added} commentaire(s) ajouté(s).`,
                stderr: '',
                trace: {
                  status: 'completed',
                  summary: `Traçage exécuté: ${result.added} email(s) ajouté(s) en commentaire.`,
                  preview_items: [],
                  question: '',
                  actions_taken: (result.subjects ?? []).map((subject) => `Commentaire ajouté: ${subject}`),
                  confidence: 1,
                  blocking_reason: '',
                  needs_minutes: false,
                },
                result,
              })
              return
            }

            const buildOrochimaruPrompt = (extraInstructions: string[] = []): string =>
              [
                `Utilise le skill $orochimaru situé à ce chemin: ${OROCHIMARU_SKILL_PATH}.`,
                'Contexte opérationnel: support iObeya, traçage des réponses email dans un ticket Jira existant.',
                `Ticket Jira imposé (non négociable): ${jiraKey}`,
                "Interdiction stricte: ne jamais demander quel ticket Jira choisir; utilise uniquement celui imposé par l'application.",
                `ThreadId: ${threadId || 'inconnu'}`,
                `MessageId courant: ${messageId || 'inconnu'}`,
                `Titre email: ${title || 'inconnu'}`,
                `Expéditeur: ${sender || 'inconnu'}`,
                "Ne vérifie pas les accès Jira/Outlook: ils sont déjà validés au lancement de l'application.",
                "Règle métier obligatoire: vérifier si le ticket est à jour en comparant le dernier commentaire tracé Jira avec le dernier email du thread.",
                "S'il manque des emails tracés: constituer une file d'attente et tracer CHAQUE email manquant en ordre chronologique (du plus ancien au plus récent).",
                "Format obligatoire de début de commentaire: '<Prénom Nom de l'expéditeur> :' puis retour à la ligne.",
                "Interdiction stricte: traçage en commentaires Jira uniquement. Ne jamais modifier la description du ticket.",
                "Interdiction stricte: ne jamais ajouter de pièce jointe lors du traçage.",
                'Mode ANALYSE: ne fais aucune action destructive, prépare uniquement un aperçu des éléments à tracer.',
                guidance ? `Validation utilisateur / consignes: ${guidance}` : '',
                'Réponse courte uniquement. Pas de plan détaillé.',
                ...extraInstructions,
                'Réponds STRICTEMENT en JSON valide, sans markdown, avec ce schéma:',
                '{"status":"needs_validation|ready|completed|error","summary":"...","preview_items":[{"sender":"...","date":"...","subject":"...","excerpt":"...","attachments":["..."]}],"question":"...","actions_taken":["..."],"confidence":0.0,"blocking_reason":"...","needs_minutes":true}',
              ]
                .filter((line) => line.length > 0)
                .join('\n')

            const runOrochimaru = async (extraInstructions: string[] = []) => {
              const prompt = buildOrochimaruPrompt(extraInstructions)
              const outputFile = path.join('/tmp', `orochimaru-trace-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
              const result = await runCommand(
                'codex',
                ['exec', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, prompt],
                APP_DIR,
                180000,
              )

              let lastMessage = ''
              try {
                lastMessage = (await readFile(outputFile, 'utf-8')).trimEnd()
              } catch {
                lastMessage = ''
              } finally {
                void unlink(outputFile).catch(() => undefined)
              }

              const rawOutput = lastMessage || result.stdout || result.stderr
              const parsed = parseCodexJson<OrochimaruTraceResponse>(rawOutput)
              return { result, rawOutput, parsed }
            }

            let run = await runOrochimaru()
            if (run.result.code === 0 && orochimaruAsksToChooseJira(run.parsed)) {
              run = await runOrochimaru([
                'CORRECTION OBLIGATOIRE: ta réponse précédente demandait de choisir un ticket Jira.',
                "C'est interdit. Le ticket est déjà fixé. Reprends le traitement sans poser cette question.",
                `Ticket unique imposé: ${jiraKey}.`,
              ])
            }

            const { result, rawOutput, parsed } = run
            const basePayload =
              parsed ??
              ({
                status: result.code === 0 ? 'needs_validation' : 'error',
                summary:
                  result.code === 0
                    ? 'Orochimaru a répondu mais le format JSON attendu est invalide. Validation manuelle requise.'
                    : 'Erreur Orochimaru lors du traçage.',
                preview_items: [],
                question: 'Peux-tu préciser comment traiter ce cas ?',
                actions_taken: [],
                confidence: 0,
                blocking_reason: result.code === 0 ? '' : result.stderr || 'Commande Orochimaru en échec',
                needs_minutes: true,
              } satisfies OrochimaruTraceResponse)
            const payload = sanitizeOrochimaruTraceAgainstJiraChoice(basePayload, jiraKey)

            sendJson(res, result.code === 0 ? 200 : 500, {
              code: result.code,
              stdout: result.stdout,
              stderr: result.stderr,
              trace: {
                ...payload,
                raw: rawOutput,
              },
            })
            return
          }

          if (req.method === 'POST' && (req.url === '/api/jira/analyze' || req.url === '/api/jirayah/propose')) {
            const body = await readJsonBody(req)
            const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
            const identificationRaw = typeof body.identification === 'string' ? body.identification.trim() : ''
            const allowed: IdentificationCategory[] = [
              'Assistance',
              'Question',
              'Intervention livraison',
              'Intervention administration',
            ]
            if (!allowed.includes(identificationRaw as IdentificationCategory)) {
              sendJson(res, 400, {
                error:
                  'Identification invalide. Valeurs autorisées: Assistance, Question, Intervention livraison, Intervention administration.',
              })
              return
            }
            const proposal = await buildJiraProposal(email, identificationRaw as IdentificationCategory)
            sendJson(res, 200, {
              code: 0,
              stdout: '',
              stderr: '',
              proposal,
            })
            return
          }

          if (req.method === 'POST' && (req.url === '/api/jira/create' || req.url === '/api/jirayah/create')) {
            const body = await readJsonBody(req)
            const email = (body.email as JiraAnalyzeInput | undefined) ?? undefined
            const proposal = (body.proposal as JiraCreateInput | undefined) ?? undefined
            if (!proposal) {
              sendJson(res, 400, { error: 'Missing proposal' })
              return
            }

            const created = await createJiraIssue(proposal, email)
            const threadId = getThreadIdFromAnalyzeInput(email)
            if (threadId) {
              const map = await readThreadJiraMap()
              map[threadId] = created.key
              await writeThreadJiraMap(map)
            }

            sendJson(res, 200, {
              code: 0,
              stdout: '',
              stderr: '',
              issue: created,
            })
            return
          }

          if (req.method === 'POST' && req.url === '/api/ticket/close') {
            const body = await readJsonBody(req)
            const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
            const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
            const worklogMinutesRaw = typeof body.worklogMinutes === 'number' ? body.worklogMinutes : Number(body.worklogMinutes ?? 0)
            const worklogMinutes = Math.max(0, Math.floor(worklogMinutesRaw))

            if (!jiraKey) {
              sendJson(res, 400, { error: 'Missing jiraKey' })
              return
            }

            const result = await closeTicketFromEmail(email, jiraKey, worklogMinutes)
            sendJson(res, 200, {
              code: 0,
              stdout: `Ticket ${result.jiraKey} clôturé.`,
              stderr: '',
              result,
            })
            return
          }

          sendJson(res, 404, { error: 'Route not found' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), supportAssistantApi()],
})
