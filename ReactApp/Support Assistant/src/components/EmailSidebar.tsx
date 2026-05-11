import type { EffortLevel, PrisEmailRow, TreatmentProgress, MicrosoftFeedback, JiraClientsFeedback } from '../types'

const EFFORTS: { value: EffortLevel; label: string }[] = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen'  },
  { value: 'high',   label: 'Élevé'  },
]

type EmailSidebarProps = {
  prisEmails: PrisEmailRow[]
  selectedEmail: PrisEmailRow | null
  treatmentsByThread: Record<string, TreatmentProgress>
  isLoadingPrisEmails: boolean
  isRefreshingJiraClients: boolean
  microsoftFeedback: MicrosoftFeedback | null
  jiraClientsFeedback: JiraClientsFeedback | null
  loadEmailsError: string | null
  effort: EffortLevel
  onEffortChange: (effort: EffortLevel) => void
  onSelectEmail: (email: PrisEmailRow) => void
  onRefresh: () => void
  onRefreshClients: () => void
}

export default function EmailSidebar({
  prisEmails,
  selectedEmail,
  treatmentsByThread,
  isLoadingPrisEmails,
  isRefreshingJiraClients,
  microsoftFeedback,
  jiraClientsFeedback,
  loadEmailsError,
  effort,
  onEffortChange,
  onSelectEmail,
  onRefresh,
  onRefreshClients,
}: EmailSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">Emails Pris</h2>
          {prisEmails.length > 0 && (
            <span className="count-badge">{prisEmails.length}</span>
          )}
        </div>
        <div className="sidebar-tools">
          <button
            type="button"
            className="tool-btn"
            onClick={onRefresh}
            disabled={isLoadingPrisEmails || isRefreshingJiraClients}
          >
            {isLoadingPrisEmails ? 'Chargement…' : '↺ Actualiser'}
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={onRefreshClients}
            disabled={isRefreshingJiraClients || isLoadingPrisEmails}
          >
            {isRefreshingJiraClients ? 'MAJ…' : 'MAJ Clients'}
          </button>
        </div>
        <div className="sidebar-effort">
          <span className="sidebar-effort-label">Effort</span>
          <div className="sidebar-effort-pills">
            {EFFORTS.map(e => (
              <button
                key={e.value}
                type="button"
                className={`sidebar-effort-pill${effort === e.value ? ' sidebar-effort-pill--active' : ''}`}
                onClick={() => onEffortChange(e.value)}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {microsoftFeedback && (
        <div className={`feedback-bar feedback-${microsoftFeedback.type}`}>
          {microsoftFeedback.text}
        </div>
      )}

      {loadEmailsError && (
        <div className="feedback-bar feedback-error">
          ↺ Chargement échoué — {loadEmailsError}
        </div>
      )}

      {jiraClientsFeedback && (
        <div className={`feedback-bar feedback-${jiraClientsFeedback.type}`}>
          <span>{jiraClientsFeedback.text}</span>
          {jiraClientsFeedback.type === 'success' &&
            (jiraClientsFeedback.addedNames?.length || jiraClientsFeedback.modifiedNames?.length) ? (
            <ul>
              {(jiraClientsFeedback.addedNames ?? []).map((name) => (
                <li key={`added-${name}`}>+ {name}</li>
              ))}
              {(jiraClientsFeedback.modifiedNames ?? []).map((name) => (
                <li key={`modified-${name}`}>~ {name}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="email-list">
        {isLoadingPrisEmails ? (
          <div className="list-state">Chargement des emails…</div>
        ) : prisEmails.length === 0 ? (
          <div className="list-state">Aucun email avec la catégorie "Pris".</div>
        ) : (
          prisEmails.map((email) => {
            const treatment = treatmentsByThread[email.id]
            const isActive = selectedEmail?.id === email.id
            const hasJiraKey = Boolean(email.jiraKey)
            const isIdentified = Boolean(treatment?.isIdentificationValidated) && !hasJiraKey

            return (
              <button
                key={email.id}
                type="button"
                className={`email-item${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectEmail(email)}
              >
                <div className="email-item-row">
                  <span className="email-sender">{email.sender}</span>
                  {hasJiraKey && email.jiraUrl ? (
                    <a
                      className="jira-tag"
                      href={email.jiraUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {email.jiraKey}
                    </a>
                  ) : isIdentified ? (
                    <span className="status-tag identified">Identifié</span>
                  ) : null}
                </div>
                <p className="email-subject">{email.title}</p>
                {email.receivedDateTime && (
                  <time className="email-date">
                    {new Date(email.receivedDateTime).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </time>
                )}
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
