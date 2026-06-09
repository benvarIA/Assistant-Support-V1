import path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import {
  APP_DIR,
  JIRA_CONFIG_CACHE,
  SIMILAR_SEARCH_PROJECTS_BY_EFFORT,
  SIMILAR_TICKETS_SKILL_PATH,
} from '../config.js'
import type { JiraConfig, JiraIssueComment } from '../types.js'
import { parseCodexJson, readJsonFile, runCommand, sanitizeCodexError } from '../utils.js'
import { adfNodeToText, buildJiraAuth, fetchJiraComments, tokenizeForMatch } from './jira.js'
import { getModelArgs } from './settings.js'

type EffortLevel = 'low' | 'medium' | 'high'

type SimilarTicketsRunConfig = {
  model?: string
  effort?: EffortLevel
}

type ParsedAnalysis = {
  summary?: string
  report?: string
}

type JiraAttachmentMeta = { filename?: string; mimeType?: string; size?: number }

type JiraIssueFields = {
  summary?: string
  description?: Record<string, unknown> | null
  issuetype?: { name?: string }
  status?: { name?: string; statusCategory?: { name?: string } }
  resolution?: { name?: string } | null
  priority?: { name?: string }
  created?: string
  updated?: string
  labels?: string[]
  attachment?: JiraAttachmentMeta[]
}

type JiraIssue = { key?: string; fields?: JiraIssueFields }

type Candidate = {
  key: string
  fields: JiraIssueFields
  descriptionText: string
  score: number
  comments: string
}

// Champs ramenés pour chaque ticket (référence + candidats).
const ISSUE_FIELDS = 'summary,description,issuetype,status,resolution,priority,created,updated,labels,attachment'

const CANDIDATE_SEARCH_LIMIT = 40
const DEEP_READ_LIMIT = 8

// Bruit fréquent dans les tickets support (politesses, mots vides FR/EN, termes ubiquistes).
const STOPWORDS = new Set([
  'bonjour', 'cordialement', 'merci', 'madame', 'monsieur', 'salutations', 'support', 'iobeya',
  'ticket', 'probleme', 'demande', 'client', 'equipe', 'team', 'email', 'mail', 'objet', 'sujet',
  'pour', 'avec', 'dans', 'sur', 'les', 'des', 'une', 'aux', 'par', 'que', 'qui', 'est', 'sont',
  'vous', 'nous', 'votre', 'notre', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have',
  'pouvez', 'merci', 'suite', 'concernant', 'voici', 'afin', 'plus', 'bien', 'fait', 'avez',
])

function trimBlock(text: string, maxChars = 6_000): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n[…tronqué ${trimmed.length - maxChars} caractères]`
}

function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

function escapeJqlText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function resolveEffort(effort?: EffortLevel): EffortLevel {
  return effort === 'low' || effort === 'high' ? effort : 'medium'
}

async function getExecModelArgs(config: SimilarTicketsRunConfig, effort: EffortLevel): Promise<string[]> {
  if (config.model) {
    return ['-m', config.model, '-c', `model_reasoning_effort="${effort}"`]
  }
  return getModelArgs('treatment')
}

async function readJiraConfigOrThrow(): Promise<JiraConfig> {
  const jira = await readJsonFile<JiraConfig>(JIRA_CONFIG_CACHE)
  buildJiraAuth(jira)
  return jira
}

async function fetchIssue(jira: JiraConfig, jiraKey: string): Promise<JiraIssue> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}`)
  url.searchParams.set('fields', ISSUE_FIELDS)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Lecture ticket Jira impossible (${jiraKey}): ${response.status} ${body}`)
  }
  return await response.json() as JiraIssue
}

async function searchIssues(jira: JiraConfig, jql: string, maxResults: number): Promise<JiraIssue[]> {
  const { baseUrl, auth } = buildJiraAuth(jira)
  const url = new URL(`${baseUrl}/rest/api/3/search/jql`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('fields', ISSUE_FIELDS)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Recherche Jira impossible: ${response.status} ${body}`)
  }
  const data = await response.json() as { issues?: JiraIssue[] }
  return Array.isArray(data.issues) ? data.issues : []
}

function extractKeywords(summary: string, description: string): string[] {
  const tokens = tokenizeForMatch(`${summary} ${description}`, 4)
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of tokens) {
    if (STOPWORDS.has(token) || /^\d+$/.test(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    keywords.push(token)
  }
  // Les mots les plus longs sont en général les plus discriminants (codes, modules, erreurs).
  return keywords.sort((a, b) => b.length - a.length).slice(0, 12)
}

function commentsToText(comments: JiraIssueComment[], maxComments = 4): string {
  if (comments.length === 0) return '(aucun commentaire)'
  const recent = comments.slice(-maxComments)
  return recent
    .map((comment, index) => {
      const body = trimBlock(adfNodeToText(comment.body ?? {}).trim(), 1_500)
      return `[${formatDate(comment.created)}] ${body || '(vide)'}` + (index < recent.length - 1 ? '' : '')
    })
    .join('\n---\n')
}

function attachmentNames(fields: JiraIssueFields): string {
  const names = (fields.attachment ?? []).map((a) => a.filename?.trim()).filter(Boolean)
  return names.length > 0 ? names.join(', ') : 'aucune'
}

function scoreCandidate(currentTokens: Set<string>, candidate: JiraIssue, descriptionText: string): number {
  const tokens = new Set(tokenizeForMatch(`${candidate.fields?.summary ?? ''} ${descriptionText}`, 4))
  let score = 0
  for (const token of tokens) {
    if (currentTokens.has(token)) score += 1
  }
  return score
}

function buildPrompt(
  referenceKey: string,
  reference: JiraIssue,
  referenceComments: JiraIssueComment[],
  projects: readonly string[],
  jql: string,
  candidates: Candidate[],
  totalFound: number,
  baseUrl: string,
  guidance?: string,
): string {
  const refFields = reference.fields ?? {}
  const refDescription = trimBlock(adfNodeToText(refFields.description ?? {}).trim(), 6_000) || '(description vide)'

  const candidatesText = candidates.length > 0
    ? candidates.map((candidate, index) => {
        const f = candidate.fields
        return [
          `--- Candidat #${index + 1} : ${candidate.key} ---`,
          `Lien: ${baseUrl}/browse/${candidate.key}`,
          `Titre: ${f.summary?.trim() || '(sans titre)'}`,
          `Type: ${f.issuetype?.name?.trim() || '—'} · Statut: ${f.status?.name?.trim() || '—'} (${f.status?.statusCategory?.name?.trim() || '—'})`,
          `Résolution: ${f.resolution?.name?.trim() || '—'} · Créé: ${formatDate(f.created)} · MAJ: ${formatDate(f.updated)}`,
          `Pièces jointes: ${attachmentNames(f)}`,
          `Description: ${trimBlock(candidate.descriptionText, 2_000) || '(vide)'}`,
          `Commentaires:\n${candidate.comments}`,
        ].join('\n')
      }).join('\n\n')
    : 'Aucun candidat trouvé par la recherche JQL.'

  return [
    `Utilise le skill $similar-tickets situé à ce chemin: ${SIMILAR_TICKETS_SKILL_PATH}.`,
    `Tu travailles UNIQUEMENT à partir des données Jira fournies ci-dessous (déjà récupérées par l'application).`,
    `Ne tente aucun accès réseau ni aucune commande: tout est dans ce prompt.`,
    '',
    `Ticket de référence: ${referenceKey} (lien: ${baseUrl}/browse/${referenceKey}).`,
    `Périmètre de recherche utilisé: project IN (${projects.join(', ')}).`,
    `Candidats fournis: ${candidates.length} (sur ${totalFound} remontés par la recherche).`,
    '',
    'Ta mission: parmi les CANDIDATS fournis, identifier les tickets réellement similaires au ticket de référence',
    '(même problème / module / message d\'erreur), les classer par pertinence, et extraire comment chacun a été résolu',
    '(ou son état s\'il est encore ouvert). Vérifie titre, description, commentaires et noms de pièces jointes.',
    '',
    'Réponds STRICTEMENT en JSON valide, sans markdown, avec ce schéma:',
    '{"summary":"résumé très court","report":"rapport structuré complet en sections numérotées"}',
    '',
    'Contraintes du rapport:',
    '- français, concret, exploitable par un agent support',
    '- aucune invention: ne cite que des candidats présents ci-dessous (avec leur lien browse)',
    '- écarte les candidats non pertinents et indique combien tu en as écartés (transparence)',
    '- sections numérotées (titres courts < 90 caractères):',
    '  1. Tickets similaires — un bloc par ticket retenu: CLÉ — titre, statut, en quoi c\'est similaire, comment résolu, lien',
    '  2. Pistes de résolution — synthèse actionnable tirée de ces précédents',
    '  3. Candidats écartés — combien et pourquoi (en une ligne)',
    '',
    '=== TICKET DE RÉFÉRENCE ===',
    `Clé: ${referenceKey}`,
    `Titre: ${refFields.summary?.trim() || '(sans titre)'}`,
    `Type: ${refFields.issuetype?.name?.trim() || '—'} · Statut: ${refFields.status?.name?.trim() || '—'}`,
    `Pièces jointes: ${attachmentNames(refFields)}`,
    'Description:',
    refDescription,
    'Commentaires:',
    commentsToText(referenceComments),
    '',
    `(JQL exécuté: ${jql})`,
    '',
    '=== CANDIDATS ===',
    candidatesText,
    guidance?.trim()
      ? ['', '=== COMPLEMENT UTILISATEUR POUR RELANCE ===', guidance.trim()].join('\n')
      : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

function normalizeParsedAnalysis(parsed: ParsedAnalysis | null, rawOutput: string): { summary: string; report: string } {
  if (parsed?.report?.trim()) {
    return {
      summary: parsed.summary?.trim() || 'Recherche de tickets similaires terminée.',
      report: parsed.report.trim(),
    }
  }
  return {
    summary: 'Recherche de tickets similaires terminée.',
    report: rawOutput.trim() || 'Aucun rapport retourné.',
  }
}

export async function runSimilarTicketsAgent(
  jiraKey: string,
  config?: SimilarTicketsRunConfig,
  guidance?: string,
): Promise<{ summary: string; report: string }> {
  const jira = await readJiraConfigOrThrow()
  const { baseUrl } = buildJiraAuth(jira)

  const effort = resolveEffort(config?.effort)
  const projects = SIMILAR_SEARCH_PROJECTS_BY_EFFORT[effort]

  // 1. Ticket de référence (Node a le réseau, contrairement au sandbox codex).
  const reference = await fetchIssue(jira, jiraKey)
  const referenceComments = await fetchJiraComments(jira, jiraKey)
  const refSummary = reference.fields?.summary ?? ''
  const refDescription = adfNodeToText(reference.fields?.description ?? {}).trim()

  // 2. Mots-clés (code) → JQL multi-projets.
  // IMPORTANT: Jira fait un AND/phrase sur `text ~ "a b c"` (plus de mots = moins de résultats).
  // On construit donc un OR entre mots-clés pour maximiser le recall ; le scoring + Codex trient ensuite.
  // Les mots-clés sortent de tokenizeForMatch → purement [a-z0-9] (sûrs en Lucene).
  // Si aucun mot-clé exploitable, on ne fabrique PAS de clause `text ~` à partir du résumé brut
  // (risque d'erreur Lucene 400) : on retombe sur les tickets récents du périmètre.
  const keywords = extractKeywords(refSummary, refDescription).slice(0, 8)
  const textClause = keywords.length > 0
    ? ` AND (${keywords.map((kw) => `text ~ "${escapeJqlText(kw)}"`).join(' OR ')})`
    : ''
  const jql = `project IN (${projects.join(', ')})${textClause} AND key != ${jiraKey} ORDER BY updated DESC`

  // 3. Recherche + scoring + lecture approfondie des meilleurs candidats.
  const found = await searchIssues(jira, jql, CANDIDATE_SEARCH_LIMIT)
  const currentTokens = new Set(tokenizeForMatch(`${refSummary} ${refDescription}`, 4))
  const ranked = found
    .filter((issue) => typeof issue.key === 'string')
    .map((issue) => {
      const descriptionText = adfNodeToText(issue.fields?.description ?? {}).trim()
      return { issue, descriptionText, score: scoreCandidate(currentTokens, issue, descriptionText) }
    })
    .sort((a, b) => b.score - a.score)

  const candidates: Candidate[] = []
  for (const { issue, descriptionText, score } of ranked.slice(0, DEEP_READ_LIMIT)) {
    const key = issue.key as string
    let comments = '(non lus)'
    try {
      comments = commentsToText(await fetchJiraComments(jira, key))
    } catch {
      comments = '(commentaires non récupérés)'
    }
    candidates.push({ key, fields: issue.fields ?? {}, descriptionText, score, comments })
  }

  // 4. Codex juge / classe / extrait la résolution (aucun réseau requis).
  const prompt = buildPrompt(jiraKey, reference, referenceComments, projects, jql, candidates, found.length, baseUrl, guidance)
  const outputFile = path.join('/tmp', `similar-tickets-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
  const modelArgs = await getExecModelArgs(config ?? {}, effort)
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
    void unlink(outputFile).catch(() => undefined)
  }

  if (result.code !== 0) {
    throw new Error(sanitizeCodexError(result.stderr || result.stdout))
  }

  // Sur exit 0 sans fichier de sortie, ne pas reverser le log de session codex (stdout) comme rapport.
  if (!lastMessage.trim()) {
    throw new Error("Codex n'a produit aucune sortie exploitable.")
  }

  const parsed = parseCodexJson<ParsedAnalysis>(lastMessage)
  return normalizeParsedAnalysis(parsed, lastMessage)
}
