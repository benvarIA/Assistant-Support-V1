import { useEffect, useMemo, useState } from 'react'
import './App.css'

const HOME_STEP_ID = 'home'
const SALESFORCE_FILTER_URL =
  'https://iobeya.lightning.force.com/lightning/r/Report/00O6900000Bjjz2EAB/view?queryScope=userFolders'

const rolloutSteps = [
  { id: 'scope', label: 'Préparer le scope clients (Salesforce + exceptions)', timing: 'Phase initiale' },
  { id: 'create', label: 'Créer les tickets (IOBEXP puis SUPIOBEYA)', timing: 'Phase initiale' },
  { id: 'link-tickets', label: 'Ajouter tous les liens requires', timing: 'Structuration' },
  { id: 'pause-support', label: 'Passer les tickets SUPIOBEYA en Pause', timing: 'Structuration' },
  { id: 'email-template', label: 'Générer et attacher le template email', timing: 'Communication' },
  { id: 'outlook-drafts', label: 'Créer les brouillons Outlook', timing: 'Communication' },
  { id: 'calendar-event', label: 'Créer l event calendrier Outlook', timing: 'Coordination' },
  { id: 'beamer-fr', label: 'Rédiger le BEAMER FR', timing: 'Clôture' },
  { id: 'beamer-en', label: 'Rédiger le BEAMER EN', timing: 'Clôture' },
]

const issueTemplates = [
  {
    id: 'rollout-final-ops',
    project: 'IOBEXP',
    type: 'Task',
    summaryPattern: 'Roll-Out {version} - {dateFull} 10h am CET',
    clientName: 'Tous clients impactes',
    descriptionPattern: '',
    requires: ['internal-platforms-ops', 'preprod-no-rep-ops', 'preprod-with-rep-ops'],
  },
  {
    id: 'preprod-no-rep-ops',
    project: 'IOBEXP',
    type: 'Task',
    summaryPattern: 'Roll-Out {version} - Preproductions sans replication',
    clientName: 'Orange / Devsanofi',
    descriptionPattern: 'Orange, Devsanofi',
    requires: [],
  },
  {
    id: 'preprod-with-rep-ops',
    project: 'IOBEXP',
    type: 'Task',
    summaryPattern: 'Roll-Out {version} - Preproductions avec replication',
    clientName: 'Sanofi / Mars / ID-Logistics',
    descriptionPattern: 'Sanofi, Mars, ID-logistics',
    requires: ['replication-ops'],
  },
  {
    id: 'replication-ops',
    project: 'IOBEXP',
    type: 'Task',
    summaryPattern: 'Roll-Out {version} - Replication de Production sur Preproduction',
    clientName: 'Sanofi / Mars / ID-Logistics',
    descriptionPattern: 'Sanofi Mars ID-logistics',
    requires: [],
  },
  {
    id: 'internal-platforms-ops',
    project: 'IOBEXP',
    type: 'Task',
    summaryPattern: 'Roll-Out {version} - Plateformes internes - à définir',
    clientName: 'Home / Clients / Preview',
    descriptionPattern: 'Home Clients Preview',
    requires: [],
  },
  {
    id: 'rollout-final-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - {dateFull} 10h am CET',
    clientName: 'Tous clients impactes',
    descriptionPattern: '',
    requires: ['internal-platforms-support', 'preprod-no-rep-support', 'preprod-with-rep-support', 'rollout-final-ops'],
  },
  {
    id: 'preprod-no-rep-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Preproductions sans replication - à partir de TBD',
    clientName: 'Orange / Devsanofi',
    descriptionPattern: 'Orange, Devsanofi',
    requires: ['preprod-no-rep-ops', 'email-clients-support'],
  },
  {
    id: 'preprod-with-rep-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Preproductions avec replication - à partir de TBD',
    clientName: 'Sanofi / Mars / ID-Logistics',
    descriptionPattern:
      'Preprod Sanofi: Activate FT FEATURE_EVENT_HANDLER_GROUPS_ENABLED on Home, Mars, ID-logistics',
    requires: ['replication-support', 'post-sanofi', 'post-mars', 'post-id', 'preprod-with-rep-ops', 'email-clients-support'],
  },
  {
    id: 'replication-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Replication de Production sur Preproduction - à partir de TBD',
    clientName: 'Sanofi / Mars / ID-Logistics',
    descriptionPattern: 'Sanofi Mars ID-logistics',
    requires: ['replication-ops'],
  },
  {
    id: 'internal-platforms-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Plateformes internes - à définir',
    clientName: 'Home / Clients / Preview',
    descriptionPattern: 'Home Clients Preview',
    requires: ['internal-platforms-ops'],
  },
  {
    id: 'email-clients-support',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Envoi Email aux clients',
    clientName: 'Tous clients impactes',
    descriptionPattern: 'Template adapte a attacher',
    requires: [],
  },
  {
    id: 'post-sanofi',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Post action Sanofi',
    clientName: 'Sanofi',
    descriptionPattern:
      'https://kapit.sharepoint.com/:w:/r/sites/LOGOS/_layouts/15/Doc.aspx?sourcedoc=%7B6257E100-F7DD-4A6A-AC07-426B4F0ABBB8%7D&file=Sanofi%20-%20post%20actions%20restoration%20environnments.docx&action=default&mobileredirect=true&DefaultItemOpen=1',
    requires: ['replication-support'],
  },
  {
    id: 'post-mars',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Post action Mars',
    clientName: 'Mars',
    descriptionPattern:
      'https://kapit.sharepoint.com/:w:/r/sites/LOGOS/_layouts/15/Doc.aspx?sourcedoc=%7BABF77E71-B420-49EE-B9A7-6E2F39AFD736%7D&file=Mars%20-%20post%20actions%20restoration%20environnments.docx&action=default&mobileredirect=true&DefaultItemOpen=1',
    requires: ['replication-support'],
  },
  {
    id: 'post-id',
    project: 'SUPIOBEYA',
    type: 'Intervention',
    summaryPattern: 'Roll-Out {version} - Post action ID',
    clientName: 'ID-Logistics',
    descriptionPattern:
      'https://kapit.sharepoint.com/:w:/r/sites/LOGOS/_layouts/15/Doc.aspx?sourcedoc=%7B634AEF73-A3D2-4923-97A0-4826CDDF3E1C%7D&file=ID-Logistics%20-%20post%20actions%20restoration%20environnments.docx&action=default&mobileredirect=true',
    requires: ['replication-support'],
  },
]

const stepPageContent = {
  scope: {
    title: 'Préparer le scope clients',
    details: 'Utiliser le filtre Salesforce puis saisir ici les exceptions à appliquer avant création des tickets.',
  },
  create: {
    title: 'Créer les tickets (IOBEXP puis SUPIOBEYA)',
    details:
      'Créer d abord les tickets IOBEXP, puis les tickets SUPIOBEYA (incluant Envoi Email + Post actions).',
  },
  'link-tickets': {
    title: 'Ajouter les dépendances',
    details: 'Ajouter les liens requires internes et les liens miroirs SUPIOBEYA -> IOBEXP.',
  },
  'pause-support': {
    title: 'Passer en Pause',
    details: 'Après ouverture en In Progress, repasser les tickets SUPIOBEYA en Pause.',
  },
  'email-template': {
    title: 'Template email clients',
    details: 'Dupliquer le template, remplacer version/date, puis attacher le fichier au ticket SUPIOBEYA Envoi Email.',
  },
  'outlook-drafts': {
    title: 'Brouillons Outlook',
    details: 'Créer les brouillons par client avec TO/CC du template et flagger les messages si pin indisponible.',
  },
  'calendar-event': {
    title: 'Event calendrier Outlook',
    details: 'Créer l event Roll Out Version X, 10:00-12:00, participants SRE et Support.',
  },
  'beamer-fr': {
    title: 'BEAMER FR',
    details: 'Préparer la communication FR de clôture du rollout.',
  },
  'beamer-en': {
    title: 'BEAMER EN',
    details: 'Préparer la communication EN de clôture du rollout.',
  },
}

const homeContent = {
  title: 'Accueil',
  details: 'Workflow validé sur le run 4.46 (28/02/2026), sans étape GO/NO-GO.',
}

const clientEmailTemplates = [
  {
    client: 'Sanofi',
    to: 'Karima.Souami@sanofi.com',
    cc: 'support@iobeya.com,yann.graufogel@iobeya.com',
    subject: 'iObeya - Mise à jour de la préproduction + dev en {version}',
  },
  {
    client: 'Orange',
    to: 'caroline.candio@orange.com,sebastien.salomez@orange.com,sophie.pendola@orange.com',
    cc: 'support@iobeya.com,joud@iobeya.com',
    subject: 'iObeya - Mise à jour de la préproduction en {version}',
  },
  {
    client: 'ID-Logistics',
    to: 'crambaud@id-logistics.com,scalas@id-logistics.com,tverron@id-logistics.com,ebeydon@id-logistics.com',
    cc: 'support@iobeya.com',
    subject: 'iObeya - Mise à jour de la préproduction en {version}',
  },
  {
    client: 'Total',
    to: 'damien.noirot@totalenergies.com',
    cc: '',
    subject: 'iObeya - Mise à jour de la préproduction en {version}',
  },
  {
    client: 'Mars',
    to: 'andre.owens1@effem.com,twan.smeets@effem.com',
    cc: 'support@iobeya.com,ygraufogel@iobeya.com',
    subject: 'iObeya - Planning the iObeya upgrade to version {version}',
  },
]

const LOCAL_STORAGE_KEY = 'rollout-manager-state-v1'

const isValidDateInput = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

const createInitialState = (defaultDate) => ({
  version: '',
  rolloutDate: defaultDate,
  submitted: false,
  validatedStepIds: [],
  activeStepId: HOME_STEP_ID,
  scopeExceptions: '',
})

const loadState = (defaultDate) => {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) {
      return createInitialState(defaultDate)
    }

    const parsed = JSON.parse(raw)
    const allowedStepIds = new Set([HOME_STEP_ID, ...rolloutSteps.map((step) => step.id)])
    const validatedStepIds = Array.isArray(parsed.validatedStepIds)
      ? parsed.validatedStepIds.filter((id) => allowedStepIds.has(id))
      : []

    return {
      version: typeof parsed.version === 'string' ? parsed.version : '',
      rolloutDate: isValidDateInput(parsed.rolloutDate) ? parsed.rolloutDate : defaultDate,
      submitted: Boolean(parsed.submitted),
      validatedStepIds,
      activeStepId: parsed.submitted && allowedStepIds.has(parsed.activeStepId) ? parsed.activeStepId : HOME_STEP_ID,
      scopeExceptions: typeof parsed.scopeExceptions === 'string' ? parsed.scopeExceptions : '',
    }
  } catch {
    return createInitialState(defaultDate)
  }
}

function App() {
  const defaultDate = new Date().toISOString().split('T')[0]
  const persistedState = useMemo(() => loadState(defaultDate), [defaultDate])
  const [version, setVersion] = useState(persistedState.version)
  const [rolloutDate, setRolloutDate] = useState(persistedState.rolloutDate)
  const [submitted, setSubmitted] = useState(persistedState.submitted)
  const [validatedSteps, setValidatedSteps] = useState(new Set(persistedState.validatedStepIds))
  const [activeStepId, setActiveStepId] = useState(persistedState.activeStepId)
  const [showDiagramModal, setShowDiagramModal] = useState(false)
  const [showStepModal, setShowStepModal] = useState(false)
  const [scopeExceptions, setScopeExceptions] = useState(persistedState.scopeExceptions)
  const hasActiveRollout = submitted

  const normalizedVersion = version.trim().replace(/^v/i, '')
  const dateObj = isValidDateInput(rolloutDate) ? new Date(`${rolloutDate}T00:00:00`) : null
  const dateFull = dateObj ? new Intl.DateTimeFormat('fr-FR').format(dateObj) : ''

  const globalSearchJql = useMemo(() => {
    if (!normalizedVersion) {
      return ''
    }

    return [
      `textfields ~ "${normalizedVersion}"`,
      'AND reporter = currentUser()',
      'AND project IN (IOBEXP, SUPIOBEYA)',
      'AND type IN (Task, Intervention)',
      `AND summary ~ "${normalizedVersion}"`,
    ].join('\n')
  }, [normalizedVersion])

  const jiraSearchUrl = useMemo(() => {
    if (!globalSearchJql) {
      return ''
    }
    return `https://iobeya.atlassian.net/issues/?jql=${encodeURIComponent(globalSearchJql)}`
  }, [globalSearchJql])

  const proposedIssues = useMemo(() => {
    if (!normalizedVersion || !rolloutDate) {
      return []
    }

    const requiredByMap = {}
    issueTemplates.forEach((issue) => {
      issue.requires.forEach((requiredId) => {
        if (!requiredByMap[requiredId]) {
          requiredByMap[requiredId] = []
        }
        requiredByMap[requiredId].push(issue.id)
      })
    })

    return issueTemplates.map((issue) => ({
      ...issue,
      summary: issue.summaryPattern
        .replaceAll('{version}', normalizedVersion)
        .replaceAll('{dateFull}', dateFull),
      description: issue.descriptionPattern
        .replaceAll('{version}', normalizedVersion)
        .replaceAll('{dateFull}', dateFull),
      priority: 'Major',
      reporter: 'Benoit Varisellaz',
      assignee: issue.project === 'SUPIOBEYA' ? 'Benoit Varisellaz' : 'Automatic',
      requiredBy: requiredByMap[issue.id] || [],
    }))
  }, [dateFull, normalizedVersion, rolloutDate])

  const [ticketsCreationTriggered, setTicketsCreationTriggered] = useState(false)
  const visibleIssues = useMemo(() => {
    if (activeStepId !== 'create') {
      return []
    }
    return proposedIssues
  }, [activeStepId, proposedIssues])
  const exploitationIssues = useMemo(
    () => visibleIssues.filter((issue) => issue.project === 'IOBEXP'),
    [visibleIssues],
  )
  const supportIssues = useMemo(
    () => visibleIssues.filter((issue) => issue.project === 'SUPIOBEYA'),
    [visibleIssues],
  )

  const handleValidateStep = (stepId) => {
    setValidatedSteps((prev) => {
      const next = new Set(prev)
      next.add(stepId)
      return next
    })
  }

  const handleStartNewRollout = () => {
    const resetState = createInitialState(defaultDate)
    setVersion(resetState.version)
    setRolloutDate(resetState.rolloutDate)
    setSubmitted(resetState.submitted)
    setValidatedSteps(new Set(resetState.validatedStepIds))
    setActiveStepId(resetState.activeStepId)
    setShowDiagramModal(false)
    setShowStepModal(false)
    setTicketsCreationTriggered(false)
    setScopeExceptions(resetState.scopeExceptions)
  }

  const handleCloseRollout = () => {
    if (!submitted) {
      return
    }
    const confirmed = window.confirm('Clôturer le rollout en cours et revenir à l accueil ?')
    if (!confirmed) {
      return
    }
    handleStartNewRollout()
  }

  const handleLaunchRollout = (event) => {
    event.preventDefault()
    if (!version.trim() || !rolloutDate) {
      return
    }
    setSubmitted(true)
    setActiveStepId('scope')
    setShowStepModal(true)
    setTicketsCreationTriggered(false)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          version,
          rolloutDate,
          submitted,
          validatedStepIds: Array.from(validatedSteps),
          activeStepId,
          scopeExceptions,
        }),
      )
    } catch {
      // Ignore persistence issues (private mode, blocked storage, quota).
    }
  }, [activeStepId, rolloutDate, scopeExceptions, submitted, validatedSteps, version])

  const activeStep = activeStepId === HOME_STEP_ID ? homeContent : stepPageContent[activeStepId]
  const activeStepIndex = rolloutSteps.findIndex((step) => step.id === activeStepId)
  const isLastStep = activeStepIndex === rolloutSteps.length - 1
  const hasPreviousStep = activeStepIndex > 0

  const handleOpenPreviousStep = () => {
    if (!hasPreviousStep) {
      return
    }
    setActiveStepId(rolloutSteps[activeStepIndex - 1].id)
    setShowStepModal(true)
  }

  const handleOpenNextStep = () => {
    if (isLastStep || activeStepIndex < 0) {
      setShowStepModal(false)
      return
    }
    setActiveStepId(rolloutSteps[activeStepIndex + 1].id)
    setShowStepModal(true)
  }

  const handleValidateAndContinue = () => {
    if (activeStepId === HOME_STEP_ID) {
      return
    }
    handleValidateStep(activeStepId)
    handleOpenNextStep()
  }

  const renderFlowDiagram = () => (
    <div className="rollout-diagram figma-diagram">
      <article className="flow-diagram-node node-main">
        <h4>1. Préparer le scope clients (Salesforce + exceptions)</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-none">Sans ticket</span>
        </div>
      </article>
      <div className="diagram-link">v</div>

      <article className="flow-diagram-node node-main">
        <h4>2. Créer les tickets (IOBEXP puis SUPIOBEYA)</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-ops">Ticket IOBEXP</span>
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>
      <div className="diagram-link">v</div>

      <article className="flow-diagram-node node-main">
        <h4>3. Ajouter les liens requires + miroirs</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-ops">Ticket IOBEXP</span>
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>
      <div className="diagram-link">v</div>

      <article className="flow-diagram-node node-main">
        <h4>4. Passer SUPIOBEYA en Pause</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>

      <div className="diagram-link">v</div>
      <article className="flow-diagram-node node-main">
        <h4>5. Générer et attacher template email</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>
      <div className="diagram-link">v</div>
      <article className="flow-diagram-node node-main">
        <h4>6. Créer brouillons Outlook</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>
      <div className="diagram-link">v</div>
      <article className="flow-diagram-node node-main">
        <h4>7. Créer event calendrier Outlook</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-support">Ticket SUPIOBEYA</span>
        </div>
      </article>
      <div className="diagram-link">v</div>
      <article className="flow-diagram-node node-main">
        <h4>8. BEAMER FR</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-none">Contenu</span>
        </div>
      </article>
      <div className="diagram-link">v</div>
      <article className="flow-diagram-node node-main">
        <h4>9. BEAMER EN</h4>
        <div className="flow-ticket-tags">
          <span className="ticket-badge ticket-badge-none">Contenu</span>
        </div>
      </article>
    </div>
  )

  return (
    <div className="app-shell app-shell-home">
      <main className="content">
        <div className="floating-actions">
          <button
            type="button"
            className="danger-button"
            onClick={handleCloseRollout}
            disabled={!hasActiveRollout}
            title={hasActiveRollout ? 'Clôturer le rollout en cours' : 'Aucun rollout en cours'}
          >
            Clôturer le rollout
          </button>
        </div>

        {activeStepId === HOME_STEP_ID && (
          <section className="home-center-wrap">
            <article className="card home-minimal-card">
              <h3>Accueil</h3>
              <div className="home-actions">
                <button type="button" className="secondary-button" onClick={() => setShowDiagramModal(true)}>
                  Deroule du roll-out
                </button>
              </div>

              <form className="home-launch-form" onSubmit={handleLaunchRollout}>
                <label>
                  Numero de version
                  <input
                    type="text"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="ex: 4.47"
                    required
                  />
                </label>
                <label>
                  Date de rollout
                  <input
                    type="date"
                    value={rolloutDate}
                    onChange={(event) => setRolloutDate(event.target.value)}
                    required
                  />
                </label>
                <button type="submit">Lancer le rollout</button>
              </form>
            </article>
          </section>
        )}

        {hasActiveRollout && activeStepId !== HOME_STEP_ID && (
          <section className="card flow-card">
            <p className="eyebrow">Progression</p>
            <h3>
              Étape {activeStepIndex + 1}/{rolloutSteps.length} · {activeStep?.title}
            </h3>
            <p>{activeStep?.details}</p>
            <div className="flow-actions">
              <button type="button" onClick={() => setShowStepModal(true)}>
                Ouvrir la pop-up de l étape
              </button>
            </div>
          </section>
        )}

        {activeStepId === 'create' && showStepModal && (
          <>
            {submitted && visibleIssues.length > 0 && (
              <section className="card flow-card">
                <h3>Proposition de tickets</h3>
                <p>Ordre de création attendu : IOBEXP d abord, puis SUPIOBEYA.</p>
                <div className="flow-actions">
                  <button type="button" onClick={() => setTicketsCreationTriggered(true)}>
                    Créer les tickets
                  </button>
                </div>
                {ticketsCreationTriggered && <p className="hint">Création à exécuter dans Jira avec cet ordre.</p>}
                <div className="ticket-groups">
                  <article className="ticket-group ticket-group-ops">
                    <header className="ticket-group-head">
                      <h4>Exploitation</h4>
                      <span className="ticket-badge ticket-badge-ops">IOBEXP</span>
                    </header>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Summary</th>
                            <th>Client name</th>
                            <th>Description</th>
                            <th>Priority</th>
                            <th>Reporter</th>
                            <th>Assignee</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {exploitationIssues.map((issue) => (
                            <tr key={issue.id}>
                              <td>{issue.summary}</td>
                              <td>{issue.clientName}</td>
                              <td>{issue.description}</td>
                              <td>{issue.priority}</td>
                              <td>{issue.reporter}</td>
                              <td>{issue.assignee}</td>
                              <td>{issue.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  <article className="ticket-group ticket-group-support">
                    <header className="ticket-group-head">
                      <h4>Support</h4>
                      <span className="ticket-badge ticket-badge-support">SUPIOBEYA</span>
                    </header>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Summary</th>
                            <th>Client name</th>
                            <th>Description</th>
                            <th>Priority</th>
                            <th>Reporter</th>
                            <th>Assignee</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supportIssues.map((issue) => (
                            <tr key={issue.id}>
                              <td>{issue.summary}</td>
                              <td>{issue.clientName}</td>
                              <td>{issue.description}</td>
                              <td>{issue.priority}</td>
                              <td>{issue.reporter}</td>
                              <td>{issue.assignee}</td>
                              <td>{issue.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                </div>
                <article className="timeline-step compact-block">
                  <h4>Recherche Jira (doublons)</h4>
                  <pre>{globalSearchJql}</pre>
                  <a href={jiraSearchUrl} target="_blank" rel="noreferrer">
                    Ouvrir la recherche Jira
                  </a>
                </article>
              </section>
            )}
          </>
        )}

        {activeStepId === 'scope' && showStepModal && (
          <section className="card flow-card">
            <h3>Source Salesforce</h3>
            <p>
              <a href={SALESFORCE_FILTER_URL} target="_blank" rel="noreferrer">
                Ouvrir le filtre Salesforce
              </a>
            </p>
            <label className="exceptions-field">
              Exceptions à appliquer
              <textarea
                value={scopeExceptions}
                onChange={(event) => setScopeExceptions(event.target.value)}
                placeholder="Ex: exclure Client X, ajouter plateforme Y, commentaire spécifique..."
                rows={4}
              />
            </label>
          </section>
        )}

        {activeStepId !== HOME_STEP_ID && activeStepId !== 'create' && showStepModal && (
          <section className="card flow-card">
            <h3>Etape</h3>
            {!hasActiveRollout ? (
              <>
                <p>Lancez d abord un rollout depuis l accueil.</p>
                <div className="flow-actions">
                  <button type="button" onClick={() => setActiveStepId('scope')}>Aller à la préparation</button>
                </div>
              </>
            ) : (
              <>
                <p>{activeStep?.details}</p>
                <div className="flow-actions">
                  <button type="button" onClick={handleValidateAndContinue}>
                    {validatedSteps.has(activeStepId) ? 'Etape validée' : 'Valider l étape'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {activeStepId === 'create' && showStepModal && (
          <section className="card flow-card">
            <h3>Validation de l étape</h3>
            <p>Valider cette étape une fois la proposition de tickets vérifiée.</p>
            <div className="flow-actions">
              <button type="button" onClick={handleValidateAndContinue}>
                {validatedSteps.has('create') ? 'Etape validée' : 'Valider l étape'}
              </button>
            </div>
          </section>
        )}

        {activeStepId === 'email-template' && showStepModal && (
          <section className="card flow-card">
            <h3>Base emails clients récupérée</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>To</th>
                    <th>CC</th>
                    <th>Objet</th>
                  </tr>
                </thead>
                <tbody>
                  {clientEmailTemplates.map((mail) => (
                    <tr key={mail.client}>
                      <td>{mail.client}</td>
                      <td>{mail.to}</td>
                      <td>{mail.cc || '-'}</td>
                      <td>{mail.subject.replaceAll('{version}', normalizedVersion || '{version}')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {showStepModal && activeStepId !== HOME_STEP_ID && (
          <div className="step-modal-backdrop" onClick={() => setShowStepModal(false)}>
            <section key={activeStepId} className="step-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3>
                  Étape {activeStepIndex + 1}/{rolloutSteps.length}
                </h3>
                <button type="button" className="secondary-button" onClick={() => setShowStepModal(false)}>
                  Fermer
                </button>
              </div>
              <p className="eyebrow">{rolloutSteps[activeStepIndex]?.timing}</p>
              <h4>{activeStep?.title}</h4>
              <p>{activeStep?.details}</p>
              <div className="step-modal-actions">
                <button type="button" className="secondary-button" onClick={handleOpenPreviousStep} disabled={!hasPreviousStep}>
                  Étape précédente
                </button>
                <button type="button" onClick={handleValidateAndContinue}>
                  {isLastStep ? 'Valider et terminer' : 'Valider et ouvrir la suite'}
                </button>
              </div>
            </section>
          </div>
        )}

        {showDiagramModal && (
          <div className="diagram-modal-backdrop" onClick={() => setShowDiagramModal(false)}>
            <div className="diagram-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3>Deroule du roll-out</h3>
                <button type="button" className="secondary-button" onClick={() => setShowDiagramModal(false)}>
                  Fermer
                </button>
              </div>
              {renderFlowDiagram()}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
