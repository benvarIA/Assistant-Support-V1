import type { PrisEmailRow } from '../../types'

type AdministrationModalProps = {
  selectedEmail: PrisEmailRow
  onClose: () => void
}

export default function AdministrationModal({ selectedEmail, onClose }: AdministrationModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large" role="dialog" aria-modal="true" aria-label="Administration">
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Administration</h2>
            <p className="modal-subtitle">{selectedEmail.title}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">×</button>
        </header>
        <div className="modal-body">
          <div className="treatment-stub-notice">
            <span className="treatment-stub-icon">⚙️</span>
            <p>Skill d'administration — Phase 4</p>
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>
  )
}
