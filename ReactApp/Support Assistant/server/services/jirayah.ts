import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { APP_DIR, CLIENT_DEPLOYMENT_MAPPING_PATH, JIRAYAH_RULES_PATH, TSUNADE_SKILL_PATH } from '../config.js'
import { lookupClientTechInfo, setupToJiraDeployment } from './clientTechInfo.js'
import type {
  IdentificationCategory,
  JiraAnalyzeInput,
  JiraProposal,
} from '../types.js'
import { extractJsonObject, runCommand, sanitizeCodexError, stripReplyPrefixes } from '../utils.js'
import { getModelArgs } from './settings.js'
import {
  cutAtSignatureAndQuote,
  ensureMicrosoftAccessToken,
  listThreadAttachmentCandidates,
  listThreadMessages,
  stripHtml,
} from './microsoft.js'
import {
  ISSUE_TYPES,
  SUBTYPE_OPTIONS,
  normalizeClientKey,
  normalizeForMatch,
  readJiraClientsReferenceValues,
  tokenizeForMatch,
} from './jira.js'

// ---------------------------------------------------------------------------
// Client hint helpers
// ---------------------------------------------------------------------------

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
    if (domain) domains.add(domain)
  }
  return Array.from(domains)
}

function tokenizeDomain(domain: string): string[] {
  const parts = domain.toLowerCase().split('.').map((p) => p.trim()).filter((p) => p.length >= 3)
  if (parts.length === 0) return []
  return parts.slice(0, -1) // skip TLD
}

function inferClientHintsFromSenders(clientOptions: string[], senders: string[]): string[] {
  const domainTokens = new Set<string>()
  for (const sender of senders) {
    if (isIobeyaSender(sender)) continue
    for (const domain of extractEmailDomains(sender)) {
      for (const token of tokenizeDomain(domain)) {
        if (token.length >= 3) domainTokens.add(token)
      }
    }
  }
  if (domainTokens.size === 0) return []
  const ranked = clientOptions
    .map((option) => {
      const optionTokens = normalizeClientKey(option).split(' ').filter(Boolean)
      let score = 0
      for (const token of domainTokens) {
        if (optionTokens.includes(token)) score += 12
        else if (normalizeClientKey(option).includes(token)) score += 4
      }
      return { option, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.localeCompare(b.option))
  return ranked.slice(0, 5).map((item) => item.option)
}

function rankClientHintsFromContext(
  clientOptions: string[],
  contextText: string,
  senders: string[],
): Array<{ option: string; score: number }> {
  const normalizedContext = normalizeClientKey(contextText)
  const contextTokens = new Set(tokenizeForMatch(contextText, 3))
  const domainTokens = new Set<string>()
  for (const sender of senders) {
    if (isIobeyaSender(sender)) continue
    for (const domain of extractEmailDomains(sender)) {
      for (const token of tokenizeDomain(domain)) {
        if (token.length >= 3) domainTokens.add(token)
      }
    }
  }
  const ranked = clientOptions
    .map((option) => {
      const normalizedOption = normalizeClientKey(option)
      const optionTokens = new Set(normalizedOption.split(' ').filter((t) => t.length >= 3))
      let score = 0
      if (normalizedContext.includes(normalizedOption) && normalizedOption.length >= 4) score += 40
      for (const token of domainTokens) {
        if (optionTokens.has(token)) score += 28
        else if (normalizedOption.includes(token)) score += 10
      }
      for (const token of contextTokens) {
        if (optionTokens.has(token)) score += 6
        else if (normalizedOption.includes(token)) score += 2
      }
      return { option, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.localeCompare(b.option))
  return ranked.slice(0, 8)
}

function pickStrongHeuristicClient(ranked: Array<{ option: string; score: number }>): string | null {
  if (ranked.length === 0) return null
  const top = ranked[0]
  const second = ranked[1]
  if (!second) return top.score >= 24 ? top.option : null
  const delta = top.score - second.score
  if (top.score >= 30 && delta >= 8) return top.option
  return null
}

function resolveClientOption(candidate: string | undefined, options: string[]): string {
  const trimmed = candidate?.trim() || ''
  if (!trimmed || trimmed.toLowerCase() === 'tbd') return 'TBD'
  const exact = options.find((o) => o === trimmed)
  if (exact) return exact
  const normalized = normalizeForMatch(trimmed)
  const close = options.find((o) => normalizeForMatch(o) === normalized)
  if (close) return close
  return 'TBD'
}

function normalizeClientCandidates(candidates: string[] | undefined, options: string[]): string[] {
  const resolved: string[] = []
  for (const candidate of candidates ?? []) {
    const mapped = resolveClientOption(candidate, options)
    if (mapped && !resolved.includes(mapped)) resolved.push(mapped)
    if (resolved.length >= 3) break
  }
  return resolved
}

function shortlistClientOptions(
  options: string[],
  context: { subject: string; description: string; sender: string; otherSenders: string[]; preferredClients: string[] },
  maxCount = 120,
): string[] {
  if (options.length <= maxCount) return options
  const rawContext = `${context.subject}\n${context.sender}\n${context.otherSenders.join('\n')}\n${context.description.slice(0, 1800)}`
  const tokens = Array.from(
    new Set(
      normalizeClientKey(rawContext)
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length >= 3),
    ),
  )
  const preferred = new Set(context.preferredClients)
  const scored = options.map((option, index) => {
    const normalizedOption = normalizeClientKey(option)
    let score = 0
    if (preferred.has(option)) score += 40
    for (const token of tokens) {
      if (!token) continue
      if (normalizedOption === token) score += 8
      else if (normalizedOption.startsWith(`${token} `) || normalizedOption.endsWith(` ${token}`)) score += 4
      else if (normalizedOption.includes(token)) score += 2
    }
    return { option, score, index }
  })
  const withSignals = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
  if (withSignals.length >= maxCount) return withSignals.slice(0, maxCount).map((item) => item.option)
  const selected = new Set(withSignals.map((item) => item.option))
  const result = withSignals.map((item) => item.option)
  for (const option of options) {
    if (selected.has(option)) continue
    result.push(option)
    if (result.length >= maxCount) break
  }
  return result
}

// ---------------------------------------------------------------------------
// Client deployment mapping (Assistance subtype inference)
// ---------------------------------------------------------------------------

let clientDeploymentMapCache: Map<string, string> | null = null

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1 }
      else inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) { cells.push(current); current = ''; continue }
    current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

async function readClientDeploymentMap(): Promise<Map<string, string>> {
  if (clientDeploymentMapCache) return clientDeploymentMapCache
  const map = new Map<string, string>()
  try {
    const raw = await readFile(CLIENT_DEPLOYMENT_MAPPING_PATH, 'utf-8')
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length <= 1) { clientDeploymentMapCache = map; return map }
    const header = parseCsvLine(lines[0])
    const clientIdx = header.indexOf('jira_client_name')
    const deploymentIdx = header.indexOf('jira_deploiement_field')
    const conflictIdx = header.indexOf('is_conflict')
    if (clientIdx < 0 || deploymentIdx < 0) { clientDeploymentMapCache = map; return map }
    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i])
      const clientName = cells[clientIdx]?.trim()
      const deployment = cells[deploymentIdx]?.trim()
      const conflict = conflictIdx >= 0 ? cells[conflictIdx]?.trim().toLowerCase() : 'no'
      if (!clientName || !deployment || conflict === 'yes') continue
      map.set(normalizeClientKey(clientName), deployment)
    }
  } catch {
    // mapping file optional
  }
  clientDeploymentMapCache = map
  return map
}

async function inferDeploymentSubtype(client: string, clientCandidates: string[]): Promise<string | null> {
  // New technical info reference takes priority
  for (const name of [client, ...clientCandidates]) {
    if (!name) continue
    const info = await lookupClientTechInfo(name)
    if (info?.setup) {
      const jiraValue = setupToJiraDeployment(info.setup)
      if (jiraValue) return jiraValue
    }
  }
  // Fall back to legacy CSV mapping
  const deploymentMap = await readClientDeploymentMap()
  if (deploymentMap.size === 0) return null
  for (const name of [client, ...clientCandidates]) {
    const key = normalizeClientKey(name || '')
    if (!key) continue
    const match = deploymentMap.get(key)
    if (match) return match
  }
  return null
}

// ---------------------------------------------------------------------------
// Jira proposal helpers
// ---------------------------------------------------------------------------

function inferProjectKey(existingJiraKey: string | null | undefined): string {
  if (!existingJiraKey) return 'SUPIOBEYA'
  const project = existingJiraKey.split('-')[0]?.trim().toUpperCase()
  return project || 'SUPIOBEYA'
}

async function fetchClientNameOptions(): Promise<string[]> {
  const referenceValues = await readJiraClientsReferenceValues()
  if (referenceValues.length > 0) return referenceValues

  // Dynamic import to avoid circular dep at module load time
  const { refreshJiraClientsReference } = await import('./jira.js')
  await refreshJiraClientsReference()
  const values = await readJiraClientsReferenceValues()
  if (values.length > 0) return values
  throw new Error('Impossible de charger les clients Jira (reference + live).')
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
    subtypeOptions: ['Onsite', 'Online', 'Mutualisee (Team+, Team, Partners)', 'TO BE DEFINED'],
  }
}

// ---------------------------------------------------------------------------
// AI classification (codex)
// ---------------------------------------------------------------------------

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
  type CodexClassification = { issueType?: string; subtypeValue?: string | null; client?: string; clientCandidates?: string[]; warnings?: string[]; confidence?: number }
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
  const clientOptionsBlock = shortlistedClientOptions.length > 0
    ? shortlistedClientOptions.map((o) => `- ${o}`).join('\n')
    : '- (aucune option disponible)'
  const otherSendersBlock = input.otherSenders.length > 0
    ? input.otherSenders.map((s) => `- ${s}`).join('\n')
    : '- (aucun)'
  const hintedClientsBlock = hintedClients.length > 0
    ? hintedClients.map((c) => `- ${c}`).join('\n')
    : '- (aucun indice domaine exploitable)'

  const prompt = [
    'Tu es JiraYah. Classe un email support en appliquant strictement le referentiel.',
    'Tu dois raisonner avec les regles et renvoyer uniquement un JSON valide.',
    '',
    'REFERENTIEL:',
    rules,
    '',
    'DONNEES EMAIL:',
    `Sujet: ${input.subject}`,
    `Expediteur: ${input.sender}`,
    `Expediteur iObeya: ${input.senderIsIobeya ? 'oui' : 'non'}`,
    'Autres expediteurs du thread:',
    otherSendersBlock,
    'Clients suggeres par les domaines expediteurs non-iObeya (indice fort):',
    hintedClientsBlock,
    'Description (copie client):',
    input.description,
    '',
    'OPTIONS CLIENT NAME JIRA (choisir exactement une valeur de cette liste si possible):',
    clientOptionsBlock,
    '',
    'CONTRAINTES:',
    '- issueType doit etre exactement: Assistance, Intervention, Information, Incident.',
    '- subtypeValue doit etre null pour Incident, sinon une valeur valide pour le type choisi.',
    '- clientCandidates doit contenir exactement 3 propositions classees (plus probable en premier).',
    '- client doit etre la proposition #1 de clientCandidates.',
    '- warnings est un tableau de chaines court, vide si confiance forte.',
    '',
    'FORMAT DE SORTIE (JSON uniquement, sans markdown):',
    '{"issueType":"...","subtypeValue":"...|null","client":"...","clientCandidates":["...","...","..."],"warnings":["..."],"confidence":0.0}',
  ].join('\n')

  const modelArgs = await getModelArgs('tickets')
  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
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
    throw new Error(sanitizeCodexError(result.stderr || raw))
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as CodexClassification
  const issueTypeRaw = (parsed.issueType || '').trim()
  if (!Object.prototype.hasOwnProperty.call(ISSUE_TYPES, issueTypeRaw)) {
    throw new Error(`Issue type invalide renvoye par Codex: "${issueTypeRaw || 'vide'}"`)
  }
  const issueType = issueTypeRaw as JiraProposal['issueType']
  const subtypeOptions = (SUBTYPE_OPTIONS[issueType] as ReadonlyArray<{ value: string }>).map((o) => o.value)
  let subtypeValue = parsed.subtypeValue ?? null
  if (issueType === 'Incident') {
    subtypeValue = null
  } else if (!subtypeValue || !subtypeOptions.includes(subtypeValue)) {
    throw new Error(`Sous-type invalide renvoye par Codex pour ${issueType}.`)
  }

  let client = resolveClientOption(parsed.client, shortlistedClientOptions)
  if (client === 'TBD' && hintedClients.length > 0) client = hintedClients[0]
  const clientCandidates = normalizeClientCandidates(parsed.clientCandidates, shortlistedClientOptions)
  if (!clientCandidates.includes(client)) clientCandidates.unshift(client)
  while (clientCandidates.length < 3 && shortlistedClientOptions.length > 0) {
    const filler = shortlistedClientOptions.find((o) => !clientCandidates.includes(o))
    if (!filler) break
    clientCandidates.push(filler)
  }
  const boundedCandidates = clientCandidates.slice(0, 3)
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((v): v is string => typeof v === 'string') : []
  if (typeof parsed.confidence === 'number' && parsed.confidence < 0.6) {
    warnings.push('Confiance faible: verifier la classification avant creation.')
  }

  return { issueType, subtypeValue, client, clientCandidates: boundedCandidates, warnings }
}

// ---------------------------------------------------------------------------
// AI identification (codex)
// ---------------------------------------------------------------------------

export async function identifyDemandWithCodex(input: {
  subject: string
  description: string
  sender: string
}): Promise<{ identification: IdentificationCategory; warnings: string[] }> {
  type CodexIdentification = { identification?: string; confidence?: number; warnings?: string[] }
  const outputFile = path.join('/tmp', `jirayah-identify-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  const prompt = [
    `Utilise le skill $tsunade situe a ce chemin: ${TSUNADE_SKILL_PATH}.`,
    'Tu es Tsunade, specialiste de l identification initiale des emails support.',
    'Objectif: identifier rapidement le type de demande d un email support.',
    'Repondre uniquement en JSON valide.',
    '',
    'Categories autorisees (exactes):',
    '- Assistance',
    '- Question',
    '- Intervention livraison',
    '- Intervention administration',
    '',
    'Sujet:',
    input.subject,
    '',
    'Expediteur:',
    input.sender,
    '',
    'Description:',
    input.description,
    '',
    'Regles:',
    '- Intervention administration: action operationnelle admin/run (creation/modification utilisateur, salle, droits, parametres).',
    '- Intervention livraison: livraison/renouvellement/ajustement de licence.',
    '- Question: simple demande d information.',
    '- Assistance: accompagnement/aide hors cas ci-dessus.',
    '',
    'Sortie JSON uniquement:',
    '{"identification":"Assistance|Question|Intervention livraison|Intervention administration","confidence":0.0,"warnings":["..."]}',
  ].join('\n')

  const modelArgs = await getModelArgs('tickets')
  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
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
    throw new Error(sanitizeCodexError(result.stderr || raw))
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as CodexIdentification
  const identification = (parsed.identification || '').trim() as IdentificationCategory
  const allowed: IdentificationCategory[] = ['Assistance', 'Question', 'Intervention livraison', 'Intervention administration']
  if (!allowed.includes(identification)) {
    throw new Error(`Identification invalide renvoyee: "${parsed.identification || 'vide'}"`)
  }

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((v): v is string => typeof v === 'string') : []
  if (typeof parsed.confidence === 'number' && parsed.confidence < 0.6) {
    warnings.push("Confiance faible: verifier l identification.")
  }

  return { identification, warnings }
}

// ---------------------------------------------------------------------------
// Proposal builder
// ---------------------------------------------------------------------------

export async function buildJiraProposal(input: JiraAnalyzeInput, identification: IdentificationCategory): Promise<JiraProposal> {
  const microsoftToken = await ensureMicrosoftAccessToken()
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
        .map((m) => {
          const senderName = m.from?.emailAddress?.name?.trim() || ''
          const senderAddress = m.from?.emailAddress?.address?.trim() || ''
          if (senderName && senderAddress) return `${senderName} <${senderAddress}>`
          return senderAddress || senderName
        })
        .filter((v): v is string => Boolean(v)),
    ),
  )
  const threadContextText = threadMessages
    .map((m) => cutAtSignatureAndQuote(stripHtml(m.body?.content?.trim() || '')))
    .filter((v) => v.length > 0)
    .slice(0, 5)
    .join('\n\n')

  const clientOptions = await fetchClientNameOptions()
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
    otherSenders: threadSenders.filter((v) => normalizeForMatch(v) !== normalizeForMatch(sender)),
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
      otherSenders: threadSenders.filter((v) => normalizeForMatch(v) !== normalizeForMatch(sender)),
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
    warnings.push('Client prerempli rapidement: a verifier avant validation.')
  }

  if (mapped.issueType === 'Assistance') {
    const inferredDeployment = await inferDeploymentSubtype(client, clientCandidates)
    if (inferredDeployment && subtypeOptions.includes(inferredDeployment)) {
      validSubtype = inferredDeployment
      warnings.push(`Type de deploiement prerempli depuis la reference client: ${inferredDeployment}.`)
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
