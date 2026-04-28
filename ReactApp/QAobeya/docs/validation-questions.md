# Questions de validation avant premier run iObeya (mode instance unique)

1. URL finale d'accès
- ex `http://localhost:8080` (test local) ou FQDN dédié

2. Ports
- valider HTTP `8080` et MySQL `3306` pour ce flux
- en cas de conflit ponctuel, ajuster ces 2 valeurs dans `.env`

3. Secrets
- mode de stockage: `.env` local (V1) validé ?
- politique de mots de passe (longueur/rotation)

4. JDBC driver
- conserver `MariaDB Connector/J` (souvent recommandé iObeya)
- ou forcer MySQL Connector/J si standard interne

5. Exploitation
- chemins de backup DB et des dossiers `/var/iobeya/*`
- rétention des logs (`log4j2` à ajuster)

6. Réseau et sécurité
- exposition locale uniquement ou accessible LAN
- HTTPS immédiat (reverse proxy) ou phase 2

7. Inputs à fournir au moment du run
- chemin exact du package extrait (`IOBEYA_PACKAGE_DIR`)
- chemin du fichier licence
