# Seed Web App (UI compacte)

Application web locale pour peupler rapidement iObeya avec des appels prêts à l'emploi.

## Lancement

```bash
cd "/home/bvarisellaz/Assistant Pro/ReactApp/QAobeya"
./scripts/start-seed-webapp.sh ./.env
```

URL:

- `http://localhost:8787`

Contrôle service local:

```bash
./scripts/seed-webappctl.sh start
./scripts/seed-webappctl.sh status
./scripts/seed-webappctl.sh logs
./scripts/seed-webappctl.sh stop
```

Port custom:

```bash
SEED_WEBAPP_PORT=8790 ./scripts/start-seed-webapp.sh ./.env
```

## Fonctions

- Scan dynamique:
  - domaines
  - rooms par domaine
  - boards par room (boards invalides ignorés)
- Création ciblée:
  - user
  - room dans le domaine sélectionné
  - board dans la room sélectionnée (clonage d'un board source)
  - notes par défaut injectées dans le board créé
- Génération rapide:
  - lot users + rooms + boards + notes

## API interne (backend UI)

- `GET /api/config`
- `POST /api/config`
- `GET /api/health`
- `GET /api/domains`
- `GET /api/rooms?domainId=...`
- `GET /api/boards?roomId=...`
- `POST /api/create-user`
- `POST /api/create-room`
- `POST /api/create-board`
- `POST /api/quick-populate`

## Notes

- Auth: username/password admin ou PAT token.
- Le backend évite le clonage depuis un board avec `id` vide.
- L'application est pensée pour usage local de test (pas d'auth UI propre).
