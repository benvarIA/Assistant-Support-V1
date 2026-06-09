import { useMemo, useState } from 'react'
import type { AssistanceState, EffortLevel, PrisEmailRow } from '../types'
import { SEQUENCE_STEPS } from '../constants'
import {
  deriveEmailStatus,
  deriveNature,
  formatRunDuration,
  formatRunTimestamp,
  type EmailStatus,
} from '../derive'
import WorkflowStepper from './WorkflowStepper'
import AnalysisReport from './AnalysisReport'
import LivraisonModal from './treatment/LivraisonModal'
import AdministrationModal from './treatment/AdministrationModal'
import AssistanceModal from './treatment/AssistanceModal'

type TreatmentAction = 'livraison' | 'administration' | 'assistance'

type EmailDetailProps = {
  selectedEmail: PrisEmailRow | null
  identificationCategoryText: string
  isIdentificationValidated: boolean
  hasAssociatedJira: boolean
  sequenceIndex: number
  isAnalyzing: boolean
  isProposingJira: boolean
  isCreatingJira: boolean
  isTracingOrochimaru: boolean
  actionPlaceholderMessage: string | null
  closeTicketSuccess: string | null
  derivedStatus: EmailStatus | null
  defaultEffort: EffortLevel
  assistanceState: AssistanceState | null
  onUpdateAssistance: (update: Partial<AssistanceState>) => void
  onLaunchAnalysis: () => void
  onLaunchCreate: () => void
  onLaunchTrace: () => void
  onOpenCloseModal: () => void
}

const STATUS_HINT: Record<string, string> = {
  idle: 'Aucune action lancée. Commence par identifier la demande.',
  identified: 'Demande identifiée. Crée le ticket Jira correspondant.',
  ticket: 'Ticket Jira créé. Trace les échanges puis lance une analyse.',
  running: 'Un agent travaille sur ce thread…',
  analyzed: 'Analyse terminée. Voir le résumé et le détail ci-dessous.',
  error: 'La dernière analyse a échoué. Relance-la depuis Assistance.',
}

const ACTION_CARDS: Array<{ id: TreatmentAction; icon: string; label: string; desc: string; family: string }> = [
  {
    id: 'livraison',
    icon: '🚚',
    label: 'Livraison',
    desc: 'Déploiement, mise en service — brouillon email client (Kiba)',
    family: 'Intervention',
  },
  {
    id: 'administration',
    icon: '⚙️',
    label: 'Administration',
    desc: 'Configuration, gestion des utilisateurs',
    family: 'Intervention',
  },
  {
    id: 'assistance',
    icon: '🎯',
    label: 'Assistance',
    desc: 'Agents spécialisés, analyse de logs/HAR, rapport et proposition d’email',
    family: 'Assistance',
  },
]

export default function EmailDetail({
  selectedEmail,
  identificationCategoryText,
  isIdentificationValidated,
  hasAssociatedJira,
  sequenceIndex,
  isAnalyzing,
  isProposingJira,
  isCreatingJira,
  isTracingOrochimaru,
  actionPlaceholderMessage,
  closeTicketSuccess,
  derivedStatus,
  defaultEffort,
  assistanceState,
  onUpdateAssistance,
  onLaunchAnalysis,
  onLaunchCreate,
  onLaunchTrace,
  onOpenCloseModal,
}: EmailDetailProps) {
  const [openModal, setOpenModal] = useState<TreatmentAction | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const nature = useMemo(() => deriveNature(identificationCategoryText), [identificationCategoryText])

  // Build the analysis timeline: prefer the explicit history, fall back to the
  // latest reports so legacy data still shows something.
  const timeline = useMemo(() => {
    if (!assistanceState) return []
    if (assistanceState.history && assistanceState.history.length > 0) {
      return [...assistanceState.history].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1))
    }
    return (assistanceState.reports ?? [])
      .filter((r) => r.status === 'done' || r.status === 'error')
      .map((r, i) => ({
        id: `${r.agentId}-${i}`,
        agentLabel: r.agentId === 'analyse' ? 'Analyse ticket' : r.agentId,
        model: null,
        effort: null,
        guidance: '',
        status: r.status as 'done' | 'error',
        summary: '',
        report: r.report,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt ?? '',
        finishedAt: r.finishedAt ?? '',
      }))
  }, [assistanceState])

  if (!selectedEmail) {
    return (
      <section className="detail detail--empty">
        <div className="detail-empty-state">
          <span className="detail-empty-mark" aria-hidden="true">⌘</span>
          <h2 className="detail-empty-title">Sélectionne un email</h2>
          <p className="detail-empty-hint">
            Choisis un thread « Pris » dans la liste pour voir sa fiche : statut du traitement,
            résumé de l’assistant et historique des analyses.
          </p>
        </div>
      </section>
    )
  }

  const status = derivedStatus ?? deriveEmailStatus(selectedEmail, undefined, assistanceState)
  const aiSummary = assistanceState?.summary?.trim() ?? ''
  const hasAnalysis = Boolean(assistanceState && assistanceState.status !== 'none')

  const closeAllModals = () => setOpenModal(null)

  return (
    <>
      {openModal === 'livraison' && (
        <LivraisonModal selectedEmail={selectedEmail} onClose={closeAllModals} />
      )}
      {openModal === 'administration' && (
        <AdministrationModal selectedEmail={selectedEmail} onClose={closeAllModals} />
      )}
      {openModal === 'assistance' && (
        <AssistanceModal
          selectedEmail={selectedEmail}
          assistanceState={assistanceState}
          defaultEffort={defaultEffort}
          onUpdateAssistance={onUpdateAssistance}
          onClose={closeAllModals}
        />
      )}

      <section className="detail" key={selectedEmail.id}>
        {/* ── Header ── */}
        <header className="detail-header">
          <div className="detail-header-top">
            <div className={`detail-status detail-status--${status.tone}`}>
              <span className="detail-status-dot" />
              {status.label}
            </div>
            {nature && (
              <span className={`nature-chip nature-chip--${nature.tone}`}>
                {nature.label}
                {nature.sub && <span className="nature-chip-sub">{nature.sub}</span>}
              </span>
            )}
            <div className="detail-header-spacer" />
            {selectedEmail.jiraKey && selectedEmail.jiraUrl && (
              <a className="detail-jira-pill" href={selectedEmail.jiraUrl} target="_blank" rel="noreferrer">
                {selectedEmail.jiraKey} ↗
              </a>
            )}
          </div>

          <h1 className="detail-title">{selectedEmail.title}</h1>

          <div className="detail-meta">
            <span className="detail-sender">{selectedEmail.sender}</span>
            {selectedEmail.receivedDateTime && (
              <span className="detail-meta-sep">·</span>
            )}
            {selectedEmail.receivedDateTime && (
              <time className="detail-date">
                {new Date(selectedEmail.receivedDateTime).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            )}
            {selectedEmail.clientInfo && (
              <span className="detail-client-badges">
                {selectedEmail.clientInfo.language && (
                  <span
                    className={`client-lang-badge lang-${selectedEmail.clientInfo.language.toLowerCase()}`}
                    title={`Langue : ${selectedEmail.clientInfo.language}`}
                  >
                    {selectedEmail.clientInfo.language === 'English' ? 'EN' : 'FR'}
                  </span>
                )}
                {selectedEmail.clientInfo.setup && (
                  <span className="client-setup-badge" title={selectedEmail.clientInfo.setup}>
                    {selectedEmail.clientInfo.setup}
                  </span>
                )}
                {selectedEmail.clientInfo.version && (
                  <span
                    className="client-version-badge"
                    title={selectedEmail.clientInfo.version === 'latest'
                      ? 'Plateforme hébergée iObeya — dernière version'
                      : `Version iObeya ${selectedEmail.clientInfo.version}`}
                  >
                    {selectedEmail.clientInfo.version === 'latest' ? 'dernière version' : `v${selectedEmail.clientInfo.version}`}
                  </span>
                )}
                {selectedEmail.clientInfo.status && (
                  <span
                    className={`client-status-badge status-${selectedEmail.clientInfo.status.toLowerCase()}`}
                    title={`Statut plateforme : ${selectedEmail.clientInfo.status}`}
                  >
                    {selectedEmail.clientInfo.status}
                  </span>
                )}
              </span>
            )}
          </div>
        </header>

        {/* ── AI status digest (daily-standup line, generated by Codex) ── */}
        <section className={`digest-card digest-card--${status.tone}`}>
          <div className="digest-head">
            <span className="digest-eyebrow">Statut · résumé assistant</span>
            {assistanceState?.updatedAt && hasAnalysis && (
              <span className="digest-updated">maj {formatRunTimestamp(assistanceState.updatedAt)}</span>
            )}
          </div>
          {aiSummary ? (
            <p className="digest-text">{aiSummary}</p>
          ) : (
            <p className="digest-placeholder">{STATUS_HINT[status.key] ?? STATUS_HINT.idle}</p>
          )}
        </section>

        {/* ── Workflow progression ── */}
        <section className="detail-block">
          <div className="detail-block-head">
            <h3 className="detail-block-title">Progression</h3>
            <span className="detail-block-sub">Identification → Création → Traçage → Clôture</span>
          </div>

          <WorkflowStepper steps={SEQUENCE_STEPS} activeIndex={sequenceIndex} />

          <div className="action-buttons">
            <button
              type="button"
              className={`action-btn${sequenceIndex === 0 ? ' action-current' : ''}`}
              onClick={onLaunchAnalysis}
              disabled={hasAssociatedJira}
              title={hasAssociatedJira ? 'Identification indisponible : ticket Jira déjà associé.' : undefined}
            >
              <span className="action-step-num">01</span>
              <span className="action-label">Identification</span>
              {isAnalyzing && <span className="action-spinner" />}
            </button>

            <button
              type="button"
              className={`action-btn action-btn-primary${sequenceIndex === 1 ? ' action-current' : ''}`}
              onClick={onLaunchCreate}
              disabled={hasAssociatedJira || !isIdentificationValidated}
              title={
                hasAssociatedJira
                  ? 'Création indisponible : ticket Jira déjà associé.'
                  : !isIdentificationValidated
                    ? "Valider l'identification avant de créer."
                    : undefined
              }
            >
              <span className="action-step-num">02</span>
              <span className="action-label">Créer ticket</span>
              {(isProposingJira || isCreatingJira) && <span className="action-spinner" />}
            </button>

            <button
              type="button"
              className={`action-btn${sequenceIndex === 2 ? ' action-current' : ''}`}
              onClick={onLaunchTrace}
              disabled={isTracingOrochimaru || !hasAssociatedJira}
              title={!hasAssociatedJira ? 'Un ticket Jira associé est requis pour tracer.' : undefined}
            >
              <span className="action-step-num">03</span>
              <span className="action-label">Tracer</span>
              {isTracingOrochimaru && <span className="action-spinner" />}
            </button>

            <button
              type="button"
              className={`action-btn action-btn-danger${sequenceIndex === 3 ? ' action-current' : ''}`}
              onClick={onOpenCloseModal}
              disabled={!hasAssociatedJira}
              title={!hasAssociatedJira ? 'Un ticket Jira associé est requis pour clôturer.' : undefined}
            >
              <span className="action-step-num">04</span>
              <span className="action-label">Clôturer</span>
            </button>
          </div>

          {actionPlaceholderMessage && (
            <div className="status-message status-info">{actionPlaceholderMessage}</div>
          )}
          {closeTicketSuccess && (
            <div className="status-message status-success">{closeTicketSuccess}</div>
          )}
        </section>

        {/* ── Treatment actions ── */}
        <section className="detail-block">
          <div className="detail-block-head">
            <h3 className="detail-block-title">Traitement</h3>
            <span className="detail-block-sub">Lancer un skill selon la nature de la demande</span>
          </div>

          <div className="treatment-action-grid">
            {ACTION_CARDS.map((card) => {
              const recommended = nature?.family === card.family
              const isAssistanceActive = card.id === 'assistance' && hasAnalysis
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`treatment-action-card${isAssistanceActive ? ' treatment-action-card--active' : ''}${recommended ? ' treatment-action-card--recommended' : ''}`}
                  onClick={() => setOpenModal(card.id)}
                >
                  <span className="treatment-action-top">
                    <span className="treatment-action-icon">{card.icon}</span>
                    {recommended && <span className="treatment-action-flag">Recommandé</span>}
                    {isAssistanceActive && !recommended && <span className="treatment-action-flag treatment-action-flag--done">Analysé</span>}
                  </span>
                  <span className="treatment-action-label">{card.label}</span>
                  <span className="treatment-action-desc">{card.desc}</span>
                </button>
              )
            })}

            {/* Placeholder — FAQ / TroubleShootings (à venir) */}
            <div
              className="treatment-action-card treatment-action-card--placeholder"
              aria-disabled="true"
            >
              <span className="treatment-action-top">
                <span className="treatment-action-icon">📚</span>
                <span className="treatment-action-flag treatment-action-flag--soon">Bientôt</span>
              </span>
              <span className="treatment-action-label">FAQ / TroubleShootings</span>
              <span className="treatment-action-desc">
                Base de connaissances et guides de résolution — à venir.
              </span>
            </div>
          </div>
        </section>

        {/* ── Analysis history (Assistance) ── */}
        {timeline.length > 0 && (
          <section className="detail-block">
            <div className="detail-block-head">
              <h3 className="detail-block-title">Historique des analyses</h3>
              <span className="count-badge">{timeline.length}</span>
            </div>

            <ol className="run-timeline">
              {timeline.map((run) => {
                const isOpen = expandedRun === run.id
                const duration = formatRunDuration(run.startedAt, run.finishedAt)
                return (
                  <li key={run.id} className={`run-item run-item--${run.status}`}>
                    <button
                      type="button"
                      className="run-head"
                      onClick={() => setExpandedRun(isOpen ? null : run.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="run-marker" />
                      <span className="run-info">
                        <span className="run-info-top">
                          <span className="run-agent">{run.agentLabel}</span>
                          <span className={`run-state run-state--${run.status}`}>
                            {run.status === 'done' ? 'Terminé' : 'Échec'}
                          </span>
                        </span>
                        <span className="run-meta">
                          {run.finishedAt && <span>{formatRunTimestamp(run.finishedAt)}</span>}
                          {duration && <span className="run-mono">{duration}</span>}
                          {run.model && <span className="run-mono">{run.model}</span>}
                          {run.effort && <span className="run-mono">effort {run.effort}</span>}
                        </span>
                        {run.summary && <span className="run-summary">{run.summary}</span>}
                      </span>
                      <span className={`run-chevron${isOpen ? ' run-chevron--open' : ''}`} aria-hidden="true">▸</span>
                    </button>

                    {isOpen && (
                      <div className="run-body">
                        {run.guidance && (
                          <p className="run-guidance">
                            <span className="run-guidance-label">Consigne</span> {run.guidance}
                          </p>
                        )}
                        {run.status === 'error' && run.errorMessage && (
                          <p className="form-error">{run.errorMessage}</p>
                        )}
                        {run.report ? (
                          <AnalysisReport report={run.report} compact />
                        ) : run.status !== 'error' ? (
                          <p className="run-empty">Aucun rapport détaillé pour cette analyse.</p>
                        ) : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </section>
    </>
  )
}
