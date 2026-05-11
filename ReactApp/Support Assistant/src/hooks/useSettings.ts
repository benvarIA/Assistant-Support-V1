import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, ModelConfig } from '../types'

const DEFAULTS: AppSettings = {
  tickets:   { provider: 'claude', model: 'claude-haiku-4-5', effort: 'medium' },
  treatment: { provider: 'codex',  model: 'gpt-5.4',          effort: 'medium' },
}

async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch('/api/settings')
  if (!res.ok) return DEFAULTS
  const data = await res.json() as { settings?: AppSettings }
  return data.settings ?? DEFAULTS
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)

  useEffect(() => {
    fetchSettings().then(setSettings).catch(() => {})
  }, [])

  const updateContext = useCallback((context: 'tickets' | 'treatment', config: ModelConfig) => {
    const next: AppSettings = { ...settings, [context]: config }
    setSettings(next)
    saveSettings(next).catch(() => {})
  }, [settings])

  return { settings, updateContext }
}
