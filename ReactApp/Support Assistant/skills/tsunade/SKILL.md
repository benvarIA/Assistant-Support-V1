---
name: tsunade
description: Analyze step-1 support emails and classify the demand category before Jira creation. Use when the user needs the first-pass identification among Assistance, Question, Intervention livraison, and Intervention administration.
---

# Tsunade

Use this skill for **step 1 only**: fast and strict demand identification from an email.

## Classification Output (mandatory)

- `Assistance`
- `Question`
- `Intervention livraison`
- `Intervention administration`

## Rules

- Focus on request intent from subject + body.
- `Intervention administration`: admin/run actions (users, rooms, rights, settings).
- `Intervention livraison`: license delivery/renewal/adjustment.
- `Question`: information request only.
- `Assistance`: all other help/support cases.

## Guardrails

- Return only the identification result with confidence/warnings.
- Do not propose Jira payload fields here.
- Do not create, update, or trace Jira tickets in this skill.
