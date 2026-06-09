# TODO — Support Assistant

---

## Contexte

L'application est structurée en **deux onglets** :
- **Tickets & Jira** — workflow existant (identification → créer → tracer → clôturer)
- **Traitement** — nouveau : actions sur un email (Livraison / Administration / Assistance)

L'onglet Traitement / Assistance est le cœur du nouveau système :
des agents spécialisés analysent un email support, produisent des rapports,
un agent consolide tout et propose un draft de réponse client.

---

## État d'avancement

### ✅ Terminé

| Phase | Description |
|-------|-------------|
| Phase 1 | Navigation deux onglets (Tickets & Jira / Traitement) |
| Phase 2 | `TreatmentPanel` — 3 boutons Livraison / Administration / Assistance |
| Phase 5e | Modèle de données `AssistanceState` + persistance (localStorage + backend) |
| Phase 5a | Sélection des agents, mode séquentiel/parallèle, config modèle+effort |

### 🔧 Bugs / fixes

| Fix | Fichier | Status |
|-----|---------|--------|
| Token Microsoft perdu au refresh | `skills/microsoft-365-workspace/scripts/ms_graph_cli.py` | ✅ |
| Label PRIS non retiré si erreur Jira lors clôture | `server/services/jira.ts` | ✅ |

---

## Skills existants (réutilisables)

| Skill | Emplacement | Usage actuel |
|-------|-------------|-------------|
| `tsunade` | `skills/tsunade/` | Identification email (catégorie) |
| `jirayah` | `skills/jirayah/` | Création ticket Jira |
| `orochimaru` | `skills/orochimaru/` | Sync email → commentaire Jira |
| `kiba` | `skills/kiba/` | Livraison de licence (email template) |
| `jira-workspace` | `../skills/jira-workspace/` | API Jira (CLI Python) |
| `microsoft-365-workspace` | `../skills/microsoft-365-workspace/` | API Graph / Outlook |

---

## Prochaine étape : Créer les agents d'Assistance

> **Principe :** chaque agent est un skill Codex invoqué via `codex exec`.
> Il reçoit un contexte (email, thread, ticket Jira, fichiers), produit un rapport texte.
> Routes génériques (déjà en place) : `POST /api/assistance/agents/:agentId/run` +
> `GET /api/assistance/agents/:runId/status` (polling). Registry : `server/services/assistanceAgents.ts`.

> ⚠️ **Contrainte d'architecture (vaut pour TOUS les agents) :** le sandbox de `codex exec`
> **n'a pas de réseau** (échec DNS). Aucun agent ne peut appeler une API/CLI réseau pendant son run.
> → **Node pré-charge** toute donnée réseau (REST Jira, Graph…) et l'embarque dans le prompt ;
> **Codex se limite au raisonnement**. Modèles de référence : `analyseTicket.ts`, `similarTickets.ts`.

---

## Phase 5-agents — Créer les 11 agents (dans cet ordre)

### Groupe A — Agents prompt-only (rapides à créer, pas de fichier)

#### 5-agents-1 : `analyse-ticket`
- **Base :** amélioration de `tsunade` — lire le thread email + ticket Jira associé
- **Input :** `conversationId`, `jiraKey`
- **Output :** état des lieux structuré (problème, contexte client, pistes, questions)
- **Config :** modèle (Opus/Sonnet/Haiku) + effort (low/medium/high)
- [x] Créer `skills/analyse-ticket/` (SKILL.md + prompt)
- [x] Route backend `POST /api/assistance/agents/analyse/run`

#### 5-agents-2 : `jira` — tickets similaires ✅
- **Architecture :** **Node fait la recherche, Codex juge** (le sandbox de `codex exec` n'a PAS
  de réseau — d'où le même pré-chargement que l'agent `analyse`). Node lit le ticket de référence,
  extrait des mots-clés (code), lance la recherche JQL multi-projets (`text ~`, exclut le ticket
  courant), score les candidats et lit les meilleurs (titre/description/commentaires/PJ) ; Codex
  classe, écarte les non-pertinents et extrait la résolution de chacun.
- **Effort = périmètre projets :** low = SUPIOBEYA · medium = + SUPNG · high = + IOBEXP + IOB.
- **Output :** JSON `{summary, report}` (sections numérotées, liens browse, transparence des écartés).
- [x] Service `server/services/similarTickets.ts` (recherche + scoring + lecture Node, jugement Codex)
- [x] Skill `skills/similar-tickets/` (SKILL.md — sources fournies, Codex juge)
- [x] Enregistrer `jira` dans `assistanceAgents.ts` (route `:agentId/run` déjà générique)
- [x] Front : lancement multi-agents généralisé + dial d'effort par agent (verrou `analyse`-only levé)
- [x] Bonus : commandes read-only `search` (JQL) + `issue get` ajoutées à `jira_cli.py` (comblent
      un manque de jira-workspace ; non utilisées par cet agent mais utiles ailleurs)

#### 5-agents-3 : Experts métier (4 agents, même pattern)
> Chacun est un skill Codex avec un prompt spécialisé + une base de connaissances intégrée.

- [ ] `skills/expert-dcm/` — Expert module DCM
- [ ] `skills/expert-qcd/` — Expert module QCD
- [ ] `skills/expert-addon-jira/` — Expert addon iObeya pour Jira
- [ ] `skills/expert-addon-ado/` — Expert addon iObeya pour Azure DevOps
- [ ] Route backend commune `POST /api/assistance/agents/:id/run` (générique)

---

### Groupe B — Agents analysant des fichiers

> **Décision (2026-06-09) :** source = **pièces jointes du ticket Jira** (Node les télécharge et
> pré-traite, contrainte réseau Codex). **Pas d'UI d'upload** pour l'instant (upload manuel = 2ᵉ
> itération éventuelle). Module partagé : `server/services/jiraAttachments.ts`
> (`downloadAttachmentBytes`, `extractAttachmentText`, `fetchIssue`…).

#### 5-agents-4 : `logs` — Analyseur de logs ✅
- **Source :** PJ du ticket (`.log` / `.out` / `.txt` / `.gz` / `.zip`).
- **Pipeline Node :** télécharge → décompresse (`zlib` pour `.gz`, `unzip` pour `.zip`) →
  pré-processeur (niveaux ERROR/WARN/SEVERE/FATAL, exceptions Java dédupliquées + extrait de stack,
  motifs d'erreurs récurrents normalisés, timeline) → digest compact. Codex diagnostique.
- **Output :** JSON `{summary, report}` — 1. Erreurs critiques · 2. Patterns · 3. Chronologie ·
  4. Cause racine · 5. Prochaine action.
- [x] `server/services/logAnalyzer.ts` + `skills/log-analyzer/SKILL.md`
- [x] Module partagé `jiraAttachments.ts` (réutilisé par har/systeme)
- [x] `logs` enregistré dans le registry + lançable/configurable dans `AssistanceModal`
- [x] Testé end-to-end (SUPIOBEYA-30584 : logs dans les ZIP → diagnostic purge/ClassCastException)

#### 5-agents-5 : `har-analyzer` ⏳
- **Input :** PJ HAR (`.har`, JSON) du ticket
- **Output :** requêtes en erreur (4xx/5xx), timeouts/lenteurs, chaînes de redirections, headers suspects
- [ ] Pré-processeur HAR Node (parse JSON → entrées en erreur/lentes) + `skills/har-analyzer/`
- [ ] Service `harAnalyzer.ts` + registry + lançable dans `AssistanceModal`

#### 5-agents-6 : `system-files` ⏳
- **Input :** fichier(s) système iObeya (format spécifique — **à documenter, exemple requis**)
- **Output :** infos serveur : version, config, modules activés, problèmes détectés
- [ ] Documenter le format des fichiers système iObeya (bloquant)
- [ ] Pré-processeur + `skills/system-files/` + service + registry

---

### Groupe C — Agent avec base documentaire

#### 5-agents-7 : `docs-iobeya` — Recherche documentation / FAQ
- **Approche :** RAG sur la documentation iObeya + guides troubleshooting
- **Input :** question / description du problème
- **Output :** extraits pertinents de la doc avec sources
- [ ] Inventorier les sources documentaires disponibles (Confluence ? PDF ? Markdown ?)
- [ ] Choisir approche : embedding + vector search, ou Codex avec docs en contexte
- [ ] Créer `skills/docs-iobeya/`
- [ ] Route backend `POST /api/assistance/agents/docs/run`

#### 5-agents-8 : `web-search` — Recherche internet
- **Approche :** Codex avec accès web (via tool `web_search`)
- **Input :** description du problème + mots-clés
- **Output :** synthèse des résultats pertinents avec sources
- [ ] Créer `skills/web-search/`
- [ ] Route backend `POST /api/assistance/agents/web/run`

---

## Phase 5b — Exécution des agents + rapports

> **Dépend de :** Phase 5-agents (au moins le Groupe A terminé pour commencer)

- [ ] Route générique backend `POST /api/assistance/agents/:agentId/run`
  - Reçoit : `{ conversationId, jiraKey, config: { model, effort } }`
  - Lance `codex exec` avec le skill correspondant
  - Retourne un `runId` pour polling
- [ ] Route `GET /api/assistance/agents/:runId/status` — polling résultat
- [ ] `AssistanceModal` : après "Lancer l'analyse", afficher le panneau d'exécution
  - Spinner + statut par agent (pending / running / done / error)
  - **Mode séquentiel** : exécution un par un, bouton "Continuer" / "Arrêter ici" après chaque agent
  - **Mode parallèle** : tous en simultané, indicateurs individuels
- [ ] Chaque agent terminé → rapport affiché dans une `AgentReportCard` (accordion)
- [ ] Les rapports sont sauvegardés dans `AssistanceState.reports`

---

## Phase 5c — Consolidation

- [ ] Bouton "Consolider" (visible quand ≥ 1 rapport terminé)
- [ ] Agent de consolidation (Codex) — agrège tous les rapports en synthèse
- [ ] Affichage de la synthèse dans la modale
- [ ] Bouton "Relancer avec la consolidation" — réinjecte la synthèse comme contexte
- [ ] Bouton "Valider" → passe à 5d

---

## Phase 5d — Proposition d'email client

- [ ] Agent de rédaction (Codex) — génère un draft email à partir de la synthèse
- [ ] Textarea modifiable avec le draft généré
- [ ] Bouton "Copier" (dans le presse-papier)
- [ ] Enregistrement dans `AssistanceState.emailDraft`

---

## Phase 3 — Action : Livraison

> `skills/kiba/` existe déjà — à connecter à `LivraisonModal`

- [ ] Connecter `LivraisonModal` au skill `kiba` existant
- [ ] Reprendre le flow de `KibaPanel` (actuellement dans l'onglet Tickets & Jira)
- [ ] Décider si `KibaPanel` reste dans l'onglet Tickets & Jira ou migre dans Traitement

---

## Phase 4 — Action : Administration

- [ ] Définir le périmètre du skill Administration (reset mot de passe, ajout utilisateur, etc.)
- [ ] Créer `skills/administration/`
- [ ] Connecter `AdministrationModal`

---

## Phase 6 — Réutilisabilité (futur)

- [ ] **Résumé daily meeting** : agréger les `AssistanceState.summary` de la journée
- [ ] Les agents sont conçus comme modules réutilisables hors contexte email

---

## Architecture technique

### Nouveaux composants UI

```
src/components/treatment/
  LivraisonModal.tsx       ✅ stub
  AdministrationModal.tsx  ✅ stub
  AssistanceModal.tsx      ✅ sélection agents + config
  AgentReportCard.tsx      ← Phase 5b
  ConsolidationPanel.tsx   ← Phase 5c
```

### Routes API

```
GET  /api/assistance                        ✅ load store
POST /api/assistance/save                   ✅ save store
POST /api/assistance/agents/:agentId/run    ← Phase 5b
GET  /api/assistance/agents/:runId/status   ← Phase 5b
```

### Skills à créer

```
skills/
  analyse-ticket/     ← Phase 5-agents-1
  jira-search/        ← Phase 5-agents-2
  expert-dcm/         ← Phase 5-agents-3
  expert-qcd/         ← Phase 5-agents-3
  expert-addon-jira/  ← Phase 5-agents-3
  expert-addon-ado/   ← Phase 5-agents-3
  log-analyzer/       ← Phase 5-agents-4
  har-analyzer/       ← Phase 5-agents-5
  system-files/       ← Phase 5-agents-6
  docs-iobeya/        ← Phase 5-agents-7
  web-search/         ← Phase 5-agents-8
```
