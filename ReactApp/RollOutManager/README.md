# RollOutManager

## Demarrage stable (port fixe)

Le serveur de dev est force sur:

- `host`: `0.0.0.0`
- `port`: `5173`
- `strictPort`: `true`

Commande:

```bash
npm run dev
```

## URL a ouvrir

Dans un environnement isole (VM/WSL/container), `127.0.0.1` peut ne pas pointer vers le serveur Vite.

Dans ce cas, ouvre l'URL reseau:

```text
http://<IP_ENV>:5173/
```

Exemple valide dans cet environnement:

```text
http://172.26.203.164:5173/
```

## Trouver l'URL rapidement

```bash
npm run dev:where
```

Cette commande affiche:

- URL locale: `http://127.0.0.1:5173`
- URL reseau: `http://<IP_ENV>:5173`
