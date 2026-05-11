import type { PrisEmailRow, OrochimaruTracePayload } from '../../types'
import ErrorBanner from '../ErrorBanner'

type TraceModalProps = {
  selectedEmail: PrisEmailRow
  isTracingOrochimaru: boolean
  orochimaruTraceResult: OrochimaruTracePayload | null
  orochimaruTraceError: string | null
  agentWorkStatus: string | null
  onRunTrace: () => void
  onClose: () => void
}

export default function TraceModal({
  selectedEmail,
  isTracingOrochimaru,
  orochimaruTraceResult,
  orochimaruTraceError,
  agentWorkStatus,
  onRunTrace,
  onClose,
}: TraceModalProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card modal-card-large"
        role="dialog"
        aria-modal="true"
        aria-label="Orochimaru"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Tracer</h2>
            <p className="modal-subtitle">
              <strong>{selectedEmail.jiraKey}</strong> · {selectedEmail.title}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isTracingOrochimaru}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        {agentWorkStatus && (
          <div className="modal-agent-status">
            <span className="agent-pulse" />
            <span>{agentWorkStatus}</span>
          </div>
        )}

        <div className="modal-body">
          <div className="modal-section">
            <p className="modal-desc">
              Analyse du fil puis ajout des emails manquants dans Jira, en ordre chronologique.
            </p>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onRunTrace}
                disabled={isTracingOrochimaru}
              >
                {isTracingOrochimaru ? (
                  <>
                    <span className="action-spinner" />
                    Traçage en cours…
                  </>
                ) : (
                  'Lancer Orochimaru'
                )}
              </button>
            </div>

            <ErrorBanner message={orochimaruTraceError} />

            {orochimaruTraceResult && (
              <div className="trace-result">
                <div className="trace-result-row">
                  <span className="trace-label">Statut</span>
                  <span className="trace-value">
                    {orochimaruTraceResult.status ?? 'inconnu'}
                  </span>
                </div>
                {orochimaruTraceResult.summary && (
                  <div className="trace-result-row">
                    <span className="trace-label">Résumé</span>
                    <span className="trace-value">{orochimaruTraceResult.summary}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isTracingOrochimaru}
          >
            Fermer
          </button>
        </footer>
      </section>
    </div>
  )
}
