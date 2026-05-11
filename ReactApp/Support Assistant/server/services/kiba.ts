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

/**
 * ADF → structured text that preserves table column-value associations.
 * Normal nodes: plain text concatenation.
 * Table rows: "Col1: val1 | Col2: val2 | Col3: val3"
 */
function adfToStructuredText(node: unknown, headerRow: string[] = []): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>

  if (n.type === 'table') {
    const rows = Array.isArray(n.content) ? n.content as Record<string, unknown>[] : []
    const lines: string[] = []
    let headers: string[] = []
    for (const row of rows) {
      if (row.type !== 'tableRow') continue
      const cells = Array.isArray(row.content) ? row.content as Record<string, unknown>[] : []
      const isHeader = cells.some((c) => c.type === 'tableHeader')
      const cellTexts = cells.map((c) => adfToStructuredText(c))
      if (isHeader) {
        headers = cellTexts
        lines.push(cellTexts.join(' | '))
      } else if (headers.length === cellTexts.length) {
        lines.push(headers.map((h, i) => `${h}: ${cellTexts[i]}`).join(' | '))
      } else {
        lines.push(cellTexts.join(' | '))
      }
    }
    return lines.join('\n')
  }

  const text = typeof n.text === 'string' ? n.text : ''
  const children = Array.isArray(n.content)
    ? (n.content as unknown[]).map((c) => adfToStructuredText(c, headerRow)).join(' ')
    : ''
  return `${text} ${children}`.trim()
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

/**
 * Step 1 of draft creation: use a single fast codex call to extract structured
 * delivery variables from the Jira ticket text. No agent loop, no tools — pure
 * JSON extraction from raw text.
 */
async function extractKibaVars(
  jiraSummary: string,
  jiraStructuredText: string,
  emailTitle: string,
  emailSender: string,
  emailBodyText: string,
): Promise<Omit<KibaVars, 'quoteNumber'>> {
  const outputFile = path.join('/tmp', `kiba-extract-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)

  const prompt = [
    'Extrait les variables de livraison depuis ces données et retourne UNIQUEMENT un JSON valide.',
    'Ne fais rien d\'autre. Pas de texte avant ou après le JSON.',
    '',
    `Résumé Jira: ${jiraSummary}`,
    `Sujet email: ${emailTitle}`,
    `Expéditeur: ${emailSender}`,
    emailBodyText ? `\nCorps de l\'email (source prioritaire pour les données licence) :\n${emailBodyText.slice(0, 2000)}` : '',
    jiraStructuredText ? `\nDescription Jira (tableaux avec colonnes: valeurs) :\n${jiraStructuredText.slice(0, 2000)}` : '',
    '',
    'Règles :',
    '- Lis les tableaux ligne par ligne : la valeur de chaque cellule correspond à l\'en-tête de sa colonne.',
    '- "salles" = colonne "Nombre de Salles" ou "Salles" ou "Rooms" ou "License to create".',
    '- "panneaux" = colonne "Panneaux" ou "Boards".',
    '- "utilisateurs" = colonne "Utilisateurs" ou "Users".',
    '- Ces trois valeurs sont toujours DISTINCTES.',
    '- "renewalDate" = "Renewal date" ou "Date de renouvellement", format JJ/MM/AAAA.',
    '- "customerName" = nom du client (société), pas un prénom seul.',
    '',
    'Retourne exactement ce JSON :',
    JSON.stringify({
      customerName: 'nom de la société cliente (ex: LBL BRENTA, RATP CML)',
      renewalDate: 'JJ/MM/AAAA ou "Non communiqué"',
      salles: 'chiffre uniquement ou "Non communiqué"',
      panneaux: 'chiffre uniquement ou "Non communiqué"',
      utilisateurs: 'chiffre uniquement ou "Non communiqué"',
    }),
  ].filter(Boolean).join('\n')

  const modelArgs = await getModelArgs('treatment')
  const result = await runCommand(
    'codex',
    ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
    APP_DIR,
    60_000, // 1 minute max — just JSON extraction, no tools
  )

  let raw = ''
  try {
    raw = (await readFile(outputFile, 'utf-8')).trim()
  } catch {
    raw = result.stdout.trim()
  } finally {
    void unlink(outputFile).catch(() => undefined)
  }

  if (!raw && result.code !== 0) {
    throw new Error(sanitizeCodexError(result.stderr || result.stdout))
  }

  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<Omit<KibaVars, 'quoteNumber'>>
  return {
    customerName: parsed.customerName || 'Non communiqué',
    renewalDate: parsed.renewalDate || 'Non communiqué',
    salles: parsed.salles || 'Non communiqué',
    panneaux: parsed.panneaux || 'Non communiqué',
    utilisateurs: parsed.utilisateurs || 'Non communiqué',
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

  // ── 2. Fetch Jira data + email thread body (fast API calls) ─────────────
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  let jiraSummary = ''
  let jiraStructuredText = ''
  let emailBodyText = ''

  const [jiraResult, microsoftToken] = await Promise.allSettled([
    (async () => {
      const { baseUrl, auth } = buildJiraAuth(jira)
      const resp = await fetch(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=summary,description`,
        { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      )
      if (!resp.ok) return
      const data = await resp.json() as { fields?: { summary?: string; description?: unknown } }
      jiraSummary = typeof data.fields?.summary === 'string' ? data.fields.summary : ''
      jiraStructuredText = adfToStructuredText(data.fields?.description)
    })(),
    ensureMicrosoftAccessToken(),
  ])

  if (microsoftToken.status === 'fulfilled') {
    try {
      const messages = await listThreadMessages(email, microsoftToken.value)
      const firstMsg = messages[0]
      if (firstMsg?.body?.content) {
        emailBodyText = cutAtSignatureAndQuote(stripHtml(firstMsg.body.content))
      }
    } catch {
      // Continue without email body
    }
  }
  void jiraResult // fetched for side-effects above

  // ── 3. Extract variables via fast codex call (single JSON extraction) ────
  const extracted = await extractKibaVars(
    jiraSummary,
    jiraStructuredText,
    email.title || '',
    email.sender || '',
    emailBodyText,
  )

  // quoteNumber: left empty if not found — the template omits the parentheses when absent
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
