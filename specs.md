# Assistant Support V1 — Specs techniques, UI/UX & fonctionnelles

> Suite d'outils d'assistance au support client : traitement automatisé des emails Outlook → Jira, gestion de déploiements (RollOut Manager), et outillage QA (QAobeya). Conçue pour une équipe support gérant des tickets clients.

**Date de rédaction :** 2026-06-03
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

### 2.7 Skills internes
| Skill | Rôle |
|---|---|
| `jirayah` | Création de tickets Jira |
| `orochimaru` | Sync thread email → Jira |
| `kiba` | Support email / templates |
| `tsunade` | Support complémentaire |
| `roll-out-manager` | Coordination déploiements |
| `analyse-ticket` | Analyse et qualification |
| `support-skill-creator` | Utilitaires de création de skills |

### 2.8 Idées / backlog (Todo)
- [ ] Skill **FAQ** — réponse automatique aux questions fréquentes
- [ ] Skill **JiraSearch** — recherche dans Jira depuis l'app
- [ ] Skill **Log Analyser** — analyse de logs clients
- [ ] Skill **API** — appels API clients
- [ ] Skill **Livraison Licence** — automatisation livraison
- [ ] Skill **Analyseur de problème sur Internet** — research web
- [ ] Skill **SQL Request Builder** — génération de requêtes SQL
- [ ] Refonte **UI/UX** (plus belle, plus pratique)

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
| `jira-workspace` | Accès et opérations Jira |
| `microsoft-365-workspace` | Emails Outlook via Graph API |
| `panda` | (à documenter) |

---

## 6. Scripts de lancement

`scripts/` contient les scripts de démarrage de la suite :
- `launch-assistant-pro.sh`, `start-and-open-assistant-pro.sh` (macOS)
- `start-and-open-assistant-pro-windows.sh` (Windows)
- `connectors.sh` (connexion aux intégrations)
- `assistant-pro.desktop` (raccourci Linux)
