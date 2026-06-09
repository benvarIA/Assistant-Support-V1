---
name: log-analyzer
description: From pre-extracted iObeya log digests (errors, exceptions, recurring patterns, timeline), produce a support diagnosis with root-cause hypothesis and next action. Use when a ticket has log files attached.
---

# Log Analyzer

À partir de **digests de logs déjà extraits et pré-analysés par l'application** (à partir des
pièces jointes du ticket : `.log`, `.out`, `.txt`, `.gz`, `.zip`), produire un diagnostic support.

## Sources (fournies dans le prompt)

Pour chaque fichier de log : nombre de lignes, compteurs de niveaux (ERROR/WARN/SEVERE/FATAL),
exceptions typées dédupliquées (type + occurrences + message + extrait de stack), messages ERROR
récurrents (motifs normalisés + occurrences), et la période couverte (premier → dernier timestamp).

Tout est dans le prompt : **aucun accès réseau ni commande**. L'app a fait l'extraction
(Node a le réseau et a décompressé/parsé les fichiers ; ce contexte non).

## Méthode

1. Identifier les **erreurs critiques** : exceptions graves (NPE, timeouts, OOM, deadlocks,
   `Lock wait timeout`, erreurs SQL/JDBC, `StaleObjectStateException`, etc.) et leur signification.
2. Repérer les **patterns récurrents** : ce qui revient le plus (volume × type) et ce que ça indique
   (boucle d'erreur, saturation, contention, configuration).
3. Lire la **chronologie** : période, rafales d'erreurs, corrélation avec un évènement (démarrage,
   purge, pic de charge).
4. Formuler une **hypothèse de cause racine** la plus probable, étayée par les digests.
5. Proposer la **prochaine action** : quoi vérifier (config, version, requête, ressource) ou
   quel complément demander au client.

## Sortie

Réponds STRICTEMENT en JSON valide, sans markdown : `{"summary":"...","report":"..."}`

- `summary` : une ligne très courte (ex. « Contention DB : 142 Lock wait timeout, pic à 14h02 »).
- `report` : français, en **sections numérotées** (titres courts < 90 caractères) :
  1. Erreurs critiques
  2. Patterns récurrents
  3. Chronologie
  4. Hypothèse de cause racine
  5. Prochaine action recommandée

## Garde-fous

- Aucune invention : ne citer que des erreurs/exceptions réellement présentes dans les digests.
- Distinguer le bruit (WARN bénins, erreurs connues sans impact) des signaux réels.
- Si les digests sont vides/insuffisants, le dire clairement plutôt que de spéculer.
