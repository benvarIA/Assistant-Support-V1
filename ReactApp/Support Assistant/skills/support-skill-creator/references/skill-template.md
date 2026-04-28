# Support Skill Template

Use this template as the target shape for every analyzer skill.

## Template

```md
name: <skill-name>

purpose:
- What concrete support problem this skill solves

trigger:
- Which case should route here
- Which nearby cases must not route here

out_of_scope:
- Cases this skill must refuse

preconditions:
- Jira access available in read mode at minimum
- What must exist before execution starts

inputs:
- jiraKey
- threadId
- initialEmail
- fullThread
- attachments
- identifiedCategory
- extra business context if available

resources:
- business procedures
- templates
- product references
- known constraints

playbook:
1. Validate prerequisites
2. Read the business resources needed for this case
3. Extract the facts needed to act
4. Decide whether the case is actionable, solvable, or blocked
5. Execute the allowed steps
6. Return a structured outcome

stop_conditions:
- Missing information
- Risky or unauthorized action
- Missing business procedure
- Ambiguous customer or scope

guardrails:
- Forbidden actions
- Stop conditions
- Cases that must escalate

human_validation:
- What requires approval before action
- What requires approval before reply to the customer
- What may be done automatically

structured_outcome:
- treatment_status
- summary
- actions_taken
- actions_pending
- blocking_reason
- needs_human_validation
- reply_draft if allowed

orchestrator_signals:
- solved_or_not
- blocked_or_not
- missing_information
- urgency_level if relevant
- confidence_level
- trace_items
```

## Review Checklist

Reject or rewrite the skill if:

- it mixes two different operational intents;
- it lacks explicit stop conditions;
- it assumes rights the analyzer does not have;
- it depends on business knowledge that is not listed under `resources`;
- it cannot be tested from a single real ticket example.

## First Skills To Prefer

Start with high-signal cases:

1. licence delivery
2. administration request
3. simple information request

Avoid edge cases until the router and update model are stable.
