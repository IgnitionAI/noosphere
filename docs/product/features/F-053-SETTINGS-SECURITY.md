# F-053 — Paramètres, sécurité et cycle de vie des données

## Résultat utilisateur

Administrer le workspace depuis un seul endroit : profil, membres,
préférences d’envoi, limites par canal, rétention, export des données,
anonymisation et consultation de l’audit — chaque opération destructive étant
confirmée, réservée aux rôles autorisés et auditée.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | toutes les sections | modifie paramètres, exporte, anonymise | confirmation renforcée requise |
| operator | sections opérationnelles (profil en lecture, limites en lecture) | non | non |
| reviewer | sections opérationnelles en lecture | non | non |
| viewer | profil public du workspace uniquement | non | non |

## État d’implémentation

Livré. `/w/[workspaceSlug]/settings` regroupe le profil, l’équipe F-002, les
préférences d’envoi, les limites par canal, la rétention, l’export asynchrone
et le journal d’audit. L’anonymisation irréversible est disponible depuis la
fiche prospect. Les permissions, confirmations typées, purges et exports sont
appliqués côté serveur et couverts par les suites HTTP et PostgreSQL.

## Périmètre

- profil du workspace : nom (slug stable, jamais modifié — les liens ne
  cassent pas) ;
- section membres et permissions : consomme les endpoints F-002 ;
- préférences d’envoi : fuseau et fenêtres horaires par défaut du workspace ;
- limites par canal : plafonds quotidiens email/LinkedIn/WhatsApp appliqués
  par le scheduler (F-034), modifiables owner/admin ;
- politique de rétention : durées de conservation des invitations expirées,
  jobs, events outbox traités et logs d’audit, par catégorie ;
- export des données du workspace : job asynchrone produisant une archive,
  accès par lien signé expirant (72 h), audité ;
- anonymisation d’un contact ou d’un membre désactivé : remplace l’identité
  sans réécrire les faits (suppressions F-026 et empreintes préservées) ;
- consultation de l’audit : journal filtrable (acteur, action, période)
  réservé owner/admin ;
- cadre de confirmation : toute opération destructive (anonymisation,
  purge, changement de rétention réducteur) exige une confirmation explicite
  typée et est auditée.

## Hors périmètre

- suppression complète du workspace (opération plateforme, pas self-service) ;
- export incrémental ou planifié ;
- rétention différenciée par entité métier au-delà des catégories listées ;
- gestion des clés API publiques du workspace ;
- conformité RGPD complète (registre, DPO) — la feature livre les mécanismes
  techniques (export, anonymisation, rétention, audit).

## Parcours principal

1. un owner ouvre `/settings` : sections profil, membres, envoi, limites,
   rétention, données, audit ;
2. il ajuste les plafonds par canal — le scheduler les applique dès la
   prochaine planification, sans toucher aux campagnes actives (pas de
   rétroactivité) ;
3. il lance un export : un job produit l’archive, le lien d’accès expire
   après 72 h, l’opération est auditée ;
4. il anonymise un contact : confirmation typée obligatoire, l’identité est
   remplacée, les empreintes de suppression et les faits agrégés survivent ;
5. il consulte le journal d’audit et y retrouve chacune de ces opérations.

## Règles métier et invariants

- chaque section applique ses permissions côté serveur — un appel direct API
  par un rôle insuffisant renvoie 403 ;
- aucune rétroactivité : limites, fenêtres et rétention ne modifient ni les
  campagnes actives ni l’historique ;
- le slug du workspace est immuable ; le renommage ne touche que le nom
  d’affichage ;
- l’export est un job idempotent (`requestKey`) dont le lien d’accès expire ;
  un export ne contient que les données du workspace demandeur ;
- l’anonymisation préserve les suppressions (F-026) : les empreintes
  normalisées ne sont jamais effacées par une anonymisation ;
- l’anonymisation ne réécrit pas les métriques (F-051) : les faits passés
  restent comptabilisés, sans lien vers la personne ;
- réduire une durée de rétention déclenche une purge planifiée, jamais une
  suppression synchrone dans la requête ; la purge est un job idempotent et
  audité ;
- toute opération destructive exige une confirmation explicite (saisie du
  libellé demandé) et produit une entrée d’audit avec acteur, cible et
  résultat ;
- les limites par canal sont bornées (planchers/plafonds produit) et
  validées côté serveur.

## Critères d’acceptation

- Étant donné un operator, quand il appelle l’endpoint d’export ou
  d’anonymisation, alors la réponse est 403 ;
- Étant donné un export demandé deux fois avec la même clé, quand le doublon
  arrive, alors un seul job et une seule archive existent ;
- Étant donné un lien d’export expiré, quand on le télécharge, alors l’accès
  est refusé (410) ;
- Étant donné deux workspaces, quand l’un exporte, alors l’archive ne
  contient aucune donnée de l’autre ;
- Étant donné un contact sous suppression active, quand il est anonymisé,
  alors l’empreinte de suppression persiste et bloque toujours un réimport ;
- Étant donné un contact anonymisé, quand je consulte les analytics, alors
  les métriques historiques sont inchangées ;
- Étant donné une anonymisation sans confirmation typée, quand elle est
  soumise, alors la requête est refusée (400) ;
- Étant donné une réduction de rétention, quand elle est enregistrée, alors
  une purge planifiée est créée et auditée, sans suppression synchrone ;
- Étant donné un plafond email modifié, quand le scheduler planifie, alors
  la nouvelle limite s’applique sans affecter les actions déjà planifiées ;
- Étant donné un owner, quand il filtre le journal d’audit par action,
  alors il retrouve chaque mutation sensible avec acteur et date.

## États et erreurs

- loading : skeleton par section ;
- empty : journal d’audit sans entrée sur le filtre courant — état neutre ;
- validation : plafond hors bornes, durée de rétention invalide, confirmation
  typée absente ou incorrecte (400 avec la raison) ;
- forbidden : sections réservées owner/admin, même par appel direct API ;
- provider indisponible : stockage de l’archive en échec → job `failed` avec
  retry borné, aucune archive partielle servie ;
- conflit métier : 409 sur export déjà en cours pour le même workspace ;
- reprise : relance d’un export échoué idempotente.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/settings` (accueil des sections :
profil, membres, envoi, limites, rétention, données, audit) ; les pages
existantes `settings/ai`, `settings/channels`, `settings/calendar` restent.

**Use cases** : `UpdateWorkspaceProfile`, `UpdateSendingPreferences`,
`UpdateChannelLimits`, `UpdateRetentionPolicy`, `RequestDataExport`,
`GetDataExport`, `AnonymizeContact`, `ListAuditLogs`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| PATCH | `/api/v1/workspaces/:id` | renommage (slug immuable) | livré |
| GET/PUT | `/api/v1/workspaces/:id/sending-preferences` | fuseau et fenêtres par défaut | livré |
| GET/PUT | `/api/v1/workspaces/:id/channel-limits` | plafonds quotidiens par canal | livré |
| GET/PUT | `/api/v1/workspaces/:id/retention-policy` | durées par catégorie | livré |
| POST | `/api/v1/workspaces/:id/actions/export` | lance un export (job, owner/admin) | livré |
| GET | `/api/v1/exports/:id` | statut + lien signé expirant | livré |
| POST | `/api/v1/contacts/:id/actions/anonymize` | anonymisation confirmée (owner/admin) | livré |
| GET | `/api/v1/audit-logs` | journal filtrable (owner/admin) | livré |

**Événements sortants** : `WorkspaceDataExportRequested`,
`ContactAnonymized`, `RetentionPolicyChanged`, livrés via l’outbox dans la
même transaction que l’audit et la mutation métier.

**Ports externes** : stockage des archives d’export derrière un port
(fichier signé à expiration) ; purge planifiée via la file de jobs (F-003).

## Données et confidentialité

- tables livrées : `workspace_data_settings` (envoi, limites, rétention) et
  `workspace_exports` (job, statut, clé d’archive, `expiresAt`, demandeur) ;
- données personnelles : l’export contient des PII — accès owner/admin
  uniquement, lien expirant, audit obligatoire ; l’anonymisation remplace
  nom, email, téléphone et identités par des valeurs irréversibles en
  conservant les empreintes de suppression ;
- rétention : catégories minimales — invitations expirées (90 j), jobs et
  events traités (90 j), audit (12 mois) ; valeurs par défaut documentées et
  modifiables dans les bornes produit ;
- audit : export, anonymisation, changements de rétention/limites/profil
  audités ; la consultation du journal ne l’est pas.

## Analytics

- événements `workspace_export_requested`, `contact_anonymized`,
  `retention_policy_changed`, `channel_limits_changed` ;
- dimensions : workspace, canal, catégorie de rétention ;
- métrique de succès : zéro opération destructive non confirmée ou non
  auditée ; aucune suppression active levée par une anonymisation.

## Tests obligatoires

- domaine : validation des bornes de limites, transitions du job d’export,
  irréversibilité de l’anonymisation ;
- application : idempotence export (`requestKey`) et purge ;
- intégration PostgreSQL : empreintes de suppression intactes après
  anonymisation, expiration du lien d’export, unicité de l’export en cours ;
- isolation workspace : export et audit strictement scopés ;
- permission : chaque endpoint refusé aux rôles insuffisants par appel
  direct API ;
- non-rétroactivité : changement de limite sans effet sur les actions déjà
  planifiées (F-034) ;
- E2E : export → téléchargement → expiration ; anonymisation confirmée →
  réimport bloqué par la suppression ; réduction de rétention → purge
  planifiée auditée.

## Dépendances

- F-002 (membres, rôles) : la section membres consomme ses endpoints —
  F-002 est livrée avant dans le même lot ;
- F-003 (jobs, outbox, audit) : livré — le journal existe, la lecture est à
  exposer ;
- F-026 (suppressions) : livré — les empreintes doivent survivre à
  l’anonymisation ;
- F-034 (scheduler) : livré — applique les limites par canal ;
- F-051 (analytics) : livré — non-réécriture des métriques après
  anonymisation.

## Questions résolues avant développement

- le slug est immuable : seuls le nom et les préférences changent ;
- l’export est un job avec lien expirant (72 h), jamais une réponse
  synchrone ;
- la purge liée à la rétention est planifiée et idempotente, jamais
  synchrone ;
- l’anonymisation préserve systématiquement les empreintes de suppression —
  c’est un invariant, pas une option ;
- pas de suppression de workspace en self-service dans ce périmètre.
