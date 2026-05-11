import { useEffect, useState } from 'react'
import type { KibaDraftResponse, KibaProposeResponse, KibaPreflightResponse, KibaPreflightResult, KibaProposal, PrisEmailRow } from '../types'

export function useKiba(selectedEmail: PrisEmailRow | null, setAgentWorkStatus: (status: string | null) => void) {
  const [kibaProposal, setKibaProposal] = useState<KibaProposal | null>(null)
  const [isKibaProposing, setIsKibaProposing] = useState(false)
  const [kibaProposeError, setKibaProposeError] = useState<string | null>(null)

  const [isKibaPreflight, setIsKibaPreflight] = useState(false)
  const [kibaPreflight, setKibaPreflight] = useState<KibaPreflightResult | null>(null)
  const [kibaPreflightError, setKibaPreflightError] = useState<string | null>(null)

  const [isKibaCreatingDraft, setIsKibaCreatingDraft] = useState(false)
  const [kibaDraftResult, setKibaDraftResult] = useState<{ status: string; subject?: string; draftInfo?: string; blockingReason?: string } | null>(null)
  const [kibaDraftError, setKibaDraftError] = useState<string | null>(null)

  useEffect(() => {
    setKibaProposal(null)
    setKibaProposeError(null)
    setKibaPreflight(null)
    setKibaPreflightError(null)
    setKibaDraftResult(null)
    setKibaDraftError(null)
  }, [selectedEmail?.id])

  const proposeKiba = async () => {
    if (!selectedEmail?.jiraKey) return
    setIsKibaProposing(true)
    setKibaProposeError(null)
    setKibaProposal(null)
    setKibaDraftResult(null)
    setKibaDraftError(null)
    try {
      const response = await fetch('/api/kiba/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selectedEmail, jiraKey: selectedEmail.jiraKey }),
      })
      const data = await response.json() as KibaProposeResponse
      if (!response.ok || !data.proposal) {
        setKibaProposeError(data.error ?? data.stderr ?? 'Analyse Kiba impossible.')
        return
      }
      setKibaProposal(data.proposal)
    } catch (error) {
      setKibaProposeError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsKibaProposing(false)
    }
  }

  const runKibaPreflight = async (customerEmail: string) => {
    if (!selectedEmail?.jiraKey) return
    setIsKibaPreflight(true)
    setKibaPreflightError(null)
    setKibaPreflight(null)
    try {
      const response = await fetch('/api/kiba/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraKey: selectedEmail.jiraKey, customerEmail }),
      })
      const data = await response.json() as KibaPreflightResponse
      if (!response.ok || !data.preflight) {
        setKibaPreflightError(data.error ?? 'Vérification préalable impossible.')
        return
      }
      setKibaPreflight(data.preflight)
    } catch (error) {
      setKibaPreflightError(error instanceof Error ? error.message : 'Erreur de vérification préalable.')
    } finally {
      setIsKibaPreflight(false)
    }
  }

  const createKibaDraft = async (onSuccess: (message: string) => void) => {
    if (!selectedEmail?.jiraKey || !kibaProposal) return
    setIsKibaCreatingDraft(true)
    setKibaDraftError(null)
    setKibaDraftResult(null)
    setAgentWorkStatus('Kiba: création du brouillon Outlook en cours…')
    try {
      const response = await fetch('/api/kiba/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: selectedEmail,
          jiraKey: selectedEmail.jiraKey,
          clientType: kibaProposal.clientType,
          deliveryType: kibaProposal.deliveryType,
          language: kibaProposal.language,
          customerEmail: kibaProposal.customerEmail,
        }),
      })
      const data = await response.json() as KibaDraftResponse
      if (!response.ok || !data.result) {
        setKibaDraftError(data.error ?? data.stderr ?? 'Création brouillon impossible.')
        return
      }
      setKibaDraftResult(data.result)
      if (data.result.status === 'draft_created') {
        onSuccess('Brouillon Outlook créé avec succès.')
      }
    } catch (error) {
      setKibaDraftError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsKibaCreatingDraft(false)
      setAgentWorkStatus(null)
    }
  }

  const setKibaProposalField = <K extends keyof KibaProposal>(field: K, value: KibaProposal[K]) => {
    setKibaProposal((current) => current ? { ...current, [field]: value } : current)
  }

  return {
    kibaProposal,
    isKibaProposing,
    kibaProposeError,
    isKibaPreflight,
    kibaPreflight,
    kibaPreflightError,
    isKibaCreatingDraft,
    kibaDraftResult,
    kibaDraftError,
    proposeKiba,
    runKibaPreflight,
    createKibaDraft,
    setKibaProposalField,
  }
}
