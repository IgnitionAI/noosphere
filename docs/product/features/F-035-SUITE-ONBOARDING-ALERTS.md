# F-035-suite — Connexion fournisseur industrialisée

Suite de [F-035-CONNECTED-ACCOUNTS.md](F-035-CONNECTED-ACCOUNTS.md) (socle
livré : comptes Unipile, capacités et quotas lus, webhooks vérifiés et
idempotents, vérification/reconnexion, suspension ciblée côté scheduler,
page `/integrations`).

## Résultat utilisateur

Connecter un compte d’envoi en quelques minutes sans assistance, voir en un
coup d’œil les quotas consommés par compte et par canal, et être alerté
immédiatement — pas en visitant la page — quand un compte se dégrade.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui (onboarding, quotas, alertes) | initie/valide une connexion, reconnecte, acquitte une alerte | non |
| operator | quotas et alertes de ses campagnes | non | non |
| reviewer/viewer | statuts uniquement | non | non |

## État d’implémentation

Socle livré (voir fiche F-035) : `connected_accounts` (capacités, quotas
jsonb, `lastCheckedAt`, dernière erreur), endpoints liste/initiation/
check/reconnect, webhook Unipile, suspension ciblée au scheduler (F-034),
page `/integrations` affichant statuts, capacités et quotas bruts. Restent à
livrer : onboarding de connexion guidé de bout en bout dans l’app, quotas
normalisés par canal avec consommation (envoyé aujourd’hui / limite),
alertes proactives de dégradation (visibles hors de la page intégrations) et
visibilité de l’impact d’une suspension (campagnes et actions concernées).

## Périmètre

- onboarding guidé en 3 étapes affichées : initiation (choix du canal →
  lien hébergé Unipile), attente du callback (état de progression explicite,
  abandon reprenable), vérification initiale (capacités lues, compte prêt
  ou erreur actionnable) ;
- reconnexion en un geste depuis l’alerte ou la fiche compte, y compris pour
  un compte dont la session fournisseur a expiré ;
- quotas normalisés par compte et par canal : limite lue du compte,
  consommation du jour calculée depuis `outreach_actions`, pourcentage et
  état (ok / proche du plafond / atteint) ;
- alertes de dégradation proactives : entrée visible dans l’app (bandeau ou
  centre de notifications) pour owner/admin/operator, créée au passage en
  `degraded`, acquittable, jamais dupliquée pour un même épisode ;
- impact d’une suspension : liste des campagnes actives et du nombre
  d’actions suspendues liées au compte dégradé ;
- extension des canaux affichés (LinkedIn/WhatsApp) selon les capacités
  réellement lues — jamais de canal affiché sans capacité confirmée.

## Hors périmètre

- rotation automatique de comptes et warmup (inchangé depuis F-035) ;
- alertes par email/Slack (canal externe — extension ultérieure, le point
  d’extension est l’event outbox) ;
- configuration manuelle des quotas (ils restent lus du compte, décision
  F-035) ;
- multi-provider au-delà d’Unipile.

## Parcours principal

1. l’owner clique « Connecter un compte » : l’assistant affiche les 3 étapes
   et fournit le lien hébergé ;
2. au retour du callback, la vérification initiale s’exécute ; le compte
   apparaît « prêt » avec ses capacités, ou l’erreur est expliquée avec
   l’action corrective ;
3. au quotidien, la page intégrations montre par compte et canal :
   envoyés/limite du jour, état ;
4. un compte passe `degraded` : une alerte est créée, les campagnes et
   actions impactées sont listées, les autres comptes continuent ;
5. l’utilisateur reconnecte en un geste depuis l’alerte ; l’alerte se clôt
   quand le compte redevient sain.

## Règles métier et invariants

- un canal n’est affiché que si la capacité correspondante a été lue du
  compte — jamais de canal supposé ;
- la consommation du jour est calculée sur les faits (`outreach_actions`
  envoyées par compte/canal), jamais estimée ; elle s’affiche avec sa date
  de référence et le fuseau du workspace ;
- un plafond atteint n’envoie plus : le scheduler (F-034) respecte la limite
  lue, et l’interface reflète le même chiffre ;
- une alerte de dégradation est unique par épisode (de l’entrée en
  `degraded` au retour à un état sain) ; rejouer la détection ne la duplique
  pas ;
- l’acquittement masque l’alerte sans masquer l’état du compte : la page
  intégrations reste fidèle ;
- la suspension reste ciblée : aucune action d’un compte sain n’est retardée
  par la dégradation d’un autre (invariant F-035, testé à nouveau ici) ;
- les secrets restent hors du navigateur (invariant F-035) : l’onboarding ne
  manipule que des URLs hébergées ;
- onboarding, reconnexion et acquittement sont audités.

## Critères d’acceptation

- Étant donné une initiation de connexion, quand le callback n’arrive pas,
  alors l’assistant affiche l’attente avec une action « reprendre » et
  aucune donnée partielle n’est persistée comme compte actif ;
- Étant donné un callback valide, quand la vérification initiale échoue,
  alors l’erreur fournisseur est traduite en action corrective (jamais un
  compte présenté prêt) ;
- Étant donné un compte avec limite email lue, quand je consulte les quotas,
  alors je vois envoyés/limite du jour cohérent avec les actions réellement
  parties ;
- Étant donné un compte qui passe `degraded`, quand la transition est
  détectée, alors une alerte unique est visible hors de la page
  intégrations pour owner/admin/operator ;
- Étant donné la même dégradation détectée deux fois (webhook relivré ou
  double vérification), quand le doublon arrive, alors une seule alerte
  existe pour l’épisode ;
- Étant donné un compte dégradé, quand je lis l’alerte, alors je vois les
  campagnes actives et le nombre d’actions suspendues de ce compte
  uniquement ;
- Étant donné une alerte acquittée, quand le compte redevient sain, alors
  l’alerte se clôt ; s’il se dégrade à nouveau, une nouvelle alerte est
  créée (nouvel épisode) ;
- Étant donné un viewer, quand il appelle l’endpoint d’acquittement, alors
  403 ;
- Étant donné deux workspaces, quand l’un dégrade un compte, alors l’autre
  ne voit ni alerte ni quota.

## États et erreurs

- loading : progression explicite de l’assistant (initiation → callback →
  vérification), skeleton des quotas ;
- empty : aucun compte — l’action principale ouvre l’assistant ; aucune
  alerte — état neutre ;
- validation : abandon d’onboarding sans callback (état reprenable, pas
  d’erreur) ;
- forbidden : connexion/reconnexion/acquittement réservés owner/admin (et
  lecture quotas élargie operator), contrôlé côté serveur ;
- provider indisponible : vérification initiale impossible → étape en échec
  avec retry, jamais un compte « prêt » par défaut ;
- conflit métier : onboarding déjà en cours pour le même canal — reprise du
  flux existant plutôt que doublon ;
- reprise : reconnexion idempotente, acquittement idempotent.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/integrations` (assistant de connexion,
quotas par canal, impact des suspensions) ; surface d’alertes globale
(bandeau shell ou centre de notifications — tranché : bandeau shell visible
sur toutes les pages, renvoyant vers `/integrations`).

**Use cases** : `StartConnectionOnboarding`, `CompleteConnectionOnboarding`,
`GetAccountQuotas`, `ListAccountHealthAlerts`, `AcknowledgeHealthAlert`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| POST | `/api/v1/connected-accounts/onboarding` | initie un onboarding guidé (canal) | à spécifier |
| GET | `/api/v1/connected-accounts/onboarding/:id` | progression de l’assistant | à spécifier |
| GET | `/api/v1/connected-accounts/:id/quotas` | limites lues + consommation du jour par canal | à spécifier |
| GET | `/api/v1/account-health-alerts` | alertes actives du workspace | à spécifier |
| POST | `/api/v1/account-health-alerts/:id/actions/acknowledge` | acquittement | à spécifier |

Les endpoints du socle (liste, initiation simple, check, reconnect, webhook)
restent inchangés ; l’onboarding guidé réutilise l’initiation et le callback
existants.

**Événements sortants** : `ConnectedAccountStatusChanged` (existant) reste
la source ; `AccountHealthAlertRaised` / `AccountHealthAlertResolved` à
ajouter, un seul envoi par épisode.

**Ports externes** : `UnipileClient` (existant) — aucun nouveau port.

## Données et confidentialité

- nouvelles tables : `connection_onboardings` (workspace, canal, étape,
  expiration du lien, résultat) et `account_health_alerts` (workspace,
  compte, épisode, statut `active/acknowledged/resolved`, acteur
  d’acquittement) ;
- la consommation de quotas n’est pas stockée : calculée à la requête sur
  les faits du jour ;
- données personnelles : l’identifiant du compte d’envoi reste la seule PII
  (invariant F-035) ; les alertes ne contiennent ni secret ni contenu de
  message ;
- rétention : les onboardings abandonnés expirent (nettoyage par job) ; les
  alertes résolues sont conservées pour l’audit ;
- audit : connexion, reconnexion, acquittement, résolution (F-003).

## Analytics

- événements `connection_onboarding_started/completed/failed`,
  `account_health_alert_raised/acknowledged/resolved` ;
- dimensions : workspace, canal, code d’erreur fournisseur ;
- métriques de succès : taux de complétion de l’onboarding, délai de
  détection → acquittement d’une dégradation, zéro envoi au-delà du plafond
  lu.

## Tests obligatoires

- domaine : transitions d’onboarding, unicité d’alerte par épisode, calcul
  de consommation (date/fuseau workspace) ;
- application : idempotence de la détection (webhook relivré = une alerte) ;
- intégration PostgreSQL : quotas cohérents avec `outreach_actions`,
  onboardings expirés purgés ;
- compte indisponible : dégradation sans blocage des autres comptes (test
  transverse QUALITY_GATES, rejoué) ;
- secrets : aucun token dans l’assistant ni les réponses d’alerte ;
- isolation workspace et permissions (acquittement refusé aux rôles non
  autorisés par appel direct) ;
- E2E : onboarding complet → quotas affichés → dégradation simulée → alerte
  visible hors page → reconnexion en un geste → alerte résolue.

## Dépendances

- F-035 (socle) : livré — cette fiche n’en change aucun invariant ;
- F-034 (scheduler) : livré — consomme les limites lues, suspend ciblé ;
- F-003 (jobs, audit, outbox) : livré ;
- F-002 (rôles) : partiel — les permissions de cette fiche s’appuient sur
  les rôles existants, suffisants.

## Questions résolues avant développement

- les quotas restent lus du compte, jamais saisis à la main ; la consommation
  est calculée sur les faits, pas stockée ;
- l’alerte est in-app (bandeau shell) : pas de canal externe dans ce
  périmètre, l’event outbox garde le point d’extension ;
- un épisode de dégradation = une alerte, de l’entrée en `degraded` au
  retour sain ; l’acquittement ne clôt pas l’épisode, la guérison si ;
- l’onboarding abandonné ne persiste jamais de compte partiellement actif.
