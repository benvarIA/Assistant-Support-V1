import type { TerminalLine, TreatmentProgress, IdentificationCategory } from './types'
import { TREATMENTS_STORAGE_KEY } from './constants'

export function createLine(type: TerminalLine['type'], text: string): TerminalLine {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    text,
  }
}

export function stripReplyPrefixes(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return ''
  return trimmed.replace(/^(?:(?:re|tr|fw|fwd)\s*:\s*)+/i, '').trim()
}

export function normalizePersistedTreatments(
  input: Record<string, TreatmentProgress>,
): Record<string, TreatmentProgress> {
  const entries = Object.entries(input)
  const normalized = entries.map(([key, value]) => [
    key,
    {
      ...value,
      jiraDraft: value.jiraDraft
        ? {
            ...value.jiraDraft,
            descriptionRenderMode: value.jiraDraft.descriptionRenderMode ?? 'plain-text',
          }
        : null,
      isAnalyzing: false,
      isProposingJira: false,
      isCreatingJira: false,
    },
  ])
  return Object.fromEntries(normalized) as Record<string, TreatmentProgress>
}

export function readStoredTreatments(): Record<string, TreatmentProgress> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TREATMENTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizePersistedTreatments(parsed as Record<string, TreatmentProgress>)
  } catch {
    return {}
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function parseIdentificationCategory(raw: string): IdentificationCategory | null {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'assistance') return 'Assistance'
  if (normalized === 'question') return 'Question'
  if (normalized === 'intervention livraison') return 'Intervention livraison'
  if (normalized === 'intervention administration') return 'Intervention administration'
  return null
}
