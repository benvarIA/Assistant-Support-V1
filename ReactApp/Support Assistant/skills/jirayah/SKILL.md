---
name: jirayah
description: Create a Jira ticket from a selected Outlook email thread with strict support business rules and explicit user confirmation before creation. Use when the user wants JiraYah to propose Client name, Issue type, subtype, and Summary, then create the issue in Jira Cloud.
---

# JiraYah

Use this skill to transform one selected email thread into a validated Jira issue for support operations.

## Workflow

1. Read `references/jira-mail-rules.md` before proposing any classification or payload.
2. Validate prerequisites:
   - Outlook Graph read-only token available at `~/.config/codex/outlook_readonly_token.json` (or ask user for the correct path).
   - Jira credentials available via `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
3. Build source data from the selected thread:
   - `Summary`: subject of the selected thread (no rewrite).
   - `Description`: first chronological client message only, stop at first `FirstName LastName` signature marker.
   - Preserve meaningful line breaks in compact Jira ADF (`hardBreak`, no excessive blank spacing).
4. Fetch live `Client name` allowed values from Jira (`customfield_11500`), then propose:
   - `Client name`
   - `Issue type`
   - required subtype field (`Type de déploiement` / `Type d'intervention` / `Type d'info`)
   - `Summary`
5. If ambiguity exists (classification or client), ask user to choose before creation.
6. Wait for explicit user confirmation.
7. Create Jira issue with validated values and default project `SUPIOBEYA` unless user requests another.
8. Attach relevant troubleshooting files from email/thread; when archive is provided, attach useful extracted raw file instead of zip when possible.
9. Return Jira key, clickable URL, and a short recap of selected values.

## Scope Boundary (Strict)

- If the thread already has an existing Jira ticket, stop creation flow and hand off to `orochimaru` for comment synchronization.
- Do not perform trace/synchronization of follow-up replies.
- Do not update an already existing ticket body/status/comments.

## Guardrails

- Never write, send, or edit emails; mailbox access is read-only.
- Never create Jira without explicit user confirmation.
- Never default to a previous ticket `Client name`; infer from current email first.
- If fixed Jira IDs from reference become invalid, stop and ask user before refreshing mappings.
- Avoid non-essential inline image attachments unless user explicitly asks.
- Ticket update / reply synchronization are out of scope for this skill (delegate to `orochimaru`).
