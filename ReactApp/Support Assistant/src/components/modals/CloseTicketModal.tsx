import type { PrisEmailRow } from '../../types'
import ErrorBanner from '../ErrorBanner'

type CloseTicketModalProps = {
  selectedEmail: PrisEmailRow
  closeWorklogMinutes: string
  closeTicketError: string | null
  isClosingTicket: boolean
  onSetCloseWorklogMinutes: (value: string) => void
  onConfirm: () => void
  onClose: () => void
}

export default function CloseTicketModal({
  selectedEmail,
  closeWorklogMinutes,
  closeTicketError,
  isClosingTicket,
  onSetCloseWorklogMinutes,
  onConfirm,
  onClose,
}: CloseTicketModalProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card modal-card-compact"
        role="dialog"
        aria-modal="true"
        aria-label="Clôturer le ticket"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Clôturer le ticket</h2>
            <p className="modal-subtitle">
              <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isClosingTicket}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="modal-form">
            <label className="form-field form-field-full">
              <span className="form-label">Temps passé (minutes)</span>
              <input
                type="number"
                className="form-input"
                min="0"
                step="1"
                value={closeWorklogMinutes}
                onChange={(e) => {
                  onSetCloseWorklogMinutes(e.target.value)
                }}
              />
            </label>
            <p className="form-hint form-field-full">
              0 par défaut. Si tu laisses 0, le ticket est clôturé sans worklog Jira.
            </p>
          </div>

          <ErrorBanner message={closeTicketError} />
        </div>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isClosingTicket}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={isClosingTicket}
          >
            {isClosingTicket ? 'Clôture…' : 'Valider et clôturer'}
          </button>
        </footer>
      </section>
    </div>
  )
}
