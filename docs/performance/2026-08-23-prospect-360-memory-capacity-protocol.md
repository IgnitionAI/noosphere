# Prospect 360 — protocole de capacité et canary shadow

**Date :** 23 août 2026
**Statut :** protocole implémenté, mesure VPS 4 vCPU / 16 Gio à exécuter
**Portée :** assemblage de contexte, journal, backfill et worker mémoire ; aucun envoi provider

## Ce que le benchmark prouve

`bun run benchmark:capacity` mesure désormais l'endpoint serveur qui assemble
une vue Prospect 360 pour la préparation d'appel. Il charge PostgreSQL, les
repositories tenant-scoped, le renderer par capacité et l'écriture du context
receipt. Il n'appelle aucun modèle et n'envoie aucun message.

Le rapport JSON inclut :

- débit, p50, p95, p99 et erreurs pour chaque delta ;
- concurrence de 100 assembleurs par défaut ;
- nombre d'événements réellement observé après le watermark ;
- pics CPU et mémoire de l'API, du web, des workers, de PostgreSQL et du crawler ;
- motif explicite si la mémoire n'était pas activée et que le scénario a été ignoré.

Le sampling Docker peut être désactivé pour isoler la latence HTTP avec
`BENCHMARK_DISABLE_DOCKER_SAMPLING=true`. Le crawler peut être exclu d'une
passe mémoire ciblée avec `BENCHMARK_SKIP_CRAWLER=true`. Une passe officielle
doit néanmoins conserver au moins une mesure complète des ressources avec
`BENCHMARK_CONTINUOUS_RESOURCE_SAMPLING=true` sur un hôte au repos.

Les contacts formels `0`, `20` et `200` sont validés avant la charge. Le script
refuse d'étiqueter un résultat avec un delta qui ne correspond pas à
`pendingEventCount`.

## Préconditions

1. utiliser une restauration expurgée dans un workspace de benchmark isolé ;
2. appliquer les migrations, dont `0089` et `0090` ;
3. activer `prospectMemoryCapture` et la capacité `call_preparation` avec un
   profil de traitement revu ;
4. terminer le backfill et construire un snapshot frais pour trois contacts ;
5. laisser respectivement 0, 20 et 200 événements autoritatifs après leur
   watermark ;
6. noter leurs identifiants dans les variables ci-dessous ;
7. maintenir toute publication et tout envoi réel désactivés.

Le scénario `200` est la limite encore utilisable. À `201`, le contrat retourne
`WAIT_MEMORY_STALE` et interdit l'action automatique.

## Lancement reproductible

```bash
PUBLIC_HOST=localhost BACKUP_DIR=/tmp/noosphere-memory-benchmark-backups \
docker compose --env-file .env \
  -f compose.infrastructure.yml \
  -f compose.production.yml \
  -f compose.benchmark.yml \
  up -d --build --wait \
  database minio minio-init searxng crawler migrate \
  api web worker decision-worker setter-worker memory-worker

BENCHMARK_MEMORY_CONTACT_0_ID=<uuid> \
BENCHMARK_MEMORY_CONTACT_20_ID=<uuid> \
BENCHMARK_MEMORY_CONTACT_200_ID=<uuid> \
BENCHMARK_MEMORY_REQUESTS=1000 \
BENCHMARK_MEMORY_CONCURRENCY=100 \
BENCHMARK_OUTPUT=docs/performance/evidence/2026-08-23-prospect-memory.json \
bun run benchmark:capacity
```

Exécuter une première passe à chaud, puis redémarrer PostgreSQL et l'API avant
la passe à froid. Conserver les deux rapports séparément. Une mesure locale sur
Apple Silicon ne remplace pas la qualification du VPS x86_64.

## Résultat local diagnostique du 23 août 2026

La fixture `bun run prepare:prospect-memory-benchmark` a produit, par le vrai
chemin transactionnel puis le projector, des deltas exacts 0, 20 et 200 sans
appel sémantique et sans effet provider. À chaud, 1 000 requêtes avec une
concurrence de 100 ont donné :

| Delta | p95 local | Erreurs |
|---:|---:|---:|
| 0 | 145,57 ms | 0 |
| 20 | 180,59 ms | 0 |
| 200 | 488,74 ms | 0 |

Le rapport est conservé dans
`docs/performance/evidence/2026-08-23-prospect-memory-capacity-local-warm.json`.
Il s'agit d'un diagnostic, non d'une qualification : Docker Desktop tournait
sur ARM64 avec environ 6,2 Gio, puis l'hôte a atteint 0,25 % de CPU idle et
125 Mio libres. Les rapports `optimized` et `memory-focused` produits pendant
cette saturation doivent être lus uniquement comme traces de diagnostic.

## Charge d'ingestion et rattrapage

Le benchmark HTTP couvre l'assemblage concurrent. La qualification VPS ajoute
une campagne de mutation autoritative instrumentée :

- 10 événements/s pendant une heure ;
- 5 événements/s de backfill en parallèle ;
- pointe à 100 événements/s pendant cinq minutes ;
- au plus 5 % d'événements exigeant une synthèse sémantique ;
- backlog, âge p95 du dernier snapshot, tokens et coût échantillonnés toutes les
  quinze secondes.

La campagne utilise les use cases métier ou des fixtures de benchmark dans une
base jetable. Elle ne doit jamais injecter directement un snapshot, car cela
court-circuiterait la capture transactionnelle et le worker mesurés.

## Seuils de passage

| Mesure | Seuil |
|---|---:|
| Assemblage p95 à chaud | < 300 ms |
| Assemblage p95 à froid | < 750 ms |
| Erreurs HTTP | 0 |
| Retard de projection p95 nominal | < 60 s |
| Rattrapage de 100 000 événements | < 6 h |
| Événement perdu ou dupliqué | 0 |
| Lecture inter-workspace | 0 |
| Envoi provider pendant le benchmark | 0 |

Ces seuils restent des objectifs tant qu'un rapport du VPS 4 vCPU / 16 Gio
n'est pas archivé. Aucun document produit ne doit les présenter comme acquis
avant cette mesure.

## Vérification des index avant la mesure

Après replay des migrations dans la base d'intégration, `EXPLAIN` confirme :

- lecture du delta par
  `prospect_memory_events_contact_sequence_idx` avec conditions workspace,
  contact et watermark ;
- lecture du snapshot courant par
  `prospect_memory_snapshots_contact_generated_idx`, puis filtre des versions
  invalidées ou remplacées.

Aucun index JSON sur les jobs ou index sémantique n'a été ajouté sans charge
mesurée. Le rapport VPS devra joindre les plans `EXPLAIN (ANALYZE, BUFFERS)`
avec une cardinalité représentative avant toute optimisation supplémentaire.

## Canary shadow sans envoi

Le test `prospect-memory-projection.test.ts` constitue le canary déterministe
local : une objection ancienne est projetée, suivie de 120 messages LinkedIn,
email et WhatsApp. Le contexte Setter retrouve l'objection, reste en mode
`shadow`, écrit un receipt et garde `automaticActionAllowed=false`.

Le test `prospect-memory-worker.test.ts` vérifie que :

- la réussite est acquittée seulement après publication ;
- un budget épuisé reprogramme le job durable ;
- une course compare-and-swap reconstruit depuis le nouveau watermark ;
- un payload provenant d'un autre workspace est refusé.

Ce canary ne prouve aucun envoi réel — volontairement. Un canary Setter réel
reste soumis à une autorisation séparée, bornée à un workspace, une capacité et
un ensemble explicite de conversations.

## Rapport shadow sur les contextes réels

Chaque comparaison enregistre désormais, sans texte ni identifiant source :

- la capacité et l'état mémoire ;
- le nombre de sources critiques du bundle ;
- le nombre encore visible dans la fenêtre historique ;
- le nombre visible uniquement grâce à Prospect 360 ;
- l'interdiction d'action automatique.

Le rapport tenant-scoped se lance avec :

```bash
SHADOW_WORKSPACE_SLUG=<workspace> \
SHADOW_MIN_CONTEXTS=1000 \
SHADOW_OUTPUT=docs/performance/evidence/prospect-memory-shadow.json \
bun run evaluate:prospect-memory-shadow
```

La commande échoue tant que les 1 000 contextes ne sont pas présents, si une
mesure est invalide ou si un contexte shadow autorisait un effet. Elle produit
un diagnostic sans fermer le gate avec `SHADOW_FAIL_ON_GATE=false`.

Ce rapport ferme uniquement le gate d'observabilité du shadow. Il indique
explicitement `semanticQualityGate: not_measured` : les seuils de rappel des
engagements et de répétition exigent toujours un corpus labellisé séparé.
