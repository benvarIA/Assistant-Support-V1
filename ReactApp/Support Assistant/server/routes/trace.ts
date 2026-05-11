import path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { JiraAnalyzeInput, OrochimaruTraceResponse } from '../types.js'
import { APP_DIR, OROCHIMARU_SKILL_PATH, TRACE_EXEC_LOCKS } from '../config.js'
import { parseCodexJson, readJsonBody, runCommand, sanitizeCodexError, sendJson } from '../utils.js'
import { traceRemainingEmailsInJira } from '../services/jira.js'
import { getModelArgs } from '../services/settings.js'

function orochimaruAsksToChooseJira(payload: OrochimaruTraceResponse | null): boolean {
  if (!payload) return false

  const bucket = [payload.summary ?? '', payload.question ?? '', payload.blocking_reason ?? '']
    .join('\n')
    .toLowerCase()

  if (!bucket.trim()) return false

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
  if (!orochimaruAsksToChooseJira(payload)) return payload

  const forcedMessage = `Ticket Jira imposé par le traitement en cours: ${jiraKey}.`
  const cleanedQuestion = payload.question && /(jira|ticket)/i.test(payload.question) ? '' : payload.question

  return {
    ...payload,
    status: payload.status === 'error' ? 'error' : 'needs_validation',
    summary: payload.summary ? `${forcedMessage} ${payload.summary}` : forcedMessage,
    question: cleanedQuestion || "Valider uniquement l'aperçu de traçage (le ticket Jira est déjà fixé).",
    blocking_reason: payload.blocking_reason && !/(jira|ticket)/i.test(payload.blocking_reason) ? payload.blocking_reason : '',
  }
}

export async function handleTraceRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/trace/execute') {
    const body = await readJsonBody(req)
    const jiraKey = typeof body.jiraKey === 'string' ? body.jiraKey.trim() : ''
    const email = (body.email as JiraAnalyzeInput | undefined) ?? {}
    if (!jiraKey) {
      sendJson(res, 400, { error: 'Missing jiraKey' })
      return true
    }

    const lockKey = `${jiraKey}::${email.conversationId?.trim() || email.id?.trim() || 'no-thread'}`
    if (TRACE_EXEC_LOCKS.has(lockKey)) {
      sendJson(res, 409, { error: 'Traçage déjà en cours pour ce ticket/thread.' })
      return true
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
    return true
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
      return true
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
      return true
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
      const modelArgs = await getModelArgs('tickets')
      const result = await runCommand(
        'codex',
        ['exec', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-o', outputFile, prompt],
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
        blocking_reason: result.code === 0 ? '' : sanitizeCodexError(result.stderr || result.stdout),
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
    return true
  }

  return false
}
