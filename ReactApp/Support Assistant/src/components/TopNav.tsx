type Tab = 'tickets' | 'treatment'

type TopNavProps = {
  agentWorkStatus: string | null
  isConnectingJira: boolean
  isConnectingMicrosoft: boolean
  isMicrosoftLoginRunning: boolean
  activeTab: Tab
  onConnectJira: () => void
  onConnectMicrosoft: () => void
  onReset: () => void
  onTabChange: (tab: Tab) => void
}

export default function TopNav({
  agentWorkStatus,
  isConnectingJira,
  isConnectingMicrosoft,
  isMicrosoftLoginRunning,
  activeTab,
  onConnectJira,
  onConnectMicrosoft,
  onReset,
  onTabChange,
}: TopNavProps) {
  return (
    <header className="top-nav">
      <button type="button" className="brand-btn" onClick={onReset}>
        <span className="brand-dot" />
        Support Assistant
      </button>

      <nav className="nav-tabs">
        <button
          type="button"
          className={`nav-tab${activeTab === 'tickets' ? ' nav-tab--active' : ''}`}
          onClick={() => onTabChange('tickets')}
        >
          Tickets & Jira
        </button>
        <button
          type="button"
          className={`nav-tab${activeTab === 'treatment' ? ' nav-tab--active' : ''}`}
          onClick={() => onTabChange('treatment')}
        >
          Traitement
        </button>
      </nav>

      <div className="nav-status">
        {agentWorkStatus && (
          <div className="agent-pill">
            <span className="agent-pulse" />
            <span>{agentWorkStatus}</span>
          </div>
        )}
      </div>

      <nav className="nav-actions">
        <button
          type="button"
          className="btn btn-nav-jira"
          onClick={onConnectJira}
          disabled={isConnectingJira || isConnectingMicrosoft}
        >
          {isConnectingJira ? 'Connexion…' : 'Jira'}
        </button>
        <button
          type="button"
          className="btn btn-nav-ms"
          onClick={onConnectMicrosoft}
          disabled={isConnectingMicrosoft || isConnectingJira || isMicrosoftLoginRunning}
        >
          {isConnectingMicrosoft || isMicrosoftLoginRunning ? 'Connexion…' : 'Outlook'}
        </button>
      </nav>
    </header>
  )
}
