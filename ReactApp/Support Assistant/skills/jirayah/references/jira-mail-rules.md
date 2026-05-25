# Jira Mail Rules (JiraYah)

## Fixed Jira Mapping

- Default project: `SUPIOBEYA` (`projectId=10200`)
- Issue types:
  - `Assistance` (`10161`)
  - `Intervention` (`12`)
  - `Bug` (`1`) - do not use by default
  - `Information` (`11`)
  - `Incident` (`10106`)
- Fields:
  - `Client name` (`customfield_11500`) - allowed values fetched live
  - `Type de déploiement` (`customfield_12413`) - required for `Assistance`
  - `Type d'intervention` (`customfield_11605`) - required for `Intervention`
  - `Type d'info` (`customfield_11607`) - required for `Information`
  - `summary`, `project`, `reporter` - required

## Subtype Option IDs

### Type de déploiement (`customfield_12413`)

- `Onsite` (`15917`)
- `Online` (`15918`)
- `Mutualisée (Team+, Team, Partners)` (`15919`)
- `TO BE DEFINED` (`18119`)

### Type d'intervention (`customfield_11605`)

- `Setup` (`10847`)
- `Update` (`10848`)
- `Administration` (`10849`)
- `Exploitation` (`15475`)
- `License delivery` (`15847`)

### Type d'info (`customfield_11607`)

- `Fonctionnelle` (`10853`)
- `Technique` (`10854`)
- `Business` (`15242`)

## Classification Rules

### Assistance

- Mother rule: demande d'aide/accompagnement, remontee de bug possible ou avere.
- Subtype decision:
  - `Onsite`: client on-premise.
  - `Online`: plateforme dediee ou NextGen (Enterprise, Trial).
  - `Mutualisee`: Team, Team+, Partner, Demo, NextGen Team.
  - `TO BE DEFINED`: deployment mode unknown.

#### Referentiel technique client (`client-technical-info.json`)

Le referentiel mappe les noms clients vers leur mode de deploiement reeel. Il a priorite sur toute inference par contexte email.

| Valeur referentiel (Set up)        | Jira `customfield_12413`          |
|------------------------------------|-----------------------------------|
| Onsite                             | Onsite                            |
| Online Dedicated                   | Online                            |
| Mutualised TEAMPLUS                | Mutualisée (Team+, Team, Partners)|
| Mutualised TEAM                    | Mutualisée (Team+, Team, Partners)|
| Mutualised PARTNERS                | Mutualisée (Team+, Team, Partners)|
| Online NextGen - Enterprise        | Online                            |
| Online NextGen - Team              | Mutualisée (Team+, Team, Partners)|
| Online NextGen - Trial             | Online                            |

Le referentiel donne aussi la langue de support (`French` / `English`) — utiliser pour adapter les messages et commentaires Jira si necessaire.

### Intervention

- Mother rule: action operationnelle executee cote support/run.
- Subtype decision:
  - `Setup`: aide installation (rare).
  - `Update`: aide mise a jour (rare).
  - `Administration`: actions admin (users, rooms, admin changes).
  - `Exploitation`: demandes exploitation (souvent liees IOBEXP).
  - `License delivery`: livraison/renouvellement/ajustement licence.

### Information

- Mother rule: simple demande d'information.
- Subtype decision:
  - `Fonctionnelle`
  - `Technique`
  - `Business`

### Incident

- Mother rule: service degrade/panne en production.

### Bug

- Reserved only for explicit instruction; avoid default use.

## Client Inference Rule (Priority)

- If the main sender is iObeya (internal sender), do **not** infer `Client name` from that sender.
- In that case, infer the client from:
  1) email content (subject + body), then
  2) other non-iObeya senders in the thread.
- If still ambiguous, keep top candidates and require user validation before creation.

## Payload Construction Rules

- `Summary`: subject of selected thread without rewrite.
- `Description`: first chronological client message only.
- Stop copied content at first signature marker `FirstName LastName`.
- Do not add narrative, reformulation, or extra synthetic sections.
- Preserve meaningful line breaks; use compact ADF with `hardBreak`.

## Confirmation Rules

Before creation, always display and confirm:

- `Client name`
- `Issue type`
- subtype value
- `Summary`

If confidence is low, show top client candidates and ask user to choose.

## Creation Defaults

- `project`: `SUPIOBEYA` unless explicit user override
- `reporter`: current Jira user
- `assignee`: current Jira user

## Attachment Rules

- Carry relevant troubleshooting files from selected email/thread.
- If archive is present (e.g. zip), extract and attach useful raw log/file when possible.
- Ignore noisy inline images unless explicitly requested.

## Email Reply to Jira Comment

- Content: reply body only, until signature marker.
- Exclude quoted thread history and footer blocks.
- Prefix first line with `<Prénom Nom de l'expéditeur> :`, then a line break.
- Preserve compact line breaks in ADF.
- Preserve inline images.
- Attach message attachments to Jira; when archive is provided, attach useful extracted raw log/file when possible.
