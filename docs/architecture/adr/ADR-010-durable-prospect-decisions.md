# ADR-010 — Décisions prospect durables au-dessus de la queue PostgreSQL

## Statut

Accepté.

## Contexte

L'autopilote créait directement des jobs d'envoi à partir d'une séquence. Ce
modèle ne pouvait pas représenter durablement un délai décidé par l'agent, une
recherche complémentaire, un handoff, un arrêt ou la raison d'un prochain
réexamen. Une réponse entrante pouvait aussi arriver entre la création d'un job
et l'appel du provider.

L'audit de TryCRM au commit
`f2484fb08d1dd1357c1e3deddb97610cd8e6f1ed` confirme l'intérêt d'une boucle
« observer, décider, planifier », mais son ordonnanceur en mémoire et son modèle
mono-tenant ne satisfont pas les invariants d'Ignition Outbound. Aucun code de
TryCRM n'est copié.

## Décision

- Conserver `jobs` comme unique queue technique et y ajouter une priorité.
- Ajouter `prospect_decisions` comme registre métier tenant-scoped relié à un
  job, un contact et, si applicable, une campagne et une action d'outreach.
- Stocker `dueAt`, raison, observation, proposition, décision de policy,
  résultat, tentatives, erreurs, idempotency key et correlation ID.
- Faire produire à LangChain/Kimi une proposition structurée seulement. Une
  policy déterministe autorise, diffère ou bloque l'effet.
- Une campagne créée manuellement démarre en `dry_run` tant que son opérateur
  ne l’a pas passée explicitement en live. Une campagne créée par la boucle
  autonome depuis un ICP audité démarre en `live` : elle ne passe pas par une
  file d’approbation, mais reste soumise aux contrôles déterministes avant
  chaque envoi.
- Utiliser le même advisory lock tenant-scoped pour la barrière webhook et la
  dernière vérification avant envoi.
- Préserver les anciens jobs `outreach.dispatch` pendant la migration
  progressive.

## Conséquences

Le système reprend les décisions après redémarrage, déduplique les
replanifications et explique le prochain mouvement dans l'interface. La base
PostgreSQL reste le point de contention à observer; la fair-queue par workspace
et les leases bornent le risque. Le mode live autonome est explicite dans la
policy persistée et reste réversible.

## Date

2026-08-13
