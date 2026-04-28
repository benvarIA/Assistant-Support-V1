# Jira REST Notes

## Authentification

Jira Cloud API: Basic auth avec email + API token.

Header:
- `Authorization: Basic base64(email:api_token)`
- `Accept: application/json`
- `Content-Type: application/json`

## Endpoints utilises

- Verifier auth utilisateur:
  - `GET /rest/api/3/myself`
- Creer ticket:
  - `POST /rest/api/3/issue`
- Editer ticket:
  - `PUT /rest/api/3/issue/{issueKey}`
- Supprimer ticket:
  - `DELETE /rest/api/3/issue/{issueKey}`
- Creer projet:
  - `POST /rest/api/3/project`
- Ajouter commentaire:
  - `POST /rest/api/3/issue/{issueKey}/comment`

## Notes ADF

Les champs texte de Jira Cloud v3 (description, commentaire) utilisent Atlassian Document Format (ADF).
Le script convertit automatiquement un texte brut en ADF minimal.

## Limitations usuelles

- La creation de projet peut exiger des droits admin Jira.
- Selon la configuration du site, la creation de projet peut requerir des champs additionnels.
- La suppression de ticket depend des permissions du projet.
