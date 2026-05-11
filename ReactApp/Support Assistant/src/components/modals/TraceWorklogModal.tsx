import type { PrisEmailRow } from '../../types'
import ErrorBanner from '../ErrorBanner'

type TraceWorklogModalProps = {
  selectedEmail: PrisEmailRow
  traceWorklogMinutes: string
  traceWorklogError: string | null
  isAddingTraceWorklog: boolean
  onSetTraceWorklogMinutes: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export default function TraceWorklogModal({
  selectedEmail,
  traceWorklogMinutes,
  traceWorklogError,
  isAddingTraceWorklog,
  onSetTraceWorklogMinutes,
  onSubmit,
  onClose,
}: TraceWorklogModalProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card modal-card-compact"
        role="dialog"
        aria-modal="true"
        aria-label="Ajouter temps passé"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Temps passé après traçage</h2>
            <p className="modal-subtitle">
              <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
            </p>
          </div>
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
                value={traceWorklogMinutes}
                onChange={(e) => {
                  onSetTraceWorklogMinutes(e.target.value)
                }}
              />
            </label>
            <p className="form-hint form-field-full">0 = ne pas ajouter de worklog.</p>
          </div>

          <ErrorBanner message={traceWorklogError} />
        </div>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isAddingTraceWorklog}
          >
            Plus tard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={isAddingTraceWorklog}
          >
            {isAddingTraceWorklog ? 'Validation…' : 'Valider'}
          </button>
        </footer>
      </section>
    </div>
  )
}
