# Microsoft Graph Notes

## Permissions deleguees recommandees

- `User.Read`
- `offline_access`
- `Calendars.ReadWrite`
- `Mail.ReadWrite`
- `MailboxSettings.Read`
- `Sites.ReadWrite.All`
- `Files.ReadWrite.All`

## Endpoints utilises

### Authentification (Device Code)
- `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode`
- `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`

### Agenda
- `GET /me/calendarView?startDateTime=...&endDateTime=...`
- `POST /me/events`
- `PATCH /me/events/{event-id}`
- `DELETE /me/events/{event-id}`

### Outlook Mail
- `GET /me/messages?$search="..."`
- `POST /me/messages/{id}/move`
- `PATCH /me/messages/{id}` (categories)
- `GET /me/messages?$filter=categories/any(c:c eq 'Category')`
- `POST /me/messages` (brouillon)

### SharePoint / OneDrive
- `GET /sites?search={query}`
- `GET /sites/{site-id}/drives`
- `POST /sites/{site-id}/drives/{drive-id}/items/{parent-id}/children` (creer dossier)
- `PUT /sites/{site-id}/drives/{drive-id}/items/{parent-id}:/{name}:/content` (upload petit fichier)
- `PATCH /sites/{site-id}/drives/{drive-id}/items/{item-id}` (deplacement via parentReference)

## Bonnes pratiques

- Toujours afficher les IDs (`site-id`, `drive-id`, `item-id`, `message-id`, `event-id`) apres creation pour les operations suivantes.
- Utiliser les categories Outlook exactes (sensibles a la casse dans les filtres selon locataire).
- Pour gros fichiers SharePoint, remplacer l'upload simple par upload session (`createUploadSession`).
