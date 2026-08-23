# Prospect 360 — rapport de validation local

**Date :** 23 août 2026
**Révision de départ :** `ecf0682` (`dev`)
**Portée :** MEM-001 à MEM-007, sauvegarde/restauration/purge locale incluses, hors charge VPS et hors effet provider réel
**Décision locale :** code-side ready derrière feature flags ; activation de production non encore approuvée

## Résultat synthétique

La mémoire Prospect 360 est implémentée comme état durable PostgreSQL. Chaque
exécution agentique reconstruit son contexte ; aucun agent ou client CLI ne
porte une mémoire singleton. Les workers restent des processus long-lived mais
stateless entre les jobs : seuls les repositories, routeurs et pools de
connexion sont réutilisés.

Quitter un drawer ou une page arrête uniquement son polling navigateur. Le job,
son lease, son watermark et son résultat restent en base. Les surfaces Prospect
et Conversation reprennent l'observation du même état serveur.

Le code ne doit toutefois pas être présenté comme qualifié pour production tant
que les gates de qualité et de capacité ci-dessous n'ont pas été exécutés sur
des données représentatives et sur le profil VPS cible.

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

- 151 tests réussis sur 43 fichiers ;
- 0 échec ;
- 1 288 assertions ;
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

## Diagnostic de capacité local

La fixture transactionnelle a produit trois contacts dont les deltas vérifiés
sont exactement 0, 20 et 200. Une première passe locale à chaud, 1 000 requêtes
et concurrence 100, a observé zéro erreur avec des p95 respectifs de 145,57 ms,
180,59 ms et 488,74 ms. Le scénario 200 est donc sous l'objectif froid de
750 ms, mais au-dessus de l'objectif chaud de 300 ms.

Cette passe ne qualifie pas le produit : Docker Desktop était limité à environ
6,2 Gio sur Apple Silicon et l'hôte a ensuite atteint 0,25 % de CPU idle,
125 Mio libres et une forte compression mémoire. Les passes suivantes sont
classées diagnostics invalides, pas régressions produit. La qualification
officielle reste à exécuter sur le VPS x86_64 4 vCPU / 16 Gio, isolé et au
repos. Aucun chiffre local n'est présenté comme un SLO acquis.

## Gates non encore exécutés

Ces éléments nécessitent un environnement, des données ou une autorisation qui
ne peuvent pas être remplacés honnêtement par un test local synthétique :

1. **Shadow réel** sur 1 000 contextes, ou l'intégralité disponible si elle est
   inférieure, avec zéro régression critique. L'agrégateur PII-free est livré,
   mais il doit encore être exécuté après collecte du corpus réel.
2. **Corpus qualité Setter** : zéro violation critique, rappel des engagements
   sémantiques supérieur ou égal à 98 %, répétition injustifiée inférieure à
   1 %. L'évaluateur PII-free est livré et refuse tout cas sans commande
   `dry_run`, `aiRunId` ou `memoryReceiptId` durable.
3. **Compréhension opérateur** supérieure ou égale à 90 % sur les états
   mémoire, préparation et envoi, sans aucune erreur sur les frontières
   d'effet. Le questionnaire et l'évaluateur fail-closed sont livrés.
4. **VPS 4 vCPU / 16 Gio** : chaud/froid, deltas 0/20/200, 100 assembleurs
   concurrents, 10 événements/s + 5/s de backfill, pointe 100/s pendant cinq
   minutes.
5. **Setter dry-run borné**, puis canary réel explicitement autorisé sur un
   workspace et un ensemble de conversations nommés.
6. **Rollback live** vers l'assembleur historique après activation limitée.
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

1. déployer la fixture expurgée et déjà vérifiée sur le VPS cible ;
2. exécuter les passes VPS chaude et froide décrites dans le protocole de
   capacité ;
3. laisser le shadow collecter le corpus réel ;
4. calculer les gates de qualité ;
5. exécuter le test opérateur ;
6. tester le rollback sur l'environnement déployé ;
7. seulement après réussite, demander l'autorisation du canary réel.

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
