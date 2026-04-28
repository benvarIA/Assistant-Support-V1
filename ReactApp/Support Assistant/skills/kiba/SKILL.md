---
name: kiba
description: Deliver a client license from an existing Jira ticket by identifying the customer context, validating client type, delivery type, and language, selecting the correct delivery template, replacing variables including the license application table, and creating an Outlook draft after human validation. Use for license delivery, renewal, new room, or new client delivery workflows; never use for incident resolution, generic support replies, Jira creation, or automatic email sending.
---

# Kiba

name: Kiba

purpose:
- Livrer une licence client à partir d'une clé Jira existante.
- Préparer un email de livraison client dans Outlook, sans envoi automatique.
- Sélectionner le bon template de livraison selon le type de client, le type de livraison et la langue validés par l'utilisateur.

trigger:
- Utiliser quand l'utilisateur fournit une clé Jira et demande une livraison de licence client.
- Router ici les cas de livraison, renouvellement, nouvelle salle, nouveau client, ou ajout/ajustement de licence.
- Ne pas router ici une demande d'assistance incident, une simple question, une demande d'administration, ou une synchronisation Jira/Outlook.

out_of_scope:
- Création initiale du ticket Jira.
- Clôture ou mise à jour du ticket Jira.
- Envoi automatique d'email au client.
- Réponse de résolution d'incident/problème.
- Génération d'une licence si le système métier ou la procédure de génération n'est pas explicitement disponible.
- Modification de droits client, configuration de production, contrat, offre commerciale, ou données de licence sans validation humaine explicite.

preconditions:
- Jira access available in read mode at minimum.
- Une clé Jira existante est fournie par l'utilisateur.
- Le ticket Jira contient ou permet de déduire le nom du client, le contexte commercial, l'email/thread source, et les informations de licence.
- Le document template est disponible: `skills/kiba/assets/SUP-900 - [SUPPORT] TEMPLATES - Livraison aux clients 👍🏻.docx`.
- Le script Outlook est disponible: `skills/kiba/scripts/outlook_draft.py`.
- Outlook authentication is available; run `python3 skills/kiba/scripts/outlook_draft.py login` only if authentication is missing.

inputs:
- jiraKey
- threadId if available
- messageId of the client email if available
- initialEmail
- fullThread
- attachments
- identifiedCategory: `Intervention livraison`
- customerName extracted from Jira
- customerEmail or recipient list
- commercial/order-form context if available
- validatedClientType: `ON-SITE` | `ONLINE dédié` | `Mutualisée`
- validatedDeliveryType: `Renouvellement` | `Nouvelle salle` | `Nouveau client`
- validatedLanguage: `FR` | `EN`

resources:
- Jira ticket content and attachments.
- Outlook source email/thread when available.
- Template document: `skills/kiba/assets/SUP-900 - [SUPPORT] TEMPLATES - Livraison aux clients 👍🏻.docx`.
- Outlook draft script: `skills/kiba/scripts/outlook_draft.py`.
- Order form or commercial source document, if present and readable.
- Business mapping for template selection:
  - `ON-SITE + Renouvellement + EN` -> `2.1 ON-SITE [EN]`
  - `ON-SITE + Renouvellement + FR` -> `2.2 ON-SITE [FR]`
  - `ONLINE dédié|Mutualisée + Renouvellement + EN` -> `2.3 ONLINE (DEDICATED,TEAM,TEAM+,PARTNERS) [EN]`
  - `ONLINE dédié|Mutualisée + Renouvellement + FR` -> `2.4 ONLINE (DEDICATED,TEAM,TEAM+,PARTNERS) [FR]`
  - `Nouvelle salle` and `Nouveau client` -> choose the corresponding section in the same document according to language and hosting mode.

playbook:
1. Validate prerequisites:
   - confirm `jiraKey` is present;
   - read the Jira ticket;
   - preserve `jiraKey` for follow-up references;
   - extract customer name, request context, recipients, source email/thread metadata, order form, and license data candidates.
2. Infer, then request explicit user validation for:
   - `Type de client`: `ON-SITE`, `ONLINE dédié`, or `Mutualisée`;
   - `Type de livraison`: `Renouvellement`, `Nouvelle salle`, or `Nouveau client`;
   - `Langue`: `FR` or `EN`.
3. For each inferred value, show:
   - suggested value;
   - confidence level: `faible`, `moyen`, or `élevé`;
   - concise reason based on subject, content, offer type, recipients, and commercial context.
4. Stop until the user explicitly validates or corrects these three values. Do not select a template before this validation.
5. Select the template section automatically using the validated `Type de client` + `Type de livraison` + `Langue`. Do not ask for intermediate validation at this step.
6. Enforce template compatibility:
   - never use an ON-SITE template for `ONLINE dédié` or `Mutualisée`;
   - never use an ONLINE template for `ON-SITE` unless the user explicitly corrects the type.
7. Load the delivery template document and extract the selected section.
8. Replace variables using Jira/email/order-form data. Do not invent absent values.
9. Build `TABLEAU APP LICENCE`:
   - never leave the placeholder in the final message;
   - use the delivery email table as primary source;
   - confirm against the order form if readable;
   - locate the `License to create / Number of Rooms / Boards / Users` block;
   - map the first three numeric values found after the block in this order:
     - `License to create` -> `Salles`
     - `Number of Rooms` -> `Panneaux`
     - `Boards` -> `Utilisateurs`
   - ignore the source `Users` line if it has no associated value;
   - use `Non communiqué` for missing values.
10. For Outlook HTML, render `TABLEAU APP LICENCE` as a one-row HTML table:
    - columns: `Salles`, `Panneaux`, `Utilisateurs`;
    - header background `#DCEBFF`;
    - dark bold header text;
    - thin grey borders `#D0D7DE`;
    - padded cells;
    - keep surrounding template labels and replace only variables/placeholders.
11. Present the modified template before creating any draft:
    - show final subject and body;
    - display tables as Markdown or aligned readable text;
    - never show raw HTML tags in the chat preview.
12. Ask explicitly: `Valider le template modifié ?` with expected answers `oui` or `corriger`.
13. Stop until the user validates the modified template. If the user asks for corrections, update the preview and ask again.
14. After validation only, create an Outlook draft with polished HTML rendering:
    - for client license delivery, add `admin@iobeya.com` in BCC/CCi;
    - create a draft only; never send automatically;
    - prefer `reply-all` from the client source message when `messageId` is available;
    - otherwise create a new draft only if recipients are unambiguous.
15. Use Outlook commands:
    - login if needed: `python3 skills/kiba/scripts/outlook_draft.py login`
    - new draft: `python3 skills/kiba/scripts/outlook_draft.py draft --to "<email_client>" --bcc "admin@iobeya.com" --subject "<objet>" --body-file "<fichier_html>"`
    - reply-all: `python3 skills/kiba/scripts/outlook_draft.py reply-all --message-id "<id_message_client>" --bcc "admin@iobeya.com" --body-file "<fichier_html>"`
16. Return the structured outcome with the draft status and remaining human actions.

stop_conditions:
- Jira key missing or Jira ticket unreadable.
- Customer identity is ambiguous.
- Type de client, Type de livraison, or Langue not explicitly validated.
- Template document missing or selected section not found.
- Template/client type mismatch detected.
- Recipient list is ambiguous or customer email is missing.
- Required source message id is missing for a required reply-all flow and no safe fallback is approved.
- `TABLEAU APP LICENCE` cannot be built without leaving placeholders; use `Non communiqué` for missing individual values, but stop if the whole license scope is unclear.
- User has not validated the modified template preview.
- Outlook draft creation fails or authentication is unavailable.
- Any requested action would send the email, modify Jira, change production configuration, or alter customer rights without explicit authorization.

guardrails:
- Do not create, update, close, or comment Jira tickets from this skill.
- Do not send email automatically.
- Do not create an Outlook draft before the modified template is validated by the user.
- Do not select a template before the user validates client type, delivery type, and language.
- Do not expose raw HTML in the chat preview.
- Do not invent license quantities, recipients, contract data, or commercial context.
- Do not use incident-resolution BCC rules for license delivery; license delivery requires `admin@iobeya.com` in CCi/BCC.
- Do not add `admin@iobeya.com` for incident/problem resolution unless explicitly requested; such cases are normally out of scope for Kiba.
- Keep the final Outlook body in HTML unless the user explicitly requests plain text.

human_validation:
- Required before selecting template:
  - `Type de client`;
  - `Type de livraison`;
  - `Langue`.
- Required before Outlook draft creation:
  - final modified template, including subject and body.
- Required before any customer-facing send action; Kiba must not send.
- Required before using a fallback recipient/thread when source metadata is ambiguous.
- May be done automatically after validation:
  - template section selection;
  - variable replacement;
  - readable preview generation;
  - HTML file generation;
  - Outlook draft creation only.

structured_outcome:
- treatment_status: `draft_created` | `blocked` | `needs_validation` | `needs_correction`
- jiraKey
- customerName
- selected_client_type
- selected_delivery_type
- selected_language
- selected_template_section
- confidence_summary
- subject_preview
- body_preview
- actions_taken
- actions_pending
- blocking_reason
- needs_human_validation
- outlook_draft_id_or_status
- reply_draft if allowed

orchestrator_signals:
- solved_or_not
- blocked_or_not
- missing_information
- confidence_level
- trace_items:
  - jiraKey
  - customerName
  - selected template section
  - source message id if used
  - generated body file path if created
- urgency_level if relevant
