import { useEffect, useState } from 'react'
import type { MicrosoftConnectResponse, MicrosoftFeedback } from '../types'

export function useMicrosoftAuth(setAgentWorkStatus: (status: string | null) => void) {
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false)
  const [isMicrosoftLoginRunning, setIsMicrosoftLoginRunning] = useState(false)
  const [microsoftConnectFeedback, setMicrosoftConnectFeedback] = useState<MicrosoftFeedback | null>(null)

  useEffect(() => {
    if (!isMicrosoftLoginRunning) return
    let cancelled = false
    let lastStdout = ''
    let lastStderr = ''
    const poll = async () => {
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        try {
          const response = await fetch('/api/connect/microsoft/status')
          const result = await response.json() as MicrosoftConnectResponse
          const stdout = result.stdout ?? ''
          const stderr = result.stderr ?? ''
          if (stdout !== lastStdout) {
            lastStdout = stdout
            const latestLine = stdout.trim().split('\n').filter(Boolean).pop()
            if (latestLine) setMicrosoftConnectFeedback({ type: 'info', text: latestLine })
          }
          if (stderr !== lastStderr && stderr.trim()) {
            lastStderr = stderr
            const latestLine = stderr.trim().split('\n').filter(Boolean).pop()
            if (latestLine) setMicrosoftConnectFeedback({ type: 'error', text: latestLine })
          }
          if (!result.running) {
            setIsMicrosoftLoginRunning(false)
            setAgentWorkStatus(null)
            if (result.code === 0) {
              setMicrosoftConnectFeedback({ type: 'success', text: 'Connexion Microsoft réussie.' })
            } else {
              const message = result.error ?? result.stderr ?? 'Connexion Microsoft interrompue.'
              setMicrosoftConnectFeedback({ type: 'error', text: message })
            }
            return
          }
        } catch (error) {
          setIsMicrosoftLoginRunning(false)
          setAgentWorkStatus(null)
          setMicrosoftConnectFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erreur de suivi de connexion Microsoft.' })
          return
        }
      }
    }
    void poll()
    return () => { cancelled = true }
  }, [isMicrosoftLoginRunning])

  const connectMicrosoft = async () => {
    setIsConnectingMicrosoft(true)
    setAgentWorkStatus("Agent Microsoft: ouverture du flux de connexion...")
    setMicrosoftConnectFeedback({ type: 'info', text: 'Démarrage de la connexion Microsoft…' })
    try {
      const response = await fetch('/api/connect/microsoft', { method: 'POST' })
      const result = await response.json() as MicrosoftConnectResponse
      if (!response.ok) {
        setMicrosoftConnectFeedback({ type: 'error', text: result.error ?? result.stderr ?? 'Connexion Microsoft impossible.' })
        setIsMicrosoftLoginRunning(false)
        return
      }
      const firstMessage = result.stdout.trim()
      setMicrosoftConnectFeedback({
        type: 'info',
        text: firstMessage || 'Connexion Microsoft lancée. Suis les instructions de connexion.',
      })
      setIsMicrosoftLoginRunning(Boolean(result.running))
    } catch (error) {
      setMicrosoftConnectFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Connexion Microsoft impossible.' })
    } finally {
      setIsConnectingMicrosoft(false)
    }
  }

  return {
    isConnectingMicrosoft,
    isMicrosoftLoginRunning,
    microsoftConnectFeedback,
    connectMicrosoft,
  }
}
