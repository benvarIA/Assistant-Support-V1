import type { FormEvent } from 'react'
import type { PrisEmailRow, JiraProposal } from '../../types'
import { ISSUE_TYPE_OPTIONS, ISSUE_SUBTYPE_MAP } from '../../constants'
import { formatBytes } from '../../utils'
import ErrorBanner from '../ErrorBanner'

type JiraTicketModalProps = {
  selectedEmail: PrisEmailRow
  ticketModalMode: 'analysis' | 'create'
  agentWorkStatus: string | null
  isAnalyzing: boolean
  analysisError: string | null
  identificationCategoryText: string
  identificationWarnings: string[]
  identificationError: string | null
  isIdentificationValidated: boolean
  isProposingJira: boolean
  jiraDraft: JiraProposal | null
  isCreatingJira: boolean
  createJiraError: string | null
  onSetIdentificationCategoryText: (value: string) => void
  onValidateIdentification: () => void
  onSetDraftField: <K extends keyof JiraProposal>(field: K, value: JiraProposal[K]) => void
  onSetJiraDraft: (updater: (current: JiraProposal | null) => JiraProposal | null) => void
  onSetAttachmentSelected: (key: string, selected: boolean) => void
  onCreateJiraFromDraft: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export default function JiraTicketModal({
  selectedEmail,
  ticketModalMode,
  agentWorkStatus,
  isAnalyzing,
  analysisError,
  identificationCategoryText,
  identificationWarnings,
  identificationError,
  isIdentificationValidated,
  isProposingJira,
  jiraDraft,
  isCreatingJira,
  createJiraError,
  onSetIdentificationCategoryText,
  onValidateIdentification,
  onSetDraftField,
  onSetJiraDraft,
  onSetAttachmentSelected,
  onCreateJiraFromDraft,
  onClose,
}: JiraTicketModalProps) {
  const visibleAttachmentCandidates =
    jiraDraft?.attachmentCandidates.filter((a) => a.kind !== 'inline-image') ?? []
  const inlineImageCandidates =
    jiraDraft?.attachmentCandidates.filter((a) => a.kind === 'inline-image') ?? []

  return (
    <div className="modal-backdrop">
      <section
        className="modal-card modal-card-large"
        role="dialog"
        aria-modal="true"
        aria-label="Traitement ticket Jira"
      >
        <header className="modal-header">
          <div>
            <h2 className="modal-title">
              {ticketModalMode === 'analysis' ? 'Identification' : 'Créer le ticket'}
            </h2>
            <p className="modal-subtitle">
              <strong>{selectedEmail.title}</strong> · {selectedEmail.sender}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
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
          {ticketModalMode === 'analysis' && (
            <div className="modal-section">
              <h3 className="modal-section-title">Identification de la demande</h3>
              {isAnalyzing && (
                <div className="modal-loading">
                  <span className="action-spinner" />
                  <span>Identification en cours…</span>
                </div>
              )}
              {!isAnalyzing && <ErrorBanner message={analysisError} />}
              {!isAnalyzing && identificationCategoryText && (
                <div className="modal-form">
                  <label className="form-field form-field-full">
                    <span className="form-label">Catégorie identifiée</span>
                    <input
                      type="text"
                      className="form-input"
                      value={identificationCategoryText}
                      onChange={(e) => {
                        onSetIdentificationCategoryText(e.target.value)
                      }}
                    />
                  </label>
                  <p className="form-hint form-field-full">
                    Valeurs: Assistance · Question · Intervention livraison · Intervention
                    administration
                  </p>
                  {identificationWarnings.map((w) => (
                    <p key={w} className="form-warning form-field-full">
                      {w}
                    </p>
                  ))}
                  {identificationError && (
                    <p className="form-error form-field-full">{identificationError}</p>
                  )}
                  <div className="form-actions form-field-full">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={onValidateIdentification}
                      disabled={!identificationCategoryText.trim()}
                    >
                      Valider
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {ticketModalMode === 'create' && (
            <div className="modal-section">
              <h3 className="modal-section-title">Ticket JiraYah</h3>
              <ErrorBanner message={analysisError} />
              {isProposingJira && (
                <div className="modal-loading">
                  <span className="action-spinner" />
                  <span>Préparation de la proposition…</span>
                </div>
              )}
              {!isProposingJira && jiraDraft && isIdentificationValidated && (
                <form className="modal-form" onSubmit={onCreateJiraFromDraft}>
                  <label className="form-field">
                    <span className="form-label">Projet Jira</span>
                    <input
                      type="text"
                      className="form-input"
                      value={jiraDraft.projectKey}
                      onChange={(e) => onSetDraftField('projectKey', e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-field">
                    <span className="form-label">Type</span>
                    <select
                      className="form-select"
                      value={jiraDraft.issueType}
                      onChange={(e) => {
                        const issueType = e.target.value as JiraProposal['issueType']
                        const subtype = ISSUE_SUBTYPE_MAP[issueType]
                        onSetJiraDraft((current) => {
                          if (!current) return current
                          return {
                            ...current,
                            issueType,
                            subtypeField: subtype.field,
                            subtypeOptions: subtype.options,
                            subtypeValue: subtype.options[0] ?? null,
                          }
                        })
                      }}
                    >
                      {ISSUE_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span className="form-label">Client</span>
                    <input
                      type="text"
                      className="form-input"
                      value={jiraDraft.client}
                      list="jirayah-clients"
                      onChange={(e) => onSetDraftField('client', e.target.value)}
                    />
                    <datalist id="jirayah-clients">
                      {jiraDraft.clientOptions.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                  </label>

                  {jiraDraft.clientCandidates.length > 0 && (
                    <div className="form-field">
                      <span className="form-label">Suggestions client</span>
                      <div className="candidate-chips">
                        {jiraDraft.clientCandidates.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="chip-btn"
                            onClick={() => onSetDraftField('client', c)}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {jiraDraft.subtypeField && (
                    <label className="form-field">
                      <span className="form-label">{jiraDraft.subtypeField}</span>
                      <select
                        className="form-select"
                        value={jiraDraft.subtypeValue ?? ''}
                        onChange={(e) =>
                          onSetDraftField('subtypeValue', e.target.value || null)
                        }
                      >
                        {jiraDraft.subtypeOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="form-field form-field-full">
                    <span className="form-label">Résumé</span>
                    <input
                      type="text"
                      className="form-input"
                      value={jiraDraft.summary}
                      onChange={(e) => onSetDraftField('summary', e.target.value)}
                      required
                    />
                  </label>

                  <label className="form-field form-field-full">
                    <span className="form-label">Description</span>
                    <textarea
                      className="form-textarea"
                      value={jiraDraft.description}
                      onChange={(e) => onSetDraftField('description', e.target.value)}
                      rows={7}
                    />
                  </label>

                  <div className="form-field form-field-full">
                    <span className="form-label">Pièces jointes</span>
                    {inlineImageCandidates.length > 0 && (
                      <p className="form-hint">
                        {inlineImageCandidates.length} image(s) inline incluse(s) dans la
                        description.
                      </p>
                    )}
                    {visibleAttachmentCandidates.length === 0 ? (
                      <p className="form-hint">
                        Récupérées automatiquement à la création du ticket.
                      </p>
                    ) : (
                      <div className="attachment-list">
                        {visibleAttachmentCandidates.map((att) => (
                          <label key={att.key} className="attachment-item">
                            <input
                              type="checkbox"
                              checked={att.selected}
                              onChange={(e) =>
                                onSetAttachmentSelected(att.key, e.target.checked)
                              }
                            />
                            <span>
                              {att.name}
                              {att.extension ? ` (.${att.extension})` : ''} —{' '}
                              {formatBytes(att.sizeBytes)}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {jiraDraft.warnings.length > 0 && (
                    <div className="form-field form-field-full">
                      {jiraDraft.warnings.map((w) => (
                        <p key={w} className="form-warning">
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  {createJiraError && (
                    <div className="form-field form-field-full">
                      <p className="form-error">{createJiraError}</p>
                    </div>
                  )}

                  <div className="form-actions form-field-full">
                    <button type="submit" className="btn btn-primary" disabled={isCreatingJira}>
                      {isCreatingJira ? 'Création en cours…' : 'Créer le ticket'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </section>
    </div>
  )
}
