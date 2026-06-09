import { useMemo, useState } from 'react'
import type { ClientKnowledge, ClientKnowledgeEntry } from '../../types'
import type { KnowledgeFeedback } from '../../hooks/useKnowledgeBase'

type KnowledgeBaseModalProps = {
  knowledge: ClientKnowledge
  isLoading: boolean
  isRefreshing: boolean
  isDetecting: boolean
  feedback: KnowledgeFeedback | null
  onRefresh: () => void
  onSetLatestVersion: (version: string) => void
  onDetectLatestVersion: () => void
  onClose: () => void
}

function versionLabel(entry: ClientKnowledgeEntry, latestVersion: string): { text: string; title: string; hosted: boolean } {
  if (entry.version && entry.version !== 'latest') {
    return { text: entry.version, title: `Version ${entry.version}`, hosted: false }
  }
  const hosted = (entry.version === 'latest') || entry.setup.trim().toLowerCase() !== 'onsite'
  if (hosted) {
    return { text: `dernière (${latestVersion})`, title: `Plateforme hébergée iObeya — toujours la dernière version (${latestVersion})`, hosted: true }
  }
  return { text: '—', title: 'Installation Onsite : version non fournie par l’export, à confirmer avec le client', hosted: false }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'jamais'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'inconnue'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function KnowledgeBaseModal({
  knowledge,
  isLoading,
  isRefreshing,
  isDetecting,
  feedback,
  onRefresh,
  onSetLatestVersion,
  onDetectLatestVersion,
  onClose,
}: KnowledgeBaseModalProps) {
  const [query, setQuery] = useState('')
  const [setupFilter, setSetupFilter] = useState('')
  // Le modal est monté à l'ouverture (rendu conditionnel) → ce brouillon s'initialise toujours
  // sur la valeur courante ; le refresh préserve `latestVersion`, donc pas de désync en session.
  const [versionDraft, setVersionDraft] = useState(knowledge.latestVersion)
  // Resynchronise le champ quand la version change côté serveur (ex. détection IOBEXP),
  // via le pattern « ajuster l'état pendant le rendu » (pas d'effet).
  const [syncedVersion, setSyncedVersion] = useState(knowledge.latestVersion)
  if (knowledge.latestVersion !== syncedVersion) {
    setSyncedVersion(knowledge.latestVersion)
    setVersionDraft(knowledge.latestVersion)
  }

  const setups = useMemo(
    () => [...new Set(knowledge.entries.map((e) => e.setup).filter(Boolean))].sort(),
    [knowledge.entries],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return knowledge.entries.filter((e) => {
      if (setupFilter && e.setup !== setupFilter) return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q) ||
        e.setup.toLowerCase().includes(q) ||
        e.language.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q) ||
        (e.version ?? '').toLowerCase().includes(q)
      )
    })
  }, [knowledge.entries, query, setupFilter])

  return (
    <div className="modal-backdrop">
      <section className="modal-card modal-card-large kb-modal" role="dialog" aria-modal="true" aria-label="Base de connaissances clients">
        <header className="modal-header">
          <div>
            <h2 className="modal-title">Base de connaissances clients</h2>
            <p className="modal-subtitle">
              {knowledge.count} clients · MAJ {formatDate(knowledge.updatedAt)}
              {knowledge.source?.attachmentName ? ` · ${knowledge.source.attachmentName}` : ''}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <div className="modal-body kb-body">
          <div className="kb-toolbar">
            <input
              type="search"
              className="form-input kb-search"
              placeholder="Rechercher un client, un setup, une langue…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <select className="form-input kb-setup-filter" value={setupFilter} onChange={(e) => setSetupFilter(e.target.value)}>
              <option value="">Tous les setups</option>
              {setups.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Rafraîchissement…' : 'Rafraîchir depuis Salesforce'}
            </button>
          </div>

          <div className="kb-latest-version">
            <label htmlFor="kb-latest">Dernière version iObeya (résout « latest ») :</label>
            <input
              id="kb-latest"
              type="text"
              className="form-input kb-version-input"
              value={versionDraft}
              onChange={(e) => setVersionDraft(e.target.value)}
              onBlur={() => { if (versionDraft.trim() && versionDraft.trim() !== knowledge.latestVersion) onSetLatestVersion(versionDraft) }}
            />
            <button
              type="button"
              className="btn btn-ghost kb-detect-btn"
              onClick={onDetectLatestVersion}
              disabled={isDetecting}
              title="Détecte la version depuis le dernier ticket Roll-Out fermé sur IOBEXP"
            >
              {isDetecting ? 'Détection…' : 'Détecter depuis IOBEXP'}
            </button>
          </div>

          {feedback && (
            <div className={`kb-feedback kb-feedback--${feedback.type}`}>{feedback.text}</div>
          )}

          <div className="kb-table-wrap">
            <table className="kb-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Type d’installation</th>
                  <th>Langue</th>
                  <th>Version</th>
                  <th>Statut plateforme</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const v = versionLabel(e, knowledge.latestVersion)
                  return (
                    <tr key={`${e.name}|${e.setup}|${e.language}|${e.status}|${e.version ?? ''}`}>
                      <td className="kb-cell-name">{e.name}</td>
                      <td>{e.setup}</td>
                      <td>
                        <span className={`client-lang-badge lang-${e.language.toLowerCase()}`}>
                          {e.language === 'English' ? 'EN' : e.language === 'French' ? 'FR' : e.language}
                        </span>
                      </td>
                      <td>
                        <span className={`kb-version ${v.hosted ? 'kb-version--hosted' : ''}`} title={v.title}>{v.text}</span>
                      </td>
                      <td>
                        {e.status
                          ? <span className={`client-status-badge status-${e.status.toLowerCase()}`}>{e.status}</span>
                          : <span className="kb-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="kb-empty">
                      {isLoading ? 'Chargement…' : 'Aucun client ne correspond à la recherche.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="modal-footer kb-footer">
          <span className="kb-footer-hint">
            {filtered.length} / {knowledge.count} affichés · source : export Salesforce hebdomadaire « Report results (New Technical Information Report) »
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>
  )
}
