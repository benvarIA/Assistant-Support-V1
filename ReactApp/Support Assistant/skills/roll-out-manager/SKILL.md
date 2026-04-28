---
name: roll-out-manager
description: Organize, document, and update Roll-Out plans for product or support operations. Use when a user needs to define rollout scope, phases, milestones, owners, risks, communications, go/no-go criteria, or post-deployment follow-up, and when rollout knowledge must be persisted in project files for later access by an app.
---

# Roll-Out Manager

## Workflow

1. Gather rollout context from the user:
   - Rollout version
   - Rollout date
   - Rollout name and objective
   - Scope (features, teams, regions, customers)
   - Timeline and milestones
   - Owners and stakeholders
   - Risks, mitigations, dependencies
   - Communication plan
   - Validation checks and go/no-go criteria
   - Rollback strategy
2. Store and update the canonical rollout data in `references/rollout-knowledge.md`.
3. When asked, generate operational outputs from the stored data:
   - rollout checklist
   - meeting notes
   - status summary
   - launch-readiness report

## Data Rules

- Use concise, factual wording.
- Preserve existing sections when updating and append change date.
- Mark unknown items as `TBD` instead of guessing.
- Keep one canonical file unless the user asks for split files.

## Reference File

- Main storage file: `references/rollout-knowledge.md`
- Read this file first before proposing updates or summaries.
