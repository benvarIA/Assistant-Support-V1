import { SETTINGS_PATH } from '../config.js'
import { readJsonFile, saveJsonFile } from '../utils.js'

export type ModelConfig = {
  provider: 'claude' | 'codex'
  model: string
  effort: 'low' | 'medium' | 'high'
}

export type AppSettings = {
  tickets: ModelConfig
  treatment: ModelConfig
}

const DEFAULTS: AppSettings = {
  tickets:   { provider: 'claude', model: 'claude-haiku-4-5', effort: 'medium' },
  treatment: { provider: 'codex',  model: 'gpt-5.4',          effort: 'medium' },
}

export async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await readJsonFile<AppSettings>(SETTINGS_PATH)
    return {
      tickets:   { ...DEFAULTS.tickets,   ...raw.tickets },
      treatment: { ...DEFAULTS.treatment, ...raw.treatment },
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeSettings(next: AppSettings): Promise<void> {
  await saveJsonFile(SETTINGS_PATH, next)
}

/** Returns the codex exec args for model + effort */
export async function getModelArgs(context: 'tickets' | 'treatment'): Promise<string[]> {
  const settings = await readSettings()
  const cfg = settings[context]
  return ['-m', cfg.model, '-c', `model_reasoning_effort="${cfg.effort}"`]
}
