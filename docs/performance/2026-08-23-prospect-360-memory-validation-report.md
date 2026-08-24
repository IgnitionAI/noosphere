# Prospect 360 — rapport de validation local

**Date :** 23 août 2026
**Révision de base :** `21da07c` (`dev`), complétée par les scripts et preuves de ce lot
**Portée :** MEM-001 à MEM-007, sauvegarde/restauration/purge, benchmark VPS isolé, shadow IgnitionAI et corpus Setter sans effet provider
**Décision :** observabilité et dry-run qualifiés ; activation automatique toujours conditionnée aux gates humains et au benchmark du VPS cible

## Résultat synthétique

La mémoire Prospect 360 est implémentée comme état durable PostgreSQL. Chaque
exécution agentique reconstruit son contexte ; aucun agent ou client CLI ne
porte une mémoire singleton. Les workers restent des processus long-lived mais
stateless entre les jobs : seuls les repositories, routeurs et pools de
connexion sont réutilisés.

Quitter un drawer ou une page arrête uniquement son polling navigateur. Le job,
son lease, son watermark et son résultat restent en base. Les surfaces Prospect
et Conversation reprennent l'observation du même état serveur.

Le shadow sur données réelles et un corpus Setter synthétique adversarial ont
désormais été exécutés. Ils ne remplacent ni une revue éditoriale humaine, ni
le benchmark de la machine de production retenue, ni un canary provider
explicitement autorisé.

## Preuves exécutées

### Suite complète applicative

Commande :

```bash
bun run check
```

Résultat :

- prototype : 26 écrans et 40 fichiers source validés ;
- architecture : 355 fichiers TypeScript contrôlés ;
- tests unitaires et HTTP : 570 réussis, 0 échec, 1 731 assertions ;
- crawler Python : 43 réussis ;
- bundle backend réussi ;
- build Next.js réussi, routes Prospect 360 incluses.

### PostgreSQL réel et intégration

Commande :

```bash
bun run test:integration
```

Résultat final après durcissement des profils provider et ajout du Setter
dry-run durable :

- 152 tests réussis sur 43 fichiers ;
- 0 échec ;
- 1 289 assertions ;
- migrations `0089` à `0092` rejouées dans la base d'intégration isolée.

Les scénarios mémoire prouvent notamment :

- déduplication source/version et ordre monotone des événements tardifs ;
- transaction atomique et coalescing des refreshs ;
- backfill reprenable sans événement ni job successeur dupliqué ;
- publication compare-and-swap et rejet d'un ancien `privacyEpoch` ;
- deux transitions d'une même décision dans la même milliseconde sont
  conservées distinctement, tandis qu'un replay exact reste idempotent ;
- les écritures directes de `prospect_decisions` sont bloquées par la garde
  d'architecture si elles n'enregistrent pas la mutation mémoire ;
- expiration et supersession retirent immédiatement les faits et synthèses
  obsolètes du contexte servi, sans attendre une nouvelle inférence ;
- un delta tronqué ou une couverture source incomplète bloque l'action
  automatique au lieu de construire un contexte partiel ;
- la pagination de reconstruction continue au-delà d'une page d'événements
  sans consommer une tentative supplémentaire ;
- les compteurs Inbound sont agrégés sur le journal durable courant, sans
  exposer le contenu privé des interactions au renderer ;
- receipt sans contexte brut ;
- activation shadow et rollback atomiques ;
- isolation workspace ;
- merge/undo CRM avec verrous ordonnés et conservation de l'historique détenu
  par l'identité source.

Le scénario de rétention PostgreSQL
`tests/integration/workspace-data-lifecycle.test.ts` ajoute une mémoire expirée
et un refresh déjà loué. La purge supprime événement, snapshot et receipt,
conserve le job `running` avec son propriétaire de lease, et laisse inchangés
les compteurs de messages, tentatives d'outreach et tentatives de publication.

### Setter durable et fermeture du drawer

Le test unitaire `tests/unit/research-worker.test.ts` exécute une commande
Setter plus longue que son lease initial. Le rôle `setter-command-worker`
renouvelle plusieurs fois le lease, appelle le processor une seule fois et
acquitte le job une seule fois. Le navigateur et le drawer ne participent ni au
lease, ni au cycle de vie de l'agent.

Le test PostgreSQL
`tests/integration/conversation-command-dry-run.test.ts` construit une
conversation de plus de 120 messages avec un engagement ancien situé hors de
la fenêtre des trente derniers messages. Il démontre que :

- le ContextAssembler restitue l'engagement via Prospect 360 ;
- le Setter génère un résultat `dry_run` durable et réouvrable ;
- la même clé idempotente retrouve la même commande et ne crée qu'un job ;
- `aiRunId`, `memoryReceiptId`, snapshot, watermark, modèle et prompt sont
  conservés dans l'audit de génération ;
- aucun message sortant, appel provider ou effet calendrier n'est produit.

### Contexte long déterministe

Le test `tests/unit/prospect-memory-projection.test.ts` projette une objection
ancienne, puis 120 messages LinkedIn, email et WhatsApp. Le bundle Setter :

- conserve l'objection et le `doNotRepeat` ;
- reste en mode `shadow` ;
- interdit l'action automatique ;
- écrit un receipt reproductible ;
- n'invoque aucun provider d'envoi.

Les tests de runner prouvent aussi que le comparateur shadow est PII-free, que
les routes utilisent le workspace/capability serveur et qu'un profil provider
incomplet est refusé avec `422`.

## Gouvernance du traitement provider

Une capacité ne peut envoyer le bundle Prospect 360 à un modèle que si le
profil du provider contient et valide :

- région ou juridiction ;
- policy d'accès opérateur ;
- sous-traitants revus ;
- procédure de suppression ;
- liste explicite des capacités autorisées.

Le filtrage est fail-closed. Les réglages sont activés ou rollbackés dans une
transaction unique et la sélection effective du provider est recalculée pour
chaque capacité.

## Sauvegarde, restauration et purge représentatives

Le profil de sauvegarde PostgreSQL/MinIO de `compose.production.yml` a été
rejoué. Les commandes multi-lignes des deux conteneurs de backup sont désormais
transmises intégralement au shell Compose ; auparavant, le tableau YAML était
interprété comme un simple `mkdir` sans opérande.

Le dump PostgreSQL a été restauré dans une base créée depuis `template0`. Le
vérificateur tenant-scoped `bun run verify:prospect-memory-backup` a comparé les
comptages et empreintes MD5 de la source et de la restauration :

- 223 événements, 3 snapshots et 3 060 receipts identiques ;
- réglage workspace identique ;
- job mémoire `running`, lease et payload identiques ;
- zéro message, tentative d'outreach ou tentative de publication.

La preuve est archivée dans
`docs/performance/evidence/2026-08-23-prospect-memory-backup-restore-local.json`.

La purge a ensuite été exécutée sur une seconde restauration jetable, avec un
garde-fou exigeant le nom exact de la base. Elle a supprimé les 223 événements,
3 snapshots et 3 060 receipts, conservé le job mémoire en vol, incrémenté le
`privacyEpoch` des trois contacts concernés afin d'invalider tout résultat
d'inférence déjà parti, et laissé les trois compteurs d'effet provider à zéro.
La preuve est archivée dans
`docs/performance/evidence/2026-08-23-prospect-memory-purge-restored-local.json`.

## Diagnostics de capacité

La fixture transactionnelle a produit trois contacts dont les deltas vérifiés
sont exactement 0, 20 et 200. Après reconstruction explicite des images et
recréation des conteneurs API/web/workers, une nouvelle passe complète a
exécuté 1 000 requêtes par delta avec une concurrence de 100, sampling Docker
continu et crawler actif :

| Delta | p95 | Erreurs | Verdict chaud `< 300 ms` |
|---:|---:|---:|---|
| 0 | 265,70 ms | 0 | atteint |
| 20 | 372,36 ms | 0 | non atteint |
| 200 | 669,25 ms | 0 | non atteint |

Le mix de lectures opérationnelles a tenu 218,32 requêtes/s avec un p95 de
180,95 ms et zéro erreur. Les 200 SSR « Aujourd’hui » et « Prospects » ont
également terminé sans erreur. Le crawler a lu quatre domaines publics sur
quatre et produit quatre pages.

La preuve courante est archivée dans
`docs/performance/evidence/2026-08-23-prospect-memory-capacity-local-current.json`.
Elle invalide toute affirmation selon laquelle le SLO chaud serait déjà
atteint pour un delta de 20 ou 200 événements.

Cette passe locale ne qualifie pas le produit : Docker Desktop était limité à environ
6,2 Gio sur Apple Silicon et l'hôte a ensuite atteint 0,25 % de CPU idle,
125 Mio libres et une forte compression mémoire. Les passes suivantes sont
classées diagnostics invalides, pas régressions produit. La qualification
officielle devait donc être répétée sur un hôte x86_64 isolé.

### VPS x86_64 isolé effectivement disponible : 2 vCPU / 8 Gio

Le dépôt a été cloné dans `/opt/noosphere-benchmark` à la révision `21da07c`,
dans un projet Compose distinct et sans aucune mutation du déploiement présent
sur la machine. Tous les effets provider, schedulers, outbox et workers
d'envoi ont été désactivés. L'hôte réellement fourni possède 2 vCPU et 8 Gio,
et non les 4 vCPU / 16 Gio visés par le protocole.

Passe chaude, 1 000 lectures par delta et 100 assembleurs concurrents :

| Delta | p95 | Erreurs | Verdict chaud `< 300 ms` |
|---:|---:|---:|---|
| 0 | 608,05 ms | 0 | non atteint |
| 20 | 646,95 ms | 0 | non atteint |
| 200 | 1 244,88 ms | 0 | non atteint |

Passe froide contrôlée :

| Delta | p95 | Erreurs | Verdict froid `< 750 ms` |
|---:|---:|---:|---|
| 0 | 706,59 ms | 0 | atteint |
| 20 | 1 156,88 ms | 0 | non atteint |
| 200 | 950,16 ms | 0 | non atteint |

Les lectures restent fonctionnelles et sans erreur, mais 2 vCPU / 8 Gio ne
respecte pas le SLO sous cette concurrence. La recommandation de déploiement
reste donc **4 vCPU / 16 Gio minimum**, à requalifier sur la machine finale.
Preuves :

- `docs/performance/evidence/2026-08-23-prospect-memory-capacity-vps-2vcpu-8g-hot.json` ;
- `docs/performance/evidence/2026-08-23-prospect-memory-capacity-vps-2vcpu-8g-cold.json` ;
- `docs/performance/evidence/2026-08-23-prospect-memory-vps-fixture.json`.

## Shadow réel IgnitionAI

Le script `bun run run:prospect-memory-shadow-corpus` a activé temporairement
le mode shadow sur le workspace `ignition-ai`, exécuté le backfill de façon
transactionnelle, assemblé 1 000 contextes Setter, puis restauré la policy
initiale. Il n'a appelé aucun modèle et n'a produit aucun effet provider.

Résultat :

- 1 000 contextes mesurables sur 1 000 ;
- 0 contexte invalide ;
- 0 contexte capable de produire automatiquement un effet ;
- 6 728 sources critiques visibles uniquement grâce à Prospect 360 ;
- 992 contextes `fresh`, 8 `budget_blocked` ;
- gate d'observabilité atteint ;
- qualité sémantique explicitement `not_measured`.

La classification utilisée pour constituer cet échantillon est une sonde
lexicale déterministe. Elle prouve la couverture et l'absence d'effet, pas la
justesse d'une synthèse par modèle. Preuves :

- `docs/performance/evidence/2026-08-23-prospect-memory-shadow-corpus-ignition-ai.json` ;
- `docs/performance/evidence/2026-08-23-prospect-memory-shadow-ignition-ai-real.json`.

## Corpus qualité Setter

Le script `bun run run:prospect-memory-setter-corpus` a créé un workspace
synthétique séparé et exécuté 100 commandes Setter via le vrai processeur de
jobs. Chaque conversation place un engagement au-delà des trente derniers
messages. Les cas couvrent rappel d'engagement, objection résolue, besoin
confirmé, `doNotRepeat` et frontière rendez-vous, en français et en anglais.

Le modèle réellement invoqué est `codex-cli / gpt-5.6-luna / xhigh`. Chaque
appel utilise un processus Codex éphémère et son propre contexte reconstruit.
Résultat en 351 206 ms :

- 100 commandes `dry_run` générées sur 100 ;
- 100 `ai_run` et 100 receipts mémoire résolubles en PostgreSQL ;
- rappel exact du marqueur d'engagement : 100 % ;
- 0 remise inventée ou rendez-vous prétendument réservé ;
- 0 répétition injustifiée détectée par l'oracle borné ;
- 0 message, réservation ou appel provider.

Le gate automatique passe. La revue éditoriale humaine reste
`not_measured` : l'oracle automatique n'est pas présenté comme un humain.
Preuves :

- `docs/performance/evidence/2026-08-23-prospect-memory-setter-corpus.json` ;
- `docs/performance/evidence/2026-08-23-prospect-memory-setter-review.json`.

## Parcours technique avec rôle Operator

Le parcours réel de l'interface a été exécuté avec un compte possédant le rôle
`Operator` sur un workspace synthétique. Depuis la conversation, l'opérateur a
lancé le Setter en `dry_run`, fermé le drawer puis navigué pendant que le job
était encore actif. Le job a continué côté serveur. Après réouverture, le
résultat durable était visible et rappelait exactement l'engagement
`NS-001-Q`, situé au-delà des trente derniers messages.

Le contrôle PostgreSQL confirme :

- commande `generated`, jamais `sent` ;
- 36 messages avant et après le parcours ;
- 0 tentative d'outreach et 0 identifiant de requête provider ;
- receipt mémoire et `ai_run` résolubles ;
- `codex-cli / gpt-5.6-luna / xhigh`, instancié de manière transiente pour le
  job ;
- aucune erreur console pendant le parcours observé.

Ce parcours a également révélé un défaut de production : la lecture du budget
sémantique interpolait directement un objet `Date` dans `postgres-js`. Le job
de rafraîchissement pouvait donc passer en retry avant l'appel modèle. La borne
temporelle utilise désormais l'opérateur Drizzle typé `gte`, avec un test
d'intégration dédié. La suite d'intégration passe avec 153 tests et 0 échec.

Cette preuve valide le parcours technique, la durabilité du job et l'absence
d'effet provider. Elle ne prétend pas mesurer la compréhension d'un humain.
Preuve :

- `docs/performance/evidence/2026-08-23-prospect-memory-operator-role-qa.json`.

## Gates encore ouverts

Les gates suivants restent explicitement ouverts :

1. **Revue éditoriale Setter** : un opérateur doit encore étiqueter le corpus
   de 100 réponses ; aucun jugement automatique ne sera compté comme humain.
2. **Compréhension opérateur** : le parcours technique avec un vrai rôle
   `Operator` passe, y compris fermeture du drawer et réouverture du résultat.
   Le fichier d'exemple passe aussi les cinq assertions attendues. En revanche,
   aucune session où un humain explique ce qu'il comprend n'a encore été
   observée : le gate de compréhension humaine reste donc `not_measured`.
   Rapports :
   `docs/performance/evidence/2026-08-23-prospect-memory-operator-role-qa.json`
   et
   `docs/performance/evidence/2026-08-23-prospect-memory-operator-example-current.json`.
3. **VPS 4 vCPU / 16 Gio** : chaud/froid, deltas 0/20/200, 100 assembleurs
   concurrents, 10 événements/s + 5/s de backfill, pointe 100/s pendant cinq
   minutes.
4. **Canary réel** explicitement autorisé sur un workspace, un compte et un
   ensemble de conversations nommés.
5. **Rollback live** vers l'assembleur historique après activation limitée.
   Le rollback transactionnel local et le fallback de code sont prouvés ; la
   manœuvre sur un environnement déployé reste à exécuter.

## Conditions de go/no-go

Le passage en production reste **no-go** si l'un des événements suivants est
observé : perte d'opt-out/refus/engagement, lecture inter-workspace, résurrection
après anonymisation, action automatique sur mémoire stale ou hors budget,
envoi pendant shadow/dry-run, p95 hors seuil ou backlog mémoire supérieur à
soixante secondes.

Le canary provider ne doit jamais être lancé implicitement par le benchmark. Il
requiert une autorisation distincte et bornée.

## Prochain protocole

1. exécuter la session de compréhension humaine et la revue éditoriale du
   corpus ;
2. répéter le benchmark sur le VPS 4 vCPU / 16 Gio retenu ;
3. tester le rollback sur l'environnement déployé ;
4. seulement après réussite, demander l'autorisation du canary réel.

## Commandes des gates manuels

Évaluation du corpus Setter, à partir d'identifiants de commandes dry-run et de
labels sans contenu personnel :

```bash
DATABASE_URL=postgres://... \
SETTER_QUALITY_WORKSPACE_SLUG=ignition-ai \
SETTER_QUALITY_LABELS=/chemin/labels.json \
SETTER_QUALITY_OUTPUT=docs/performance/evidence/prospect-memory-setter-quality.json \
bun run evaluate:prospect-memory-setter
```

Évaluation de compréhension opérateur :

```bash
MEMORY_OPERATOR_RESPONSES=/chemin/reponses.json \
MEMORY_OPERATOR_OUTPUT=docs/performance/evidence/prospect-memory-operator.json \
bun run evaluate:prospect-memory-operator
```

Ces commandes terminent avec un code non nul tant que le gate correspondant
n'est pas atteint. Elles ne déclenchent aucun modèle et aucun envoi.
