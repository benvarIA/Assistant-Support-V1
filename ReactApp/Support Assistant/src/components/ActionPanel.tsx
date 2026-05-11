import type { PrisEmailRow } from '../types'
import { SEQUENCE_STEPS } from '../constants'
import WorkflowStepper from './WorkflowStepper'

type ActionPanelProps = {
  selectedEmail: PrisEmailRow | null
  sequenceIndex: number
  isAnalyzing: boolean
  isProposingJira: boolean
  isCreatingJira: boolean
  isTracingOrochimaru: boolean
  isIdentificationValidated: boolean
  hasAssociatedJira: boolean
  actionPlaceholderMessage: string | null
  closeTicketSuccess: string | null
  onLaunchAnalysis: () => void
  onLaunchCreate: () => void
  onLaunchTrace: () => void
  onOpenCloseModal: () => void
}

export default function ActionPanel({
  selectedEmail,
  sequenceIndex,
  isAnalyzing,
  isProposingJira,
  isCreatingJira,
  isTracingOrochimaru,
  isIdentificationValidated,
  hasAssociatedJira,
  actionPlaceholderMessage,
  closeTicketSuccess,
  onLaunchAnalysis,
  onLaunchCreate,
  onLaunchTrace,
  onOpenCloseModal,
}: ActionPanelProps) {
  const hasSelectedEmail = Boolean(selectedEmail)

  if (!selectedEmail) {
    return (
      <div className="main-panel">
        <div className="panel-placeholder">
          <div className="placeholder-icon">✉</div>
          <h3>Aucun email sélectionné</h3>
          <p>Sélectionne un email dans la liste pour commencer le traitement.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="main-panel">
      <div className="panel-content">
        <div className="email-header-card">
          <div className="email-header-info">
            <h2 className="email-header-title">{selectedEmail.title}</h2>
            <span className="email-header-sender">{selectedEmail.sender}</span>
          </div>
          {selectedEmail.jiraKey && selectedEmail.jiraUrl && (
            <a
              className="jira-pill"
              href={selectedEmail.jiraUrl}
              target="_blank"
              rel="noreferrer"
            >
              {selectedEmail.jiraKey} ↗
            </a>
          )}
        </div>

        <WorkflowStepper steps={SEQUENCE_STEPS} activeIndex={sequenceIndex} />

        <div className="action-buttons">
          <button
            type="button"
            className={`action-btn${sequenceIndex === 0 ? ' action-current' : ''}`}
            onClick={onLaunchAnalysis}
            disabled={!hasSelectedEmail || hasAssociatedJira}
            title={
              !hasSelectedEmail
                ? "Sélectionne un email pour lancer l'identification."
                : hasAssociatedJira
                  ? 'Identification indisponible: ticket Jira déjà associé.'
                  : undefined
            }
          >
            <span className="action-step-num">01</span>
            <span className="action-label">Identification</span>
            {isAnalyzing && <span className="action-spinner" />}
          </button>

          <button
            type="button"
            className={`action-btn action-btn-primary${sequenceIndex === 1 ? ' action-current' : ''}`}
            onClick={onLaunchCreate}
            disabled={!hasSelectedEmail || hasAssociatedJira || !isIdentificationValidated}
            title={
              !hasSelectedEmail
                ? "Sélectionne un email pour créer un ticket."
                : hasAssociatedJira
                  ? 'Création indisponible: ticket Jira déjà associé.'
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
            disabled={!hasSelectedEmail || isTracingOrochimaru}
            title={
              !hasSelectedEmail ? "Sélectionne un email pour tracer les réponses." : undefined
            }
          >
            <span className="action-step-num">03</span>
            <span className="action-label">Tracer</span>
            {isTracingOrochimaru && <span className="action-spinner" />}
          </button>

          <button
            type="button"
            className={`action-btn action-btn-danger${sequenceIndex === 3 ? ' action-current' : ''}`}
            onClick={onOpenCloseModal}
            disabled={!hasSelectedEmail || !hasAssociatedJira}
            title={
              !hasSelectedEmail
                ? "Sélectionne un email pour clôturer."
                : !hasAssociatedJira
                  ? 'Un ticket Jira associé est requis pour clôturer.'
                  : undefined
            }
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
      </div>
    </div>
  )
}
