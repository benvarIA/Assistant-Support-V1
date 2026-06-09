# Support Assistant — CLAUDE.md

## What this is

Support ticketing assistant that bridges Outlook emails with Jira. It automates the 4-step treatment of support emails: **Identification → Créer (ticket Jira) → Tracer (sync email thread) → Clôturer**.

Target users: support team processing customer emails in Outlook and routing them to Jira.

---

## Tech stack

- **React 19 + TypeScript 5.9** — `App.tsx` orchestrates state/API; UI split into components + hooks
- **Vite 7** — dev server with the backend API mounted as a Vite plugin (`server/plugin.ts`), port 5199
- **Pure CSS** — no UI library, no Tailwind; styles split into `src/styles/*.css`, aggregated by `App.css`

---

## UI layout (single screen)

The app is **one screen**, no tabs (the old "Tickets & Jira" / "Traitement" tabs were merged):

- **`EmailSidebar`** (left) — the live overview of "Pris" threads. Each row shows a derived
  **status pill** (À traiter → Identifié → Ticket créé → En cours → Analysé / Analyse en échec),
  an optional **nature chip** (Assistance / Intervention / Information / Question), the Jira key,
  and client badges.
- **`EmailDetail`** (right, the "fiche") — header (status + nature + Jira pill), an **AI digest card**
  (renders the Codex `assistanceState.summary` as a daily-standup line; falls back to a neutral
  workflow hint when no analysis exists yet — never fabricates a status), the 4-step **workflow**
  (stepper + action buttons), the **treatment** action cards (open Livraison/Administration/Assistance
  modals), and an **analysis-history timeline** (per-run, expandable, with a structured report).

Derived view-state lives in **`src/derive.ts`** (`deriveEmailStatus`, `deriveNature`,
`parseReportSections`, …). Codex reports are rendered by **`src/components/AnalysisReport.tsx`**
(splits numbered sections "1. …", "2. …" into scannable blocks).

Selecting a thread calls `selectEmail()` → `treatment.resumeTreatment()` so the fiche reflects that
thread's persisted progress (and the sync effect writes back consistent data).

---

## Project structure

```
src/
  App.tsx               # State orchestration + API calls + modal wiring (single-screen composition)
  derive.ts             # Pure view-state derivation (status, nature, report parsing)
  types.ts              # Shared types (incl. AssistanceState.history: AssistanceRun[])
  constants.ts utils.ts # Constants + helpers
  main.tsx index.css    # Entry point + global resets/font
  components/
    TopNav EmailSidebar EmailDetail AnalysisReport WorkflowStepper KibaPanel ErrorBanner …
    modals/             # JiraTicketModal, TraceModal, TraceWorklogModal, CloseTicketModal, JiraValidationModal
    treatment/          # LivraisonModal (wraps KibaPanel), AdministrationModal, AssistanceModal
  hooks/                # useEmails, useTreatment, useTrace, useKiba, useAssistance, useMicrosoftAuth, useSettings
  styles/               # variables, layout, nav, buttons, forms, modals, workflow, status, treatment, kiba, detail, …
                        # all @import-ed by App.css

server/                 # Node API mounted by vite.config.ts (routes/ + services/)

data/
  client-deployment-jira-mapping.json  # 579 client mappings (Excel export)
  jira-clients-reference.json          # 406 active Jira client names (refreshed via API)
  treatments-progress.json             # Backend-persisted treatment state snapshot
  assistance-progress.json             # Backend-persisted assistance state (summary, reports, history)
  client-technical-info.json           # Client knowledge base (~378: name/setup/language/version/status)
  client-knowledge-meta.json           # KB metadata (updatedAt, latestVersion, source export, diff stats)

skills/
  jirayah/              # Jira ticket creation agent
  orochimaru/           # Email thread sync to Jira
  kiba/                 # Email/template support
  tsunade/              # Additional support
  roll-out-manager/     # Rollout coordination
  support-skill-creator/ # Skill dev utilities
```

---

## State management

**40+ `useState` hooks** — no external state library.

Treatment state (per email thread) is triple-persisted:
1. `useState` (in-memory, local to session)
2. `localStorage` (key: `support-assistant:treatments:v1`) — survives reload
3. `POST /api/treatments/save` with 300ms debounce — survives machine changes

On mount: backend state is merged over localStorage state (`normalizePersistedTreatments` resets in-flight flags like `isAnalyzing`).

State is keyed by `conversationId` (Graph email thread ID).

---

## Email threading

Emails are aggregated by `conversationId`. Per thread:
- **title** = subject of the **latest** email (stripped of Re:/Fwd: prefixes via `stripReplyPrefixes`)
- **sender** = from the **oldest** email (original initiator)
- **jiraKey/jiraUrl** = from the **latest** email (most recent association)

---

## 4-step treatment workflow

```
[Identification] → [Créer] → [Tracer] → [Clôturer]
```

### Step 1 — Identification
- `POST /api/issue/identify` → returns `IdentificationCategory`
- Categories: `Assistance | Question | Intervention livraison | Intervention administration`
- User confirms/edits the category, clicks Valider → `isIdentificationValidated = true`
- Minimum display duration: `MIN_ANALYSIS_DURATION_MS = 1800ms`

### Step 2 — Créer (JiraYah)
- `POST /api/jirayah/propose` → returns `JiraProposal` (pre-filled form)
- Form: projectKey, issueType, subtype, client (with datalist autocomplete), summary, description, attachments
- `POST /api/jirayah/create` → creates ticket, returns `{ key, url }`
- On success: `window.location.reload()` to reset state

### Step 3 — Tracer (Orochimaru)
- `POST /api/trace/execute` → syncs missing emails as Jira comments chronologically
- On success: opens worklog modal (`isTraceWorklogModalOpen`)

### Step 4 — Clôturer
- Modal with worklog minutes input
- `POST /api/ticket/close` → archives emails (removes "PRIS" label), optionally logs time
- On success: removes treatment from state, reloads email list

---

## Jira validation flow

When loading emails, if an email has `jiraMatches` (high-confidence existing tickets) but no `jiraKey`, it enters `pendingJiraValidationQueue`. A modal prompts the user to confirm or dismiss each match.

`POST /api/jira/association/confirm` → links email to existing ticket.

---

## API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/emails/pris` | GET | Load "Pris"-labeled Outlook emails |
| `/api/issue/identify` | POST | AI categorize email |
| `/api/jirayah/propose` | POST | Propose Jira ticket |
| `/api/jirayah/create` | POST | Create Jira ticket |
| `/api/trace/execute` | POST | Sync email thread to Jira (Orochimaru) |
| `/api/ticket/close` | POST | Close ticket + archive emails |
| `/api/ticket/worklog` | POST | Add worklog to ticket |
| `/api/connect/jira` | POST | Jira login |
| `/api/connect/microsoft` | POST | Start Microsoft OAuth |
| `/api/connect/microsoft/status` | GET | Poll Microsoft login (1.5s interval) |
| `/api/jira/clients/refresh` | POST | Refresh client reference JSON |
| `/api/jira/association/confirm` | POST | Link email to existing Jira ticket |
| `/api/email/preview` | POST | Fetch email HTML preview |
| `/api/treatments` | GET | Load persisted treatment state |
| `/api/treatments/save` | POST | Save treatment state |
| `/api/clients/knowledge` | GET | Load client knowledge base (name/setup/language/version/status + meta) |
| `/api/clients/knowledge/refresh` | POST | Rebuild KB from the latest Salesforce export email (Graph) |
| `/api/clients/knowledge/latest-version` | POST | Set the iObeya version that `"latest"` resolves to |

---

## Key types

```typescript
type PrisEmailRow        // One row in the email list (aggregated thread)
type TreatmentProgress   // Full treatment state for one thread
type JiraProposal        // Pre-filled Jira ticket form data
type IdentificationCategory = 'Assistance' | 'Question' | 'Intervention livraison' | 'Intervention administration'
type JiraIssueMatch      // Candidate existing Jira ticket match with score
```

---

## Running the app

```bash
npm run dev      # Vite dev server (port configured in vite.config.ts)
npm run build    # TypeScript + Vite production build
npm run lint     # ESLint
```

---

## Critical behaviors to preserve

- `normalizePersistedTreatments` **must** reset `isAnalyzing`, `isProposingJira`, `isCreatingJira` to `false` on load — async calls can't survive a restart.
- `createJiraFromDraft` calls `window.location.reload()` on success — intentional hard reset.
- `loadPrisEmails` also removes invalidated treatments from state (when the backend signals `invalidatedThreadIds`).
- The Microsoft login uses a polling loop (`isMicrosoftLoginRunning` drives a `useEffect` with 1.5s intervals).
- `MIN_ANALYSIS_DURATION_MS = 1800` enforces a minimum UX delay during identification to avoid jarring instant transitions.
- Treatment state is debounced 300ms before saving to backend to avoid spamming on rapid state changes.
- The **client knowledge base** is refreshed by an in-process weekly scheduler (`clientKnowledgeScheduler.ts`, started once in `plugin.ts`'s `configureServer`): runs Sunday→Monday 00:00 local, with a startup catch-up if the KB is >7 days stale. The Salesforce export fetch needs the **local** Microsoft token, so this is intentionally in-process (not a cloud routine). `client-technical-info.json` stays a bare array (loader in `clientTechInfo.ts` is unchanged) — version is an optional additive field; metadata lives in the separate `client-knowledge-meta.json`.
- When listing email attachments via Graph, **do not** `$select` `contentId` on `/messages/{id}/attachments` — it 400s (not a property of the base `attachment` type). `clientKnowledge.ts` lists with a safe select; `fetchMessageAttachmentRefs` in `microsoft.ts` tolerates the 400 only via its MIME fallback.
