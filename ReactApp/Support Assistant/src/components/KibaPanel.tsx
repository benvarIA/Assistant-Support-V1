import type { PrisEmailRow, KibaProposal, KibaPreflightResult } from '../types'
import ErrorBanner from './ErrorBanner'

const CLIENT_TYPE_OPTIONS: KibaProposal['clientType'][] = ['ON-SITE', 'ONLINE dédié', 'Mutualisée']
const DELIVERY_TYPE_OPTIONS: KibaProposal['deliveryType'][] = ['Renouvellement', 'Nouvelle salle', 'Nouveau client']
const LANGUAGE_OPTIONS: KibaProposal['language'][] = ['FR', 'EN']

const CONFIDENCE_LABELS = { faible: 'Faible', moyen: 'Moyen', élevé: 'Élevé' }

type KibaPanelProps = {
  selectedEmail: PrisEmailRow
  isProposing: boolean
  proposal: KibaProposal | null
  proposeError: string | null
  isPreflight: boolean
  preflight: KibaPreflightResult | null
  preflightError: string | null
  isCreatingDraft: boolean
  draftResult: { status: string; subject?: string; draftInfo?: string; blockingReason?: string } | null
  draftError: string | null
  onPropose: () => void
  onRunPreflight: () => void
  onSetProposalField: <K extends keyof KibaProposal>(field: K, value: KibaProposal[K]) => void
  onCreateDraft: () => void
}

export default function KibaPanel({
  selectedEmail,
  isProposing,
  proposal,
  proposeError,
  isPreflight,
  preflight,
  preflightError,
  isCreatingDraft,
  draftResult,
  draftError,
  onPropose,
  onRunPreflight,
  onSetProposalField,
  onCreateDraft,
}: KibaPanelProps) {
  const isDraftCreated = draftResult?.status === 'draft_created'

  return (
    <div className="kiba-panel">
      <div className="kiba-panel-header">
        <div className="kiba-panel-title-row">
          <span className="kiba-badge">Kiba</span>
          <h3 className="kiba-panel-title">Livraison de licence</h3>
        </div>
        <p className="kiba-panel-desc">
          Génère le brouillon Outlook de livraison pour{' '}
          <strong>{selectedEmail.jiraKey}</strong>.
        </p>
      </div>

      {!proposal && !isProposing && !proposeError && (
        <div className="kiba-panel-empty">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onPropose}
            disabled={isProposing}
          >
            Analyser et proposer
          </button>
          <p className="kiba-hint">
            Kiba lit le ticket Jira et le thread pour inférer les paramètres de livraison.
          </p>
        </div>
      )}

      {isProposing && (
        <div className="kiba-loading">
          <span className="action-spinner" />
          <span>Analyse du ticket en cours…</span>
        </div>
      )}

      {proposeError && !isProposing && (
        <div className="kiba-panel-empty">
          <ErrorBanner message={proposeError} />
          <button type="button" className="btn btn-ghost" onClick={onPropose}>
            Réessayer
          </button>
        </div>
      )}

      {proposal && !isProposing && (
        <div className="kiba-form">
          <div className="kiba-field">
            <div className="kiba-field-header">
              <label className="kiba-field-label">Type de client</label>
              <span className={`kiba-confidence kiba-confidence-${proposal.clientTypeConfidence}`}>
                {CONFIDENCE_LABELS[proposal.clientTypeConfidence]}
              </span>
            </div>
            <select
              className="form-select"
              value={proposal.clientType}
              onChange={(e) => onSetProposalField('clientType', e.target.value as KibaProposal['clientType'])}
            >
              {CLIENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {proposal.clientTypeReason && (
              <p className="kiba-reason">{proposal.clientTypeReason}</p>
            )}
          </div>

          <div className="kiba-field">
            <div className="kiba-field-header">
              <label className="kiba-field-label">Type de livraison</label>
              <span className={`kiba-confidence kiba-confidence-${proposal.deliveryTypeConfidence}`}>
                {CONFIDENCE_LABELS[proposal.deliveryTypeConfidence]}
              </span>
            </div>
            <select
              className="form-select"
              value={proposal.deliveryType}
              onChange={(e) => onSetProposalField('deliveryType', e.target.value as KibaProposal['deliveryType'])}
            >
              {DELIVERY_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {proposal.deliveryTypeReason && (
              <p className="kiba-reason">{proposal.deliveryTypeReason}</p>
            )}
          </div>

          <div className="kiba-field">
            <div className="kiba-field-header">
              <label className="kiba-field-label">Langue</label>
              <span className={`kiba-confidence kiba-confidence-${proposal.languageConfidence}`}>
                {CONFIDENCE_LABELS[proposal.languageConfidence]}
              </span>
            </div>
            <select
              className="form-select"
              value={proposal.language}
              onChange={(e) => onSetProposalField('language', e.target.value as KibaProposal['language'])}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {proposal.languageReason && (
              <p className="kiba-reason">{proposal.languageReason}</p>
            )}
          </div>

          {(proposal.customerName || proposal.customerEmail) && (
            <div className="kiba-customer">
              {proposal.customerName && (
                <span className="kiba-customer-item">
                  <span className="kiba-customer-label">Client</span>
                  {proposal.customerName}
                </span>
              )}
              {proposal.customerEmail && (
                <span className="kiba-customer-item">
                  <span className="kiba-customer-label">Email</span>
                  {proposal.customerEmail}
                </span>
              )}
            </div>
          )}

          {!isDraftCreated && !preflight && !isPreflight && (
            <div className="kiba-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onRunPreflight}
              >
                Vérifier les destinataires →
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onPropose}
              >
                Relancer
              </button>
            </div>
          )}

          {isPreflight && (
            <div className="kiba-loading">
              <span className="action-spinner" />
              <span>Vérification Jira…</span>
            </div>
          )}

          <ErrorBanner message={preflightError} />

          {!isDraftCreated && preflight && (
            <div className="kiba-preflight">
              {!preflight.jiraOk && (
                <ErrorBanner message={`Jira inaccessible — ${preflight.jiraError ?? 'accès refusé'}. Le brouillon sera peut-être incomplet.`} />
              )}

              <div className="kiba-recipients">
                <div className="kiba-recipient-row">
                  <span className="kiba-recipient-label">À</span>
                  <span className="kiba-recipient-value">{preflight.to || <em className="kiba-recipient-empty">non renseigné</em>}</span>
                </div>
                <div className="kiba-recipient-row">
                  <span className="kiba-recipient-label">CC</span>
                  <span className="kiba-recipient-value">{preflight.cc.join(', ')}</span>
                </div>
                <div className="kiba-recipient-row">
                  <span className="kiba-recipient-label">CCI</span>
                  <span className="kiba-recipient-value">{preflight.bcc.join(', ')}</span>
                </div>
              </div>

              <div className="kiba-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onCreateDraft}
                  disabled={isCreatingDraft}
                >
                  {isCreatingDraft ? (
                    <>
                      <span className="action-spinner" />
                      Création du brouillon… (2-3 min)
                    </>
                  ) : (
                    'Créer le brouillon Outlook'
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onRunPreflight}
                  disabled={isCreatingDraft}
                >
                  ↺
                </button>
              </div>
            </div>
          )}

          <ErrorBanner message={draftError} />

          {draftResult && (
            <div className={`kiba-result kiba-result-${isDraftCreated ? 'success' : 'blocked'}`}>
              {isDraftCreated ? (
                <>
                  <span className="kiba-result-icon">✓</span>
                  <div>
                    <p className="kiba-result-title">Brouillon créé dans Outlook</p>
                    {draftResult.subject && (
                      <p className="kiba-result-detail">Sujet: {draftResult.subject}</p>
                    )}
                    {draftResult.draftInfo && (
                      <p className="kiba-result-detail">{draftResult.draftInfo}</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="kiba-result-icon">!</span>
                  <div>
                    <p className="kiba-result-title">Blocage</p>
                    {draftResult.blockingReason && (
                      <p className="kiba-result-detail">{draftResult.blockingReason}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
