---
name: analyse-ticket
description: Analyze an existing Jira support ticket from Jira only — issue fields, comments, and attachments — and produce a structured support diagnosis with next action.
---

# Analyse Ticket

Use this skill only when a Jira ticket already exists and is the single source of truth.

## Mandatory sources

- Jira ticket fields
- Jira comments
- Jira attachments

## Forbidden sources

- Outlook email thread
- assumptions not grounded in Jira content

## Expected output

Produce a structured analysis that covers:

1. Résumé du problème
2. Contexte / historique du ticket
3. Ce qui a déjà été tenté
4. Constats tirés des commentaires
5. Constats tirés des pièces jointes
6. Hypothèses
7. Blocages / informations manquantes
8. Prochaine action recommandée

## Guardrails

- Be explicit when an attachment is unreadable or only partially readable.
- Do not invent product facts.
- Prefer actionable support reasoning over generic summaries.
