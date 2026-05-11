---
name: kiba
description: Deliver a client license from an existing Jira ticket by reading the ticket, selecting the correct template section, replacing all variables including the license table, and creating a new Outlook draft. All delivery parameters (client type, delivery type, language) and recipients are provided by the caller and already validated — never ask for user validation during execution.
---

# Kiba

name: Kiba

purpose:
- Livrer une licence client à partir d'une clé Jira existante.
- Préparer un email de livraison dans Outlook en brouillon, sans envoi automatique.
- Sélectionner le bon template selon type de client + type de livraison + langue, remplacer toutes les variables, créer le brouillon.

trigger:
- Utiliser quand une clé Jira et les 3 paramètres validés (clientType, deliveryType, language) sont fournis.
- Router ici les cas de livraison, renouvellement, nouvelle salle, nouveau client.
- Ne pas router ici les incidents, questions simples, synchronisation Jira, ou création de ticket.

out_of_scope:
- Création ou mise à jour du ticket Jira.
- Envoi automatique d'email au client.
- Réponse-à-tous (reply-all) : Kiba crée TOUJOURS un nouveau brouillon (commande `draft`), jamais `reply-all`.
- Demande de validation interactive : les paramètres sont déjà validés par l'utilisateur avant l'appel.

preconditions:
- Jira accessible en lecture.
- Clé Jira présente et lisible.
- Les 3 paramètres validés sont fournis : clientType, deliveryType, language.
- Les destinataires sont fournis : --to, --cc, --bcc.
- Template disponible : `skills/kiba/assets/SUP-900 - [SUPPORT] TEMPLATES - Livraison aux clients 👍🏻.docx`.
- Script Outlook disponible : `skills/kiba/scripts/outlook_draft.py`.
- Token Outlook RW disponible ; exécuter `python3 skills/kiba/scripts/outlook_draft.py login` seulement si absent.

inputs:
- jiraKey
- validatedClientType: `ON-SITE` | `ONLINE dédié` | `Mutualisée`
- validatedDeliveryType: `Renouvellement` | `Nouvelle salle` | `Nouveau client`
- validatedLanguage: `FR` | `EN`
- toRecipient: email du client (fourni par le caller)
- ccRecipients: `support@iobeya.com,sales.support@iobeya.com` (fixes)
- bccRecipient: `admin@iobeya.com` (fixe)

resources:
- Contenu du ticket Jira et ses pièces jointes.
- Template : `skills/kiba/assets/SUP-900 - [SUPPORT] TEMPLATES - Livraison aux clients 👍🏻.docx`.
- Script Outlook : `skills/kiba/scripts/outlook_draft.py`.
- Mapping template :
  - `ON-SITE + Renouvellement + EN` → section `2.1 ON-SITE [EN]`
  - `ON-SITE + Renouvellement + FR` → section `2.2 ON-SITE [FR]`
  - `ONLINE dédié|Mutualisée + Renouvellement + EN` → section `2.3 ONLINE (DEDICATED,TEAM,TEAM+,PARTNERS) [EN]`
  - `ONLINE dédié|Mutualisée + Renouvellement + FR` → section `2.4 ONLINE (DEDICATED,TEAM,TEAM+,PARTNERS) [FR]`
  - `Nouvelle salle` et `Nouveau client` → choisir la section correspondante selon langue et mode d'hébergement.

playbook:
1. Lire le ticket Jira (jiraKey) :
   - extraire : nom client, contexte commande, données de licence, email/thread source.
   - conserver jiraKey pour les références suivantes.
2. Sélectionner automatiquement la section template en utilisant les paramètres fournis (validatedClientType + validatedDeliveryType + validatedLanguage). Ne pas demander de validation — ils sont déjà validés.
3. Respecter la compatibilité des templates :
   - ne jamais utiliser un template ON-SITE pour ONLINE dédié ou Mutualisée, et vice versa.
4. Charger le document template et extraire la section sélectionnée.
5. Remplacer toutes les variables avec les données Jira. Ne pas inventer de valeurs absentes.
6. Construire le `TABLEAU APP LICENCE` :
   - ne jamais laisser le placeholder dans le message final ;
   - source primaire : email de livraison / ticket Jira ;
   - localiser le bloc `License to create / Number of Rooms / Boards / Users` ;
   - mapper les 3 premières valeurs numériques dans l'ordre :
     - `License to create` → `Salles`
     - `Number of Rooms` → `Panneaux`
     - `Boards` → `Utilisateurs`
   - utiliser `Non communiqué` pour les valeurs absentes.
7. Rendre `TABLEAU APP LICENCE` en HTML dans le corps de l'email :
   - tableau une ligne, colonnes : `Salles`, `Panneaux`, `Utilisateurs` ;
   - en-tête fond `#DCEBFF`, texte gras sombre ;
   - bordures grises fines `#D0D7DE` ;
   - cellules avec padding.
8. Extraire le sujet du template :
   - localiser la ligne commençant par `Email title:` (ou équivalent selon la langue : `Objet :`, `Subject:`, etc.) dans la section sélectionnée ;
   - extraire la valeur après le préfixe et les variables remplacées → ce sera le `--subject` du brouillon ;
   - **supprimer entièrement cette ligne du corps de l'email** (elle ne doit pas apparaître dans le corps).
9. Générer le corps HTML final avec toutes les variables remplacées et sans la ligne `Email title:`. Écrire dans un fichier temporaire (ex. `/tmp/kiba-body-<timestamp>.html`).
10. Créer le brouillon Outlook avec la commande `draft` (JAMAIS `reply-all`) :
   ```
   python3 skills/kiba/scripts/outlook_draft.py draft \
     --to "<toRecipient>" \
     --cc "support@iobeya.com,sales.support@iobeya.com" \
     --bcc "admin@iobeya.com" \
     --subject "<sujet extrait à l'étape 8>" \
     --body-file "<fichier_html généré à l'étape 9>"
   ```
11. Retourner le JSON de résultat structuré (voir structured_outcome). Ne rien afficher d'autre.

stop_conditions:
- Clé Jira manquante ou ticket illisible.
- Document template manquant ou section introuvable.
- Incompatibilité type client / template détectée.
- `TABLEAU APP LICENCE` impossible à construire même avec `Non communiqué`.
- Échec de création du brouillon Outlook ou authentification indisponible.
- Toute action entraînerait l'envoi de l'email, la modification de Jira, ou un changement de configuration production.

guardrails:
- Ne jamais créer, mettre à jour, clore ou commenter des tickets Jira.
- Ne jamais envoyer d'email automatiquement.
- Ne jamais utiliser `reply-all` — toujours `draft`.
- Ne jamais demander de validation interactive pendant l'exécution : les paramètres sont pré-validés.
- Ne pas exposer de balises HTML brutes dans la sortie texte.
- Ne pas inventer de quantités de licences, destinataires, données contractuelles ou contexte commercial.
- BCC `admin@iobeya.com` toujours présent pour toute livraison de licence.
- CC `support@iobeya.com,sales.support@iobeya.com` toujours présents.

structured_outcome:
- status: `draft_created` | `blocked`
- subject: sujet du brouillon créé
- draftInfo: informations sur le brouillon (id, webLink, etc.)
- blockingReason: null ou raison du blocage si status=blocked
