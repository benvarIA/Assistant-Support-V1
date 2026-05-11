import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  DescriptionRenderMode,
  IdentificationCategory,
  IdentificationResponse,
  JiraCreateResponse,
  JiraProposal,
  JiraProposalResponse,
  PrisEmailRow,
  TreatmentProgress,
  TreatmentsStoreResponse,
} from '../types'
import { MIN_ANALYSIS_DURATION_MS, TREATMENTS_STORAGE_KEY } from '../constants'
import { normalizePersistedTreatments, readStoredTreatments } from '../utils'

export function useTreatment(
  selectedEmail: PrisEmailRow | null,
  setSelectedEmail: (updater: ((current: PrisEmailRow | null) => PrisEmailRow | null) | PrisEmailRow | null) => void,
  setPrisEmails: (updater: (current: PrisEmailRow[]) => PrisEmailRow[]) => void,
  setAgentWorkStatus: (status: string | null) => void,
) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProposingJira, setIsProposingJira] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [jiraDraft, setJiraDraft] = useState<JiraProposal | null>(null)
  const [isCreatingJira, setIsCreatingJira] = useState(false)
  const [createJiraError, setCreateJiraError] = useState<string | null>(null)
  const [createdIssue, setCreatedIssue] = useState<TreatmentProgress['createdIssue']>(null)
  const [isRealTreatmentActive, setIsRealTreatmentActive] = useState(false)
  const [identificationCategoryText, setIdentificationCategoryText] = useState('')
  const [isIdentificationValidated, setIsIdentificationValidated] = useState(false)
  const [identificationError, setIdentificationError] = useState<string | null>(null)
  const [identificationWarnings, setIdentificationWarnings] = useState<string[]>([])

  const [treatmentsByThread, setTreatmentsByThread] = useState<Record<string, TreatmentProgress>>(() => readStoredTreatments())
  const [isTreatmentsStoreReady, setIsTreatmentsStoreReady] = useState(false)

  // Load persisted treatments from backend on mount
  useEffect(() => {
    let isCancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/treatments')
        const data = await response.json() as TreatmentsStoreResponse
        if (!response.ok) return
        const persisted = normalizePersistedTreatments(data.treatments ?? {})
        if (!isCancelled) setTreatmentsByThread((current) => ({ ...current, ...persisted }))
      } catch {
        // Keep local fallback when backend store is unavailable.
      } finally {
        if (!isCancelled) setIsTreatmentsStoreReady(true)
      }
    }
    void load()
    return () => { isCancelled = true }
  }, [])

  // Persist to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(TREATMENTS_STORAGE_KEY, JSON.stringify(treatmentsByThread))
    } catch {
      // Ignore storage quota / private mode errors.
    }
  }, [treatmentsByThread])

  // Debounced save to backend
  useEffect(() => {
    if (!isTreatmentsStoreReady) return
    const timeoutId = window.setTimeout(() => {
      void fetch('/api/treatments/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treatments: treatmentsByThread }),
      }).catch(() => {
        // Ignore backend persistence errors.
      })
    }, 300)
    return () => window.clearTimeout(timeoutId)
  }, [treatmentsByThread, isTreatmentsStoreReady])

  // Sync current treatment state to treatmentsByThread
  useEffect(() => {
    if (!selectedEmail) return
    setTreatmentsByThread((current) => ({
      ...current,
      [selectedEmail.id]: {
        selectedEmail,
        isAnalyzing,
        isProposingJira,
        analysisError,
        jiraDraft,
        isCreatingJira,
        createJiraError,
        createdIssue,
        isRealTreatmentActive,
        identificationCategoryText,
        isIdentificationValidated,
        identificationError,
        identificationWarnings,
      },
    }))
  }, [
    selectedEmail,
    isAnalyzing,
    isProposingJira,
    analysisError,
    jiraDraft,
    isCreatingJira,
    createJiraError,
    createdIssue,
    isRealTreatmentActive,
    identificationCategoryText,
    isIdentificationValidated,
    identificationError,
    identificationWarnings,
  ])

  const identifyEmail = async (email: PrisEmailRow) => {
    setIsAnalyzing(true)
    setAgentWorkStatus("Agent d'identification: analyse de l'email en cours...")
    setAnalysisError(null)
    setJiraDraft(null)
    const analysisStartedAt = Date.now()
    try {
      const response = await fetch('/api/issue/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json() as IdentificationResponse
      if (!response.ok || !data.identification) {
        setAnalysisError(data.error ?? data.stderr ?? 'Identification impossible.')
        return
      }
      setIdentificationCategoryText(data.identification)
      setIsIdentificationValidated(false)
      setIdentificationError(null)
      setIdentificationWarnings(data.warnings ?? [])
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      const elapsed = Date.now() - analysisStartedAt
      if (elapsed < MIN_ANALYSIS_DURATION_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_ANALYSIS_DURATION_MS - elapsed))
      }
      setIsAnalyzing(false)
      setAgentWorkStatus(null)
    }
  }

  const resetTreatmentState = () => {
    setAnalysisError(null)
    setJiraDraft(null)
    setIsCreatingJira(false)
    setCreateJiraError(null)
    setCreatedIssue(null)
    setIsRealTreatmentActive(false)
    setIdentificationCategoryText('')
    setIsIdentificationValidated(false)
    setIdentificationError(null)
    setIdentificationWarnings([])
    setIsAnalyzing(false)
    setIsProposingJira(false)
  }

  const resumeTreatment = (email: PrisEmailRow, existing: TreatmentProgress) => {
    setSelectedEmail({ ...existing.selectedEmail, ...email })
    setIsAnalyzing(false)
    setIsProposingJira(false)
    setAnalysisError(existing.analysisError)
    setJiraDraft(existing.jiraDraft)
    setIsCreatingJira(false)
    setCreateJiraError(existing.createJiraError)
    setCreatedIssue(existing.createdIssue)
    setIsRealTreatmentActive(existing.isRealTreatmentActive)
    setIdentificationCategoryText(existing.identificationCategoryText)
    setIsIdentificationValidated(existing.isIdentificationValidated)
    setIdentificationError(existing.identificationError)
    setIdentificationWarnings(existing.identificationWarnings)
  }

  const parseIdentificationCategory = (raw: string): IdentificationCategory | null => {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'assistance') return 'Assistance'
    if (normalized === 'question') return 'Question'
    if (normalized === 'intervention livraison') return 'Intervention livraison'
    if (normalized === 'intervention administration') return 'Intervention administration'
    return null
  }

  const validateIdentification = (onSuccess: (message: string) => void): boolean => {
    const parsedCategory = parseIdentificationCategory(identificationCategoryText)
    if (!parsedCategory) {
      setIdentificationError('Valeur invalide. Utiliser exactement: Assistance, Question, Intervention livraison, Intervention administration.')
      return false
    }
    if (!selectedEmail) return false
    setIdentificationError(null)
    setIdentificationCategoryText(parsedCategory)
    setIsIdentificationValidated(true)
    onSuccess('Identification sauvegardée.')
    return true
  }

  const proposeJiraDraft = async (email: PrisEmailRow, identification: IdentificationCategory) => {
    setIsProposingJira(true)
    setAgentWorkStatus('Préparation de la proposition Jira...')
    setAnalysisError(null)
    setJiraDraft(null)
    try {
      const response = await fetch('/api/jirayah/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, identification }),
      })
      const data = await response.json() as JiraProposalResponse
      if (!response.ok || !data.proposal) {
        setAnalysisError(data.error ?? data.stderr ?? 'Proposition Jira impossible.')
        return
      }
      setJiraDraft(data.proposal)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsProposingJira(false)
      setAgentWorkStatus(null)
    }
  }

  const setDraftField = <K extends keyof JiraProposal>(field: K, value: JiraProposal[K]) => {
    setJiraDraft((current) => {
      if (!current) return current
      return {
        ...current,
        [field]: value,
        ...(field === 'description' ? { descriptionRenderMode: 'plain-text' as DescriptionRenderMode } : {}),
      }
    })
  }

  const setAttachmentSelected = (key: string, selected: boolean) => {
    setJiraDraft((current) => {
      if (!current) return current
      return {
        ...current,
        attachmentCandidates: current.attachmentCandidates.map((c) =>
          c.key === key ? { ...c, selected } : c,
        ),
      }
    })
  }

  const createJiraFromDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!jiraDraft || !selectedEmail || isCreatingJira) return
    setIsCreatingJira(true)
    setAgentWorkStatus('Agent Jira: création du ticket en cours...')
    setCreateJiraError(null)
    try {
      const response = await fetch('/api/jirayah/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selectedEmail, proposal: jiraDraft }),
      })
      const data = await response.json() as JiraCreateResponse
      if (!response.ok || !data.issue) {
        setCreateJiraError(data.error ?? data.stderr ?? 'Création Jira impossible.')
        return
      }
      const issue = data.issue
      setCreatedIssue(issue)
      setSelectedEmail((current) => (current ? { ...current, jiraKey: issue.key, jiraUrl: issue.url } : current))
      setPrisEmails((current) =>
        current.map((email) =>
          email.id !== selectedEmail.id ? email : { ...email, jiraKey: issue.key, jiraUrl: issue.url },
        ),
      )
      window.location.reload()
    } catch (error) {
      setCreateJiraError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsCreatingJira(false)
      setAgentWorkStatus(null)
    }
  }

  const removeTreatment = (threadId: string) => {
    setTreatmentsByThread((current) => {
      const next = { ...current }
      delete next[threadId]
      return next
    })
  }

  const invalidateTreatments = (invalidatedSet: Set<string>) => {
    setTreatmentsByThread((current) => {
      const next = { ...current }
      for (const threadId of invalidatedSet) delete next[threadId]
      return next
    })
  }

  return {
    isAnalyzing,
    isProposingJira,
    analysisError,
    jiraDraft,
    setJiraDraft,
    isCreatingJira,
    createJiraError,
    createdIssue,
    isRealTreatmentActive,
    setIsRealTreatmentActive,
    identificationCategoryText,
    setIdentificationCategoryText,
    isIdentificationValidated,
    setIsIdentificationValidated,
    identificationError,
    setIdentificationError,
    identificationWarnings,
    treatmentsByThread,
    setTreatmentsByThread,
    identifyEmail,
    resetTreatmentState,
    resumeTreatment,
    validateIdentification,
    parseIdentificationCategory,
    proposeJiraDraft,
    setDraftField,
    setAttachmentSelected,
    createJiraFromDraft,
    removeTreatment,
    invalidateTreatments,
  }
}
