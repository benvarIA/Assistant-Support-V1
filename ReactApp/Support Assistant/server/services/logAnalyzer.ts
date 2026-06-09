import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { APP_DIR, LOG_ANALYZER_SKILL_PATH } from '../config.js'
import { parseCodexJson, runCommand, sanitizeCodexError } from '../utils.js'
import {
  downloadAttachmentBytes,
  extensionOf,
  extractUtf8Text,
  fetchIssue,
  readJiraConfigOrThrow,
  trimBlock,
  type JiraAttachment,
} from './jiraAttachments.js'
import { getModelArgs } from './settings.js'

type EffortLevel = 'low' | 'medium' | 'high'

type LogAnalyzerRunConfig = {
  model?: string
  effort?: EffortLevel
}

type ParsedAnalysis = {
  summary?: string
  report?: string
}

// Options de filtrage (définies localement pour éviter un import circulaire avec assistanceAgents).
type LogFilterOptions = {
  ignoreAuthErrors?: boolean
  skipPatterns?: string[]
}

type NormalizedFilter = {
  ignoreAuthErrors: boolean
  skipPatterns: string[] // déjà en minuscules
}

type LogFileText = { filename: string; text: string; note?: string }

type LogDigest = {
  filename: string
  totalLines: number
  levelCounts: Record<string, number>
  exceptions: { type: string; count: number; firstMessage: string; sample: string }[]
  topErrors: { pattern: string; count: number }[]
  timeline: { first: string; last: string } | null
  skipped: { auth: number; user: number }
  note?: string
}

// Bornes pour ne pas exploser la mémoire / le contexte / le CPU sur de gros logs.
const MAX_LOG_FILES = 6
const MAX_TEXT_CHARS = 4_000_000
const MAX_ZIP_ENTRIES = 12
const MAX_LINE_LEN = 2_000 // borne l'entrée des regex par ligne (garde-fou ReDoS)
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 30_000_000 // ne pas télécharger une PJ plus grosse
const MAX_DECOMPRESSED_BYTES = 64_000_000 // plafond de sortie gunzip (anti gzip-bomb)
const MAX_ZIP_ENTRY_BYTES = 16_000_000 // plafond de lecture par entrée zip

const LEVEL_RE = /\b(ERROR|SEVERE|FATAL|WARN(?:ING)?)\b/
const EXCEPTION_RE = /([\w.$]{1,200}(?:Exception|Error|Throwable))(?::\s*(.*))?/
const STACK_FRAME_RE = /^\s*(at\s+\S|Caused by:|\.{3}\s+\d+\s+more|Suppressed:)/
const TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|\d{2}[-/][A-Za-z]{3}[-/]\d{4}[ :]\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2}[.,]\d{3})/

// Signaux clairs d'erreurs d'authentification (alternation plate de littéraux — pas de ReDoS).
const AUTH_RE = /(\b401\b|\b403\b|unauthori[sz]ed|authenticat(?:ion|ed)?\s*(?:fail|error|exception|denied)|authentif|invalid\s+credential|bad\s*credential|login\s+fail|access\s+denied|acc[eè]s\s+refus|forbidden|securityexception|accessdenied(?:exception)?|authenticationexception|badcredentials|token\s+(?:expired|invalid)|session\s+expir)/i

function normalizeErrorPattern(line: string): string {
  return line
    .replace(TIMESTAMP_RE, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function isLogCandidate(filename: string, mimeType: string): boolean {
  const ext = extensionOf(filename)
  if (ext === 'log' || ext === 'out' || ext === 'gz' || ext === 'zip') return true
  if (ext === 'txt' && /log|catalina|tomcat|error|console|server|thread|dump|stack|trace/i.test(filename)) return true
  if (mimeType.startsWith('text/') && /log/i.test(filename)) return true
  return false
}

function preprocessLog(filename: string, rawText: string, filter: NormalizedFilter): LogDigest {
  const text = rawText.length > MAX_TEXT_CHARS ? rawText.slice(0, MAX_TEXT_CHARS) : rawText
  const note = rawText.length > MAX_TEXT_CHARS ? `Fichier tronqué à ${MAX_TEXT_CHARS} caractères pour analyse.` : undefined
  const lines = text.split('\n')

  const levelCounts: Record<string, number> = {}
  const exceptionMap = new Map<string, { count: number; firstMessage: string; sample: string }>()
  const errorPatternCounts = new Map<string, number>()
  let firstTs: string | null = null
  let lastTs: string | null = null
  const skipped = { auth: 0, user: 0 }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    // Borne l'entrée des regex : une ligne très longue (JSON/base64 minifié) provoquerait
    // un backtracking quadratique sur EXCEPTION_RE et bloquerait l'event loop.
    const probe = line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) : line

    // Filtres utilisateur : on retire la ligne avant tout comptage.
    if (filter.ignoreAuthErrors && AUTH_RE.test(probe)) { skipped.auth += 1; continue }
    if (filter.skipPatterns.length > 0) {
      const probeLower = probe.toLowerCase()
      if (filter.skipPatterns.some((p) => probeLower.includes(p))) { skipped.user += 1; continue }
    }

    const tsMatch = probe.match(TIMESTAMP_RE)
    if (tsMatch) {
      if (firstTs === null) firstTs = tsMatch[1]
      lastTs = tsMatch[1]
    }

    const levelMatch = probe.match(LEVEL_RE)
    if (levelMatch) {
      const level = levelMatch[1].toUpperCase().replace('WARNING', 'WARN')
      levelCounts[level] = (levelCounts[level] ?? 0) + 1
      if (level === 'ERROR' || level === 'SEVERE' || level === 'FATAL') {
        const pattern = normalizeErrorPattern(probe)
        if (pattern) errorPatternCounts.set(pattern, (errorPatternCounts.get(pattern) ?? 0) + 1)
      }
    }

    const excMatch = probe.match(EXCEPTION_RE)
    if (excMatch) {
      const type = excMatch[1]
      const message = (excMatch[2] ?? '').trim().slice(0, 200)
      // Capture un court extrait de stack (la ligne d'exception + les frames suivantes).
      const sampleLines = [probe.trim().slice(0, 500)]
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
        if (STACK_FRAME_RE.test(lines[j].slice(0, MAX_LINE_LEN))) sampleLines.push(lines[j].trim().slice(0, 500))
        else break
      }
      const sample = sampleLines.join('\n')
      const existing = exceptionMap.get(type)
      if (existing) {
        existing.count += 1
        // Conserver le message/échantillon le plus informatif (la 1ʳᵉ occurrence est souvent vide).
        if (message.length > existing.firstMessage.length) existing.firstMessage = message
        if (sample.length > existing.sample.length) existing.sample = sample
      } else {
        exceptionMap.set(type, { count: 1, firstMessage: message, sample })
      }
    }
  }

  const exceptions = [...exceptionMap.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  const topErrors = [...errorPatternCounts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  return {
    filename,
    totalLines: lines.length,
    levelCounts,
    exceptions,
    topErrors,
    timeline: firstTs && lastTs ? { first: firstTs, last: lastTs } : null,
    skipped,
    note,
  }
}

function formatDigest(digest: LogDigest): string {
  const levels = Object.entries(digest.levelCounts).map(([k, v]) => `${k}=${v}`).join(' · ') || 'aucun niveau détecté'
  const exceptionsText = digest.exceptions.length > 0
    ? digest.exceptions.map((e) => [
        `• ${e.type} (×${e.count})${e.firstMessage ? ` — ${e.firstMessage}` : ''}`,
        e.sample ? trimBlock(e.sample, 600) : '',
      ].filter(Boolean).join('\n')).join('\n')
    : 'Aucune exception/erreur typée détectée.'
  const errorsText = digest.topErrors.length > 0
    ? digest.topErrors.map((e) => `• ×${e.count} — ${e.pattern}`).join('\n')
    : 'Aucune ligne ERROR/SEVERE/FATAL répétée.'

  const skippedNote = digest.skipped.auth + digest.skipped.user > 0
    ? `Lignes ignorées (filtres) : ${digest.skipped.auth} auth · ${digest.skipped.user} motif(s) utilisateur`
    : ''

  return [
    `### ${digest.filename}`,
    `Lignes: ${digest.totalLines} · Niveaux: ${levels}`,
    digest.timeline ? `Période: ${digest.timeline.first} → ${digest.timeline.last}` : 'Période: indéterminée (aucun timestamp reconnu)',
    skippedNote,
    digest.note ? `Note: ${digest.note}` : '',
    '',
    'Exceptions / erreurs typées (dédupliquées, top 12) :',
    exceptionsText,
    '',
    'Messages ERROR récurrents (motifs normalisés, top 15) :',
    errorsText,
  ].filter(Boolean).join('\n')
}

async function extractZipTexts(bytes: Buffer): Promise<LogFileText[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'log-zip-'))
  const zipPath = path.join(dir, 'archive.zip')
  const out: LogFileText[] = []
  try {
    await writeFile(zipPath, bytes)
    const result = await runCommand('unzip', ['-o', '-q', zipPath, '-d', dir], APP_DIR, 30_000)
    if (result.code !== 0) {
      return [{ filename: 'archive.zip', text: '', note: `Décompression zip échouée: ${result.stderr.slice(0, 200)}` }]
    }
    const entries = await readdir(dir, { recursive: true, withFileTypes: true }) as unknown as { name: string; parentPath?: string; path?: string; isFile: () => boolean }[]
    let count = 0
    for (const entry of entries) {
      if (count >= MAX_ZIP_ENTRIES) break
      if (!entry.isFile()) continue
      const ext = extensionOf(entry.name)
      if (!(ext === 'log' || ext === 'txt' || ext === 'out')) continue
      const full = path.join(entry.parentPath ?? entry.path ?? dir, entry.name)
      if (full === zipPath) continue
      try {
        const st = await stat(full)
        if (st.size > MAX_ZIP_ENTRY_BYTES) {
          out.push({ filename: entry.name, text: '', note: `Entrée trop volumineuse (${st.size} o) — ignorée.` })
          count += 1
          continue
        }
        const buf = await readFile(full)
        out.push({ filename: entry.name, text: extractUtf8Text(buf) })
        count += 1
      } catch {
        // ignore unreadable entry
      }
    }
    if (out.length === 0) out.push({ filename: 'archive.zip', text: '', note: 'Aucun fichier .log/.txt/.out dans l’archive.' })
    return out
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function gatherLogTexts(attachments: JiraAttachment[]): Promise<LogFileText[]> {
  const jira = await readJiraConfigOrThrow()
  const candidates = attachments.filter((a) => isLogCandidate(a.filename?.trim() || '', a.mimeType?.trim() || ''))
  const out: LogFileText[] = []

  for (const attachment of candidates) {
    if (out.length >= MAX_LOG_FILES) break
    const filename = attachment.filename?.trim() || 'pièce jointe'
    if (Number(attachment.size ?? 0) > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
      out.push({ filename, text: '', note: `Trop volumineux (${attachment.size} o) — non téléchargé.` })
      continue
    }
    const dl = await downloadAttachmentBytes(jira, attachment)
    if (!dl.bytes) {
      out.push({ filename: dl.filename, text: '', note: `Téléchargement impossible: ${dl.error ?? 'inconnu'}` })
      continue
    }
    const ext = extensionOf(dl.filename)
    try {
      if (ext === 'gz') {
        const text = extractUtf8Text(gunzipSync(dl.bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }))
        out.push({ filename: dl.filename.replace(/\.gz$/i, ''), text })
      } else if (ext === 'zip') {
        const zipTexts = await extractZipTexts(dl.bytes)
        for (const z of zipTexts) {
          if (out.length >= MAX_LOG_FILES) break
          out.push(z)
        }
      } else {
        out.push({ filename: dl.filename, text: extractUtf8Text(dl.bytes) })
      }
    } catch (error) {
      out.push({ filename: dl.filename, text: '', note: `Lecture impossible: ${error instanceof Error ? error.message : 'erreur'}` })
    }
  }
  return out
}

function buildPrompt(jiraKey: string, digests: LogDigest[], skippedNote: string, guidance?: string): string {
  const digestsText = digests.map(formatDigest).join('\n\n---\n\n')
  return [
    `Utilise le skill $log-analyzer situé à ce chemin: ${LOG_ANALYZER_SKILL_PATH}.`,
    `Tu travailles UNIQUEMENT à partir des digests de logs fournis ci-dessous (déjà extraits et pré-analysés par l'application à partir des pièces jointes du ticket ${jiraKey}).`,
    `Ne tente aucun accès réseau ni aucune commande: tout est dans ce prompt.`,
    skippedNote ? skippedNote : '',
    '',
    'Réponds STRICTEMENT en JSON valide, sans markdown, avec ce schéma:',
    '{"summary":"résumé très court","report":"rapport structuré complet en sections numérotées"}',
    '',
    'Contraintes du rapport (français, exploitable par un agent support, aucune invention) :',
    '- sections numérotées (titres courts < 90 caractères) :',
    '  1. Erreurs critiques — les exceptions/erreurs les plus graves, avec leur signification',
    '  2. Patterns récurrents — ce qui revient le plus et ce que ça indique',
    '  3. Chronologie — ce que la période / l’ordre des erreurs suggère',
    '  4. Hypothèse de cause racine — la piste la plus probable',
    '  5. Prochaine action recommandée — quoi vérifier/demander ensuite',
    '- ne cite que des erreurs réellement présentes dans les digests',
    '- si les logs sont insuffisants/illisibles, le dire clairement',
    '',
    '=== DIGESTS DES LOGS ===',
    digestsText,
    guidance?.trim()
      ? ['', '=== COMPLEMENT UTILISATEUR POUR RELANCE ===', guidance.trim()].join('\n')
      : '',
  ].filter((line) => line.length > 0).join('\n')
}

async function getExecModelArgs(config: LogAnalyzerRunConfig): Promise<string[]> {
  if (config.model) {
    return ['-m', config.model, '-c', `model_reasoning_effort="${config.effort ?? 'medium'}"`]
  }
  return getModelArgs('treatment')
}

function normalizeParsedAnalysis(parsed: ParsedAnalysis | null, rawOutput: string): { summary: string; report: string } {
  if (parsed?.report?.trim()) {
    return {
      summary: parsed.summary?.trim() || 'Analyse des logs terminée.',
      report: parsed.report.trim(),
    }
  }
  return { summary: 'Analyse des logs terminée.', report: rawOutput.trim() || 'Aucun rapport retourné.' }
}

export async function runLogAnalyzerAgent(
  jiraKey: string,
  config?: LogAnalyzerRunConfig,
  guidance?: string,
  options?: LogFilterOptions,
): Promise<{ summary: string; report: string }> {
  const filter: NormalizedFilter = {
    ignoreAuthErrors: options?.ignoreAuthErrors === true,
    skipPatterns: (options?.skipPatterns ?? []).map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0),
  }

  const jira = await readJiraConfigOrThrow()
  const issue = await fetchIssue(jira, jiraKey)
  const attachments = Array.isArray(issue.fields?.attachment) ? issue.fields.attachment : []

  if (attachments.length === 0) {
    return {
      summary: `Aucune pièce jointe sur ${jiraKey}.`,
      report: `Aucune pièce jointe n'est présente sur le ticket ${jiraKey}. L'analyseur de logs lit les fichiers joints (.log/.out/.txt/.gz/.zip) — il n'y a rien à analyser.`,
    }
  }

  const files = await gatherLogTexts(attachments)
  const usable = files.filter((f) => f.text.trim().length > 0)

  if (usable.length === 0) {
    const notes = files.map((f) => `${f.filename}${f.note ? ` (${f.note})` : ''}`).join(', ')
    return {
      summary: `Aucun log exploitable trouvé en PJ de ${jiraKey}.`,
      report: `Aucun fichier de log exploitable n'a été trouvé parmi les pièces jointes de ${jiraKey} (.log/.out/.txt/.gz/.zip). Pièces examinées : ${notes || 'aucune candidate'}.`,
    }
  }

  const digests = usable.map((f) => preprocessLog(f.filename, f.text, filter))
  const skipped = files.filter((f) => f.text.trim().length === 0)
  const skippedFilesNote = skipped.length > 0
    ? `Note: ${skipped.length} pièce(s) non exploitée(s) : ${skipped.map((f) => `${f.filename}${f.note ? ` (${f.note})` : ''}`).join(', ')}.`
    : ''
  const filterNote = (filter.ignoreAuthErrors || filter.skipPatterns.length > 0)
    ? `Filtres actifs (lignes retirées des digests, à NE PAS commenter comme manquantes) : ${[
        filter.ignoreAuthErrors ? "erreurs d'authentification ignorées" : '',
        filter.skipPatterns.length > 0 ? `motifs ignorés = ${filter.skipPatterns.join(', ')}` : '',
      ].filter(Boolean).join(' ; ')}.`
    : ''
  const skippedNote = [filterNote, skippedFilesNote].filter(Boolean).join('\n')

  const prompt = buildPrompt(jiraKey, digests, skippedNote, guidance)
  const outputFile = path.join('/tmp', `log-analyzer-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
  const modelArgs = await getExecModelArgs(config ?? {})
  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
    APP_DIR,
    240_000,
  )

  let lastMessage = ''
  try {
    lastMessage = (await readFile(outputFile, 'utf-8')).trimEnd()
  } catch {
    lastMessage = ''
  } finally {
    void rm(outputFile, { force: true }).catch(() => undefined)
  }

  if (result.code !== 0) {
    throw new Error(sanitizeCodexError(result.stderr || result.stdout))
  }
  if (!lastMessage.trim()) {
    throw new Error("Codex n'a produit aucune sortie exploitable.")
  }

  const parsed = parseCodexJson<ParsedAnalysis>(lastMessage)
  return normalizeParsedAnalysis(parsed, lastMessage)
}
