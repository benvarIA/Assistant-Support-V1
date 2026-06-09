import path from 'node:path'
import { unlink, writeFile } from 'node:fs/promises'
import { APP_DIR, JIRA_CONFIG_CACHE } from '../config.js'
import type { JiraConfig } from '../types.js'
import { readJsonFile, runCommand } from '../utils.js'
import { buildJiraAuth } from './jira.js'

// Module partagé de récupération/extraction des pièces jointes Jira.
// Utilisé par les agents d'Assistance qui lisent des fichiers du ticket (logs, HAR, systeme…).
// NOTE: analyseTicket.ts garde sa propre copie historique — migration à faire (cf. TODO).

export type JiraAttachment = {
  id?: string
  filename?: string
  mimeType?: string
  size?: number
  content?: string
}

export type JiraIssueFields = {
  summary?: string
  description?: Record<string, unknown> | null
  issuetype?: { name?: string }
  status?: { name?: string }
  created?: string
  updated?: string
  labels?: string[]
  attachment?: JiraAttachment[]
}

export type JiraIssueResponse = {
  key?: string
  fields?: JiraIssueFields
}

export type AttachmentAnalysis = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  extractedText: string
  extractionNote?: string
}

export type AttachmentBytes = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  bytes: Buffer | null
  error?: string
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'json', 'xml', 'csv', 'md', 'markdown', 'yml', 'yaml', 'ini', 'conf', 'config', 'properties',
  'sql', 'js', 'ts', 'tsx', 'jsx', 'html', 'htm', 'svg', 'sh', 'out',
])

// Octet nul construit à l'exécution (évite un caractère de contrôle littéral dans le source / une regex).
const NULL_CHAR = String.fromCharCode(0)

export function extensionOf(filename: string): string {
  return filename.split('.').pop()?.trim().toLowerCase() || ''
}

export function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString()
}

export function trimBlock(text: string, maxChars = 12_000): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n[…tronqué ${trimmed.length - maxChars} caractères]`
}

export function isProbablyTextAttachment(filename: string, mimeType: string): boolean {
  const ext = extensionOf(filename)
  if (mimeType.startsWith('text/')) return true
  if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript')) return true
  return TEXT_EXTENSIONS.has(ext)
}

export function extractUtf8Text(buffer: Buffer): string {
  return buffer
    .toString('utf-8')
    .split(NULL_CHAR).join('')
    .replace(/\r\n/g, '\n')
    .trim()
}

function printableRatio(input: string): number {
  // Itère et compte en POINTS DE CODE (pas en unités UTF-16) pour ne pas sous-estimer
  // les caractères non-BMP (emoji, CJK rares), qui restent du texte imprimable valide.
  const chars = Array.from(input)
  if (chars.length === 0) return 0
  let printable = 0
  for (const char of chars) {
    const code = char.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || (code >= 32 && code !== 0xfffd)) printable += 1
  }
  return printable / chars.length
}

export async function extractAttachmentText(filename: string, mimeType: string, bytes: Buffer): Promise<{ text: string; note?: string }> {
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

  const ext = extensionOf(filename)
  if (ext === 'pdf') {
    const tmpFile = path.join('/tmp', `jira-attach-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`)
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

export async function readJiraConfigOrThrow(): Promise<JiraConfig> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  buildJiraAuth(jira)
  return jira
}

export async function fetchIssue(jira: JiraConfig, jiraKey: string, fields = 'summary,description,issuetype,status,created,updated,labels,attachment'): Promise<JiraIssueResponse> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}`)
  url.searchParams.set('fields', fields)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`Lecture ticket Jira impossible (${jiraKey}): ${error instanceof Error ? error.message : 'erreur réseau'}`)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Lecture ticket Jira impossible (${jiraKey}): ${response.status} ${body}`)
  }
  try {
    return await response.json() as JiraIssueResponse
  } catch {
    throw new Error(`Lecture ticket Jira impossible (${jiraKey}): réponse non-JSON inattendue`)
  }
}

function resolveAttachmentMeta(attachment: JiraAttachment): { id: string; filename: string; mimeType: string; sizeBytes: number } {
  const id = attachment.id?.trim() || ''
  const filename = attachment.filename?.trim() || `attachment-${id || 'unknown'}`
  const mimeType = attachment.mimeType?.trim() || 'application/octet-stream'
  const sizeBytes = Number(attachment.size ?? 0)
  return { id, filename, mimeType, sizeBytes }
}

async function fetchAttachmentBuffer(jira: JiraConfig, attachment: JiraAttachment, id: string): Promise<{ bytes: Buffer } | { error: string }> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const contentUrl = attachment.content?.trim() || `${baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(id)}`
  try {
    const response = await fetch(contentUrl, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: '*/*' },
    })
    if (!response.ok) {
      const body = await response.text()
      return { error: `${response.status} ${body.slice(0, 300)}` }
    }
    return { bytes: Buffer.from(await response.arrayBuffer()) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'erreur réseau' }
  }
}

export async function downloadAttachment(jira: JiraConfig, attachment: JiraAttachment): Promise<AttachmentAnalysis> {
  const { id, filename, mimeType, sizeBytes } = resolveAttachmentMeta(attachment)
  if (!id) {
    return { id: 'unknown', filename, mimeType, sizeBytes, extractedText: '[Pièce jointe Jira sans identifiant exploitable.]', extractionNote: 'Téléchargement impossible.' }
  }
  const result = await fetchAttachmentBuffer(jira, attachment, id)
  if ('error' in result) {
    return { id, filename, mimeType, sizeBytes, extractedText: `[Téléchargement impossible: ${result.error}]`, extractionNote: 'Téléchargement échoué.' }
  }
  const extracted = await extractAttachmentText(filename, mimeType, result.bytes)
  return { id, filename, mimeType, sizeBytes, extractedText: extracted.text, extractionNote: extracted.note }
}

// Octets bruts — nécessaire pour le pré-traitement (décompression .gz/.zip, parsing HAR, etc.).
export async function downloadAttachmentBytes(jira: JiraConfig, attachment: JiraAttachment): Promise<AttachmentBytes> {
  const { id, filename, mimeType, sizeBytes } = resolveAttachmentMeta(attachment)
  if (!id) {
    return { id: 'unknown', filename, mimeType, sizeBytes, bytes: null, error: 'Pièce jointe sans identifiant.' }
  }
  const result = await fetchAttachmentBuffer(jira, attachment, id)
  if ('error' in result) {
    return { id, filename, mimeType, sizeBytes, bytes: null, error: result.error }
  }
  return { id, filename, mimeType, sizeBytes, bytes: result.bytes }
}
