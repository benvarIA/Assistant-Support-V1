import { useMemo, useState } from 'react'
import type { AgentId, AssistanceAgentRunResponse, AssistanceAgentStatusResponse, AssistanceRun, AssistanceState, ExecutionMode, PrisEmailRow } from '../../types'
import AnalysisReport from '../AnalysisReport'

type AssistanceModalProps = {
  selectedEmail: PrisEmailRow
  assistanceState: AssistanceState | null
  defaultEffort?: 'low' | 'medium' | 'high'
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
  { id: 'analyse',    label: 'Analyse ticket',          desc: 'État des lieux Codex — lit le ticket Jira, ses commentaires et ses pièces jointes', configurable: true },
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
  { value: 'gpt-5.5',       label: 'GPT-5.5',      hint: 'Qualité max' },
  { value: 'gpt-5.4',       label: 'GPT-5.4',      hint: 'Équilibré' },
  { value: 'gpt-5.4-mini',  label: '5.4-Mini',     hint: 'Rapide' },
  { value: 'gpt-5.3-codex', label: '5.3-Codex',    hint: 'Orienté code' },
  { value: 'gpt-5.2',       label: 'GPT-5.2',      hint: 'Compatible long run' },
]

const EFFORT_LEVELS = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen' },
  { value: 'high',   label: 'Élevé' },
]

export default function AssistanceModal({
  selectedEmail,
  assistanceState,
  defaultEffort,
  onUpdateAssistance,
  onClose,
}: AssistanceModalProps) {
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set(['analyse']))
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential')
  const [analyseModel, setAnalyseModel] = useState('gpt-5.4')
  const [analyseEffort, setAnalyseEffort] = useState<'low' | 'medium' | 'high'>(defaultEffort ?? 'medium')
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [followUpPrompt, setFollowUpPrompt] = useState(assistanceState?.followUpPrompt ?? '')

  const reports = assistanceState?.reports ?? []
  const analyseReport = useMemo(
    () => reports.find((report) => report.agentId === 'analyse') ?? null,
    [reports],
  )

  const toggleAgent = (id: AgentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLaunch = async () => {
    if (isLaunching) return
    setLaunchError(null)
    if (!selectedEmail.jiraKey) {
      setLaunchError('Aucun ticket Jira associé à cet email.')
      return
    }
    if (selectedAgents.size !== 1 || !selectedAgents.has('analyse')) {
      setLaunchError("Pour l'instant, seul l'agent « Analyse ticket » est réellement branché.")
      return
    }

    const priorHistory: AssistanceRun[] = assistanceState?.history ?? []
    const runStartedAt = new Date().toISOString()

    onUpdateAssistance({
      status: 'in_progress',
      summary: `Analyse Jira en cours — ${selectedEmail.jiraKey}`,
      reports: [{
        agentId: 'analyse',
        status: 'running',
        report: '',
        startedAt: runStartedAt,
        finishedAt: null,
        errorMessage: null,
      }],
    })

    setIsLaunching(true)
    try {
      const response = await fetch('/api/assistance/agents/analyse/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jiraKey: selectedEmail.jiraKey,
          guidance: followUpPrompt.trim(),
          config: {
            model: analyseModel,
            effort: analyseEffort,
          },
        }),
      })
      const data = await response.json() as AssistanceAgentRunResponse
      if (!response.ok) {
        throw new Error(data.error ?? data.stderr ?? "L'agent d'analyse a échoué.")
      }
      if (!data.runId) {
        throw new Error("L'agent d'analyse n'a pas retourné de runId.")
      }

      let completed = false
      while (!completed) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200))
        const statusResponse = await fetch(`/api/assistance/agents/${encodeURIComponent(data.runId)}/status`)
        const statusData = await statusResponse.json() as AssistanceAgentStatusResponse
        if (!statusResponse.ok) {
          throw new Error(statusData.error ?? statusData.stderr ?? "Le suivi d'exécution a échoué.")
        }

        if (statusData.status === 'done') {
          completed = true
          const startedAt = statusData.startedAt ?? analyseReport?.startedAt ?? runStartedAt
          const finishedAt = statusData.finishedAt ?? new Date().toISOString()
          const report = statusData.report?.trim() || ''
          const summary = statusData.summary?.trim() || `Analyse Jira terminée — ${selectedEmail.jiraKey}`
          const run: AssistanceRun = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            agentLabel: 'Analyse ticket',
            model: analyseModel,
            effort: analyseEffort,
            guidance: followUpPrompt.trim(),
            status: 'done',
            summary,
            report,
            errorMessage: null,
            startedAt,
            finishedAt,
          }
          onUpdateAssistance({
            status: 'done',
            summary,
            followUpPrompt,
            reports: [{ agentId: 'analyse', status: 'done', report, startedAt, finishedAt, errorMessage: null }],
            history: [run, ...priorHistory],
          })
        } else if (statusData.status === 'error') {
          completed = true
          const message = statusData.error ?? "L'agent d'analyse a échoué."
          setLaunchError(message)
          const startedAt = statusData.startedAt ?? analyseReport?.startedAt ?? runStartedAt
          const finishedAt = statusData.finishedAt ?? new Date().toISOString()
          const report = statusData.report?.trim() || ''
          const run: AssistanceRun = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            agentLabel: 'Analyse ticket',
            model: analyseModel,
            effort: analyseEffort,
            guidance: followUpPrompt.trim(),
            status: 'error',
            summary: '',
            report,
            errorMessage: message,
            startedAt,
            finishedAt,
          }
          onUpdateAssistance({
            status: 'done',
            summary: `Analyse Jira en échec — ${selectedEmail.jiraKey}`,
            followUpPrompt,
            reports: [{ agentId: 'analyse', status: 'error', report, startedAt, finishedAt, errorMessage: message }],
            history: [run, ...priorHistory],
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "L'agent d'analyse a échoué."
      setLaunchError(message)
      const startedAt = analyseReport?.startedAt ?? runStartedAt
      const finishedAt = new Date().toISOString()
      const run: AssistanceRun = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        agentLabel: 'Analyse ticket',
        model: analyseModel,
        effort: analyseEffort,
        guidance: followUpPrompt.trim(),
        status: 'error',
        summary: '',
        report: '',
        errorMessage: message,
        startedAt,
        finishedAt,
      }
      onUpdateAssistance({
        status: 'done',
        summary: `Analyse Jira en échec — ${selectedEmail.jiraKey}`,
        followUpPrompt,
        reports: [{ agentId: 'analyse', status: 'error', report: '', startedAt, finishedAt, errorMessage: message }],
        history: [run, ...priorHistory],
      })
    } finally {
      setIsLaunching(false)
    }
  }

  const canLaunch = selectedAgents.size > 0 && !isLaunching

  return (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large assistance-modal" role="dialog" aria-modal="true" aria-label="Assistance">
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

          {(launchError || analyseReport) && (
            <div className="assistance-section">
              <p className="assistance-section-label">Rapport d'analyse</p>
              {launchError && <p className="form-error">{launchError}</p>}
              {analyseReport?.status === 'running' && (
                <p className="modal-agent-status">Analyse en cours sur {selectedEmail.jiraKey}…</p>
              )}
              {analyseReport?.status === 'error' && analyseReport.errorMessage && (
                <p className="form-error">{analyseReport.errorMessage}</p>
              )}
              {analyseReport?.report && (
                <div className="assistance-report-render">
                  <AnalysisReport report={analyseReport.report} />
                </div>
              )}
            </div>
          )}

          <div className="assistance-section">
            <p className="assistance-section-label">Complément pour relancer l'analyse</p>
            <textarea
              className="form-textarea assistance-followup-textarea"
              placeholder="Ex: le client confirme que le problème n'arrive qu'en VPN, un redémarrage a déjà été tenté, ou voici une info métier manquante..."
              value={followUpPrompt}
              onChange={(event) => {
                const value = event.target.value
                setFollowUpPrompt(value)
                onUpdateAssistance({ followUpPrompt: value })
              }}
            />
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canLaunch}
            onClick={() => { void handleLaunch() }}
          >
            {isLaunching ? 'Analyse en cours…' : analyseReport?.report ? "Relancer l'analyse →" : "Lancer l'analyse →"}
          </button>
        </footer>
      </section>
    </div>
  )
}
