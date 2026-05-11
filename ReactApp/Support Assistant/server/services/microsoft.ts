import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { M365_CONFIG_CACHE, M365_TOKEN_CACHE } from '../config.js'
import type {
  AttachmentCandidate,
  AttachmentCollectionReport,
  EmbeddedImageTarget,
  EmailPreviewPayload,
  GraphAttachment,
  GraphAttachmentList,
  GraphEmail,
  GraphEmailList,
  GraphMailFolder,
  JiraAnalyzeInput,
  M365Config,
  M365Token,
  MimeInlineAttachment,
  UploadableAttachment,
} from '../types.js'
import { escapeODataString, nowEpoch, readJsonFile, runBinaryCommand, saveJsonFile, stripReplyPrefixes } from '../utils.js'

// Module-level cache: inline attachment bytes extracted from MIME, keyed by messageId -> attachmentId
const mimeInlineAttachmentCache = new Map<string, Map<string, MimeInlineAttachment>>()

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function fileExtension(name: string): string {
  const trimmed = name.trim()
  const index = trimmed.lastIndexOf('.')
  if (index <= 0 || index === trimmed.length - 1) return ''
  return trimmed.slice(index + 1).toLowerCase()
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeContentId(value: string | undefined): string {
  const base = (value || '')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim()
  const decoded = (() => {
    try { return decodeURIComponent(base) } catch { return base }
  })()
  return decoded.toLowerCase()
}

export function isLikelyNoisyInlineImage(attachment: GraphAttachment): boolean {
  if (!attachment.isInline) return false
  const name = (attachment.name || '').trim().toLowerCase()
  const contentType = (attachment.contentType || '').trim().toLowerCase()
  const size = Number(attachment.size ?? 0)
  const noisePattern = /(logo|icon|banner|signature|footer|header|facebook|twitter|linkedin|instagram|youtube|spacer|pixel|tracker)/i
  if (!contentType.startsWith('image/')) return true
  if (size > 0 && size <= 5 * 1024) return true
  return noisePattern.test(name)
}

export function sanitizeEmailHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\shref\s*=\s*(['"])\s*javascript:.*?\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*(['"])\s*javascript:.*?\1/gi, '')
}

export function stripHtml(input: string): string {
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

export function cutAtSignatureAndQuote(input: string): string {
  const lines = input.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.trim()
    const normalized = line.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    if (!normalized) { kept.push(rawLine); continue }
    if (/^(de|from|envoye)\s*:/.test(normalized)) break
    if (/^(-{2,}|_{2,})/.test(normalized) || /^message original/.test(normalized)) break
    if (/^(tel|telephone|mobile|mail|email|www|http|sent from my)/.test(normalized)) break
    if (i > 0 && /^\p{Lu}[\p{L}''.-]{1,40}\s+\p{Lu}[\p{L}''.-]{1,40}$/u.test(line)) break
    kept.push(rawLine)
  }
  return kept.join('\n').trim()
}

function buildEmailPreviewFallback(message: GraphEmail): string {
  const subject = escapeHtml(stripReplyPrefixes(message.subject?.trim() || '') || '(Sans objet)')
  const sender = escapeHtml(
    message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu',
  )
  const bodyText = escapeHtml(
    cutAtSignatureAndQuote(stripHtml(message.body?.content?.trim() || '')) || '(Contenu email introuvable)',
  )
  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#17324d} img{max-width:100%;height:auto}</style>',
    '</head><body>',
    `<h2>${subject}</h2>`,
    `<p><strong>Expediteur:</strong> ${sender}</p>`,
    `<pre style="white-space:pre-wrap;font:inherit">${bodyText}</pre>`,
    '</body></html>',
  ].join('')
}

// ---------------------------------------------------------------------------
// ADF builders
// ---------------------------------------------------------------------------

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (match, value: string) => {
      const cp = Number.parseInt(value, 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, value: string) => {
      const cp = Number.parseInt(value, 16)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
}

function extractHtmlAttribute(input: string, attribute: string): string {
  const pattern = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = input.match(pattern)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

export function buildAdfParagraphFromText(input: string): Record<string, unknown> {
  // Strip C0 control characters except tab/newline; trim trailing whitespace per line
  const lines = input.split('\n').map((line) => line.replace(/[ \t]+$/g, ''))
  const paragraphContent: Array<Record<string, unknown>> = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.length > 0) paragraphContent.push({ type: 'text', text: line })
    if (i < lines.length - 1) paragraphContent.push({ type: 'hardBreak' })
  }
  if (paragraphContent.length === 0) paragraphContent.push({ type: 'text', text: ' ' })
  return { type: 'paragraph', content: paragraphContent }
}

export function buildAdfFromText(input: string): Record<string, unknown> {
  return { type: 'doc', version: 1, content: [buildAdfParagraphFromText(input)] }
}

function normalizeEmbeddedImageDimensions(width?: number, height?: number): { width: number; height: number } {
  const fallbackWidth = 760
  const fallbackHeight = 480
  const safeWidth = Number.isFinite(width) && typeof width === 'number' && width > 0 ? width : fallbackWidth
  const safeHeight = Number.isFinite(height) && typeof height === 'number' && height > 0 ? height : fallbackHeight
  const clampedWidth = Math.max(1, Math.min(760, Math.round(safeWidth)))
  if (safeWidth === clampedWidth) return { width: clampedWidth, height: Math.max(1, Math.round(safeHeight)) }
  return { width: clampedWidth, height: Math.max(1, Math.round((safeHeight * clampedWidth) / safeWidth)) }
}

export function createAdfMediaSingle(target: EmbeddedImageTarget): Record<string, unknown> {
  const dimensions = normalizeEmbeddedImageDimensions(target.width, target.height)
  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [{
      type: 'media',
      attrs: { type: 'file', id: target.id, collection: '', alt: target.alt, width: dimensions.width, height: dimensions.height },
    }],
  }
}

export function buildAdfWithEmbeddedImages(input: string, imageTargets: EmbeddedImageTarget[]): Record<string, unknown> {
  const base = buildAdfFromText(input) as { type: string; version: number; content: Array<Record<string, unknown>> }
  const mediaBlocks = imageTargets.map((target) => createAdfMediaSingle(target))
  return { ...base, content: [...(Array.isArray(base.content) ? base.content : []), ...mediaBlocks] }
}

export function buildAdfFromEmailHtml(
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
      if (!src) return alt ? `\n${alt}\n` : '\n'
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
    .replace(/ /g, ' ')
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
      if (!placeholder) continue
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
      .map((p) => p.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).join('\n'))
      .filter((p) => p.length > 0)
    for (const paragraph of paragraphs) blocks.push(buildAdfParagraphFromText(paragraph))
  }

  if (blocks.length === 0) return buildAdfFromText(fallbackText)
  return { type: 'doc', version: 1, content: blocks }
}

// ---------------------------------------------------------------------------
// Image dimension helpers
// ---------------------------------------------------------------------------

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9) continue
    if (marker === 0xda) break
    if (offset + 2 > bytes.length) break
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSOF && offset + 7 < bytes.length) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (width > 0 && height > 0) return { width, height }
    }
    offset += segmentLength
  }
  return null
}

export function getImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width > 0 && height > 0) return { width, height }
  }
  if (bytes.length >= 10) {
    const gifHeader = bytes.toString('ascii', 0, 6)
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      const width = bytes.readUInt16LE(6)
      const height = bytes.readUInt16LE(8)
      if (width > 0 && height > 0) return { width, height }
    }
  }
  return readJpegDimensions(bytes)
}

// ---------------------------------------------------------------------------
// Microsoft OAuth token management
// ---------------------------------------------------------------------------

export async function ensureMicrosoftAccessToken(): Promise<string> {
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshPayload,
  })

  const refreshText = await refreshResponse.text()
  if (!refreshResponse.ok) {
    throw new Error(`Échec refresh token Microsoft: ${refreshResponse.status} ${refreshText}`)
  }

  const refreshed = JSON.parse(refreshText) as M365Token
  if (!refreshed.access_token) throw new Error('Refresh Microsoft invalide: access_token absent.')

  const refreshedWithExpiry = {
    ...token,
    ...refreshed,
    expires_at: nowEpoch() + Number(refreshed.expires_in ?? 0) - 60,
  }

  await saveJsonFile(M365_TOKEN_CACHE, refreshedWithExpiry)
  return refreshed.access_token
}

// ---------------------------------------------------------------------------
// Email thread fetching
// ---------------------------------------------------------------------------

export async function listThreadMessages(input: JiraAnalyzeInput, token: string): Promise<GraphEmail[]> {
  const fetchByConversationId = async (conversationId: string): Promise<GraphEmail[]> => {
    const queryUrl = new URL('https://graph.microsoft.com/v1.0/me/messages')
    queryUrl.searchParams.set('$filter', `conversationId eq '${escapeODataString(conversationId)}'`)
    queryUrl.searchParams.set('$select', 'id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories')
    queryUrl.searchParams.set('$top', '50')
    const response = await fetch(queryUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Lecture thread Outlook impossible: ${response.status} ${text}`)
    const parsed = JSON.parse(text) as GraphEmailList
    return Array.isArray(parsed.value) ? parsed.value : []
  }

  const fetchByMessageId = async (id: string): Promise<GraphEmail | null> => {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!response.ok) return null
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
    queryUrl.searchParams.set('$select', 'id,internetMessageId,subject,from,conversationId,receivedDateTime,body,hasAttachments,categories')
    queryUrl.searchParams.set('$top', '1')
    const response = await fetch(queryUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Lecture Outlook impossible: ${response.status} ${text}`)
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

export async function listPrisEmails(): Promise<GraphEmail[]> {
  const token = await ensureMicrosoftAccessToken()
  const emails: GraphEmail[] = []
  let deletedItemsFolderId: string | null = null

  try {
    const deletedFolderResponse = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/deleteditems?$select=id', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(`Microsoft Graph mail list a echoue: ${response.status} ${bodyText}`)
    const parsed = JSON.parse(bodyText) as GraphEmailList
    if (Array.isArray(parsed.value)) emails.push(...parsed.value)
    nextUrl = parsed['@odata.nextLink'] ? new URL(parsed['@odata.nextLink']) : null
  }

  return emails.filter((email) => {
    const hasPrisCategory = (email.categories ?? []).some((c) => c.trim().toLowerCase() === 'pris')
    if (!hasPrisCategory) return false
    if (deletedItemsFolderId && email.parentFolderId === deletedItemsFolderId) return false
    return true
  })
}

async function getGraphArchiveFolderId(token: string): Promise<string> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/archive?$select=id', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const bodyText = await response.text()
  if (!response.ok) throw new Error(`Lecture dossier Archive impossible: ${response.status} ${bodyText}`)
  const parsed = JSON.parse(bodyText) as GraphMailFolder
  const folderId = parsed.id?.trim()
  if (!folderId) throw new Error('Dossier Archive Outlook introuvable.')
  return folderId
}

export async function updateThreadMessagesCategories(
  threadMessages: GraphEmail[],
  token: string,
  updater: (categories: string[]) => string[],
): Promise<void> {
  for (const message of threadMessages) {
    const messageId = message.id?.trim()
    if (!messageId) continue
    const currentCategories = Array.isArray(message.categories)
      ? message.categories.filter((v): v is string => typeof v === 'string')
      : []
    const nextCategories = updater(currentCategories)
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: nextCategories }),
    })
    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`Mise a jour categories Outlook impossible (${messageId}): ${response.status} ${bodyText}`)
    }
  }
}

export async function archiveThreadMessages(threadMessages: GraphEmail[], token: string): Promise<number> {
  const archiveFolderId = await getGraphArchiveFolderId(token)
  let archivedCount = 0
  for (const message of threadMessages) {
    const messageId = message.id?.trim()
    if (!messageId) continue
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: archiveFolderId }),
    })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(`Archivage Outlook impossible (${messageId}): ${response.status} ${bodyText}`)
    archivedCount += 1
  }
  return archivedCount
}

// ---------------------------------------------------------------------------
// Attachment extraction
// ---------------------------------------------------------------------------

export async function extractInlineImagesFromMime(messageId: string, token: string): Promise<MimeInlineAttachment[]> {
  const encodedMessageId = encodeURIComponent(messageId)
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/$value`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return []

  const raw = Buffer.from(await response.arrayBuffer()).toString('utf-8')
  const boundaryMatches = Array.from(raw.matchAll(/boundary="?([^"\r\n;]+)"?/gi))
  const boundaries = Array.from(
    new Set(boundaryMatches.map((m) => m[1]?.trim()).filter((v): v is string => Boolean(v))),
  )
  if (boundaries.length === 0) return []

  const results: MimeInlineAttachment[] = []
  const seenByContentId = new Set<string>()

  const parseHeaderValue = (headers: string, pattern: RegExp): string => {
    const match = headers.match(pattern)
    return match?.[1]?.trim() ?? ''
  }

  for (const boundary of boundaries) {
    const parts = raw.split(`--${boundary}`)
    for (const part of parts) {
      if (!part || part.startsWith('--')) continue
      const separatorIndex = part.search(/\r?\n\r?\n/)
      if (separatorIndex < 0) continue
      const headers = part.slice(0, separatorIndex)
      const body = part.slice(separatorIndex).replace(/^\r?\n\r?\n/, '')
      const contentType = parseHeaderValue(headers, /content-type:\s*([^\r\n;]+)/i).toLowerCase()
      const contentId = normalizeContentId(parseHeaderValue(headers, /content-id:\s*<?([^>\r\n]+)>?/i))
      const transferEncoding = parseHeaderValue(headers, /content-transfer-encoding:\s*([^\r\n]+)/i).toLowerCase()
      const contentDisposition = parseHeaderValue(headers, /content-disposition:\s*([^\r\n]+)/i).toLowerCase()
      if (!contentId || !contentType.startsWith('image/')) continue
      if (transferEncoding !== 'base64') continue
      if (seenByContentId.has(contentId)) continue
      if (contentDisposition && !contentDisposition.includes('inline') && !headers.toLowerCase().includes('content-id')) continue
      const filename =
        parseHeaderValue(headers, /filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i) ||
        `${contentId}.${contentType.split('/')[1] || 'img'}`
      const normalizedBase64 = body.replace(/\r?\n/g, '').replace(/\s+/g, '').trim()
      if (!normalizedBase64) continue
      let bytes: Buffer
      try { bytes = Buffer.from(normalizedBase64, 'base64') } catch { continue }
      if (bytes.length === 0) continue
      const id = `mime-inline:${results.length + 1}:${contentId}`
      results.push({ id, name: filename.replace(/^utf-8''/i, ''), contentType, contentId, bytes })
      seenByContentId.add(contentId)
    }
  }

  return results
}

export async function fetchMessageAttachmentRefs(messageId: string, token: string): Promise<GraphAttachment[]> {
  const encodedMessageId = encodeURIComponent(messageId)
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}/attachments`)
  url.searchParams.set('$select', 'id,name,contentType,size,isInline,contentId')
  url.searchParams.set('$top', '100')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const parsed = response.ok ? ((await response.json()) as GraphAttachmentList) : { value: [] }
  const direct = Array.isArray(parsed.value) ? parsed.value : []
  const directHasInlineSignal = direct.some(
    (ref) =>
      normalizeContentId(ref.contentId).length > 0 ||
      (Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')),
  )
  if (direct.length > 0 && directHasInlineSignal) return direct

  try {
    const expandedUrl = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodedMessageId}`)
    expandedUrl.searchParams.set('$select', 'id')
    expandedUrl.searchParams.set('$expand', 'attachments($select=id,name,contentType,size,isInline,contentId)')
    const expandedResponse = await fetch(expandedUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (expandedResponse.ok) {
      const expanded = (await expandedResponse.json()) as { attachments?: GraphAttachment[] }
      const expandedAttachments = Array.isArray(expanded.attachments) ? expanded.attachments : direct
      const expandedHasInlineSignal = expandedAttachments.some(
        (ref) =>
          normalizeContentId(ref.contentId).length > 0 ||
          (Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')),
      )
      if (expandedAttachments.length > 0 && expandedHasInlineSignal) return expandedAttachments
    }
  } catch {
    // fall through to MIME fallback
  }

  const mimeInline = await extractInlineImagesFromMime(messageId, token)
  if (mimeInline.length === 0) return direct
  mimeInlineAttachmentCache.set(messageId, new Map(mimeInline.map((item) => [item.id, item])))
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

export async function listThreadAttachmentCandidates(
  thread: GraphEmail[],
  token: string,
  selectedMessageId?: string,
): Promise<AttachmentCandidate[]> {
  const candidates: AttachmentCandidate[] = []
  const seenNames = new Set<string>()

  for (const message of thread) {
    if (!message.id) continue
    const refs = await fetchMessageAttachmentRefs(message.id, token)
    for (const ref of refs) {
      const name = ref.name?.trim() || ''
      if (!name || !ref.id) continue
      if (seenNames.has(name)) continue
      seenNames.add(name)
      const isInlineImage = Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')
      candidates.push({
        key: `${message.id}:${ref.id}`,
        name,
        extension: fileExtension(name),
        sizeBytes: Number(ref.size ?? 0),
        selected: isInlineImage ? !isLikelyNoisyInlineImage(ref) : true,
        kind: isInlineImage ? 'inline-image' : 'attachment',
      })
    }
  }

  if (candidates.length === 0 && selectedMessageId) {
    const refs = await fetchMessageAttachmentRefs(selectedMessageId, token)
    for (const ref of refs) {
      const name = ref.name?.trim() || ''
      if (!name || !ref.id) continue
      if (seenNames.has(name)) continue
      seenNames.add(name)
      const isInlineImage = Boolean(ref.isInline) && (ref.contentType?.trim().toLowerCase() || '').startsWith('image/')
      candidates.push({
        key: `${selectedMessageId}:${ref.id}`,
        name,
        extension: fileExtension(name),
        sizeBytes: Number(ref.size ?? 0),
        selected: isInlineImage ? !isLikelyNoisyInlineImage(ref) : true,
        kind: isInlineImage ? 'inline-image' : 'attachment',
      })
    }
  }

  return candidates
}

export async function fetchFileAttachment(messageId: string, attachmentId: string, token: string): Promise<GraphAttachment | null> {
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

  const url = new URL(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
  url.searchParams.set('$select', 'id,name,contentType,size,isInline,contentId,contentBytes')
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!response.ok) return null
  return (await response.json()) as GraphAttachment
}

export async function fetchFileAttachmentBytesViaValue(messageId: string, attachmentId: string, token: string): Promise<Buffer | null> {
  const mimeCache = mimeInlineAttachmentCache.get(messageId)
  const mimeAttachment = mimeCache?.get(attachmentId)
  if (mimeAttachment) return mimeAttachment.bytes

  const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`
  const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return null
  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength === 0) return null
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Email preview
// ---------------------------------------------------------------------------

export async function buildEmailPreview(
  message: GraphEmail,
  token: string,
  threadMessages: GraphEmail[] = [],
): Promise<EmailPreviewPayload> {
  const subject = stripReplyPrefixes(message.subject?.trim() || '') || '(Sans objet)'
  const sender = message.from?.emailAddress?.name?.trim() || message.from?.emailAddress?.address?.trim() || 'Inconnu'
  const receivedDateTime = message.receivedDateTime?.trim() || null
  const rawHtml = message.body?.content?.trim() || ''

  if (!rawHtml) {
    return { subject, sender, receivedDateTime, html: buildEmailPreviewFallback(message), hasInlineImages: false }
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
      const candidates = [normalizedContentId, normalizedName].filter((v): v is string => Boolean(v))
      if (candidates.length === 0 || !ref.id) continue
      const full = await fetchFileAttachment(messageId, ref.id, token)
      const contentType = full?.contentType?.trim() || ref.contentType?.trim() || 'application/octet-stream'
      const contentBytes = full?.contentBytes
      const bytes = contentBytes
        ? Buffer.from(contentBytes, 'base64')
        : await fetchFileAttachmentBytesViaValue(messageId, ref.id, token)
      if (!bytes || bytes.length === 0) continue

      const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`
      if (contentType.toLowerCase().startsWith('image/')) inlineImageDataUrls.push(dataUrl)

      for (const candidate of candidates) {
        const cidPattern = new RegExp(`(["'])cid:${escapeRegExp(candidate)}\\1`, 'gi')
        const bareCidPattern = new RegExp(`(["'])${escapeRegExp(candidate)}\\1`, 'gi')
        nextHtml = nextHtml.replace(cidPattern, `$1${dataUrl}$1`).replace(bareCidPattern, `$1${dataUrl}$1`)
      }
      nextHtml = nextHtml.replace(
        /(src\s*=\s*["'])(cid:[^"']+)(["'])/gi,
        (fullMatch, prefix: string, srcValue: string, suffix: string) => {
          const normalizedSrc = normalizeContentId(srcValue)
          const matched = candidates.some((c) => normalizedSrc.includes(c) || c.includes(normalizedSrc))
          if (!matched) return fullMatch
          return `${prefix}${dataUrl}${suffix}`
        },
      )
      if (nextHtml !== currentHtml) hasInlineImages = true
    }
    return nextHtml
  }

  if (message.id) html = await hydrateInlineImagesFromMessage(message.id, html)

  if (threadMessages.length > 0 && /cid:/i.test(html)) {
    for (const threadMessage of threadMessages) {
      if (!threadMessage.id || threadMessage.id === message.id) continue
      const nextHtml = await hydrateInlineImagesFromMessage(threadMessage.id, html)
      if (nextHtml !== html) { hasInlineImages = true; html = nextHtml }
      if (!/cid:/i.test(html)) break
    }
  }

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
    if (hasCidLeft && nextHtml !== html) { hasInlineImages = true; html = nextHtml }
  }

  const wrappedHtml = [
    '<!doctype html><html><head><meta charset="utf-8" />',
    '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#17324d;overflow-wrap:anywhere} img{max-width:100%;height:auto} table{max-width:100%}</style>',
    '</head><body>',
    html,
    '</body></html>',
  ].join('')

  return { subject, sender, receivedDateTime, html: wrappedHtml, hasInlineImages }
}

// ---------------------------------------------------------------------------
// Attachment collection for Jira ticket creation
// ---------------------------------------------------------------------------

async function extractUsefulFileFromZip(zipFilename: string, zipBytes: Buffer): Promise<UploadableAttachment | null> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jirayah-zip-'))
  const zipPath = path.join(tempDir, zipFilename || 'attachment.zip')
  try {
    await writeFile(zipPath, zipBytes)
    const listing = await runBinaryCommand('unzip', ['-Z1', zipPath])
    if (listing.code !== 0) return null
    const entries = listing.stdout
      .toString('utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.endsWith('/'))
    if (entries.length === 0) return null
    const priority = [/\.log$/i, /\.txt$/i, /\.csv$/i, /\.json$/i, /\.xml$/i, /\.ya?ml$/i, /.*/]
    let selected = entries[0]
    for (const matcher of priority) {
      const found = entries.find((e) => matcher.test(e))
      if (found) { selected = found; break }
    }
    const extracted = await runBinaryCommand('unzip', ['-p', zipPath, selected])
    if (extracted.code !== 0 || extracted.stdout.length === 0) return null
    return { filename: path.basename(selected), contentType: 'application/octet-stream', bytes: extracted.stdout }
  } catch {
    return null
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function collectThreadAttachments(
  input: JiraAnalyzeInput,
  token: string,
  selectedAttachmentKeys?: Set<string>,
): Promise<{ attachments: UploadableAttachment[]; report: AttachmentCollectionReport }> {
  const thread = await listThreadMessages(input, token)
  const collected: UploadableAttachment[] = []
  const seenNames = new Set<string>()
  const report: AttachmentCollectionReport = { found: 0, skipped: 0, errors: [] }

  for (const message of thread) {
    if (!message.id) continue
    const refs = await fetchMessageAttachmentRefs(message.id, token)
    for (const ref of refs) {
      report.found += 1
      const name = ref.name?.trim() || ''
      if (!name) { report.skipped += 1; continue }
      if (!ref.id) { report.skipped += 1; continue }
      const attachmentKey = `${message.id}:${ref.id}`
      if (!selectedAttachmentKeys && isLikelyNoisyInlineImage(ref)) { report.skipped += 1; continue }
      if (selectedAttachmentKeys && !selectedAttachmentKeys.has(attachmentKey)) { report.skipped += 1; continue }
      const full = await fetchFileAttachment(message.id, ref.id, token)
      const contentBytes = full?.contentBytes
      const bytes = contentBytes
        ? Buffer.from(contentBytes, 'base64')
        : await fetchFileAttachmentBytesViaValue(message.id, ref.id, token)
      if (!bytes) { report.skipped += 1; report.errors.push(`Lecture binaire impossible: ${name}`); continue }
      if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) { report.skipped += 1; continue }

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
        if (!seenNames.has(extracted.filename)) { seenNames.add(extracted.filename); collected.push(extracted) }
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
