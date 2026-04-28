---
name: microsoft-365-workspace
description: Connexion et pilotage d'un compte Microsoft 365 via Microsoft Graph pour gérer le calendrier (consulter, creer, modifier, supprimer des evenements), Outlook (rechercher, archiver, categoriser, lister par categorie, creer des brouillons) et SharePoint/OneDrive (creer et deplacer dossiers/fichiers). Utiliser ce skill quand l'utilisateur demande des operations sur agenda, emails Outlook ou fichiers SharePoint.
---

# Microsoft 365 Workspace

## Vue d'ensemble

Utiliser ce skill pour executer des operations Microsoft 365 de facon reproductible via Microsoft Graph. Le script principal est `scripts/ms_graph_cli.py`.

## Prerequis

1. Creer une App Registration Azure AD (public client) et autoriser le flux Device Code.
2. Configurer les variables d'environnement:
   - `M365_CLIENT_ID` (optionnel si deja enregistre dans `./codex/persistant/token/m365_config.json`)
   - `M365_TENANT_ID` (optionnel, par defaut `common`)
3. Si les variables ne sont pas presentes, le script demande les valeurs interactives et les enregistre automatiquement dans `./codex/persistant/token/m365_config.json` avec le token dans `./codex/persistant/token/m365_token.json`.
4. Pour changer ce chemin, definir `M365_PERSIST_DIR` (ou directement `M365_CONFIG_CACHE` et `M365_TOKEN_CACHE`).
5. Accorder les permissions deleguees minimales:
   - `User.Read`
   - `offline_access`
   - `Calendars.ReadWrite`
   - `Mail.ReadWrite`
   - `MailboxSettings.Read`
   - `Sites.ReadWrite.All`
   - `Files.ReadWrite.All`

## Workflow rapide

1. Authentifier le compte:
```bash
python3 scripts/ms_graph_cli.py auth login
```
2. Verifier le token:
```bash
python3 scripts/ms_graph_cli.py auth status
```
3. Executer la commande metier (agenda, mail, SharePoint).

## Taches Agenda

- Lister les evenements:
```bash
python3 scripts/ms_graph_cli.py calendar list --top 25
```
- Creer un evenement:
```bash
python3 scripts/ms_graph_cli.py calendar create \
  --subject "Point equipe" \
  --start "2026-03-05T09:00:00" \
  --end "2026-03-05T09:30:00" \
  --timezone "Europe/Paris"
```
- Modifier un evenement:
```bash
python3 scripts/ms_graph_cli.py calendar update --event-id <EVENT_ID> --subject "Nouveau sujet"
```
- Supprimer un evenement:
```bash
python3 scripts/ms_graph_cli.py calendar delete --event-id <EVENT_ID>
```

## Taches Outlook

- Rechercher des emails:
```bash
python3 scripts/ms_graph_cli.py mail search --query "from:contoso.com facture"
```
- Archiver un email:
```bash
python3 scripts/ms_graph_cli.py mail archive --message-id <MESSAGE_ID>
```
- Ajouter une categorie:
```bash
python3 scripts/ms_graph_cli.py mail add-category --message-id <MESSAGE_ID> --category "Finance"
```
- Lire les emails d'une categorie:
```bash
python3 scripts/ms_graph_cli.py mail list-category --category "Finance"
```
- Mettre en brouillon:
```bash
python3 scripts/ms_graph_cli.py mail draft --to "destinataire@example.com" --subject "Brouillon" --body "Texte"
```
- Exporter un email en package Jira (corps wiki + pieces jointes + images inline telechargees):
```bash
python3 scripts/ms_graph_cli.py mail jira-package \
  --message-id <MESSAGE_ID> \
  --output-dir /tmp/jira-mail
```

## Taches SharePoint / OneDrive

- Rechercher des sites:
```bash
python3 scripts/ms_graph_cli.py sharepoint list-sites --query "projet"
```
- Lister les drives d'un site:
```bash
python3 scripts/ms_graph_cli.py sharepoint list-drives --site-id <SITE_ID>
```
- Creer un dossier:
```bash
python3 scripts/ms_graph_cli.py sharepoint create-folder --site-id <SITE_ID> --drive-id <DRIVE_ID> --name "NouveauDossier"
```
- Televerser un fichier:
```bash
python3 scripts/ms_graph_cli.py sharepoint upload-file --site-id <SITE_ID> --drive-id <DRIVE_ID> --local-path ./rapport.pdf
```
- Deplacer un dossier/fichier:
```bash
python3 scripts/ms_graph_cli.py sharepoint move-item --site-id <SITE_ID> --drive-id <DRIVE_ID> --item-id <ITEM_ID> --new-parent-id <PARENT_ID>
```

## References

Lire `references/microsoft-graph.md` pour les details d'API, permissions et payloads.
