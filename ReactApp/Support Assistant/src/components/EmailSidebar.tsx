import type {
  EffortLevel,
  PrisEmailRow,
  TreatmentProgress,
  MicrosoftFeedback,
  JiraClientsFeedback,
  AssistanceStateMap,
} from '../types'
import { deriveEmailStatus, deriveNature } from '../derive'

function formatSetupShort(setup: string): string {
  if (setup === 'Onsite') return 'Onsite'
  if (setup === 'Online Dedicated') return 'Online'
  if (setup.startsWith('Mutualised')) return 'Mutu'
  if (setup.startsWith('Online NextGen')) return 'NextGen'
  return setup.slice(0, 8)
}

const EFFORTS: { value: EffortLevel; label: string }[] = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen'  },
  { value: 'high',   label: 'Élevé'  },
]

type EmailSidebarProps = {
  prisEmails: PrisEmailRow[]
  selectedEmail: PrisEmailRow | null
  treatmentsByThread: Record<string, TreatmentProgress>
  assistanceStates: AssistanceStateMap
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
  assistanceStates,
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
          <h2 className="sidebar-title">Emails Pris · en cours</h2>
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
          <span className="sidebar-effort-label">Effort agents</span>
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
            const assistance = assistanceStates[email.conversationId] ?? null
            const isActive = selectedEmail?.id === email.id
            const status = deriveEmailStatus(email, treatment, assistance)
            const nature = deriveNature(treatment?.identificationCategoryText)

            return (
              <button
                key={email.id}
                type="button"
                className={`email-item${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectEmail(email)}
              >
                <div className="email-item-row">
                  <span className={`email-status-pill email-status-pill--${status.tone}`}>
                    <span className="email-status-dot" />
                    {status.label}
                  </span>
                  {email.jiraKey && email.jiraUrl ? (
                    <a
                      className="jira-tag"
                      href={email.jiraUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {email.jiraKey}
                    </a>
                  ) : null}
                </div>

                <p className="email-subject">{email.title}</p>

                <div className="email-item-footer">
                  <span className="email-sender">{email.sender}</span>
                  <div className="email-item-tags">
                    {nature && (
                      <span className={`nature-chip nature-chip--mini nature-chip--${nature.tone}`}>
                        {nature.label}
                      </span>
                    )}
                    {email.clientInfo?.language && (
                      <span className={`client-lang-badge lang-${email.clientInfo.language.toLowerCase()}`}>
                        {email.clientInfo.language === 'English' ? 'EN' : 'FR'}
                      </span>
                    )}
                    {email.clientInfo?.setup && (
                      <span className="client-setup-badge" title={email.clientInfo.setup}>
                        {formatSetupShort(email.clientInfo.setup)}
                      </span>
                    )}
                    {email.receivedDateTime && (
                      <time className="email-date">
                        {new Date(email.receivedDateTime).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </time>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
