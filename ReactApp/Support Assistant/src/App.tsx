import { useEffect, useState } from 'react'
import './App.css'

import type {
  PrisEmailRow,
  JiraClientsRefreshResponse,
  MicrosoftFeedback,
  JiraClientsFeedback,
  CloseTicketResponse,
  WorklogResponse,
} from './types'


import TopNav from './components/TopNav'
import EmailSidebar from './components/EmailSidebar'
import ActionPanel from './components/ActionPanel'
import KibaPanel from './components/KibaPanel'
import TreatmentPanel from './components/TreatmentPanel'
import JiraTicketModal from './components/modals/JiraTicketModal'
import TraceModal from './components/modals/TraceModal'
import TraceWorklogModal from './components/modals/TraceWorklogModal'
import CloseTicketModal from './components/modals/CloseTicketModal'
import JiraValidationModal from './components/modals/JiraValidationModal'

import { useMicrosoftAuth } from './hooks/useMicrosoftAuth'
import { useEmails } from './hooks/useEmails'
import { useTreatment } from './hooks/useTreatment'
import { useTrace } from './hooks/useTrace'
import { useKiba } from './hooks/useKiba'
import { useAssistance } from './hooks/useAssistance'
import { useSettings } from './hooks/useSettings'

function App() {

  const [agentWorkStatus, setAgentWorkStatus] = useState<string | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<PrisEmailRow | null>(null)
  const [activeTab, setActiveTab] = useState<'tickets' | 'treatment'>('tickets')

  const [isConnectingJira, setIsConnectingJira] = useState(false)
  const [isRefreshingJiraClients, setIsRefreshingJiraClients] = useState(false)
  const [jiraClientsRefreshFeedback, setJiraClientsRefreshFeedback] = useState<JiraClientsFeedback | null>(null)

  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false)
  const [ticketModalMode, setTicketModalMode] = useState<'analysis' | 'create' | null>(null)
  const [isTraceModalOpen, setIsTraceModalOpen] = useState(false)
  const [actionPlaceholderMessage, setActionPlaceholderMessage] = useState<string | null>(null)

  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
  const [closeWorklogMinutes, setCloseWorklogMinutes] = useState('0')
  const [closeTicketError, setCloseTicketError] = useState<string | null>(null)
  const [closeTicketSuccess, setCloseTicketSuccess] = useState<string | null>(null)
  const [isClosingTicket, setIsClosingTicket] = useState(false)

  const [isTraceWorklogModalOpen, setIsTraceWorklogModalOpen] = useState(false)
  const [traceWorklogMinutes, setTraceWorklogMinutes] = useState('0')
  const [traceWorklogError, setTraceWorklogError] = useState<string | null>(null)
  const [isAddingTraceWorklog, setIsAddingTraceWorklog] = useState(false)

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message)
    setToastType(type)
  }

  // --- Hooks ---
  const microsoftAuth = useMicrosoftAuth(setAgentWorkStatus)

  const { prisEmails, setPrisEmails, isLoadingPrisEmails, loadEmailsError, confirmJiraError, setConfirmJiraError, pendingJiraValidationQueue, loadPrisEmails, dismissCurrentJiraValidation, confirmJiraAssociation } =
    useEmails(setAgentWorkStatus, (invalidatedSet) => {
      treatment.invalidateTreatments(invalidatedSet)
      setSelectedEmail((current) => (current && invalidatedSet.has(current.id) ? null : current))
      setIsTicketModalOpen(false)
    })

  const treatment = useTreatment(selectedEmail, setSelectedEmail, setPrisEmails, setAgentWorkStatus)

  const trace = useTrace(selectedEmail, setAgentWorkStatus)

  const kiba = useKiba(selectedEmail, setAgentWorkStatus)
  const assistance = useAssistance()
  const { settings, updateContext } = useSettings()

  // --- Auto-load on mount ---
  useEffect(() => {
    void loadPrisEmails()
  }, [])

  // --- Toast auto-dismiss ---
  useEffect(() => {
    if (!toastMessage) return
    const timeoutId = window.setTimeout(() => setToastMessage(null), 3600)
    return () => window.clearTimeout(timeoutId)
  }, [toastMessage])

  // --- Connect handlers ---
  const connectJira = async () => {
    setIsConnectingJira(true)
    try {
      const response = await fetch('/api/connect/jira', { method: 'POST' })
      const result = await response.json() as { code: number; stdout: string; stderr: string; error?: string }
      if (!response.ok || result.error) {
        showToast(result.error ?? result.stderr ?? 'Connexion Jira impossible.', 'error')
      } else {
        showToast(result.stdout.trim() || 'Jira connecté.', 'success')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Connexion Jira impossible.', 'error')
    } finally {
      setIsConnectingJira(false)
    }
  }

  const refreshJiraClientsReference = async () => {
    setIsRefreshingJiraClients(true)
    setAgentWorkStatus('Agent Jira: mise à jour de la référence clients...')
    setJiraClientsRefreshFeedback(null)
    try {
      const response = await fetch('/api/jira/clients/refresh', { method: 'POST' })
      const result = await response.json() as JiraClientsRefreshResponse
      if (!response.ok) {
        const message = result.error ?? result.stderr ?? 'Mise à jour des clients Jira impossible.'
        setJiraClientsRefreshFeedback({ type: 'error', text: message })
        return
      }
      if (result.stats) {
        setJiraClientsRefreshFeedback({
          type: 'success',
          text: `MAJ clients Jira: ${result.stats.added} ajoutés, ${result.stats.modified} modifiés, ${result.stats.removed} supprimés (total: ${result.stats.total}).`,
          addedNames: result.stats.addedNames ?? [],
          modifiedNames: result.stats.modifiedNames ?? [],
        })
      } else if (result.stdout.trim()) {
        setJiraClientsRefreshFeedback({ type: 'success', text: result.stdout.trim() })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mise à jour impossible.'
      setJiraClientsRefreshFeedback({ type: 'error', text: message })
    } finally {
      setIsRefreshingJiraClients(false)
      setAgentWorkStatus(null)
    }
  }

  // --- Treatment open/close ---
  const openTreatment = (email: PrisEmailRow, options?: { forceIdentification?: boolean }) => {
    const forceIdentification = options?.forceIdentification ?? false
    setIsTicketModalOpen(true)
    if (forceIdentification) {
      treatment.resetTreatmentState()
      setSelectedEmail(email)
      void treatment.identifyEmail(email)
      return
    }
    const existingTreatment = treatment.treatmentsByThread[email.id]
    if (existingTreatment) {
      treatment.resumeTreatment(email, existingTreatment)
      return
    }
    const hasExistingJira = Boolean(email.jiraKey)
    treatment.resetTreatmentState()
    setSelectedEmail(email)
    if (hasExistingJira) {
      treatment.setIsRealTreatmentActive(true)
      return
    }
    void treatment.identifyEmail(email)
  }

  const closeTreatment = () => {
    setIsTicketModalOpen(false)
    setTicketModalMode(null)
    setIsTraceModalOpen(false)
    setIsTraceWorklogModalOpen(false)
    setSelectedEmail(null)
  }

  // --- Modal handlers ---
  const openCloseModal = () => {
    if (!selectedEmail?.jiraKey) {
      setActionPlaceholderMessage("Clôture impossible: cet email n'a pas encore de ticket Jira associé.")
      return
    }
    setCloseWorklogMinutes('0')
    setCloseTicketError(null)
    setCloseTicketSuccess(null)
    setIsCloseModalOpen(true)
  }

  const closeCloseModal = () => {
    if (isClosingTicket) return
    setIsCloseModalOpen(false)
    setCloseTicketError(null)
  }

  const confirmCloseTicket = async () => {
    if (!selectedEmail?.jiraKey || isClosingTicket) return
    const parsedMinutes = Number(closeWorklogMinutes)
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
      setCloseTicketError('Le temps passé doit être un nombre supérieur ou égal à 0.')
      return
    }
    const worklogMinutes = Math.floor(parsedMinutes)
    setIsClosingTicket(true)
    setCloseTicketError(null)
    setCloseTicketSuccess(null)
    setAgentWorkStatus(`Clôture en cours pour ${selectedEmail.jiraKey}...`)
    try {
      const response = await fetch('/api/ticket/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selectedEmail, jiraKey: selectedEmail.jiraKey, worklogMinutes }),
      })
      const data = await response.json() as CloseTicketResponse
      if (!response.ok || !data.result) {
        setCloseTicketError(data.error ?? data.stderr ?? 'Clôture impossible.')
        return
      }
      setCloseTicketSuccess(
        `${data.result.jiraKey} clôturé · ${data.result.worklogAdded ? `${data.result.worklogMinutes} min loggées` : 'sans worklog'} · ${data.result.archivedCount} email(s) archivé(s)`,
      )
      showToast(`${data.result.jiraKey} clôturé avec succès. ${data.result.archivedCount} email(s) archivé(s).`)
      setActionPlaceholderMessage(`${data.result.jiraKey} clôturé. Email archivé et label PRIS retiré.`)
      setIsCloseModalOpen(false)
      setSelectedEmail(null)
      setIsTicketModalOpen(false)
      treatment.removeTreatment(selectedEmail.id)
      await loadPrisEmails()
    } catch (error) {
      setCloseTicketError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsClosingTicket(false)
      setAgentWorkStatus(null)
    }
  }

  const submitTraceWorklog = async () => {
    const parsedMinutes = Number(traceWorklogMinutes)
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
      setTraceWorklogError('Le temps passé doit être un nombre supérieur ou égal à 0.')
      return
    }
    setIsAddingTraceWorklog(true)
    setTraceWorklogError(null)
    try {
      const response = await fetch('/api/ticket/worklog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraKey: selectedEmail?.jiraKey, worklogMinutes: Math.floor(parsedMinutes) }),
      })
      const data = await response.json() as WorklogResponse
      if (!response.ok || !data.result) {
        setTraceWorklogError(data.error ?? data.stderr ?? 'Ajout worklog impossible.')
        return
      }
      setIsTraceWorklogModalOpen(false)
      showToast(
        data.result.worklogAdded
          ? `Worklog ajouté: ${data.result.worklogMinutes} min sur ${data.result.jiraKey}.`
          : `Aucun worklog ajouté sur ${data.result.jiraKey}.`,
      )
    } catch (error) {
      setTraceWorklogError(error instanceof Error ? error.message : 'Erreur inconnue')
    } finally {
      setIsAddingTraceWorklog(false)
    }
  }

  // --- Action launchers ---
  const selectEmailFromTable = (email: PrisEmailRow) => {
    setSelectedEmail(email)
    setActionPlaceholderMessage(null)
    setCloseTicketSuccess(null)
  }

  const launchAnalysis = () => {
    if (!selectedEmail) return
    setActionPlaceholderMessage(null)
    setTicketModalMode('analysis')
    void openTreatment(selectedEmail, { forceIdentification: true })
  }

  const launchCreate = () => {
    if (!selectedEmail || selectedEmail.jiraKey) return
    if (!treatment.isIdentificationValidated) {
      setActionPlaceholderMessage("Identification non validée. Lance d'abord l'étape Identification.")
      return
    }
    const parsedCategory = treatment.parseIdentificationCategory(treatment.identificationCategoryText)
    if (!parsedCategory) {
      setActionPlaceholderMessage("Identification invalide. Refaire l'étape Identification.")
      return
    }
    setTicketModalMode('create')
    setIsTicketModalOpen(true)
    if (!treatment.jiraDraft && !treatment.isProposingJira) {
      void treatment.proposeJiraDraft(selectedEmail, parsedCategory)
    }
  }

  const launchTraceAction = () => {
    if (!selectedEmail) return
    setActionPlaceholderMessage(null)
    if (!selectedEmail.jiraKey) {
      setActionPlaceholderMessage('Tracer impossible: aucun ticket Jira associé.')
      return
    }
    setIsTraceModalOpen(true)
  }

  // --- Derived state ---
  const hasAssociatedJira = Boolean(selectedEmail?.jiraKey)
  const sequenceIndex = !treatment.isIdentificationValidated ? 0 : !hasAssociatedJira ? 1 : closeTicketSuccess ? 3 : 2
  const currentJiraValidation = pendingJiraValidationQueue[0] ?? null

  const microsoftFeedback: MicrosoftFeedback | null = microsoftAuth.microsoftConnectFeedback

  return (
    <main className="app">
      {selectedEmail && isTicketModalOpen && ticketModalMode && (
        <JiraTicketModal
          selectedEmail={selectedEmail}
          ticketModalMode={ticketModalMode}
          agentWorkStatus={agentWorkStatus}
          isAnalyzing={treatment.isAnalyzing}
          analysisError={treatment.analysisError}
          identificationCategoryText={treatment.identificationCategoryText}
          identificationWarnings={treatment.identificationWarnings}
          identificationError={treatment.identificationError}
          isIdentificationValidated={treatment.isIdentificationValidated}
          isProposingJira={treatment.isProposingJira}
          jiraDraft={treatment.jiraDraft}
          isCreatingJira={treatment.isCreatingJira}
          createJiraError={treatment.createJiraError}
          onSetIdentificationCategoryText={(value) => {
            treatment.setIdentificationCategoryText(value)
            treatment.setIsIdentificationValidated(false)
            treatment.setIdentificationError(null)
          }}
          onValidateIdentification={() => {
            const ok = treatment.validateIdentification((msg) => setActionPlaceholderMessage(msg))
            if (ok) { setIsTicketModalOpen(false); setTicketModalMode(null) }
          }}
          onSetDraftField={treatment.setDraftField}
          onSetJiraDraft={treatment.setJiraDraft}
          onSetAttachmentSelected={treatment.setAttachmentSelected}
          onCreateJiraFromDraft={treatment.createJiraFromDraft}
          onClose={() => { setIsTicketModalOpen(false); setTicketModalMode(null) }}
        />
      )}

      {selectedEmail && isTraceModalOpen && selectedEmail.jiraKey && (
        <TraceModal
          selectedEmail={selectedEmail}
          isTracingOrochimaru={trace.isTracingOrochimaru}
          orochimaruTraceResult={trace.orochimaruTraceResult}
          orochimaruTraceError={trace.orochimaruTraceError}
          agentWorkStatus={agentWorkStatus}
          onRunTrace={() => void trace.runTrace((summary) => {
            showToast(`Traçage terminé: ${summary}`)
            setActionPlaceholderMessage(summary)
            setIsTraceModalOpen(false)
            setTraceWorklogMinutes('0')
            setTraceWorklogError(null)
            setIsTraceWorklogModalOpen(true)
          })}
          onClose={() => { if (!trace.isTracingOrochimaru) setIsTraceModalOpen(false) }}
        />
      )}

      {selectedEmail && selectedEmail.jiraKey && isTraceWorklogModalOpen && (
        <TraceWorklogModal
          selectedEmail={selectedEmail}
          traceWorklogMinutes={traceWorklogMinutes}
          traceWorklogError={traceWorklogError}
          isAddingTraceWorklog={isAddingTraceWorklog}
          onSetTraceWorklogMinutes={setTraceWorklogMinutes}
          onSubmit={() => void submitTraceWorklog()}
          onClose={() => setIsTraceWorklogModalOpen(false)}
        />
      )}

      {selectedEmail && isCloseModalOpen && (
        <CloseTicketModal
          selectedEmail={selectedEmail}
          closeWorklogMinutes={closeWorklogMinutes}
          closeTicketError={closeTicketError}
          isClosingTicket={isClosingTicket}
          onSetCloseWorklogMinutes={setCloseWorklogMinutes}
          onConfirm={() => void confirmCloseTicket()}
          onClose={closeCloseModal}
        />
      )}

      {currentJiraValidation && !isTicketModalOpen && !isTraceModalOpen && (
        <JiraValidationModal
          email={currentJiraValidation}
          confirmError={confirmJiraError}
          onConfirm={(email, match) => { setConfirmJiraError(null); void confirmJiraAssociation(email, match, (emailId, key, url) => {
            const existing = treatment.treatmentsByThread[emailId]
            if (existing) {
              treatment.setTreatmentsByThread((current) => ({
                ...current,
                [emailId]: {
                  ...existing,
                  selectedEmail: { ...existing.selectedEmail, jiraKey: key, jiraUrl: url, jiraMatches: [] },
                },
              }))
            }
          }) }}
          onDismiss={() => { setConfirmJiraError(null); dismissCurrentJiraValidation() }}
        />
      )}

      {toastMessage && (
        <div className={`toast toast-${toastType}`} role={toastType === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span>{toastMessage}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => setToastMessage(null)}
            aria-label="Fermer la notification"
          >
            ×
          </button>
        </div>
      )}

      <TopNav
        agentWorkStatus={agentWorkStatus}
        isConnectingJira={isConnectingJira}
        isConnectingMicrosoft={microsoftAuth.isConnectingMicrosoft}
        isMicrosoftLoginRunning={microsoftAuth.isMicrosoftLoginRunning}
        activeTab={activeTab}
        onConnectJira={() => void connectJira()}
        onConnectMicrosoft={() => void microsoftAuth.connectMicrosoft()}
        onReset={closeTreatment}
        onTabChange={setActiveTab}
      />

      <div className="workspace">
        <EmailSidebar
          prisEmails={prisEmails}
          selectedEmail={selectedEmail}
          treatmentsByThread={treatment.treatmentsByThread}
          isLoadingPrisEmails={isLoadingPrisEmails}
          isRefreshingJiraClients={isRefreshingJiraClients}
          microsoftFeedback={microsoftFeedback}
          jiraClientsFeedback={jiraClientsRefreshFeedback}
          loadEmailsError={loadEmailsError}
          onSelectEmail={selectEmailFromTable}
          onRefresh={() => void loadPrisEmails()}
          onRefreshClients={() => void refreshJiraClientsReference()}
          effort={activeTab === 'tickets' ? settings.tickets.effort : settings.treatment.effort}
          onEffortChange={(effort) => updateContext(activeTab === 'tickets' ? 'tickets' : 'treatment', {
            ...(activeTab === 'tickets' ? settings.tickets : settings.treatment),
            effort,
          })}
        />

        {activeTab === 'tickets' ? (
          <>
            <ActionPanel
              selectedEmail={selectedEmail}
              sequenceIndex={sequenceIndex}
              isAnalyzing={treatment.isAnalyzing}
              isProposingJira={treatment.isProposingJira}
              isCreatingJira={treatment.isCreatingJira}
              isTracingOrochimaru={trace.isTracingOrochimaru}
              isIdentificationValidated={treatment.isIdentificationValidated}
              hasAssociatedJira={hasAssociatedJira}
              actionPlaceholderMessage={actionPlaceholderMessage}
              closeTicketSuccess={closeTicketSuccess}
              onLaunchAnalysis={launchAnalysis}
              onLaunchCreate={launchCreate}
              onLaunchTrace={launchTraceAction}
              onOpenCloseModal={openCloseModal}
            />

            {selectedEmail && hasAssociatedJira && treatment.identificationCategoryText === 'Intervention livraison' && (
              <KibaPanel
                selectedEmail={selectedEmail}
                isProposing={kiba.isKibaProposing}
                proposal={kiba.kibaProposal}
                proposeError={kiba.kibaProposeError}
                isPreflight={kiba.isKibaPreflight}
                preflight={kiba.kibaPreflight}
                preflightError={kiba.kibaPreflightError}
                isCreatingDraft={kiba.isKibaCreatingDraft}
                draftResult={kiba.kibaDraftResult}
                draftError={kiba.kibaDraftError}
                onPropose={() => void kiba.proposeKiba()}
                onRunPreflight={() => void kiba.runKibaPreflight(kiba.kibaProposal?.customerEmail ?? '')}
                onSetProposalField={(field, value) => kiba.setKibaProposalField(field, value)}
                onCreateDraft={() => void kiba.createKibaDraft((msg) => showToast(msg))}
              />
            )}
          </>
        ) : (
          <TreatmentPanel
            selectedEmail={selectedEmail}
            assistanceState={selectedEmail ? (assistance.getState(selectedEmail.conversationId) ?? null) : null}
            onUpdateAssistance={(update) => {
              if (selectedEmail) assistance.updateState(selectedEmail.conversationId, update)
            }}
          />
        )}
      </div>
    </main>
  )
}

export default App
