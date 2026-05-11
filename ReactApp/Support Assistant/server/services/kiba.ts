import path from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import type { JiraAnalyzeInput, JiraConfig, KibaPreflightResult, KibaProposalResult } from '../types.js'
import { APP_DIR, JIRA_CONFIG_CACHE, KIBA_SKILL_PATH } from '../config.js'
import { extractJsonObject, readJsonFile, runCommand, sanitizeCodexError, stripReplyPrefixes } from '../utils.js'
import { getModelArgs } from './settings.js'
import { cutAtSignatureAndQuote, ensureMicrosoftAccessToken, listThreadMessages, stripHtml } from './microsoft.js'
import { buildJiraAuth } from './jira.js'
import { buildHtmlBody, getTemplateSection, type KibaVars } from './kibaTemplates.js'

const KIBA_CC = ['support@iobeya.com', 'sales.support@iobeya.com']
const KIBA_BCC = ['admin@iobeya.com']

/** Strip all HTML tags, collapse whitespace. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Parse the first HTML table found in html into { header: value } pairs.
 * Returns an empty object if no table is found.
 */
function parseHtmlTable(html: string): Record<string, string> {
  const result: Record<string, string> = {}
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i)
  if (!tableMatch) return result

  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)]
  let headers: string[] = []

  for (const row of rows) {
    // th = header cells, td = data cells
    const thCells = [...row[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => stripTags(m[1]))
    const tdCells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]))

    if (thCells.length > 0) {
      headers = thCells
    } else if (tdCells.length > 0 && headers.length === 0) {
      // First row is all <td> but acts as header (some templates do this)
      headers = tdCells
    } else if (tdCells.length > 0 && headers.length > 0) {
      headers.forEach((h, i) => { if (tdCells[i]) result[h.toLowerCase()] = tdCells[i] })
    }
  }
  return result
}

/** Match a column value by trying multiple synonyms (case-insensitive). */
function matchColumn(table: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    for (const col of Object.keys(table)) {
      if (col.includes(key.toLowerCase())) return table[col]
    }
  }
  return 'Non communiqué'
}

/**
 * Extract delivery variables from the email HTML body + Jira summary.
 * Pure parsing — no LLM, no async.
 */
function extractKibaVars(
  emailHtml: string,
  jiraSummary: string,
  emailTitle: string,
): Omit<KibaVars, 'quoteNumber'> {
  const table = parseHtmlTable(emailHtml)
  const bodyText = stripTags(emailHtml)

  // Salles / Panneaux / Utilisateurs from the HTML table
  const salles = matchColumn(table, 'salle', 'room', 'license to create')
  const panneaux = matchColumn(table, 'panneau', 'board')
  const utilisateurs = matchColumn(table, 'utilisateur', 'user')

  // Renewal date: look for dd/mm/yyyy or dd-mm-yyyy patterns
  const dateMatch = bodyText.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)
  const renewalDate = dateMatch ? `${dateMatch[1].padStart(2,'0')}/${dateMatch[2].padStart(2,'0')}/${dateMatch[3]}` : 'Non communiqué'

  // Customer name: strip known delivery prefixes from Jira summary
  const customerName = jiraSummary
    .replace(/^(renouvellement|nouvelle salle|nouveau client|livraison)\s+iobeya\s*[–\-:]\s*/i, '')
    .replace(/^iobeya\s*[–\-:]\s*/i, '')
    .trim() || (emailTitle.replace(/^(re:|fwd:|tr:)\s*/i, '').trim()) || 'Non communiqué'

  return { customerName, renewalDate, salles, panneaux, utilisateurs }
}

export async function kibaPreflightCheck(
  jiraKey: string,
  customerEmail: string,
): Promise<KibaPreflightResult> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)

  let jiraOk = false
  let jiraError: string | null = null
  try {
    const { baseUrl, auth } = buildJiraAuth(jira)
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=summary`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    if (resp.ok) {
      jiraOk = true
    } else {
      const body = await resp.json().catch(() => ({})) as { errorMessages?: string[] }
      jiraError = body.errorMessages?.[0] ?? `Jira a retourné ${resp.status}`
    }
  } catch (err) {
    jiraError = err instanceof Error ? err.message : 'Jira inaccessible'
  }

  return { jiraOk, jiraError, to: customerEmail, cc: KIBA_CC, bcc: KIBA_BCC }
}

export async function proposeKibaDelivery(
  email: JiraAnalyzeInput,
  jiraKey: string,
): Promise<KibaProposalResult> {
  const microsoftToken = await ensureMicrosoftAccessToken()
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  const threadMessages = await listThreadMessages(email, microsoftToken)
  const firstMessage = threadMessages[0]

  const subject = stripReplyPrefixes(email.title?.trim() || firstMessage?.subject?.trim() || '') || '(Sans objet)'
  const sender =
    email.sender?.trim() ||
    firstMessage?.from?.emailAddress?.name?.trim() ||
    firstMessage?.from?.emailAddress?.address?.trim() ||
    'Inconnu'
  const bodyRaw = firstMessage?.body?.content?.trim() || ''
  const bodyText = cutAtSignatureAndQuote(stripHtml(bodyRaw)) || '(Contenu email introuvable)'

  const threadContext = threadMessages
    .slice(0, 5)
    .map((m) => cutAtSignatureAndQuote(stripHtml(m.body?.content?.trim() || '')))
    .filter((t) => t.length > 0)
    .join('\n\n---\n\n')

  let jiraSummary = ''
  let jiraDescription = ''
  try {
    const { baseUrl, auth } = buildJiraAuth(jira)
    const jiraResponse = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=summary,description`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    })
    if (jiraResponse.ok) {
      const jiraData = await jiraResponse.json() as { fields?: { summary?: string; description?: unknown } }
      jiraSummary = typeof jiraData.fields?.summary === 'string' ? jiraData.fields.summary : ''
    }
  } catch {
    // Continue without Jira data if unavailable.
  }

  const outputFile = path.join('/tmp', `kiba-propose-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)

  const prompt = [
    `Utilise le skill Kiba situe a ce chemin: ${KIBA_SKILL_PATH}.`,
    'Objectif: analyser ce ticket Jira de livraison de licence et inferer les 3 parametres de livraison.',
    'Reponds uniquement en JSON valide, aucun texte avant ou apres.',
    '',
    `Ticket Jira: ${jiraKey}`,
    jiraSummary ? `Resume Jira: ${jiraSummary}` : '',
    jiraDescription ? `Description Jira: ${jiraDescription}` : '',
    '',
    `Sujet email: ${subject}`,
    `Expediteur: ${sender}`,
    '',
    'Contenu email (premier message):',
    bodyText,
    '',
    threadContext ? 'Contexte thread complet:' : '',
    threadContext,
    '',
    'Infere et retourne exactement ce JSON:',
    JSON.stringify({
      clientType: 'ON-SITE | ONLINE dedie | Mutualisee',
      clientTypeConfidence: 'faible | moyen | eleve',
      clientTypeReason: 'raison concise',
      deliveryType: 'Renouvellement | Nouvelle salle | Nouveau client',
      deliveryTypeConfidence: 'faible | moyen | eleve',
      deliveryTypeReason: 'raison concise',
      language: 'FR | EN',
      languageConfidence: 'faible | moyen | eleve',
      languageReason: 'raison concise',
      customerName: 'nom du client extrait',
      customerEmail: 'email du client ou vide',
    }),
    '',
    'Regles:',
    '- ON-SITE: installation physique en salle.',
    '- ONLINE dedie: hebergement cloud dedie a un seul client.',
    '- Mutualisee: Team+, Team, Partners, hebergement partage.',
    '- Renouvellement: renouvellement de licence existante.',
    '- Nouvelle salle: ajout de salle a un client existant.',
    '- Nouveau client: premier deploiement pour ce client.',
    '- Langue: FR si correspondance en francais, EN si en anglais ou mix.',
  ].filter(Boolean).join('\n')

  const modelArgs = await getModelArgs('treatment')
  const result = await runCommand('codex', ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt], APP_DIR)

  let raw = ''
  try {
    raw = (await readFile(outputFile, 'utf-8')).trim()
  } catch {
    raw = result.stdout.trim()
  } finally {
    void unlink(outputFile).catch(() => undefined)
  }

  if (result.code !== 0 && !raw) {
    throw new Error(sanitizeCodexError(result.stderr || result.stdout))
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as KibaProposalResult

  const validClientTypes: KibaProposalResult['clientType'][] = ['ON-SITE', 'ONLINE dédié', 'Mutualisée']
  const validDeliveryTypes: KibaProposalResult['deliveryType'][] = ['Renouvellement', 'Nouvelle salle', 'Nouveau client']
  const validLanguages: KibaProposalResult['language'][] = ['FR', 'EN']
  const validConfidences: KibaProposalResult['clientTypeConfidence'][] = ['faible', 'moyen', 'élevé']

  return {
    clientType: validClientTypes.includes(parsed.clientType) ? parsed.clientType : 'ON-SITE',
    clientTypeConfidence: validConfidences.includes(parsed.clientTypeConfidence) ? parsed.clientTypeConfidence : 'faible',
    clientTypeReason: parsed.clientTypeReason || '',
    deliveryType: validDeliveryTypes.includes(parsed.deliveryType) ? parsed.deliveryType : 'Renouvellement',
    deliveryTypeConfidence: validConfidences.includes(parsed.deliveryTypeConfidence) ? parsed.deliveryTypeConfidence : 'faible',
    deliveryTypeReason: parsed.deliveryTypeReason || '',
    language: validLanguages.includes(parsed.language) ? parsed.language : 'FR',
    languageConfidence: validConfidences.includes(parsed.languageConfidence) ? parsed.languageConfidence : 'faible',
    languageReason: parsed.languageReason || '',
    customerName: parsed.customerName || '',
    customerEmail: parsed.customerEmail || '',
  }
}

export async function createKibaOutlookDraft(
  email: JiraAnalyzeInput,
  jiraKey: string,
  clientType: string,
  deliveryType: string,
  language: string,
  customerEmail: string,
): Promise<{ status: string; subject?: string; blockingReason?: string; draftInfo?: string }> {
  // ── 1. Select template section (instant, no LLM) ────────────────────────
  const section = getTemplateSection(deliveryType, clientType, language)
  if (!section) {
    return {
      status: 'blocked',
      blockingReason: `Aucun template pour : ${deliveryType} / ${clientType} / ${language}`,
    }
  }

  // ── 2. Fetch Jira summary + email HTML body (parallel, fast API calls) ────
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  let jiraSummary = ''
  let emailHtml = ''

  await Promise.allSettled([
    (async () => {
      try {
        const { baseUrl, auth } = buildJiraAuth(jira)
        const resp = await fetch(
          `${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=summary`,
          { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
        )
        if (resp.ok) {
          const data = await resp.json() as { fields?: { summary?: string } }
          jiraSummary = typeof data.fields?.summary === 'string' ? data.fields.summary : ''
        }
      } catch { /* continue */ }
    })(),
    (async () => {
      try {
        const token = await ensureMicrosoftAccessToken()
        const messages = await listThreadMessages(email, token)
        const firstMsg = messages[0]
        if (firstMsg?.body?.content) emailHtml = firstMsg.body.content
      } catch { /* continue */ }
    })(),
  ])

  // ── 3. Extract variables — pure HTML parsing, zero LLM ───────────────────
  const extracted = extractKibaVars(emailHtml, jiraSummary, email.title || '')
  const vars: KibaVars = { ...extracted, quoteNumber: '' }

  // ── 4. Build HTML body from static template (instant, no LLM) ───────────
  const { subject, html } = buildHtmlBody(section, vars)

  // ── 5. Write HTML to temp file ───────────────────────────────────────────
  const bodyFile = path.join('/tmp', `kiba-body-${Date.now()}-${Math.random().toString(16).slice(2)}.html`)
  await writeFile(bodyFile, html, 'utf-8')

  // ── 6. Call outlook_draft.py directly (no codex, no LLM) ─────────────────
  const scriptPath = path.join(KIBA_SKILL_PATH, 'scripts', 'outlook_draft.py')
  const toRecipient = customerEmail.trim()
  const ccRecipients = KIBA_CC.join(',')
  const bccRecipient = KIBA_BCC[0]

  try {
    const draftResult = await runCommand(
      'python3',
      [
        scriptPath,
        'draft',
        '--to', toRecipient,
        '--cc', ccRecipients,
        '--bcc', bccRecipient,
        '--subject', subject,
        '--body-file', bodyFile,
      ],
      APP_DIR,
      30_000,
    )

    if (draftResult.code !== 0) {
      return {
        status: 'blocked',
        blockingReason: sanitizeCodexError(draftResult.stderr || draftResult.stdout),
      }
    }

    // outlook_draft.py prints JSON: { id, subject, webLink }
    let draftInfo = ''
    try {
      const parsed = JSON.parse(draftResult.stdout.trim()) as { id?: string; subject?: string; webLink?: string }
      draftInfo = parsed.webLink ? `Lien : ${parsed.webLink}` : (parsed.id ?? '')
    } catch {
      draftInfo = draftResult.stdout.trim().slice(0, 200)
    }

    return { status: 'draft_created', subject, draftInfo }
  } finally {
    void unlink(bodyFile).catch(() => undefined)
  }
}
