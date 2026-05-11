import { useState } from 'react'
import type { PrisEmailRow } from '../../types'
import { useKiba } from '../../hooks/useKiba'
import KibaPanel from '../KibaPanel'

type LivraisonModalProps = {
  selectedEmail: PrisEmailRow
  onClose: () => void
}

export default function LivraisonModal({ selectedEmail, onClose }: LivraisonModalProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const kiba = useKiba(selectedEmail, setStatusMessage)

  return (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large" role="dialog" aria-modal="true" aria-label="Livraison">
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Livraison</h2>
            <p className="modal-subtitle">{selectedEmail.title}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <div className="modal-body">
          {statusMessage && (
            <div className="livraison-status-banner">{statusMessage}</div>
          )}
          {!selectedEmail.jiraKey && (
            <div className="livraison-no-jira">
              <span className="livraison-no-jira-icon">⚠️</span>
              <p>Aucun ticket Jira associé à cet email.</p>
              <p className="livraison-no-jira-hint">Kiba a besoin du ticket Jira pour inférer les paramètres de livraison. Associe d'abord un ticket depuis l'onglet Tickets & Jira.</p>
            </div>
          )}
          {selectedEmail.jiraKey && <KibaPanel
            selectedEmail={selectedEmail}
            isProposing={kiba.isKibaProposing}
            proposal={kiba.kibaProposal}
            proposeError={kiba.kibaProposeError}
            isPreflight={kiba.isKibaPreflight}
            preflight={kiba.kibaPreflight}
            preflightError={kiba.kibaPreflightError}
            isCreatingDraft={kiba.isKibaCreatingDraft}
            draftResult={kiba.kibaDraftResult}
            draftError={kiba.kibaDraftError}
            onPropose={() => void kiba.proposeKiba()}
            onRunPreflight={() => void kiba.runKibaPreflight(kiba.kibaProposal?.customerEmail ?? '')}
            onSetProposalField={(field, value) => kiba.setKibaProposalField(field, value)}
            onCreateDraft={() => void kiba.createKibaDraft((msg) => setStatusMessage(msg))}
          />}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>
  )
}
