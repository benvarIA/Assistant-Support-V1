---
name: orochimaru
description: Update an existing Jira ticket by synchronizing missing Outlook email replies as Jira comments, preserving formatting, inline images, and attachments. Use when a Jira ticket already exists and the user wants ticket update / reply sync only (no ticket creation).
---

# Orochimaru

Use this skill to keep an existing Jira ticket up-to-date from its Outlook email thread.

## Workflow

1. Validate prerequisites:
   - Jira read/write access is available.
   - Outlook Graph read access is available.
2. Require an existing Jira ticket (`jiraKey` or ticket URL).
3. Resolve the source email thread linked to this ticket:
   - first with explicit metadata (thread/message ids);
   - fallback with subject candidates + content verification;
   - never rely on subject only when duplicates exist.
4. Compare last traced Jira comment vs last email reply in thread.
5. Build chronological queue of missing replies (oldest -> newest).
6. For each missing reply, add one Jira comment:
   - first line: `<Prénom Nom de l'expéditeur> :`
   - then line break and body content.
7. Keep only reply content until signature marker, excluding quoted history/footer.
8. Preserve compact ADF line breaks, inline images, and attachments.
9. Return summary: traced count, skipped count, attachment/image upload report.

## Comment Format Rules (Strict)

- One Jira comment per missing email reply.
- Start comment with exact first line: `<Prénom Nom de l'expéditeur> :`
- Then one line break, then only the useful reply body.
- Remove signatures, quoted history, and footer/legal blocks.
- Preserve meaningful line breaks in compact Jira ADF.
- Keep chronological posting order strictly (oldest missing -> newest missing).

## Guardrails

- Never create a new Jira issue.
- Never send or edit customer emails.
- Never silently skip comment/attachment upload failures.
- If thread resolution is ambiguous, stop and ask for human validation.
- Do not change ticket description/status/fields in this skill.
