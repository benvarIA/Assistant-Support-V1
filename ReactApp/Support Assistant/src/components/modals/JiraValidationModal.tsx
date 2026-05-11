import type { PrisEmailRow, JiraIssueMatch } from '../../types'
import ErrorBanner from '../ErrorBanner'

type JiraValidationModalProps = {
  email: PrisEmailRow
  confirmError: string | null
  onConfirm: (email: PrisEmailRow, match: JiraIssueMatch) => void
  onDismiss: () => void
}

export default function JiraValidationModal({
  email,
  confirmError,
  onConfirm,
  onDismiss,
}: JiraValidationModalProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Validation ticket Jira trouvé"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Ticket Jira détecté</h2>
            <p className="modal-subtitle">Un ou plusieurs tickets correspondent à cet email.</p>
          </div>
        </header>

        <div className="modal-body">
          <div className="jira-validation-meta">
            <div>
              <span className="meta-label">Titre</span>
              <span className="meta-value">{email.title}</span>
            </div>
            <div>
              <span className="meta-label">Expéditeur</span>
              <span className="meta-value">{email.sender}</span>
            </div>
            {email.receivedDateTime && (
              <div>
                <span className="meta-label">Date</span>
                <span className="meta-value">
                  {new Date(email.receivedDateTime).toLocaleDateString('fr-FR')}
                </span>
              </div>
            )}
          </div>

          <ErrorBanner message={confirmError} />

          <div className="jira-match-list">
            {email.jiraMatches.map((match) => (
              <div key={match.key} className="jira-match-card">
                <div className="jira-match-header">
                  <strong className="jira-match-key">{match.key}</strong>
                  <span className="jira-match-score">Score: {match.score}</span>
                </div>
                <p className="jira-match-summary">{match.summary}</p>
                <p className="jira-match-reason">{match.reason}</p>
                <div className="jira-match-meta">
                  <span>Créé: {match.created}</span>
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onConfirm(email, match)}
                  >
                    Associer ce ticket
                  </button>
                  <a
                    className="btn btn-ghost"
                    href={match.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir Jira ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Aucun de ces tickets
          </button>
        </footer>
      </section>
    </div>
  )
}
