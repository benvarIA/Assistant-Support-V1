import { inflateRawSync } from 'node:zlib'
import { CLIENT_KNOWLEDGE_META_PATH, CLIENT_TECH_INFO_PATH, JIRA_CONFIG_CACHE } from '../config.js'
import type { JiraConfig } from '../types.js'
import { readJsonFile, saveJsonFile } from '../utils.js'
import { buildJiraAuth } from './jira.js'
import {
  DEFAULT_LATEST_VERSION,
  invalidateClientTechInfoCache,
  isHostedSetup,
  type ClientTechInfo,
} from './clientTechInfo.js'
import {
  ensureMicrosoftAccessToken,
  fetchFileAttachmentBytesViaValue,
} from './microsoft.js'

// Sujet exact de l'export Salesforce quotidien (reçu ~07:00, archivé par l'utilisateur).
export const REPORT_SUBJECT = 'Report results (New Technical Information Report)'

// Setups attendus dans l'export. Sert uniquement à repérer une éventuelle nouvelle
// valeur (warning) — on n'écarte JAMAIS une ligne client sur ce seul critère.
const KNOWN_SETUPS = new Set([
  'Onsite',
  'Online Dedicated',
  'Mutualised TEAMPLUS',
  'Mutualised TEAM',
  'Mutualised PARTNERS',
  'Online NextGen - Enterprise',
  'Online NextGen - Team',
  'Online NextGen - Trial',
])

export type ClientKnowledgeSource = {
  messageId: string
  subject: string
  receivedDateTime: string | null
  attachmentName: string
  totalRecords: number
}

export type ClientKnowledgeStats = {
  added: number
  modified: number
  removed: number
  total: number
  addedNames: string[]
  removedNames: string[]
}

export type ClientKnowledgeMeta = {
  updatedAt: string
  latestVersion: string
  source: ClientKnowledgeSource | null
  stats: ClientKnowledgeStats | null
}

export type ClientKnowledge = {
  updatedAt: string | null
  latestVersion: string
  source: ClientKnowledgeSource | null
  stats: ClientKnowledgeStats | null
  count: number
  entries: ClientTechInfo[]
}

// ---------------------------------------------------------------------------
// Lecteur XLSX minimaliste, zéro dépendance (un .xlsx est un ZIP de XML).
// Suffisant pour l'export Salesforce (chaînes "inline", une feuille).
// ---------------------------------------------------------------------------

type ZipEntry = { method: number; compSize: number; localOffset: number }

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End Of Central Directory record (signature 0x06054b50), recherché depuis la fin.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('XLSX invalide : End Of Central Directory introuvable.')
  const cdCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  const entries = new Map<string, ZipEntry>()
  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const fnLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen)
    entries.set(name, { method, compSize, localOffset })
    p += 46 + fnLen + extraLen + commentLen
  }
  return entries
}

function readZipFile(buf: Buffer, entries: Map<string, ZipEntry>, name: string): Buffer | null {
  const e = entries.get(name)
  if (!e) return null
  if (e.compSize === 0) {
    // compSize=0 ⇒ ZIP « en flux » (data descriptor, bit 3 du flag) : la taille est reportée
    // après les données. Apache POI/Salesforce écrit des tailles correctes en répertoire central ;
    // on échoue clairement plutôt que de produire des données vides si le format change un jour.
    throw new Error(`Format XLSX non supporté (entrée « ${name} » sans taille — ZIP en flux).`)
  }
  if (e.localOffset + 30 > buf.length) {
    throw new Error(`XLSX invalide : en-tête local de « ${name} » hors limites.`)
  }
  const lfFnLen = buf.readUInt16LE(e.localOffset + 26)
  const lfExtraLen = buf.readUInt16LE(e.localOffset + 28)
  const dataStart = e.localOffset + 30 + lfFnLen + lfExtraLen
  if (dataStart + e.compSize > buf.length) {
    throw new Error(`XLSX invalide : données de « ${name} » hors limites du buffer.`)
  }
  const raw = buf.subarray(dataStart, dataStart + e.compSize)
  if (e.method === 0) return Buffer.from(raw)
  if (e.method === 8) return inflateRawSync(raw)
  throw new Error(`Méthode de compression ZIP non supportée : ${e.method}`)
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const out: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml))) {
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let text = ''
    let t: RegExpExecArray | null
    while ((t = tRe.exec(m[1]))) text += decodeXmlEntities(t[1])
    out.push(text)
  }
  return out
}

function parseSheet(xml: string, shared: string[]): Map<number, Record<string, string>> {
  const rows = new Map<number, Record<string, string>>()
  const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = cRe.exec(xml))) {
    const attrs = m[1] || ''
    const inner = m[2] || ''
    const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs)
    if (!refMatch) continue
    const col = refMatch[1]
    const rowNum = Number(refMatch[2])
    const typeMatch = /\bt="([^"]+)"/.exec(attrs)
    const type = typeMatch ? typeMatch[1] : null
    let val = ''
    if (type === 'inlineStr') {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
      let t: RegExpExecArray | null
      while ((t = tRe.exec(inner))) val += decodeXmlEntities(t[1])
    } else {
      const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)
      if (vMatch) {
        const raw = decodeXmlEntities(vMatch[1])
        val = type === 's' ? (shared[Number(raw)] ?? '') : raw
      }
    }
    val = val.trim()
    if (!val) continue
    let row = rows.get(rowNum)
    if (!row) { row = {}; rows.set(rowNum, row) }
    row[col] = val
  }
  return rows
}

export type ParsedReport = {
  entries: ClientTechInfo[]
  totalRecords: number
  unknownSetups: string[]
}

// Détecte la ligne d'en-tête par nom de colonne (robuste aux déplacements de
// colonnes) : la colonne « Version » est captée automatiquement si l'utilisateur
// l'ajoute un jour au rapport Salesforce, sans modification de code.
export function parseReportWorkbook(bytes: Buffer): ParsedReport {
  const entries = readZipEntries(bytes)
  const shared = parseSharedStrings(readZipFile(bytes, entries, 'xl/sharedStrings.xml')?.toString('utf8') ?? null)
  const sheetName = [...entries.keys()].find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  if (!sheetName) throw new Error('XLSX invalide : aucune feuille trouvée.')
  const rows = parseSheet(readZipFile(bytes, entries, sheetName)!.toString('utf8'), shared)

  // Repérer l'en-tête ("Technical Information: Name", "Set up", ...).
  let headerRow = 0
  const colmap: { name?: string; setup?: string; language?: string; status?: string; version?: string } = {}
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(r)!
    if (!Object.values(cells).some((v) => v.toLowerCase().startsWith('technical information'))) continue
    headerRow = r
    for (const [col, raw] of Object.entries(cells)) {
      const v = raw.toLowerCase()
      if (v.includes('name')) colmap.name = col
      else if (v.includes('set up') || v.includes('setup')) colmap.setup = col
      else if (v.includes('language')) colmap.language = col
      else if (v.includes('status of the platform')) colmap.status = col
      else if (v.includes('version')) colmap.version = col
    }
    break
  }
  if (!headerRow || !colmap.name || !colmap.setup) {
    throw new Error('Export Salesforce illisible : colonnes « Name » / « Set up » introuvables.')
  }

  const out: ClientTechInfo[] = []
  const unknownSetups = new Set<string>()
  const seen = new Set<string>()
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    if (r <= headerRow) continue
    const cells = rows.get(r)!
    const name = (cells[colmap.name] ?? '').trim()
    const setup = (cells[colmap.setup] ?? '').trim()
    const language = (colmap.language ? cells[colmap.language] : '')?.trim() ?? ''
    const status = (colmap.status ? cells[colmap.status] : '')?.trim() ?? ''
    const rawVersion = (colmap.version ? cells[colmap.version] : '')?.trim() ?? ''
    // Écarter les lignes de total / pied de tableau (nom vide, purement numérique, "Total"…).
    if (!name || !setup) continue
    if (/^\d+([.,]\d+)?$/.test(name) || /^\d+([.,]\d+)?$/.test(setup)) continue
    // Pied de tableau seulement (libellé EXACT) — ne JAMAIS écarter un vrai client dont le
    // nom commence par « Total » (ex. « Total Energies - TGITS »). La vraie ligne de total a
    // de toute façon un setup numérique, déjà filtré ci-dessus.
    if (/^(grand\s+)?total$/i.test(name)) continue
    if (!KNOWN_SETUPS.has(setup)) unknownSetups.add(setup)
    // Conserver les doublons légitimes (plusieurs plateformes par client) mais
    // dédupliquer les répétitions strictement identiques.
    const sig = `${name}|${setup}|${language}|${status}|${rawVersion}`
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push({ name, setup, language, status, version: deriveVersion(setup, rawVersion) })
  }

  return { entries: out, totalRecords: out.length, unknownSetups: [...unknownSetups] }
}

// 'latest' = hébergé iObeya (toujours à jour) · null = Onsite (version inconnue de
// l'export) · valeur explicite si l'export fournit une colonne version.
export function deriveVersion(setup: string, rawVersion: string): string | null {
  if (rawVersion) return rawVersion
  return isHostedSetup(setup) ? 'latest' : null
}

// ---------------------------------------------------------------------------
// Récupération de l'email d'export + de sa pièce jointe .xlsx via Microsoft Graph
// ---------------------------------------------------------------------------

type GraphMessage = {
  id: string
  subject?: string
  receivedDateTime?: string
  hasAttachments?: boolean
}

async function graphGet<T>(token: string, path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Graph ${path} : ${res.status} ${text}`)
  return JSON.parse(text) as T
}

// Trouve l'email d'export le plus récent. `$search` couvre toute la boîte (Inbox +
// Archive) ; on ajoute une requête explicite sur le dossier Archive par sécurité,
// puisque l'utilisateur archive automatiquement cet email.
export async function findLatestReportMessage(token: string): Promise<GraphMessage | null> {
  const select = 'id,subject,receivedDateTime,hasAttachments'
  const candidates = new Map<string, GraphMessage>()

  try {
    const searched = await graphGet<{ value?: GraphMessage[] }>(token, '/me/messages', {
      $search: `"${REPORT_SUBJECT}"`,
      $top: '25',
      $select: select,
    })
    for (const m of searched.value ?? []) candidates.set(m.id, m)
  } catch {
    // Index de recherche indisponible : on se rabat sur le dossier Archive ci-dessous.
  }

  try {
    const archived = await graphGet<{ value?: GraphMessage[] }>(token, '/me/mailFolders/archive/messages', {
      $filter: `startswith(subject,'${REPORT_SUBJECT.replace(/'/g, "''")}')`,
      $top: '25',
      $select: select,
    })
    for (const m of archived.value ?? []) candidates.set(m.id, m)
  } catch {
    // Pas de dossier Archive (ou filtre refusé) : `$search` reste la source principale.
  }

  const matches = [...candidates.values()]
    .filter((m) => (m.subject ?? '').trim().toLowerCase() === REPORT_SUBJECT.toLowerCase())
    .filter((m) => m.hasAttachments !== false)
    .sort((a, b) => new Date(b.receivedDateTime ?? 0).getTime() - new Date(a.receivedDateTime ?? 0).getTime())

  return matches[0] ?? null
}

type AttachmentRef = { id?: string; name?: string; contentType?: string }

async function downloadReportXlsx(token: string, messageId: string): Promise<{ bytes: Buffer; name: string }> {
  // NB : on liste les pièces jointes nous-mêmes avec un $select sûr — `contentId`
  // n'existe pas sur le type de base `microsoft.graph.attachment` et fait échouer
  // la requête (HTTP 400), d'où l'on n'utilise pas fetchMessageAttachmentRefs ici.
  const listed = await graphGet<{ value?: AttachmentRef[] }>(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/attachments`,
    { $select: 'id,name,contentType,size', $top: '50' },
  )
  const xlsx = (listed.value ?? []).find((a) => {
    const name = (a.name ?? '').toLowerCase()
    const type = (a.contentType ?? '').toLowerCase()
    return name.endsWith('.xlsx') || type.includes('spreadsheetml')
  })
  if (!xlsx?.id) throw new Error('Aucune pièce jointe .xlsx trouvée dans l’email d’export.')
  const bytes = await fetchFileAttachmentBytesViaValue(messageId, xlsx.id, token)
  if (!bytes || bytes.length === 0) throw new Error('Téléchargement de la pièce jointe .xlsx impossible.')
  return { bytes, name: xlsx.name ?? 'export.xlsx' }
}

// ---------------------------------------------------------------------------
// Lecture / écriture de la base de connaissances
// ---------------------------------------------------------------------------

function normName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function readEntries(): Promise<ClientTechInfo[]> {
  try {
    return await readJsonFile<ClientTechInfo[]>(CLIENT_TECH_INFO_PATH)
  } catch {
    return []
  }
}

async function readMeta(): Promise<ClientKnowledgeMeta | null> {
  try {
    return await readJsonFile<ClientKnowledgeMeta>(CLIENT_KNOWLEDGE_META_PATH)
  } catch {
    return null
  }
}

function diffEntries(prev: ClientTechInfo[], next: ClientTechInfo[]): ClientKnowledgeStats {
  const sigOf = (list: ClientTechInfo[]) => {
    const byName = new Map<string, string>()
    for (const e of list) {
      const key = normName(e.name)
      byName.set(key, `${byName.get(key) ?? ''}|${e.setup}/${e.language}/${e.status}/${e.version ?? ''}`)
    }
    return byName
  }
  const prevSig = sigOf(prev)
  const nextSig = sigOf(next)
  const displayByKey = new Map<string, string>()
  for (const e of next) displayByKey.set(normName(e.name), e.name)
  for (const e of prev) if (!displayByKey.has(normName(e.name))) displayByKey.set(normName(e.name), e.name)

  const addedNames: string[] = []
  const removedNames: string[] = []
  let modified = 0
  for (const [key, sig] of nextSig) {
    if (!prevSig.has(key)) addedNames.push(displayByKey.get(key) ?? key)
    else if (prevSig.get(key) !== sig) modified++
  }
  for (const key of prevSig.keys()) {
    if (!nextSig.has(key)) removedNames.push(displayByKey.get(key) ?? key)
  }
  return { added: addedNames.length, modified, removed: removedNames.length, total: next.length, addedNames, removedNames }
}

export async function readClientKnowledge(): Promise<ClientKnowledge> {
  const [entries, meta] = await Promise.all([readEntries(), readMeta()])
  return {
    updatedAt: meta?.updatedAt ?? null,
    latestVersion: meta?.latestVersion || DEFAULT_LATEST_VERSION,
    source: meta?.source ?? null,
    stats: meta?.stats ?? null,
    count: entries.length,
    entries,
  }
}

// Sérialise les rafraîchissements : un clic manuel et la routine hebdomadaire ne doivent
// jamais réécrire les fichiers en même temps. Les appels concurrents partagent le même résultat.
let refreshInFlight: Promise<ClientKnowledge> | null = null

export function refreshClientKnowledge(): Promise<ClientKnowledge> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefreshClientKnowledge().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

async function doRefreshClientKnowledge(): Promise<ClientKnowledge> {
  const token = await ensureMicrosoftAccessToken()
  const message = await findLatestReportMessage(token)
  if (!message) {
    throw new Error(`Email « ${REPORT_SUBJECT} » introuvable dans Outlook (Inbox + Archive).`)
  }
  const { bytes, name } = await downloadReportXlsx(token, message.id)
  const parsed = parseReportWorkbook(bytes)
  if (parsed.entries.length === 0) {
    throw new Error('Export Salesforce vide ou illisible : aucune fiche client extraite.')
  }
  if (parsed.unknownSetups.length > 0) {
    console.warn(`[client-knowledge] Setups inconnus dans l'export : ${parsed.unknownSetups.join(', ')}`)
  }

  const prev = await readEntries()
  const stats = diffEntries(prev, parsed.entries)
  const existingMeta = await readMeta()
  // Auto-détecte la dernière version online depuis IOBEXP (best effort : on garde
  // la valeur existante / le défaut si Jira est indisponible).
  const detectedVersion = await fetchLatestRolloutVersion().catch((err) => {
    console.warn(`[client-knowledge] Détection version Roll-Out IOBEXP échouée: ${err instanceof Error ? err.message : err}`)
    return null
  })
  const meta: ClientKnowledgeMeta = {
    updatedAt: new Date().toISOString(),
    latestVersion: detectedVersion || existingMeta?.latestVersion || DEFAULT_LATEST_VERSION,
    source: {
      messageId: message.id,
      subject: message.subject ?? REPORT_SUBJECT,
      receivedDateTime: message.receivedDateTime ?? null,
      attachmentName: name,
      totalRecords: parsed.totalRecords,
    },
    stats,
  }

  await saveJsonFile(CLIENT_TECH_INFO_PATH, parsed.entries)
  await saveJsonFile(CLIENT_KNOWLEDGE_META_PATH, meta)
  invalidateClientTechInfoCache()

  console.log(`[client-knowledge] Rafraîchi : ${stats.total} clients (` +
    `${stats.added} ajoutés, ${stats.modified} modifiés, ${stats.removed} retirés) depuis « ${name} ».`)

  return readClientKnowledge()
}

// ---------------------------------------------------------------------------
// Détection de la « dernière version online » via Jira.
// Source de vérité : le TOUT DERNIER ticket « Roll-Out » fermé du projet IOBEXP
// (trié par date de clôture décroissante), dont le titre contient la version,
// ex. « Roll-Out 4.47 - Parc Online ».
// ---------------------------------------------------------------------------

const ROLLOUT_VERSION_RE = /roll[\s-]?out\s+v?(\d+(?:\.\d+){1,2})/i
const ROLLOUT_JQL = 'project = IOBEXP AND summary ~ "Roll-Out" AND statusCategory = Done ORDER BY resolutiondate DESC'

export async function fetchLatestRolloutVersion(): Promise<string | null> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = new URL(`${baseUrl}/rest/api/3/search/jql`)
  url.searchParams.set('jql', ROLLOUT_JQL)
  url.searchParams.set('maxResults', '25')
  url.searchParams.set('fields', 'summary')
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Recherche Roll-Out IOBEXP impossible: ${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json() as { issues?: { fields?: { summary?: string } }[] }
  const issues = Array.isArray(data.issues) ? data.issues : []
  // Tickets triés par date de clôture décroissante : on prend la version du tout premier
  // (= dernier fermé) dont le titre contient une version exploitable.
  for (const issue of issues) {
    const match = issue.fields?.summary?.match(ROLLOUT_VERSION_RE)
    if (match) return match[1]
  }
  return null
}

// Détecte la dernière version Roll-Out IOBEXP et l'enregistre comme « latest ».
export async function autoDetectAndUpdateLatestVersion(): Promise<ClientKnowledge> {
  const detected = await fetchLatestRolloutVersion()
  if (!detected) {
    throw new Error('Aucun ticket « Roll-Out » fermé exploitable trouvé sur IOBEXP.')
  }
  return updateLatestVersion(detected)
}

export async function updateLatestVersion(version: string): Promise<ClientKnowledge> {
  const clean = version.trim()
  if (!clean) throw new Error('Version invalide.')
  const meta = (await readMeta()) ?? {
    updatedAt: new Date().toISOString(),
    latestVersion: DEFAULT_LATEST_VERSION,
    source: null,
    stats: null,
  }
  meta.latestVersion = clean
  await saveJsonFile(CLIENT_KNOWLEDGE_META_PATH, meta)
  return readClientKnowledge()
}

// Âge de la base en ms (Infinity si jamais rafraîchie) — utilisé par le planificateur.
export async function getClientKnowledgeAgeMs(): Promise<number> {
  const meta = await readMeta()
  if (!meta?.updatedAt) return Number.POSITIVE_INFINITY
  const ts = new Date(meta.updatedAt).getTime()
  return Number.isFinite(ts) ? Date.now() - ts : Number.POSITIVE_INFINITY
}
