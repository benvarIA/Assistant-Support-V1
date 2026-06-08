type TopNavProps = {
  agentWorkStatus: string | null
  isConnectingJira: boolean
  isConnectingMicrosoft: boolean
  isMicrosoftLoginRunning: boolean
  onConnectJira: () => void
  onConnectMicrosoft: () => void
  onReset: () => void
}

export default function TopNav({
  agentWorkStatus,
  isConnectingJira,
  isConnectingMicrosoft,
  isMicrosoftLoginRunning,
  onConnectJira,
  onConnectMicrosoft,
  onReset,
}: TopNavProps) {
  return (
    <header className="top-nav">
      <button type="button" className="brand-btn" onClick={onReset}>
        <span className="brand-dot" />
        Support Assistant
      </button>

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
