---
name: similar-tickets
description: From a reference Jira ticket and a set of candidate tickets already fetched from Jira, identify the truly similar ones and extract how each was resolved. Use to reuse precedents and speed up a new support case.
---

# Similar Tickets

À partir d'un **ticket de référence** et d'une **liste de candidats déjà récupérés depuis Jira**
(fournis dans le prompt), identifier les tickets réellement similaires et extraire **ce qui a été
fait / la piste de résolution**. But : réutiliser des cas déjà traités.

## Sources (toutes fournies dans le prompt)

- Le ticket de référence : titre, description, commentaires, noms de pièces jointes.
- Les candidats : pour chacun, titre, statut, résolution, dates, description, commentaires, PJ.
- Le périmètre projets utilisé et le JQL exécuté (pour transparence).

Tout est déjà dans le prompt : **aucun accès réseau ni aucune commande**. L'application a fait la
recherche (Node a le réseau, pas ce contexte).

## Méthode

1. Comprendre le ticket de référence : vrai problème, module concerné (DCM, QCD, addon Jira/ADO…),
   messages d'erreur exacts, versions, type d'action, indices dans les noms de pièces jointes.
2. Pour **chaque candidat**, juger la similarité réelle en croisant **titre + description +
   commentaires + noms de pièces jointes** avec le ticket de référence. Recouvrement de mots-clés,
   même module, même message d'erreur = similaire ; simple co-occurrence d'un mot courant = non.
3. Classer les candidats retenus par pertinence (pas seulement par date). Les tickets résolus **et**
   non résolus sont traités de la même façon.
4. Pour chaque ticket retenu, extraire concrètement **comment il a été résolu** (depuis description /
   commentaires) ou, s'il est ouvert, où il en est.
5. Écarter explicitement les candidats non pertinents.

## Sortie

Réponds STRICTEMENT en JSON valide, sans markdown : `{"summary":"...","report":"..."}`

- `summary` : une ligne très courte (ex. « 4 tickets similaires, dont SUPIOBEYA-123 résolu par … »).
- `report` : français, en **sections numérotées** (titres courts < 90 caractères) :
  1. Tickets similaires — un bloc par ticket retenu : `CLÉ — titre`, statut, en quoi c'est similaire,
     comment résolu, et le lien browse.
  2. Pistes de résolution — synthèse actionnable tirée de ces précédents.
  3. Candidats écartés — combien et pourquoi (une ligne).

## Garde-fous

- Aucune invention : ne citer que des candidats réellement présents dans le prompt.
- La résolution citée doit venir du contenu réel du ticket (description / commentaires).
- Indiquer combien de candidats ont été écartés plutôt que de tronquer en silence.
- Si aucun candidat n'est pertinent, le dire clairement (ne pas forcer une shortlist).
