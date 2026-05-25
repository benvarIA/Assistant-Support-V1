import path from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { ANALYSE_TICKET_SKILL_PATH, APP_DIR, JIRA_CONFIG_CACHE } from '../config.js'
import type { JiraConfig, JiraIssueComment } from '../types.js'
import { parseCodexJson, readJsonFile, runCommand, sanitizeCodexError } from '../utils.js'
import { adfNodeToText, buildJiraAuth, fetchJiraComments } from './jira.js'
import { getModelArgs } from './settings.js'

type AnalysisRunConfig = {
  model?: string
  effort?: 'low' | 'medium' | 'high'
}

type JiraAttachment = {
  id?: string
  filename?: string
  mimeType?: string
  size?: number
  content?: string
}

type JiraIssueFields = {
  summary?: string
  description?: Record<string, unknown> | null
  issuetype?: { name?: string }
  status?: { name?: string }
  priority?: { name?: string }
  reporter?: { displayName?: string; emailAddress?: string }
  assignee?: { displayName?: string; emailAddress?: string } | null
  created?: string
  updated?: string
  labels?: string[]
  attachment?: JiraAttachment[]
}

type JiraIssueResponse = {
  key?: string
  fields?: JiraIssueFields
}

type AttachmentAnalysis = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  extractedText: string
  extractionNote?: string
}

type ParsedAnalysis = {
  summary?: string
  report?: string
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'json', 'xml', 'csv', 'md', 'markdown', 'yml', 'yaml', 'ini', 'conf', 'config', 'properties',
  'sql', 'js', 'ts', 'tsx', 'jsx', 'html', 'htm', 'svg', 'sh',
])

function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString()
}

function trimBlock(text: string, maxChars = 12_000): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n[…tronqué ${trimmed.length - maxChars} caractères]`
}

function isProbablyTextAttachment(filename: string, mimeType: string): boolean {
  const ext = filename.split('.').pop()?.trim().toLowerCase() || ''
  if (mimeType.startsWith('text/')) return true
  if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript')) return true
  return TEXT_EXTENSIONS.has(ext)
}

function extractUtf8Text(buffer: Buffer): string {
  return buffer
    .toString('utf-8')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function printableRatio(input: string): number {
  if (!input) return 0
  let printable = 0
  for (const char of input) {
    const code = char.charCodeAt(0)
    if (char === '\n' || char === '\t' || (code >= 32 && code < 65533)) printable += 1
  }
  return printable / input.length
}

async function extractAttachmentText(filename: string, mimeType: string, bytes: Buffer): Promise<{ text: string; note?: string }> {
  if (isProbablyTextAttachment(filename, mimeType)) {
    return { text: trimBlock(extractUtf8Text(bytes), 16_000) }
  }

  const utf8 = extractUtf8Text(bytes)
  if (utf8 && printableRatio(utf8) >= 0.85) {
    return {
      text: trimBlock(utf8, 8_000),
      note: 'Extraction dégradée depuis un fichier non typé comme texte.',
    }
  }

  const ext = filename.split('.').pop()?.trim().toLowerCase() || ''
  if (ext === 'pdf') {
    const tmpFile = path.join('/tmp', `analyse-ticket-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`)
    try {
      await writeFile(tmpFile, bytes)
      const result = await runCommand('pdftotext', [tmpFile, '-'], APP_DIR, 20_000)
      if (result.code === 0 && result.stdout.trim()) {
        return { text: trimBlock(result.stdout, 16_000), note: 'Texte extrait du PDF via pdftotext.' }
      }
    } catch {
      // best effort only
    } finally {
      void unlink(tmpFile).catch(() => undefined)
    }
  }

  return {
    text: '[Contenu binaire non textuel — impossible d’extraire un texte exploitable automatiquement.]',
    note: 'Lecture limitée aux métadonnées du fichier.',
  }
}

async function readJiraConfigOrThrow(): Promise<JiraConfig> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  buildJiraAuth(jira)
  return jira
}

async function fetchIssue(jira: JiraConfig, jiraKey: string): Promise<JiraIssueResponse> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}`)
  url.searchParams.set('fields', 'summary,description,issuetype,status,priority,reporter,assignee,created,updated,labels,attachment')
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Lecture ticket Jira impossible (${jiraKey}): ${response.status} ${body}`)
  }
  return await response.json() as JiraIssueResponse
}

async function downloadAttachment(jira: JiraConfig, attachment: JiraAttachment): Promise<AttachmentAnalysis> {
  const id = attachment.id?.trim() || ''
  const filename = attachment.filename?.trim() || `attachment-${id || 'unknown'}`
  const mimeType = attachment.mimeType?.trim() || 'application/octet-stream'
  const sizeBytes = Number(attachment.size ?? 0)
  if (!id) {
    return {
      id: 'unknown',
      filename,
      mimeType,
      sizeBytes,
      extractedText: '[Pièce jointe Jira sans identifiant exploitable.]',
      extractionNote: 'Téléchargement impossible.',
    }
  }

  const { baseUrl, auth } = buildJiraAuth(jira)
  const contentUrl = attachment.content?.trim() || `${baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(id)}`
  const response = await fetch(contentUrl, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: '*/*' },
  })
  if (!response.ok) {
    const body = await response.text()
    return {
      id,
      filename,
      mimeType,
      sizeBytes,
      extractedText: `[Téléchargement impossible: ${response.status} ${body.slice(0, 300)}]`,
      extractionNote: 'Téléchargement échoué.',
    }
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const extracted = await extractAttachmentText(filename, mimeType, bytes)
  return {
    id,
    filename,
    mimeType,
    sizeBytes,
    extractedText: extracted.text,
    extractionNote: extracted.note,
  }
}

function commentToText(comment: JiraIssueComment, index: number): string {
  const bodyText = trimBlock(adfNodeToText(comment.body ?? {}).trim(), 6_000)
  return [
    `Commentaire #${index + 1}`,
    `Créé le: ${formatDate(comment.created)}`,
    bodyText || '(commentaire vide)',
  ].join('\n')
}

function buildPrompt(
  jiraKey: string,
  issue: JiraIssueResponse,
  comments: JiraIssueComment[],
  attachments: AttachmentAnalysis[],
  guidance?: string,
): string {
  const fields = issue.fields ?? {}
  const description = trimBlock(adfNodeToText(fields.description ?? {}).trim(), 10_000) || '(description vide)'
  const commentsText = comments.length > 0
    ? comments.map((comment, index) => commentToText(comment, index)).join('\n\n---\n\n')
    : 'Aucun commentaire Jira.'
  const attachmentsText = attachments.length > 0
    ? attachments.map((attachment, index) => [
        `Pièce jointe #${index + 1}`,
        `Nom: ${attachment.filename}`,
        `Type MIME: ${attachment.mimeType}`,
        `Taille: ${attachment.sizeBytes} octets`,
        attachment.extractionNote ? `Note: ${attachment.extractionNote}` : '',
        'Contenu extrait:',
        attachment.extractedText || '(aucun texte extrait)',
      ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    : 'Aucune pièce jointe Jira.'

  return [
    `Utilise le skill $analyse-ticket situé à ce chemin: ${ANALYSE_TICKET_SKILL_PATH}.`,
    `Analyse uniquement le ticket Jira ${jiraKey}.`,
    'Le thread email est hors périmètre et doit être ignoré.',
    'Tu dois obligatoirement exploiter: ticket, commentaires, pièces jointes.',
    '',
    'Réponds STRICTEMENT en JSON valide, sans markdown, avec ce schéma:',
    '{"summary":"résumé très court","report":"rapport structuré complet"}',
    '',
    'Contraintes du rapport:',
    '- français',
    '- concret, exploitable par un agent support',
    '- aucune invention',
    '- si une pièce jointe est illisible, le signaler explicitement',
    '- structure obligatoire dans report:',
    '  1. Résumé du problème',
    '  2. Contexte / historique du ticket',
    '  3. Ce qui a déjà été tenté',
    '  4. Constats tirés des commentaires',
    '  5. Constats tirés des pièces jointes',
    '  6. Hypothèses',
    '  7. Blocages / informations manquantes',
    '  8. Prochaine action recommandée',
    '',
    '=== TICKET JIRA ===',
    `Clé: ${jiraKey}`,
    `Type: ${fields.issuetype?.name?.trim() || '—'}`,
    `Statut: ${fields.status?.name?.trim() || '—'}`,
    `Priorité: ${fields.priority?.name?.trim() || '—'}`,
    `Créé le: ${formatDate(fields.created)}`,
    `Mis à jour le: ${formatDate(fields.updated)}`,
    `Reporter: ${fields.reporter?.displayName?.trim() || fields.reporter?.emailAddress?.trim() || '—'}`,
    `Assigné à: ${fields.assignee?.displayName?.trim() || fields.assignee?.emailAddress?.trim() || '—'}`,
    `Labels: ${Array.isArray(fields.labels) && fields.labels.length > 0 ? fields.labels.join(', ') : '—'}`,
    `Summary: ${fields.summary?.trim() || '(sans summary)'}`,
    'Description:',
    description,
    '',
    '=== COMMENTAIRES JIRA ===',
    commentsText,
    '',
    '=== PIECES JOINTES JIRA ===',
    attachmentsText,
    guidance?.trim()
      ? ['', '=== COMPLEMENT UTILISATEUR POUR RELANCE ===', guidance.trim()].join('\n')
      : '',
  ].join('\n')
}

async function getExecModelArgs(config?: AnalysisRunConfig): Promise<string[]> {
  if (config?.model) {
    return ['-m', config.model, '-c', `model_reasoning_effort="${config.effort ?? 'medium'}"`]
  }
  return getModelArgs('treatment')
}

function normalizeParsedAnalysis(parsed: ParsedAnalysis | null, rawOutput: string): { summary: string; report: string } {
  if (parsed?.report?.trim()) {
    return {
      summary: parsed.summary?.trim() || 'Analyse ticket terminée.',
      report: parsed.report.trim(),
    }
  }
  return {
    summary: 'Analyse ticket terminée.',
    report: rawOutput.trim() || 'Aucun rapport retourné.',
  }
}

export async function runAnalyseTicketAgent(
  jiraKey: string,
  config?: AnalysisRunConfig,
  guidance?: string,
): Promise<{ summary: string; report: string }> {
  const jira = await readJiraConfigOrThrow()
  const issue = await fetchIssue(jira, jiraKey)
  const comments = await fetchJiraComments(jira, jiraKey)
  const rawAttachments = Array.isArray(issue.fields?.attachment) ? issue.fields?.attachment : []
  const attachments = await Promise.all(rawAttachments.map((attachment) => downloadAttachment(jira, attachment)))

  const prompt = buildPrompt(jiraKey, issue, comments, attachments, guidance)
  const outputFile = path.join('/tmp', `analyse-ticket-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
  const modelArgs = await getExecModelArgs(config)
  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
    APP_DIR,
    180_000,
  )

  let lastMessage = ''
  try {
    lastMessage = (await readFile(outputFile, 'utf-8')).trimEnd()
  } catch {
    lastMessage = ''
  } finally {
    void unlink(outputFile).catch(() => undefined)
  }

  if (result.code !== 0) {
    throw new Error(sanitizeCodexError(result.stderr || result.stdout))
  }

  const rawOutput = lastMessage || result.stdout
  const parsed = parseCodexJson<ParsedAnalysis>(rawOutput)
  return normalizeParsedAnalysis(parsed, rawOutput)
}
