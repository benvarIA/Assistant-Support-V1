import { useEffect, useState } from 'react'
import type { OrochimaruTracePayload, PrisEmailRow, TraceExecuteResponse } from '../types'

export function useTrace(selectedEmail: PrisEmailRow | null, setAgentWorkStatus: (status: string | null) => void) {
  const [isTracingOrochimaru, setIsTracingOrochimaru] = useState(false)
  const [orochimaruTraceResult, setOrochimaruTraceResult] = useState<OrochimaruTracePayload | null>(null)
  const [orochimaruTraceError, setOrochimaruTraceError] = useState<string | null>(null)

  useEffect(() => {
    setOrochimaruTraceResult(null)
    setOrochimaruTraceError(null)
    setIsTracingOrochimaru(false)
  }, [selectedEmail?.id])

  const runTrace = async (
    onSuccess: (summary: string) => void,
  ): Promise<boolean> => {
    if (!selectedEmail?.jiraKey || isTracingOrochimaru) return false
    setIsTracingOrochimaru(true)
    setAgentWorkStatus(`Traçage en cours dans Jira (${selectedEmail.jiraKey})...`)
    setOrochimaruTraceError(null)
    try {
      const response = await fetch('/api/trace/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraKey: selectedEmail.jiraKey, email: selectedEmail }),
      })
      const data = await response.json() as TraceExecuteResponse
      if (!response.ok || !data.result) {
        setOrochimaruTraceError(data.error ?? data.stderr ?? 'Traçage impossible.')
        return false
      }
      const added = data.result.added
      const summary = `Jira tracé: 1 · commentaires ajoutés: ${added}`
      setOrochimaruTraceResult({ status: 'completed', summary })
      onSuccess(summary)
      return true
    } catch (error) {
      setOrochimaruTraceError(error instanceof Error ? error.message : 'Erreur inconnue')
      return false
    } finally {
      setIsTracingOrochimaru(false)
      setAgentWorkStatus(null)
    }
  }

  return {
    isTracingOrochimaru,
    orochimaruTraceResult,
    orochimaruTraceError,
    runTrace,
  }
}
