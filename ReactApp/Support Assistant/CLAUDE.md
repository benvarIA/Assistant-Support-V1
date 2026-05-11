# Support Assistant — CLAUDE.md

## What this is

Support ticketing assistant that bridges Outlook emails with Jira. It automates the 4-step treatment of support emails: **Identification → Créer (ticket Jira) → Tracer (sync email thread) → Clôturer**.

Target users: support team processing customer emails in Outlook and routing them to Jira.

---

## Tech stack

- **React 19 + TypeScript 5.9** — monolithic `App.tsx` component (~2000 lines)
- **Vite 7** — dev server with proxy to backend API
- **Pure CSS** — no UI library, no Tailwind; all styling in `App.css`

---

## Project structure

```
src/
  App.tsx          # Entire UI + all state + all API calls
  App.css          # All component styles
  index.css        # Global resets + font
  main.tsx         # React entry point

data/
  client-deployment-jira-mapping.json  # 579 client mappings (Excel export)
  jira-clients-reference.json          # 406 active Jira client names (refreshed via API)
  treatments-progress.json             # Backend-persisted treatment state snapshot

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
