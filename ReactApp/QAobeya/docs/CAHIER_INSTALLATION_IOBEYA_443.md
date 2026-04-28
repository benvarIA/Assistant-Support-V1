# Cahier d'installation et d'exploitation - iObeya On-Prem (Docker, Tomcat, MySQL)

## 1. Objectif
Ce document décrit l'installation opérationnelle d'une instance iObeya en conteneurs Docker (Tomcat + MySQL), ainsi que la façon de l'exploiter et de la diagnostiquer.

Etat cible validé:
- iObeya accessible sur `http://localhost:8080`
- licence installée via l'interface d'administration
- stack persistée côté hôte dans `instances/iObeya443-temp`

## 2. Stack technique
- OS hôte: Ubuntu/WSL
- Conteneur application: `tomcat:9.0-jdk21-temurin`
- Conteneur base de données: `mysql:8.0.42`
- Java: JDK 21
- Orchestration: Docker Compose

## 3. Répertoires et organisation de données
Répertoire projet:
- `/home/bvarisellaz/Assistant Pro/ReactApp/QAobeya`

Instance active:
- `instances/iObeya443-temp`

Organisation retenue côté runtime `/var/iobeya`:
- `/var/iobeya/assets`
- `/var/iobeya/data`
- `/var/iobeya/logs`
- `/var/iobeya/settings`

Règle d'usage:
- éléments jetables ou régénérables dans `/var/iobeya/data` (index, temp, cache)
- éléments à conserver dans `assets`, `logs`, `settings`

## 4. Fichiers de configuration clés
- Environnement: `.env`
- Compose: `docker/docker-compose.iobeya.yml`
- Context Tomcat: `instances/iObeya443-temp/tomcat/conf/ROOT.xml`
- Log4j2: `instances/iObeya443-temp/app/settings/log4j2.xml`
- Driver JDBC: `instances/iObeya443-temp/tomcat/lib/mysql-connector-java.jar`

## 5. Paramètres JVM appliqués (Step 6)
`CATALINA_OPTS` est aligné avec les options validées, incluant:
- `-Xms3072m`
- `-Xmx4096m`
- `-XX:MaxMetaspaceSize=512m`
- `-XX:+UseParallelGC`
- série `--add-opens` Java 9+ (java.base/java.io/java.lang/java.net/java.security/java.text/java.time/java.util, etc.)

Validation au démarrage:
- vérifier les lignes `Command line argument` dans les logs Tomcat

## 6. Fonts (Step 6)
Pour éviter l'erreur `No font found with familyName Arial`, les fontes Arial sont fournies:
- source Windows: `C:\Windows\Fonts\arial*.ttf`
- montage conteneur: `/usr/local/share/fonts/iobeya`

Validation:
- `fc-list | grep -i arial` dans le conteneur Tomcat

## 7. Démarrage / arrêt / statut
Depuis le répertoire projet:

Démarrer:
```bash
docker compose --env-file ./.env -f docker/docker-compose.iobeya.yml up -d
```

Arrêter:
```bash
docker compose --env-file ./.env -f docker/docker-compose.iobeya.yml down
```

Statut:
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

## 8. Accès application
- application: `http://localhost:8080`
- administration: `http://localhost:8080/admin`

Licence:
- déjà installée sur cette instance

## 8bis. Connexion Docker et accès opérationnel
Si la session Linux n'a pas encore les droits Docker actifs:
```bash
newgrp docker
```

Lister les conteneurs:
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Entrer dans le conteneur Tomcat:
```bash
docker exec -it iObeya443-temp-tomcat bash
```

Entrer dans le conteneur MySQL:
```bash
docker exec -it iObeya443-temp-mysql bash
```

Se connecter à MySQL dans le conteneur:
```bash
mysql -uroot -p
```

Montages utiles dans Tomcat:
- `/var/iobeya/webapp`
- `/var/iobeya/assets`
- `/var/iobeya/data`
- `/var/iobeya/logs`
- `/var/iobeya/settings`
- `/usr/local/tomcat/conf/Catalina/localhost/ROOT.xml`

Vérifier les montages exacts:
```bash
docker inspect iObeya443-temp-tomcat --format '{{range .Mounts}}{{println .Destination " <- " .Source}}{{end}}'
```

Localiser les identifiants en cours:
- fichier: `.env`
- clés DB: `MYSQL_ROOT_PASSWORD`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`

Valeurs actuellement en place pour cette instance:
- `MYSQL_DATABASE=iobeya`
- `MYSQL_USER=iobeya`
- `MYSQL_PASSWORD=changeMeIobeya`
- `MYSQL_ROOT_PASSWORD=changeMeRoot`

## 9. Logs et diagnostic
Logs conteneurs:
```bash
docker logs --tail 200 iObeya443-temp-tomcat
docker logs --tail 120 iObeya443-temp-mysql
```

Logs applicatifs (dans le conteneur Tomcat):
```bash
docker exec iObeya443-temp-tomcat sh -lc 'tail -n 200 /var/iobeya/logs/app.log'
docker exec iObeya443-temp-tomcat sh -lc 'grep -n "ERROR\|SEVERE\|Exception\|Caused by" /var/iobeya/logs/app.log | tail -n 120'
```

Signaux de démarrage correct:
- `--Plugin Framework has been successfully started--`
- absence d'erreur bloquante dans `app.log`

## 10. Initialisation base (Liquibase)
Commande type utilisée:
```bash
docker run --rm --network iObeya443-temp-net \
  -v "/mnt/c/var/iobeya/liquibase:/liquibase" -w /liquibase \
  eclipse-temurin:21-jre \
  java -jar /liquibase/iobeya-sql-changelog.jar \
  --defaultsFile=/liquibase/mysql/liquibase.properties \
  --url="jdbc:mysql://mysql:3306/iobeya?createDatabaseIfNotExist=true&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC" \
  --username="root" --password="<MYSQL_ROOT_PASSWORD>" update
```

## 11. Vérifications finales recommandées
- `curl -I http://localhost:8080/`
- `curl -I http://localhost:8080/admin`
- ouverture navigateur sur `/` et `/admin`
- contrôle des jobs de démarrage dans `app.log`

## 12. Points d'attention pour un autre agent
- conserver la cohérence version package/config/plugins
- ne pas écraser `lib` Tomcat complet avec un bind mount: monter uniquement le driver JDBC
- garder `ROOT.xml` et `log4j2.xml` alignés avec les chemins Linux Docker
- en cas d'erreur fonts, vérifier d'abord Arial
- diagnostiquer prioritairement via `/var/iobeya/logs/app.log`
