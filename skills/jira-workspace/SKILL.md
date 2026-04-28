---
name: jira-workspace
description: Connexion et pilotage de Jira via API REST avec stockage persistant des identifiants dans ./.codex/persistant/token. Utiliser ce skill quand l'utilisateur veut creer, modifier ou supprimer un ticket Jira, creer un projet Jira, ou ajouter des commentaires sur un ticket.
---

# Jira Workspace

## Vue d'ensemble

Utiliser ce skill pour gerer Jira de facon reproductible via API REST. Le script principal est `scripts/jira_cli.py`.

## Prerequis

1. Avoir un compte Jira Cloud et un token API Atlassian.
2. Permissions Jira adaptees:
   - Ticket: creation, edition, suppression selon droits projet.
   - Projet: droits d'administration Jira pour creation de projet.
3. Stockage persistant par defaut:
   - `./.codex/persistant/token/jira_config.json`

## Initialisation

```bash
python3 scripts/jira_cli.py auth setup
```

Le script demande si besoin:
- URL Jira (`https://<tenant>.atlassian.net`)
- Email Atlassian
- API token

Il enregistre ces informations dans `./.codex/persistant/token/jira_config.json`.

## Verifier la connexion

```bash
python3 scripts/jira_cli.py auth status
```

## Tickets

- Creer un ticket:
```bash
python3 scripts/jira_cli.py issue create \
  --project-key SUPNG \
  --summary "Sujet du ticket" \
  --description "Description" \
  --issue-type Task
```

- Editer un ticket:
```bash
python3 scripts/jira_cli.py issue edit \
  --issue-key SUPNG-123 \
  --summary "Nouveau sujet" \
  --description "Nouvelle description"
```

- Supprimer un ticket:
```bash
python3 scripts/jira_cli.py issue delete --issue-key SUPNG-123
```

## Projets

- Creer un projet:
```bash
python3 scripts/jira_cli.py project create \
  --key DEMO \
  --name "Projet Demo" \
  --project-type software
```

## Commentaires

- Ajouter un commentaire:
```bash
python3 scripts/jira_cli.py comment add \
  --issue-key SUPNG-123 \
  --body "Commentaire depuis le skill"
```

- Ajouter un commentaire en wiki (utile pour `!image.png!` inline):
```bash
python3 scripts/jira_cli.py comment add \
  --issue-key SUPNG-123 \
  --format wiki \
  --body "Alice :\n\nTexte\n\n!capture.png!"
```

- Uploader des pieces jointes:
```bash
python3 scripts/jira_cli.py attachment add \
  --issue-key SUPNG-123 \
  --file /tmp/jira-mail/capture.png \
  --file /tmp/jira-mail/log.txt
```

- Poster un package email->Jira (upload + commentaire wiki en une commande):
```bash
python3 scripts/jira_cli.py comment add-from-package \
  --issue-key SUPNG-123 \
  --package-json /tmp/jira-mail/jira_package_<MESSAGE_ID>.json
```

- Consolider les commentaires en double (dry-run puis suppression):
```bash
python3 scripts/jira_cli.py comment consolidate-duplicates --issue-key SUPNG-123
python3 scripts/jira_cli.py comment consolidate-duplicates --issue-key SUPNG-123 --apply
```

## Variables optionnelles

- `JIRA_PERSIST_DIR` pour changer le dossier de persistance.
- `JIRA_CONFIG_CACHE` pour changer le fichier config explicitement.
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` pour surcharge ponctuelle.

## References

Lire `references/jira-rest.md` pour details d'endpoints et prerequis.
