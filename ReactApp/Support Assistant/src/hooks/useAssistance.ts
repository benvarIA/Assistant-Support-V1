import { useEffect, useRef, useState } from 'react'
import type { AgentReport, AssistanceState, AssistanceStateMap, AssistanceStoreResponse } from '../types'
import { ASSISTANCE_STORAGE_KEY } from '../constants'

function readStoredAssistance(): AssistanceStateMap {
  try {
    const raw = window.localStorage.getItem(ASSISTANCE_STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as AssistanceStateMap
  } catch {
    return {}
  }
}

export function makeEmptyAssistanceState(): AssistanceState {
  return {
    status: 'none',
    summary: '',
    reports: [],
    consolidation: '',
    emailDraft: '',
    updatedAt: new Date().toISOString(),
  }
}

export function useAssistance() {
  const [states, setStates] = useState<AssistanceStateMap>(() => readStoredAssistance())
  const isReadyRef = useRef(false)

  // Load from backend on mount, merge (backend wins)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/assistance')
        if (!response.ok) return
        const data = await response.json() as AssistanceStoreResponse
        if (!cancelled && data.states) {
          setStates((current) => ({ ...current, ...data.states }))
        }
      } catch {
        // localStorage fallback
      } finally {
        if (!cancelled) { isReadyRef.current = true }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Persist to localStorage on change
  useEffect(() => {
    try {
      window.localStorage.setItem(ASSISTANCE_STORAGE_KEY, JSON.stringify(states))
    } catch {
      // Ignore storage errors
    }
  }, [states])

  // Debounced backend save
  useEffect(() => {
    if (!isReadyRef.current) return
    const id = window.setTimeout(() => {
      void fetch('/api/assistance/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states }),
      }).catch(() => {})
    }, 300)
    return () => window.clearTimeout(id)
  }, [states])

  const getState = (conversationId: string): AssistanceState | null =>
    states[conversationId] ?? null

  const updateState = (conversationId: string, update: Partial<AssistanceState>) => {
    setStates((current) => ({
      ...current,
      [conversationId]: {
        ...(current[conversationId] ?? makeEmptyAssistanceState()),
        ...update,
        updatedAt: new Date().toISOString(),
      },
    }))
  }

  const updateReport = (conversationId: string, report: AgentReport) => {
    setStates((current) => {
      const existing = current[conversationId] ?? makeEmptyAssistanceState()
      const reports = existing.reports.filter((r) => r.agentId !== report.agentId)
      return {
        ...current,
        [conversationId]: {
          ...existing,
          reports: [...reports, report],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  }

  const removeState = (conversationId: string) => {
    setStates((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
  }

  return { states, getState, updateState, updateReport, removeState }
}
