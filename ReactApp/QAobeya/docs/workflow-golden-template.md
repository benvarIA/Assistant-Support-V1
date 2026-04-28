# Workflow Golden Template (iObeya 4.43)

Objectif: installer une fois une instance vide fonctionnelle, la figer, puis recréer rapidement la même base propre.

## A. Créer le template (one-shot)

1. Préparer `.env` et l'instance:

```bash
./scripts/new-instance-env.sh
./scripts/prepare-instance.sh ./.env
```

2. Lancer et initialiser DB (quand tu seras prêt à exécuter réellement):

```bash
docker compose --env-file ./.env -f docker/docker-compose.iobeya.yml up -d
# puis commande Liquibase fournie par scripts/init-db.sh
```

3. Vérifier iObeya vide fonctionnelle (UI + login admin + DB OK).

4. Capturer le seed:

```bash
./scripts/capture-seed.sh ./.env iobeya443-empty
```

## B. Réutiliser le template

1. Détruire runtime courant:

```bash
./scripts/destroy-instance.sh ./.env
```

2. Restaurer depuis seed:

```bash
./scripts/restore-from-seed.sh ./.env iobeya443-empty
```

3. Relancer:

```bash
docker compose --env-file ./.env -f docker/docker-compose.iobeya.yml up -d
```

Remarque: la DB seed est injectée via `docker-entrypoint-initdb.d` seulement si le volume DB est vide.
