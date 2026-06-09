import { useCallback, useEffect, useState } from 'react'
import type { ClientKnowledge, ClientKnowledgeResponse } from '../types'

const EMPTY: ClientKnowledge = {
  updatedAt: null,
  latestVersion: '4.43',
  source: null,
  stats: null,
  count: 0,
  entries: [],
}

export type KnowledgeFeedback = { type: 'success' | 'error'; text: string }

export function useKnowledgeBase() {
  const [knowledge, setKnowledge] = useState<ClientKnowledge>(EMPTY)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [feedback, setFeedback] = useState<KnowledgeFeedback | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/clients/knowledge')
      const data = (await res.json()) as ClientKnowledgeResponse
      if (res.ok && data.knowledge) setKnowledge(data.knowledge)
    } catch {
      // garder l'état courant en cas d'échec réseau
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/clients/knowledge/refresh', { method: 'POST' })
      const data = (await res.json()) as ClientKnowledgeResponse & { error?: string }
      if (!res.ok || !data.knowledge) {
        setFeedback({ type: 'error', text: data.error ?? 'Rafraîchissement impossible.' })
        return
      }
      setKnowledge(data.knowledge)
      const s = data.knowledge.stats
      setFeedback({
        type: 'success',
        text: s
          ? `Base à jour : ${s.total} clients (${s.added} ajoutés, ${s.modified} modifiés, ${s.removed} retirés).`
          : `Base à jour : ${data.knowledge.count} clients.`,
      })
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Rafraîchissement impossible.' })
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  const setLatestVersion = useCallback(async (version: string) => {
    const clean = version.trim()
    if (!clean) return
    try {
      const res = await fetch('/api/clients/knowledge/latest-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: clean }),
      })
      const data = (await res.json()) as ClientKnowledgeResponse & { error?: string }
      if (res.ok && data.knowledge) {
        setKnowledge(data.knowledge)
        setFeedback({ type: 'success', text: `Dernière version définie sur ${data.knowledge.latestVersion}.` })
      } else {
        setFeedback({ type: 'error', text: data.error ?? 'Mise à jour de la version impossible.' })
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Mise à jour impossible.' })
    }
  }, [])

  const detectLatestVersion = useCallback(async () => {
    setIsDetecting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/clients/knowledge/latest-version/detect', { method: 'POST' })
      const data = (await res.json()) as ClientKnowledgeResponse & { error?: string }
      if (res.ok && data.knowledge) {
        setKnowledge(data.knowledge)
        setFeedback({ type: 'success', text: `Dernière version détectée depuis IOBEXP : ${data.knowledge.latestVersion}.` })
      } else {
        setFeedback({ type: 'error', text: data.error ?? 'Détection de la version impossible.' })
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Détection impossible.' })
    } finally {
      setIsDetecting(false)
    }
  }, [])

  return { knowledge, isLoading, isRefreshing, isDetecting, feedback, setFeedback, load, refresh, setLatestVersion, detectLatestVersion }
}
