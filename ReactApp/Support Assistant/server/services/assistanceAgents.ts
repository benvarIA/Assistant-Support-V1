import { randomUUID } from 'node:crypto'
import { runAnalyseTicketAgent } from './analyseTicket.js'
import { runSimilarTicketsAgent } from './similarTickets.js'
import { runLogAnalyzerAgent } from './logAnalyzer.js'

type EffortLevel = 'low' | 'medium' | 'high'

export type AssistanceAgentId =
  | 'analyse'
  | 'web'
  | 'docs'
  | 'jira'
  | 'systeme'
  | 'logs'
  | 'har'
  | 'dcm'
  | 'qcd'
  | 'addon-jira'
  | 'addon-ado'

export type LogFilterOptions = {
  ignoreAuthErrors?: boolean
  skipPatterns?: string[]
}

export type AssistanceAgentPayload = {
  jiraKey?: string
  guidance?: string
  config?: {
    model?: string
    effort?: EffortLevel
  }
  options?: LogFilterOptions
}

export type AssistanceAgentResult = {
  summary: string
  report: string
}

export type AssistanceAgentRunState = {
  runId: string
  agentId: AssistanceAgentId
  status: 'queued' | 'running' | 'done' | 'error'
  summary: string
  report: string
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

type AssistanceAgentHandler = (payload: AssistanceAgentPayload) => Promise<AssistanceAgentResult>

const RUNS = new Map<string, AssistanceAgentRunState>()

const AGENT_REGISTRY: Partial<Record<AssistanceAgentId, AssistanceAgentHandler>> = {
  analyse: async (payload) => {
    const jiraKey = payload.jiraKey?.trim()
    if (!jiraKey) throw new Error('Missing jiraKey')
    return runAnalyseTicketAgent(jiraKey, payload.config, payload.guidance?.trim())
  },
  jira: async (payload) => {
    const jiraKey = payload.jiraKey?.trim()
    if (!jiraKey) throw new Error('Missing jiraKey')
    return runSimilarTicketsAgent(jiraKey, payload.config, payload.guidance?.trim())
  },
  logs: async (payload) => {
    const jiraKey = payload.jiraKey?.trim()
    if (!jiraKey) throw new Error('Missing jiraKey')
    return runLogAnalyzerAgent(jiraKey, payload.config, payload.guidance?.trim(), payload.options)
  },
}

function buildInitialRunState(runId: string, agentId: AssistanceAgentId): AssistanceAgentRunState {
  return {
    runId,
    agentId,
    status: 'queued',
    summary: '',
    report: '',
    error: null,
    startedAt: null,
    finishedAt: null,
  }
}

function getAgentHandler(agentId: string): AssistanceAgentHandler | null {
  if (!Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, agentId)) return null
  return AGENT_REGISTRY[agentId as AssistanceAgentId] ?? null
}

export function isRegisteredAssistanceAgent(agentId: string): agentId is AssistanceAgentId {
  return getAgentHandler(agentId) !== null
}

export function startAssistanceAgentRun(agentId: AssistanceAgentId, payload: AssistanceAgentPayload): AssistanceAgentRunState {
  const handler = getAgentHandler(agentId)
  if (!handler) {
    throw new Error(`Unsupported agent: ${agentId}`)
  }

  const runId = randomUUID()
  const initialState = buildInitialRunState(runId, agentId)
  RUNS.set(runId, initialState)

  void (async () => {
    const runningState: AssistanceAgentRunState = {
      ...initialState,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    RUNS.set(runId, runningState)

    try {
      const result = await handler(payload)
      RUNS.set(runId, {
        ...runningState,
        status: 'done',
        summary: result.summary.trim(),
        report: result.report.trim(),
        finishedAt: new Date().toISOString(),
      })
    } catch (error) {
      RUNS.set(runId, {
        ...runningState,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        finishedAt: new Date().toISOString(),
      })
    }
  })()

  return initialState
}

export function getAssistanceAgentRun(runId: string): AssistanceAgentRunState | null {
  return RUNS.get(runId) ?? null
}

