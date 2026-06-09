import { useRef, useState } from 'react'
import type { AgentId, AgentReport, AssistanceAgentRunResponse, AssistanceAgentStatusResponse, AssistanceRun, AssistanceState, ExecutionMode, PrisEmailRow } from '../../types'
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
  { id: 'jira',       label: 'Tickets Jira similaires',  desc: 'Tickets similaires déjà traités dans Jira (recherche live)', configurable: true },
  { id: 'systeme',    label: 'Fichiers système',         desc: 'Infos serveur client extraites des fichiers système iObeya' },
  { id: 'logs',       label: 'Analyseur de logs',        desc: 'Erreurs, exceptions et patterns dans les logs joints au ticket (.log/.out/.txt/.gz/.zip)', configurable: true },
  { id: 'har',        label: 'Analyseur de HAR',         desc: 'Traces réseau — fichiers HAR' },
  { id: 'dcm',        label: 'Expert DCM',               desc: 'Expertise sur le module DCM' },
  { id: 'qcd',        label: 'Expert QCD',               desc: 'Expertise sur le module QCD' },
  { id: 'addon-jira', label: 'Expert addon Jira',        desc: 'Addon iObeya pour Jira' },
  { id: 'addon-ado',  label: 'Expert addon ADO',         desc: 'Addon iObeya pour Azure DevOps' },
]

// Agents réellement branchés côté backend (registry assistanceAgents.ts).
const LAUNCHABLE_AGENTS: AgentId[] = ['analyse', 'jira', 'logs']

type AgentRunConfig = { model: string; effort: 'low' | 'medium' | 'high' }

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
  const defaultConfig: AgentRunConfig = { model: 'gpt-5.4', effort: defaultEffort ?? 'medium' }
  const [agentConfig, setAgentConfig] = useState<Record<string, AgentRunConfig>>({
    analyse: { ...defaultConfig },
    jira: { ...defaultConfig },
    logs: { ...defaultConfig },
  })
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [followUpPrompt, setFollowUpPrompt] = useState(assistanceState?.followUpPrompt ?? '')

  // Options spécifiques à l'agent « Analyseur de logs ».
  const [logsIgnoreAuth, setLogsIgnoreAuth] = useState(false)
  const [logsSkipText, setLogsSkipText] = useState('')

  // Live accumulator so parallel agent runs merge into one reports array without races.
  const reportsRef = useRef<AgentReport[]>(assistanceState?.reports ?? [])
  const reports = assistanceState?.reports ?? []

  const getConfig = (id: AgentId): AgentRunConfig => agentConfig[id] ?? defaultConfig
  const setConfig = (id: AgentId, patch: Partial<AgentRunConfig>) => {
    setAgentConfig((prev) => ({ ...prev, [id]: { ...(prev[id] ?? defaultConfig), ...patch } }))
  }

  const toggleAgent = (id: AgentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const labelFor = (id: AgentId): string => AGENTS.find((a) => a.id === id)?.label ?? id

  const handleLaunch = async () => {
    if (isLaunching) return
    setLaunchError(null)
    if (!selectedEmail.jiraKey) {
      setLaunchError('Aucun ticket Jira associé à cet email.')
      return
    }
    const toRun = [...selectedAgents].filter((id) => LAUNCHABLE_AGENTS.includes(id))
    if (toRun.length === 0) {
      setLaunchError('Aucun agent branché sélectionné (disponibles : Analyse ticket, Tickets Jira similaires, Analyseur de logs).')
      return
    }

    const jiraKey = selectedEmail.jiraKey
    const guidance = followUpPrompt.trim()
    const priorHistory: AssistanceRun[] = assistanceState?.history ?? []
    const historyAcc: AssistanceRun[] = []
    const summaries: Record<string, string> = {}

    // Seed the accumulator with a running report per launched agent.
    reportsRef.current = toRun.map((id) => ({
      agentId: id,
      status: 'running' as const,
      report: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorMessage: null,
    }))
    onUpdateAssistance({
      status: 'in_progress',
      summary: `Assistance en cours — ${jiraKey}`,
      reports: [...reportsRef.current],
    })

    const patchReport = (report: AgentReport) => {
      reportsRef.current = [...reportsRef.current.filter((r) => r.agentId !== report.agentId), report]
      onUpdateAssistance({ reports: [...reportsRef.current] })
    }

    const runOneAgent = async (agentId: AgentId) => {
      const label = labelFor(agentId)
      const cfg = getConfig(agentId)
      const startedAt = new Date().toISOString()
      const options = agentId === 'logs'
        ? {
            ignoreAuthErrors: logsIgnoreAuth,
            skipPatterns: logsSkipText.split(/[\n,]/).map((p) => p.trim()).filter((p) => p.length > 0),
          }
        : undefined
      try {
        const response = await fetch(`/api/assistance/agents/${encodeURIComponent(agentId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jiraKey, guidance, config: { model: cfg.model, effort: cfg.effort }, options }),
        })
        const data = await response.json() as AssistanceAgentRunResponse
        if (!response.ok) throw new Error(data.error ?? data.stderr ?? `${label} a échoué.`)
        if (!data.runId) throw new Error(`${label} n'a pas retourné de runId.`)
        const runId = data.runId

        for (;;) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200))
          const statusResponse = await fetch(`/api/assistance/agents/${encodeURIComponent(runId)}/status`)
          const statusData = await statusResponse.json() as AssistanceAgentStatusResponse
          if (!statusResponse.ok) throw new Error(statusData.error ?? statusData.stderr ?? `Le suivi de ${label} a échoué.`)

          if (statusData.status === 'done') {
            const finishedAt = statusData.finishedAt ?? new Date().toISOString()
            const report = statusData.report?.trim() ?? ''
            const summary = statusData.summary?.trim() || `${label} terminé — ${jiraKey}`
            summaries[agentId] = summary
            patchReport({ agentId, status: 'done', report, startedAt: statusData.startedAt ?? startedAt, finishedAt, errorMessage: null })
            historyAcc.push({
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              agentLabel: label, model: cfg.model, effort: cfg.effort, guidance,
              status: 'done', summary, report, errorMessage: null,
              startedAt: statusData.startedAt ?? startedAt, finishedAt,
            })
            return
          }
          if (statusData.status === 'error') {
            throw new Error(statusData.error ?? `${label} a échoué.`)
          }
        }
      } catch (error) {
        // Erreur par agent : rendue dans le bloc de rapport de l'agent (pas de bannière globale,
        // sinon l'échec d'un agent masquerait le succès d'un autre).
        const message = error instanceof Error ? error.message : `${label} a échoué.`
        const finishedAt = new Date().toISOString()
        patchReport({ agentId, status: 'error', report: '', startedAt, finishedAt, errorMessage: message })
        historyAcc.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          agentLabel: label, model: cfg.model, effort: cfg.effort, guidance,
          status: 'error', summary: '', report: '', errorMessage: message, startedAt, finishedAt,
        })
      }
    }

    setIsLaunching(true)
    try {
      if (executionMode === 'parallel') {
        await Promise.all(toRun.map((id) => runOneAgent(id)))
      } else {
        for (const id of toRun) {
          await runOneAgent(id)
        }
      }
      const okSummaries = toRun.map((id) => summaries[id]).filter(Boolean)
      const aggregateSummary = okSummaries.length > 0
        ? okSummaries.join(' · ')
        : `Assistance en échec — ${jiraKey}`
      onUpdateAssistance({
        status: 'done',
        summary: aggregateSummary,
        followUpPrompt,
        reports: [...reportsRef.current],
        history: [...historyAcc, ...priorHistory],
      })
    } finally {
      setIsLaunching(false)
    }
  }

  const launchableSelected = [...selectedAgents].filter((id) => LAUNCHABLE_AGENTS.includes(id))
  const canLaunch = launchableSelected.length > 0 && !isLaunching
  const hasAnyReport = reports.some((r) => r.report || r.status === 'error')

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
                                className={`assistance-pill${getConfig(agent.id).model === m.value ? ' assistance-pill--active' : ''}`}
                                onClick={() => setConfig(agent.id, { model: m.value })}
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
                                className={`assistance-pill${getConfig(agent.id).effort === e.value ? ' assistance-pill--active' : ''}`}
                                onClick={() => setConfig(agent.id, { effort: e.value as 'low' | 'medium' | 'high' })}
                              >
                                {e.label}
                              </button>
                            ))}
                          </div>
                        </label>
                        {agent.id === 'jira' && (
                          <span className="assistance-config-hint">
                            Périmètre : Faible = SUPIOBEYA · Moyen = + SUPNG · Élevé = + IOBEXP + IOB
                          </span>
                        )}
                        {agent.id === 'logs' && (
                          <>
                            <label className="assistance-config-check">
                              <input
                                type="checkbox"
                                checked={logsIgnoreAuth}
                                onChange={(e) => setLogsIgnoreAuth(e.target.checked)}
                              />
                              <span>Ignorer les erreurs d'authentification</span>
                            </label>
                            <label className="assistance-config-field assistance-config-field--stacked">
                              <span className="assistance-config-label">À ignorer</span>
                              <textarea
                                className="form-textarea assistance-skip-textarea"
                                placeholder="Un motif par ligne (ou séparés par des virgules). Toute ligne de log contenant ce texte sera ignorée. Ex: HealthCheck, favicon, broken pipe"
                                value={logsSkipText}
                                onChange={(e) => setLogsSkipText(e.target.value)}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {(launchError || reports.length > 0) && (
            <div className="assistance-section">
              <p className="assistance-section-label">Rapports</p>
              {launchError && <p className="form-error">{launchError}</p>}
              {reports.map((r) => (
                <div key={r.agentId} className="assistance-report-block">
                  <p className="assistance-report-agent">{labelFor(r.agentId)}</p>
                  {r.status === 'running' && (
                    <p className="modal-agent-status">{labelFor(r.agentId)} en cours sur {selectedEmail.jiraKey}…</p>
                  )}
                  {r.status === 'error' && r.errorMessage && (
                    <p className="form-error">{r.errorMessage}</p>
                  )}
                  {r.report && (
                    <div className="assistance-report-render">
                      <AnalysisReport report={r.report} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="assistance-section">
            <p className="assistance-section-label">Complément pour relancer l'assistance</p>
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
            {isLaunching ? 'Assistance en cours…' : hasAnyReport ? 'Relancer →' : "Lancer l'assistance →"}
          </button>
        </footer>
      </section>
    </div>
  )
}
