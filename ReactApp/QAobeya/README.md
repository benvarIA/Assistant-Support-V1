# iObeya 4.43 Deployer Scaffold (Tomcat + MySQL + Docker)

Ce repo est une **préparation** du déployeur rapide iObeya.
Aucune installation n'est lancée automatiquement.

## Cible validée

- iObeya: `4.43`
- OS hôte: Ubuntu
- Runtime: Docker Compose
- App server: Tomcat 9 + JDK 21
- DB: MySQL 8.0 (interne à la stack)
- Mode: **1 seule instance active à la fois** (install, test, suppression)

## Fichiers créés

- `docker/docker-compose.iobeya.yml`: stack Docker paramétrée par `.env`
- `.env.example`: variables d'instance
- `templates/ROOT.xml.tpl`: template Tomcat context iObeya
- `templates/log4j2.xml.tpl`: template logs
- `scripts/check-prereqs.sh`: vérifie les outils locaux (sans installer)
- `scripts/new-instance-env.sh`: génère le fichier `.env` (instance unique)
- `scripts/prepare-instance.sh`: prépare arborescence + rend les templates + copie webapp
- `scripts/init-db.sh`: imprime la commande d'init DB Liquibase (ne l'exécute pas)
- `scripts/capture-seed.sh`: capture un template (`seeds/<name>`) depuis une instance vide fonctionnelle
- `scripts/restore-from-seed.sh`: restaure l'instance depuis un template
- `scripts/destroy-instance.sh`: supprime runtime (containers + volume DB)

## Préparation d'une instance (sans run)

1. Vérifier prérequis locaux:

```bash
./scripts/check-prereqs.sh
```

2. Générer le `.env`:

```bash
./scripts/new-instance-env.sh
```

3. Éditer `.env`:

- `IOBEYA_PACKAGE_DIR`
- `ROOT_AUTHORIZE_URI`
- `ROOT_TOKEN_URI`
- secrets MySQL

4. Préparer les fichiers d'instance:

```bash
./scripts/prepare-instance.sh ./.env
```

5. Valider la configuration Compose sans lancer:

```bash
docker compose --env-file ./.env -f docker/docker-compose.iobeya.yml config
```

6. Obtenir la commande d'init DB (affichage uniquement):

```bash
./scripts/init-db.sh ./.env
```

## Structure attendue du package iObeya

`IOBEYA_PACKAGE_DIR` doit contenir au moins:

- `iobeya/`
- `liquibase/`
- `ROOT.xml`
- `log4j2.xml`

## Questions bloquantes avant exécution réelle

- URL finale d'accès (FQDN) pour renseigner `ROOT_AUTHORIZE_URI` / `ROOT_TOKEN_URI`
- stratégie secrets (mot de passe root DB et user DB)
- choix du driver JDBC final (MySQL vs MariaDB Connector/J)
- chemin exact package/licence sur l'hôte

## Workflow recommandé: Golden Template

Voir: `docs/workflow-golden-template.md`

- créer 1 fois une instance vide fonctionnelle
- la capturer en seed (`seeds/iobeya443-empty`)
- restaurer cette base propre à chaque nouveau besoin

## Seed Agent (peuplement rapide)

Un agent léger est disponible pour créer rapidement des users, rooms et contenu (boards + notes) via les endpoints admin/API internes (compatible 4.43), avec vérification via gluecode:

- script: `tools/seed-agent/app.mjs`
- scénario prêt à l'emploi: `scenarios/demo-instance.json`
- documentation: `docs/seed-agent.md`

Exemple:

```bash
node tools/seed-agent/app.mjs run-demo --env .env
```

## Seed Web App (UI compacte)

Interface web locale pour:

- scanner domaines / rooms / boards
- créer user, room, board + notes
- lancer une génération rapide en lot

Lancement:

```bash
./scripts/start-seed-webapp.sh ./.env
```

Gestion start/stop:

```bash
./scripts/seed-webappctl.sh start
./scripts/seed-webappctl.sh status
./scripts/seed-webappctl.sh stop
```

Puis ouvrir: `http://localhost:8787`

Doc: `docs/seed-webapp.md`
