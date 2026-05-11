import { useState } from 'react'
import type { AgentId, AssistanceState, ExecutionMode, PrisEmailRow } from '../../types'

type AssistanceModalProps = {
  selectedEmail: PrisEmailRow
  assistanceState: AssistanceState | null
  onUpdateAssistance: (update: Partial<AssistanceState>) => void
  onClose: () => void
}

type AgentDef = {
  id: AgentId
  label: string
  desc: string
  configurable?: boolean
}

const AGENTS: AgentDef[] = [
  { id: 'analyse',    label: 'Analyse ticket',          desc: 'État des lieux Codex — lit le ticket Jira et le thread email', configurable: true },
  { id: 'web',        label: 'Recherche internet',       desc: 'Recherche en ligne sur le problème' },
  { id: 'docs',       label: 'Docs iObeya / FAQ',        desc: 'Documentation, FAQ et guides de troubleshooting' },
  { id: 'jira',       label: 'Tickets Jira similaires',  desc: 'Tickets similaires déjà résolus dans Jira' },
  { id: 'systeme',    label: 'Fichiers système',         desc: 'Infos serveur client extraites des fichiers système iObeya' },
  { id: 'logs',       label: 'Analyseur de logs',        desc: 'Erreurs et patterns dans les fichiers de logs' },
  { id: 'har',        label: 'Analyseur de HAR',         desc: 'Traces réseau — fichiers HAR' },
  { id: 'dcm',        label: 'Expert DCM',               desc: 'Expertise sur le module DCM' },
  { id: 'qcd',        label: 'Expert QCD',               desc: 'Expertise sur le module QCD' },
  { id: 'addon-jira', label: 'Expert addon Jira',        desc: 'Addon iObeya pour Jira' },
  { id: 'addon-ado',  label: 'Expert addon ADO',         desc: 'Addon iObeya pour Azure DevOps' },
]

const MODELS = [
  { value: 'claude-opus-4-5',   label: 'Opus',   hint: 'Meilleure qualité' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet', hint: 'Équilibré' },
  { value: 'claude-haiku-4-5',  label: 'Haiku',  hint: 'Rapide' },
]

const EFFORT_LEVELS = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen' },
  { value: 'high',   label: 'Élevé' },
]

export default function AssistanceModal({
  selectedEmail,
  assistanceState: _assistanceState,
  onUpdateAssistance,
  onClose,
}: AssistanceModalProps) {
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set(['analyse']))
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential')
  const [analyseModel, setAnalyseModel] = useState('claude-sonnet-4-5')
  const [analyseEffort, setAnalyseEffort] = useState<'low' | 'medium' | 'high'>('medium')

  const toggleAgent = (id: AgentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLaunch = () => {
    // Phase 5a stub — transition to in_progress + pass config
    // Real agent execution wired in Phase 5b
    onUpdateAssistance({
      status: 'in_progress',
      summary: `Analyse lancée — ${selectedAgents.size} agent(s) · mode ${executionMode === 'sequential' ? 'séquentiel' : 'parallèle'}`,
      reports: Array.from(selectedAgents).map((agentId) => ({
        agentId,
        status: 'pending',
        report: '',
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
      })),
    })
    onClose()
  }

  const canLaunch = selectedAgents.size > 0

  return (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large" role="dialog" aria-modal="true" aria-label="Assistance">
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Assistance</h2>
            <p className="modal-subtitle">{selectedEmail.title}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <div className="modal-body">
          {/* Execution mode */}
          <div className="assistance-section">
            <p className="assistance-section-label">Mode d'exécution</p>
            <div className="assistance-mode-toggle">
              <button
                type="button"
                className={`assistance-mode-btn${executionMode === 'sequential' ? ' assistance-mode-btn--active' : ''}`}
                onClick={() => setExecutionMode('sequential')}
              >
                <span className="assistance-mode-icon">⏭</span>
                <span className="assistance-mode-label">Séquentiel</span>
                <span className="assistance-mode-hint">Pause entre chaque agent</span>
              </button>
              <button
                type="button"
                className={`assistance-mode-btn${executionMode === 'parallel' ? ' assistance-mode-btn--active' : ''}`}
                onClick={() => setExecutionMode('parallel')}
              >
                <span className="assistance-mode-icon">⚡</span>
                <span className="assistance-mode-label">Parallèle</span>
                <span className="assistance-mode-hint">Tous les agents en simultané</span>
              </button>
            </div>
          </div>

          {/* Agent grid */}
          <div className="assistance-section">
            <p className="assistance-section-label">
              Agents
              <span className="assistance-count-badge">{selectedAgents.size} sélectionné{selectedAgents.size > 1 ? 's' : ''}</span>
            </p>
            <div className="assistance-agent-grid">
              {AGENTS.map((agent) => {
                const isSelected = selectedAgents.has(agent.id)
                return (
                  <div key={agent.id} className={`assistance-agent-card${isSelected ? ' assistance-agent-card--selected' : ''}`}>
                    <button
                      type="button"
                      className="assistance-agent-toggle"
                      onClick={() => toggleAgent(agent.id)}
                      aria-pressed={isSelected}
                    >
                      <span className={`assistance-agent-checkbox${isSelected ? ' assistance-agent-checkbox--checked' : ''}`}>
                        {isSelected && '✓'}
                      </span>
                      <span className="assistance-agent-info">
                        <span className="assistance-agent-label">{agent.label}</span>
                        <span className="assistance-agent-desc">{agent.desc}</span>
                      </span>
                    </button>

                    {/* Inline config for configurable agents */}
                    {agent.configurable && isSelected && (
                      <div className="assistance-agent-config">
                        <label className="assistance-config-field">
                          <span className="assistance-config-label">Modèle</span>
                          <div className="assistance-pill-group">
                            {MODELS.map((m) => (
                              <button
                                key={m.value}
                                type="button"
                                className={`assistance-pill${analyseModel === m.value ? ' assistance-pill--active' : ''}`}
                                onClick={() => setAnalyseModel(m.value)}
                                title={m.hint}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </label>
                        <label className="assistance-config-field">
                          <span className="assistance-config-label">Effort</span>
                          <div className="assistance-pill-group">
                            {EFFORT_LEVELS.map((e) => (
                              <button
                                key={e.value}
                                type="button"
                                className={`assistance-pill${analyseEffort === e.value ? ' assistance-pill--active' : ''}`}
                                onClick={() => setAnalyseEffort(e.value as 'low' | 'medium' | 'high')}
                              >
                                {e.label}
                              </button>
                            ))}
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canLaunch}
            onClick={handleLaunch}
          >
            Lancer l'analyse →
          </button>
        </footer>
      </section>
    </div>
  )
}
