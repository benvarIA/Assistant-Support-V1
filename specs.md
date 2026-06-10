# Assistant Support V1 — Specs techniques, UI/UX & fonctionnelles

> Suite d'outils d'assistance au support client : traitement automatisé des emails Outlook → Jira, gestion de déploiements (RollOut Manager), et outillage QA (QAobeya). Conçue pour une équipe support gérant des tickets clients.

**Date de rédaction :** 2026-06-03
**Dernière MAJ :** 2026-06-10 — dossier `Persistant/` à la racine pour les tokens/configs (voir §7) ; base de connaissances clients (export Salesforce hebdo → langue / type d'install / version, voir §2.10) + agents d'Assistance (Phase 5) + agent « Tickets Jira similaires »
**Statut :** Fonctionnel (V1 en production interne)
**Périmètre :** 3 sous-apps + skills/agents internes

---

## 1. Sous-applications

| Dossier | Nom | Rôle |
|---|---|---|
| `ReactApp/Support Assistant/` | **Support Assistant** | Application principale — traitement emails → Jira |
| `ReactApp/RollOutManager/` | **RollOutManager** | Suivi et coordination des déploiements |
| `ReactApp/QAobeya/` | **QAobeya** | Déployeur rapide iObeya (Docker / Tomcat / MySQL) |

---

## 2. Support Assistant (app principale)

### 2.1 Contexte & Problème
L'équipe support reçoit des emails clients dans **Outlook**, doit créer les tickets **Jira** correspondants, synchroniser le thread email dans le ticket, puis clôturer. Ce workflow en 4 étapes est répétitif et sujet aux erreurs. **Support Assistant** l'automatise via agents CLI internes (skills).

### 2.2 Stack
- React 19 + TypeScript · Vite 7 · CSS pur (pas de Tailwind/UI lib) · monolithe `App.tsx` (~2000 lignes)
- Backend Express (proxy + persistance) · `data/` JSON

### 2.3 Workflow — 4 étapes

```
[Identification] → [Créer] → [Tracer] → [Clôturer]
```

| Étape | Description | Skill / Agent |
|---|---|---|
| **1 — Identification** | `POST /api/issue/identify` → catégorie de l'email | — |
| **2 — Créer** | Création ticket Jira depuis l'email | `jirayah` |
| **3 — Tracer** | Sync du thread email dans le ticket Jira | `orochimaru` |
| **4 — Clôturer** | Clôture du ticket + email de confirmation | `kiba` + `tsunade` |

**Catégories d'identification :** `Assistance · Question · Intervention livraison · Intervention administration`

### 2.4 Agrégation des emails par thread
- Emails groupés par `conversationId` (Graph API)
- `title` = sujet du **dernier** email (sans Re:/Fwd:)
- `sender` = expéditeur du **premier** email (initiateur original)
- `jiraKey/jiraUrl` = depuis le **dernier** email

### 2.5 Gestion d'état
- **40+ `useState`** hooks — pas de bibliothèque externe
- Triple persistance par thread (`conversationId`) :
  1. `useState` (in-memory)
  2. `localStorage` (clé `support-assistant:treatments:v1`)
  3. `POST /api/treatments/save` (debounce 300ms) — survit aux changements de machine
- Au montage : état backend **mergé** sur localStorage, flags in-flight (`isAnalyzing`) réinitialisés

### 2.6 Données de référence
- `data/client-deployment-jira-mapping.json` — 579 mappings clients (export Excel)
- `data/jira-clients-reference.json` — 406 noms de clients Jira actifs (rafraîchi via API)
- `data/client-technical-info.json` — **base de connaissances clients** (~378 fiches : nom,
  type d'install, langue support, statut plateforme, **version**), rafraîchie depuis l'export
  Salesforce (voir §2.10)
- `data/client-knowledge-meta.json` — métadonnées de la base (date de MAJ, version iObeya « latest »,
  source de l'export, stats du dernier rafraîchissement)

### 2.7 Skills internes
| Skill | Rôle |
|---|---|
| `jirayah` | Création de tickets Jira |
| `orochimaru` | Sync thread email → Jira |
| `kiba` | Support email / templates |
| `tsunade` | Support complémentaire |
| `roll-out-manager` | Coordination déploiements |
| `analyse-ticket` | Analyse d'un ticket Jira (champs + commentaires + PJ) → diagnostic |
| `similar-tickets` | Jugement de similarité + extraction de résolution (agent `jira`, voir §2.9) |
| `support-skill-creator` | Utilitaires de création de skills |

### 2.8 Idées / backlog (Todo)
- [ ] Skill **FAQ** — réponse automatique aux questions fréquentes
- [~] Skill **JiraSearch** — partiellement livré : commandes read-only `search`/`issue get` sur
  `jira_cli.py` + agent d'Assistance `jira` (tickets similaires, voir §2.9)
- [ ] Skill **Log Analyser** — analyse de logs clients
- [ ] Skill **API** — appels API clients
- [ ] Skill **Livraison Licence** — automatisation livraison
- [ ] Skill **Analyseur de problème sur Internet** — research web
- [ ] Skill **SQL Request Builder** — génération de requêtes SQL
- [ ] Refonte **UI/UX** (plus belle, plus pratique)

### 2.9 Système d'agents d'Assistance (Phase 5)

Au-delà du workflow 4 étapes, l'écran de traitement propose une action **Assistance** : un panel
(`AssistanceModal`) où l'on sélectionne des **agents** spécialisés, un **mode d'exécution**
(séquentiel / parallèle) et, par agent configurable, un **modèle** + un **effort**. Chaque agent
produit un rapport ; l'historique des runs est conservé par thread (`AssistanceState.history`).

**Contrainte d'architecture clé (vaut pour TOUS les agents) :** `codex exec` tourne dans un
**sandbox sans réseau**. Aucun agent ne peut appeler une API/CLI réseau pendant son exécution.
→ **Node pré-charge** toute donnée réseau (REST Jira, Graph…) puis l'embarque dans le prompt ;
**Codex se limite au raisonnement** (analyse / jugement / rédaction). Routes génériques :
`POST /api/assistance/agents/:agentId/run` + `GET /api/assistance/agents/:runId/status` (polling).
Registry : `server/services/assistanceAgents.ts`.

**Agents (11 prévus) :**

| Agent | ID | Statut | Notes |
|---|---|---|---|
| Analyse ticket | `analyse` | ✅ | Lit ticket Jira + commentaires + PJ (`analyse-ticket`) |
| Tickets Jira similaires | `jira` | ✅ | Voir ci-dessous |
| Analyseur de logs | `logs` | ✅ | PJ du ticket (.log/.out/.txt/.gz/.zip), pré-traité par Node, voir ci-dessous |
| Experts métier (DCM, QCD, addon Jira, addon ADO) | `dcm` `qcd` `addon-jira` `addon-ado` | ⏳ | Prompt expert + base de connaissances |
| Recherche internet | `web` | ⏳ | |
| Docs iObeya / FAQ | `docs` | ⏳ | RAG documentation |
| Analyseur HAR / fichiers système | `har` `systeme` | ⏳ | Source = PJ du ticket Jira (pas d'upload) |

**Agent `jira` — Tickets Jira similaires :**
- **Skill :** `similar-tickets` (les sources sont fournies dans le prompt ; Codex juge, classe, écarte, extrait la résolution).
- **Pipeline Node :** lit le ticket de référence → extrait mots-clés (code) → recherche JQL `text ~`
  en **OR** (Jira fait un AND sur `text ~ "a b c"`) sur le périmètre → score par recouvrement de
  tokens → lecture approfondie des ~8 meilleurs (titre/description/commentaires/PJ).
- **Effort = périmètre projets :** `low` = SUPIOBEYA · `medium` = + SUPNG · `high` = + IOBEXP + IOB.
- **Sortie :** JSON `{summary, report}`, sections numérotées, liens browse, candidats écartés explicités.

**Agent `logs` — Analyseur de logs :**
- **Source :** pièces jointes du ticket (`.log` / `.out` / `.txt` / `.gz` / `.zip`) — **pas d'upload**.
- **Pipeline Node :** télécharge les PJ → décompresse (`zlib` gz, `unzip` zip) → pré-processeur
  (niveaux, exceptions Java dédupliquées + extrait de stack, motifs d'erreurs récurrents, timeline)
  → digests compacts ; Codex diagnostique (erreurs critiques, patterns, chronologie, cause racine, action).
- **Module partagé :** `server/services/jiraAttachments.ts` (téléchargement + extraction des PJ),
  réutilisé par les futurs agents `har` / `systeme`.

---

### 2.10 Base de connaissances clients (Salesforce → langue / type d'install / version)

Source de vérité sur **qui est le client** : sa **langue** de communication, son **type
d'installation** et sa **version** iObeya. Sert à fiabiliser l'identification client, la langue de
l'email (Kiba) et le type de déploiement (JiraYah), et reste consultable à la demande.

**Source — export Salesforce quotidien.** L'utilisateur reçoit chaque jour ~07:00 l'email
**« Report results (New Technical Information Report) »** (qu'il archive automatiquement). C'est une
pièce jointe `.xlsx` (~378 clients actifs, statut ≠ Closed) avec 4 colonnes : `Technical Information:
Name`, `Set up`, `Support Language`, `Status of the platform` (Solid / Downsell / Churn).

**Routine hebdomadaire (pas quotidienne).** Planificateur **in-process** (`clientKnowledgeScheduler.ts`,
démarré une fois au boot via `configureServer`) :
- exécution **chaque nuit de dimanche à lundi à 00:00 local** (« dimanche soir à minuit ») ;
- **rattrapage au démarrage** si la base date de plus de 7 jours (app éteinte le dimanche) ;
- **bouton manuel** « Rafraîchir depuis Salesforce » dans l'UI.
> ⚠️ Le fetch nécessite le token Microsoft **local** → routine in-process (et non une routine cloud).

**Pipeline Node** (`clientKnowledge.ts`, aucune dépendance externe) :
1. recherche du **dernier** email d'export (Graph `$search` sur toute la boîte + requête explicite du
   dossier **Archive**, tri `receivedDateTime` desc) ;
2. téléchargement de la PJ `.xlsx` via `/$value` (`$select` **sans** `contentId` — propriété absente
   du type de base `attachment`, sinon HTTP 400) ;
3. **lecteur XLSX maison** (ZIP via `zlib.inflateRawSync` + parsing XML par regex, chaînes « inline ») ;
4. **en-têtes auto-détectés par nom** → une future colonne `Version` serait captée sans toucher au code ;
5. **dérivation de version** : explicite si présente, sinon `latest` pour les setups **hébergés**
   (Online, Online Dedicated, Mutualised\*, NextGen) et `null` pour **Onsite** (version non fournie →
   l'assistant la demande à l'utilisateur le cas échéant) ;
6. écriture de `client-technical-info.json` (+ `client-knowledge-meta.json`), diff added/modified/removed.

**Résolution de « latest ».** `meta.latestVersion` (défaut `4.43`, éditable depuis l'UI) donne le
numéro affiché pour les plateformes hébergées.

**Exploitation par l'assistant** (`lookupClientTechInfo` / `lookupClientTechInfoAll`) :
- enrichissement des emails → badges **langue / setup / version / statut** sur la fiche ;
- bloc « RÉFÉRENTIEL CLIENT » (`formatClientTechContext`) injecté dans le prompt **JiraYah**
  (pattern « Node pré-charge, Codex raisonne ») ;
- override haute confiance du `clientType`/langue côté **Kiba** (inchangé) ;
- **modal « Base clients »** (TopNav) : table cherchable (nom / install / langue / version / statut),
  bouton de rafraîchissement, champ d'édition de la version « latest ».

**Routes :** `GET /api/clients/knowledge` · `POST /api/clients/knowledge/refresh` ·
`POST /api/clients/knowledge/latest-version`.

---

## 3. RollOutManager

### 3.1 Contexte
Outil de suivi et de coordination des déploiements produit auprès des clients.

### 3.2 Stack
- React (JSX) + Vite · port `5173` fixe (`strictPort: true`, host `0.0.0.0`)

### 3.3 Fonctionnalités (à spécifier)
- Tableau de bord des déploiements en cours
- Statut par client / version

---

## 4. QAobeya

### 4.1 Contexte
Déployeur rapide de l'application **iObeya 4.43** pour les sessions de QA. Cible : Ubuntu, Docker Compose, Tomcat 9 + JDK 21, MySQL 8.0. **1 seule instance active à la fois** (install → test → suppression).

### 4.2 Structure
```
docs/       → documentation
ops/        → scripts opérationnels
scenarios/  → scénarios de test
scripts/    → automatisation
seeds/      → données de test
templates/  → templates de config
tools/      → outillage
docker/     → Docker Compose
```

### 4.3 Fonctionnalités
- [ ] Déploiement rapide iObeya 4.43 via Docker Compose
- [ ] Scénarios de test automatisés
- [ ] Seeds de données pour les sessions QA
- [ ] Suppression propre de l'instance après les tests

---

## 5. Skills externes (dossier racine `skills/`)

| Dossier | Workspace |
|---|---|
| `jira-workspace` | Accès et opérations Jira via `jira_cli.py` : auth, issue create/edit/delete, comment, attachment, **+ read-only `search` (JQL) et `issue get`** |
| `microsoft-365-workspace` | Emails Outlook via Graph API |
| `panda` | (à documenter) |

---

## 7. Dossier `Persistant/` (tokens & configs locaux)

Dossier à la **racine du projet** (`/Persistant/`) — exclu du git (`.gitignore`), jamais versionné.
Contient les credentials persistants entre les sessions et les redémarrages de l'app.

| Fichier | Rôle |
|---|---|
| `jira_config.json` | URL Jira, email et API token (`base_url`, `email`, `api_token`) |
| `m365_config.json` | App registration Microsoft 365 (`client_id`, `tenant_id`) |
| `m365_token.json` | Token OAuth M365 (access + refresh, expiry) — renouvelé automatiquement |
| `jirayah_thread_jira_map.json` | Cache de correspondance thread email ↔ clé Jira (créé à la 1ère exécution) |

Ces chemins sont centralisés dans [`ReactApp/Support Assistant/server/config.ts`](ReactApp/Support%20Assistant/server/config.ts) via la constante `PERSISTANT_DIR`.

> Pour se (re)connecter : bouton **Jira** ou **Microsoft** dans l'UI → `scripts/connectors.sh login jira|outlook` → écrit dans ce dossier.

---

## 6. Scripts de lancement

`scripts/` contient les scripts de démarrage de la suite :
- `launch-assistant-pro.sh`, `start-and-open-assistant-pro.sh` (macOS)
- `start-and-open-assistant-pro-windows.sh` (Windows)
- `connectors.sh` (connexion aux intégrations)
- `assistant-pro.desktop` (raccourci Linux)
