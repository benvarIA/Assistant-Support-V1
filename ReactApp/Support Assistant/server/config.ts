import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MicrosoftLoginState } from './types.js'

const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url))
export const APP_DIR = path.resolve(SERVER_DIR, '..') // = Support Assistant/
export const ASSISTANT_PRO_DIR = path.resolve(APP_DIR, '..', '..') // = Assistant-Pro/

export const M365_CONFIG_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'm365_config.json')
export const M365_TOKEN_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'm365_token.json')
export const JIRA_CONFIG_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'jira_config.json')
export const JIRAYAH_THREAD_JIRA_CACHE = path.join(ASSISTANT_PRO_DIR, '.codex', 'persistant', 'token', 'jirayah_thread_jira_map.json')
export const JIRAYAH_RULES_PATH = path.join(APP_DIR, 'skills', 'jirayah', 'references', 'jira-mail-rules.md')
export const TSUNADE_SKILL_PATH = path.join(APP_DIR, 'skills', 'tsunade')
export const JIRA_CLIENTS_REFERENCE_PATH = path.join(APP_DIR, 'data', 'jira-clients-reference.json')
export const CLIENT_DEPLOYMENT_MAPPING_PATH = path.join(APP_DIR, 'data', 'client-deployment-jira-mapping-unique.csv')
export const CLIENT_TECH_INFO_PATH = path.join(APP_DIR, 'data', 'client-technical-info.json')
export const CLIENT_KNOWLEDGE_META_PATH = path.join(APP_DIR, 'data', 'client-knowledge-meta.json')
export const TREATMENTS_STORE_PATH = path.join(APP_DIR, 'data', 'treatments-progress.json')
export const SETTINGS_PATH = path.join(APP_DIR, 'data', 'settings.json')
export const ASSISTANCE_STORE_PATH = path.join(APP_DIR, 'data', 'assistance-progress.json')
export const OROCHIMARU_SKILL_PATH = path.join(APP_DIR, 'skills', 'orochimaru')
export const KIBA_SKILL_PATH = path.join(APP_DIR, 'skills', 'kiba')
export const ANALYSE_TICKET_SKILL_PATH = path.join(APP_DIR, 'skills', 'analyse-ticket')
export const SIMILAR_TICKETS_SKILL_PATH = path.join(APP_DIR, 'skills', 'similar-tickets')
export const LOG_ANALYZER_SKILL_PATH = path.join(APP_DIR, 'skills', 'log-analyzer')

// Recherche de tickets similaires : périmètre par effort.
// low → SUPIOBEYA seul · medium → + SUPNG · high → + IOBEXP + IOB.
export const SIMILAR_SEARCH_PROJECTS_BY_EFFORT = {
  low: ['SUPIOBEYA'],
  medium: ['SUPIOBEYA', 'SUPNG'],
  high: ['SUPIOBEYA', 'SUPNG', 'IOBEXP', 'IOB'],
} as const

export const EXCLUDED_CLIENT_NAME_OPTIONS = new Set(['_IOBEYA_', '_IOBEYA_ (SALES)'])
export const TRACE_EXEC_LOCKS = new Set<string>()

export const CONNECTOR_COMMANDS = {
  jira: {
    command: './scripts/connectors.sh',
    args: ['login', 'jira'],
  },
  microsoft: {
    command: './scripts/connectors.sh',
    args: ['login', 'outlook'],
  },
} as const

export const DEFAULT_PROJECT_KEY = 'SUPIOBEYA'
export const DEFAULT_PROJECT_ID = '10200'

export let microsoftLoginState: MicrosoftLoginState | null = null

function appendBounded(current: string, chunk: string, maxChars = 24_000): string {
  const next = current + chunk
  if (next.length <= maxChars) return next
  return next.slice(next.length - maxChars)
}

export function startMicrosoftLoginProcess(): MicrosoftLoginState {
  if (microsoftLoginState?.isRunning) return microsoftLoginState

  const { command, args } = CONNECTOR_COMMANDS.microsoft
  const child = spawn(command, args, {
    cwd: ASSISTANT_PRO_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  microsoftLoginState = {
    stdout: '',
    stderr: '',
    code: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    isRunning: true,
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (!microsoftLoginState) return
    microsoftLoginState.stdout = appendBounded(microsoftLoginState.stdout, chunk.toString('utf-8'))
  })

  child.stderr.on('data', (chunk: Buffer) => {
    if (!microsoftLoginState) return
    microsoftLoginState.stderr = appendBounded(microsoftLoginState.stderr, chunk.toString('utf-8'))
  })

  child.on('error', (error) => {
    if (!microsoftLoginState) return
    microsoftLoginState.stderr = appendBounded(microsoftLoginState.stderr, `\nErreur lancement connexion Microsoft: ${error.message}\n`)
    microsoftLoginState.code = 1
    microsoftLoginState.finishedAt = new Date().toISOString()
    microsoftLoginState.isRunning = false
  })

  child.on('close', (code) => {
    if (!microsoftLoginState) return
    microsoftLoginState.code = code ?? 1
    microsoftLoginState.finishedAt = new Date().toISOString()
    microsoftLoginState.isRunning = false
  })

  return microsoftLoginState
}
