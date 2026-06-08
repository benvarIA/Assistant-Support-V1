import type { AssistanceState, PrisEmailRow, TreatmentProgress } from './types'

/* ============================================================
   DERIVED STATE — status & nature of a "Pris" email thread
   Pure functions, no side effects. Drives the list overview
   and the detail fiche.
   ============================================================ */

export type StatusTone = 'idle' | 'identified' | 'ticket' | 'running' | 'analyzed' | 'error'

export type EmailStatus = {
  key: StatusTone
  label: string
  tone: StatusTone
}

/**
 * Collapses everything we know about a thread into a single, most-advanced
 * stage. Priority (high → low): running > analyzed/error > ticket created >
 * identified > untouched.
 */
export function deriveEmailStatus(
  email: PrisEmailRow,
  treatment: Partial<TreatmentProgress> | undefined,
  assistance: AssistanceState | null,
): EmailStatus {
  const isRunning =
    Boolean(treatment?.isAnalyzing) ||
    Boolean(treatment?.isProposingJira) ||
    Boolean(treatment?.isCreatingJira) ||
    assistance?.status === 'in_progress'

  if (isRunning) {
    return { key: 'running', label: 'En cours', tone: 'running' }
  }

  if (assistance?.status === 'done') {
    const reports = assistance.reports ?? []
    const hasDone = reports.some((r) => r.status === 'done')
    const hasError = reports.some((r) => r.status === 'error')
    if (hasError && !hasDone) {
      return { key: 'error', label: 'Analyse en échec', tone: 'error' }
    }
    return { key: 'analyzed', label: 'Analysé', tone: 'analyzed' }
  }

  if (email.jiraKey) {
    return { key: 'ticket', label: 'Ticket créé', tone: 'ticket' }
  }

  if (treatment?.isIdentificationValidated) {
    return { key: 'identified', label: 'Identifié', tone: 'identified' }
  }

  return { key: 'idle', label: 'À traiter', tone: 'idle' }
}

export type NatureFamily = 'Assistance' | 'Intervention' | 'Information' | 'Question'

export type Nature = {
  family: NatureFamily
  label: string
  sub: string | null
  tone: 'assistance' | 'intervention' | 'information' | 'question'
}

/**
 * The "nature" of the request, as defined through the Jira identification step.
 * Returns null when nothing has been identified yet (so the chip stays hidden
 * until the nature is actually known — "quand défini via le Jira").
 */
export function deriveNature(categoryText: string | undefined | null): Nature | null {
  const c = (categoryText ?? '').trim().toLowerCase()
  if (c === 'assistance') {
    return { family: 'Assistance', label: 'Assistance', sub: null, tone: 'assistance' }
  }
  if (c === 'question') {
    return { family: 'Question', label: 'Question', sub: null, tone: 'question' }
  }
  if (c === 'intervention livraison') {
    return { family: 'Intervention', label: 'Intervention', sub: 'Livraison', tone: 'intervention' }
  }
  if (c === 'intervention administration') {
    return { family: 'Intervention', label: 'Intervention', sub: 'Admin', tone: 'intervention' }
  }
  return null
}

/* ── Structured rendering of a Codex analysis report ── */

export type ReportSection = { num: string; title: string; body: string }

const SECTION_HEADER_RE = /^\s*(\d{1,2})[.)]\s+(.{2,90})$/

/**
 * Codex analysis reports follow a numbered-section convention
 * ("1. Résumé du problème", "2. Contexte / historique du ticket", …).
 * Parse those into structured sections so they can be rendered as a clean,
 * scannable digest instead of a raw text dump. Returns null when the report
 * doesn't follow the convention (then render it verbatim).
 */
export function parseReportSections(report: string): ReportSection[] | null {
  if (!report.trim()) return null
  const lines = report.split('\n')
  const sections: ReportSection[] = []
  let current: ReportSection | null = null

  for (const line of lines) {
    const match = line.match(SECTION_HEADER_RE)
    if (match) {
      if (current) sections.push(current)
      current = { num: match[1], title: match[2].trim(), body: '' }
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current) sections.push(current)

  const cleaned = sections.map((s) => ({ ...s, body: s.body.trim() }))
  return cleaned.length >= 2 ? cleaned : null
}

export function formatRunTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRunDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return ''
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return ''
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 1) return '< 1s'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}
