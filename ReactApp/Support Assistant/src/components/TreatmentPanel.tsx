import { useState } from 'react'
import type { AssistanceState, PrisEmailRow } from '../types'
import LivraisonModal from './treatment/LivraisonModal'
import AdministrationModal from './treatment/AdministrationModal'
import AssistanceModal from './treatment/AssistanceModal'

type TreatmentAction = 'livraison' | 'administration' | 'assistance'

type TreatmentPanelProps = {
  selectedEmail: PrisEmailRow | null
  assistanceState: AssistanceState | null
  onUpdateAssistance: (update: Partial<AssistanceState>) => void
}

const ACTION_CARDS = [
  {
    id: 'livraison' as TreatmentAction,
    icon: '🚚',
    label: 'Livraison',
    desc: 'Intervention livraison — déploiement, mise en service',
  },
  {
    id: 'administration' as TreatmentAction,
    icon: '⚙️',
    label: 'Administration',
    desc: 'Intervention admin — configuration, gestion utilisateurs',
  },
  {
    id: 'assistance' as TreatmentAction,
    icon: '🎯',
    label: 'Assistance',
    desc: 'Analyse et résolution — agents spécialisés, rapport, proposition email',
  },
]

const STATUS_LABELS: Record<AssistanceState['status'], string> = {
  none: '',
  in_progress: 'Analyse en cours',
  done: 'Analyse terminée',
}

const STATUS_CLASS: Record<AssistanceState['status'], string> = {
  none: '',
  in_progress: 'assistance-badge--progress',
  done: 'assistance-badge--done',
}

export default function TreatmentPanel({ selectedEmail, assistanceState, onUpdateAssistance }: TreatmentPanelProps) {
  const [openModal, setOpenModal] = useState<TreatmentAction | null>(null)

  if (!selectedEmail) {
    return (
      <div className="treatment-panel treatment-panel--empty">
        <div className="treatment-empty-state">
          <span className="treatment-empty-icon">✦</span>
          <p className="treatment-empty-title">Aucun email sélectionné</p>
          <p className="treatment-empty-hint">Sélectionne un email dans la liste pour lancer le traitement.</p>
        </div>
      </div>
    )
  }

  const hasAnalysis = assistanceState && assistanceState.status !== 'none'

  return (
    <>
      {openModal === 'livraison' && (
        <LivraisonModal selectedEmail={selectedEmail} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'administration' && (
        <AdministrationModal selectedEmail={selectedEmail} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'assistance' && (
        <AssistanceModal
          selectedEmail={selectedEmail}
          assistanceState={assistanceState}
          onUpdateAssistance={onUpdateAssistance}
          onClose={() => setOpenModal(null)}
        />
      )}

      <div className="treatment-panel">
        <div className="treatment-email-header">
          <div className="treatment-email-meta">
            <span className="treatment-email-sender">{selectedEmail.sender}</span>
            {selectedEmail.jiraKey && (
              <a
                className="treatment-jira-badge"
                href={selectedEmail.jiraUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedEmail.jiraKey}
              </a>
            )}
          </div>
          <h2 className="treatment-email-title">{selectedEmail.title}</h2>
        </div>

        {hasAnalysis && (
          <div className={`assistance-summary-badge ${STATUS_CLASS[assistanceState.status]}`}>
            <span className="assistance-badge-status">{STATUS_LABELS[assistanceState.status]}</span>
            {assistanceState.summary && (
              <span className="assistance-badge-text">{assistanceState.summary}</span>
            )}
          </div>
        )}

        <div className="treatment-action-grid">
          {ACTION_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`treatment-action-card${card.id === 'assistance' && hasAnalysis ? ' treatment-action-card--active' : ''}`}
              onClick={() => setOpenModal(card.id)}
            >
              <span className="treatment-action-icon">{card.icon}</span>
              <span className="treatment-action-label">{card.label}</span>
              <span className="treatment-action-desc">{card.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
