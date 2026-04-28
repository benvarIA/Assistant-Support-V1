# Seed Agent iObeya (users, rooms, contenu)

Ce mini agent peuple rapidement une instance iObeya 4.43 en utilisant:

- écriture: endpoints admin (`/admin/user/save-user.action`, `/admin/room/save-room.action`)
- lecture/validation: gluecode (`/s/j/gluecode/*`)

## 1. Configuration

Ajouter dans `.env`:

```bash
IOBEYA_BASE_URL=http://localhost:8080
IOBEYA_LOGIN_PATH=/j_spring_security_check

IOBEYA_ADMIN_USERNAME=admin
IOBEYA_ADMIN_PASSWORD=admin

# Optionnel
IOBEYA_PAT_TOKEN=
IOBEYA_SEED_DRY_RUN=false
IOBEYA_ROOM_MAX_BOARDS=40
IOBEYA_ROOM_MAX_USERS=200
```

## 2. Commandes

Health check:

```bash
node tools/seed-agent/app.mjs health --env .env
```

Exécuter le scénario de démo:

```bash
node tools/seed-agent/app.mjs run-demo --env .env
```

Exécuter un scénario personnalisé:

```bash
node tools/seed-agent/app.mjs run --scenario scenarios/demo-instance.json --env .env
```

Requête custom:

```bash
node tools/seed-agent/app.mjs custom --method GET --path /s/j/gluecode/domains --env .env
```

## 3. Ce que fait le scénario

- crée des utilisateurs
- crée des rooms
- vérifie que chaque room existe
- crée des boards métier dans chaque room (clonage d'un board template)
- injecte du contenu visible dans chaque board créé (notes d'action/risque/décision)
- vérifie le contenu minimal de chaque room

## 4. Format scénario

Voir `scenarios/demo-instance.json`.

Champs principaux:

- `users`: `username`, `firstname`/`firstName`, `lastname`/`lastName`, `email`
- `rooms`: `name`, `description`, optionnels `maximumBoards`, `maximumUsers`, `modelId`
- `customRequests`: appels HTTP additionnels

## 5. Notes

- iObeya refuse les emails en `.local` sur ce setup; utiliser des emails valides (`example.com`, etc.).
- l'affectation fine des membres/permissions de room n'est pas encore automatisée dans ce script.
