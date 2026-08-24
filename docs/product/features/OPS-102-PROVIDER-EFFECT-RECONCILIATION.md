# OPS-102 — Réconciliation des effets provider inconnus

## Résultat

Une tentative LinkedIn qui franchit la frontière provider puis perd sa réponse
reste `unknown`. Noosphere ne remet jamais le job de publication en file. Il
crée à la place une recherche durable, visible sur le calendrier, qui observe
les posts du compte sélectionné et prend une décision auditée.

## Identité durable et données expurgées

La recherche conserve uniquement :

- le compte provider sélectionné ;
- le SHA-256 d'une forme canonique du texte ;
- une fenêtre bornée autour de `publishStartedAt` ;
- `content-publication:<publicationId>` comme correlation ID.

Le texte, les secrets, les en-têtes et les réponses provider ne sont jamais
stockés dans `criteria_snapshot`. Les erreurs persistées sont des codes
normalisés et des messages locaux.

## Machine de réconciliation

`pending → searching → matched | not_found | ambiguous | error`

- une lease expirée rend la recherche reprenable après un kill worker ;
- un match exact et unique renseigne les identifiants provider et clôt la
  tentative initiale comme `published` dans la même transaction ;
- plusieurs matches deviennent `ambiguous` sans sélection arbitraire ;
- aucun match est réobservé pendant la fenêtre puis devient `not_found` ;
- une erreur de lecture reste réessayable dans sa limite, sans réexécuter
  `SocialPublisher.publishText` ;
- une décision terminale produit un événement outbox et une ligne d'audit.

Les commentaires, réponses et réactions entrantes sont des lectures provider :
leur synchronisation conserve ses leases et ses clés provider idempotentes.
Noosphere V1 n'émet pas encore de commentaire ou réponse sociale sortante ;
toute future mutation réutilisera cette primitive avant activation.

## Preuves automatiques

- timeout post-envoi et perte de lease créent une réconciliation ;
- deux acquisitions concurrentes n'accordent qu'une lease ;
- un post retrouvé finalise la publication sans second envoi ;
- une absence après la fenêtre reste `unknown/not_found`, sans replay ;
- workspace et payload sont isolés/expurgés ;
- la reprise de la synchronisation des interactions est déjà couverte par les
  tests LNK-102/ENG-101.

L'index `content_publication_reconciliations_due_idx` a été conservé après
`EXPLAIN (COSTS OFF)` : PostgreSQL choisit un `Bitmap Index Scan` pour la
sélection des statuts dus, suivi du filtre de lease et de complétion.

Le réseau provider réel reste réservé à PTC-101 et n'est pas déclenché par ces
tests.
