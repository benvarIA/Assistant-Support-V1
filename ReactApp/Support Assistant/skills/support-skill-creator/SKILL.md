---
name: support-skill-creator
description: Design or update support-operation skills for the external analyzer app. Use when the user wants to define a new support case workflow, challenge a proposed support skill, or standardize inputs, guardrails, resources, structured outcomes, and human validation rules before implementation.
---

# Support Skill Creator

Use this skill to design one support skill at a time for the future analyzer application.

## Assistant Pro Rule

For Assistant Pro support/analyzer skills, always use this custom skill creator workflow.
Do not use the generic Codex `skill-creator` skill to create or design these skills.

## Workflow

1. Read `references/skill-template.md`.
2. Start from one concrete support case, not a generic family.
3. Challenge the requested design before writing anything:
   - reject a skill split that is too broad or too narrow;
   - reject automation that lacks validation boundaries;
   - reject hidden assumptions about email replies, production actions, or external rights.
4. Produce a skill definition with these sections only:
   - `name`
   - `purpose`
   - `trigger`
   - `out_of_scope`
   - `preconditions`
   - `inputs`
   - `resources`
   - `playbook`
   - `stop_conditions`
   - `guardrails`
   - `human_validation`
   - `structured_outcome`
   - `orchestrator_signals`
5. Keep the skill reusable:
   - encode stable workflow and rules;
   - move volatile business data to resources;
   - call out missing resources explicitly.
6. If a step changes customer data, production configuration, access rights, or sends a client-facing reply, require explicit validation unless the user states otherwise.
7. End with:
   - the proposed skill definition;
   - open risks or missing resources;
   - the minimum next step to make the skill executable.

## Mandatory Preconditions

- Jira access is always required at least in read mode, because the analyzer must be able to inspect the current ticket before acting.

## Design Rules

- Prefer a router plus a few strong skills over many overlapping skills.
- A skill must own one operational intent. If two branches have different permissions or validation rules, split them.
- Do not hide business rules in prose. Put them under `stop_conditions`, `guardrails`, `human_validation`, or `orchestrator_signals`.
- Do not invent external APIs that do not exist yet.
- Do not assume the analyzer may answer the customer automatically unless that right is explicitly granted.
- Do not ask the skill to update Jira directly.
- Do not ask the skill to estimate or compute time spent.

## When To Split A Skill

Split when at least one of these is true:

- different support teams or permissions;
- different business references or templates;
- different approval requirements;
- different success criteria.

## Output Style

- Be concrete.
- Prefer operational wording over architecture talk.
- If the proposed skill is weak, say why and replace it with a better shape.
