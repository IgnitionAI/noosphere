# F-035 — Comptes connectés et santé fournisseurs

## Résultat utilisateur

Connecter les comptes d’envoi (LinkedIn, email, WhatsApp via Unipile),
connaître leurs capacités et quotas réels, et voir immédiatement un compte
dégradé — sans jamais exposer un secret au navigateur.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | connecter, déconnecter, reconnecter | — |
| operator | oui (capacités, santé) | non | — |
| reviewer | oui (statut uniquement) | non | non |
| viewer | oui (statut uniquement) | non | non |

## Périmètre

- connexion Unipile : création de compte hébergé, callback, statut ;
- comptes LinkedIn/email/WhatsApp : capacités lues du compte (limites,
  canaux actifs), quotas, erreurs, dernière vérification ;
- webhooks fournisseur : vérification de signature, persistance, traitement
  idempotent ;
- reconnexion d’un compte dégradé ou expiré ;
- déconnexion : le compte est retiré, l’historique des conversations est
  préservé.

## Hors périmètre

- envoi effectif des messages (F-034) ;
- traitement des messages entrants (F-040/F-041) ;
- warmup email et rotation de comptes ;
- multi-provider au-delà d’Unipile V1.

## Parcours principal

1. l’utilisateur initie une connexion depuis `/integrations` ;
2. le callback enregistre le compte et lit ses capacités réelles ;
3. la santé du compte est vérifiée périodiquement et sur webhook ;
4. un compte dégradé suspend ses actions sans bloquer les autres ;
5. l’utilisateur reconnecte ou déconnecte ; l’historique est conservé.

## Règles métier et invariants

- les secrets fournisseurs (tokens, clés) ne transitent jamais vers le
  navigateur : stockage chiffré côté serveur, exposition limitée au statut ;
- les capacités sont lues du compte, jamais supposées par canal ;
- un compte dégradé suspend uniquement ses propres actions ;
- un webhook non vérifié (signature) est rejeté ; un webhook relivré est
  persisté mais traité une seule fois ;
- la suppression d’un compte préserve l’historique des conversations et des
  actions ;
- connexion et déconnexion sont auditées (F-003) ;
- un compte appartient à un seul workspace.

## Critères d’acceptation

- Étant donné un callback de connexion, quand il est traité, alors le
  navigateur ne reçoit jamais le token, seulement le statut du compte ;
- Étant donné un compte LinkedIn sans capacité message, quand je lis ses
  capacités, alors le canal est marqué indisponible ;
- Étant donné un compte dégradé, quand le scheduler (F-034) planifie, alors
  les actions de ce compte sont suspendues et les autres comptes continuent ;
- Étant donné le même webhook relivré deux fois, quand il arrive, alors un
  seul effet métier est appliqué ;
- Étant donné un webhook à signature invalide, quand il arrive, alors 401 et
  aucune persistance métier ;
- Étant donné un operator, quand il appelle l’endpoint de déconnexion, alors
  403 ;
- Étant donné deux workspaces, quand l’un connecte un compte, alors l’autre
  ne le voit pas.

## États et erreurs

- loading : skeleton de la liste des comptes pendant la vérification ;
- empty : aucun compte — action principale « connecter un compte » ;
- validation : callback incomplet ou expiré ;
- forbidden : connexion/déconnexion réservées à owner/admin, contrôlé côté
  serveur ;
- provider indisponible : Unipile injoignable → statut `unknown` explicite
  avec retry, jamais un compte présenté comme sain ;
- conflit métier : même compte connecté deux fois (doublon refusé) ;
- reprise : une connexion interrompu se reprend depuis l’initiation.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/integrations`.

**API** :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/connected-accounts` | comptes du workspace, statut et capacités |
| POST | `/api/v1/connected-accounts` | initier une connexion Unipile |
| POST | `/api/v1/connected-accounts/:id/actions/check` | vérifier santé et capacités |
| POST | `/api/v1/connected-accounts/:id/actions/reconnect` | reconnecter un compte dégradé |
| DELETE | `/api/v1/connected-accounts/:id` | déconnecter (historique préservé) |
| POST | `/api/v1/webhooks/unipile` | webhook fournisseur (vérifié, idempotent) |

**Événements sortants** : `ConnectedAccountStatusChanged` (entériné par
décision lead).

**Ports externes** : `UnipileClient` (comptes, capacités, webhooks).

## Données et confidentialité

- agrégat `ConnectedAccount` (provider, statut, capacités, quotas, dernière
  vérification) ;
- secrets : tokens chiffrés au repos, jamais journalisés, jamais renvoyés
  au client ;
- données personnelles : identifiant du compte d’envoi (profil de
  l’expéditeur) ;
- audit : connexion, déconnexion, changement de statut tracés.

## Analytics

- événement `connected_account_status_changed` ;
- dimensions : workspace, canal, statut ;
- métrique de succès : temps de détection d’un compte dégradé.

## Tests obligatoires

- contrat fournisseur : capacités, erreurs, payload partiel/retardé/relivré
  (test transverse QUALITY_GATES) ;
- webhook : signature invalide rejetée, relivraison sans doublon
  (intégration) ;
- compte indisponible : dégradation sans blocage des autres comptes (test
  transverse) ;
- secrets : aucun token dans les réponses API ni les logs (intégration) ;
- isolation workspace et permissions (appel direct API) ;
- E2E : connexion → vérification → dégradation → reconnexion →
  déconnexion.

## Dépendances

- F-002, F-003 (workspace, audit, outbox) : livrés ;
- F-031 : le préflight lit les comptes vérifiés (`NO_VERIFIED_SENDER_ACCOUNT`
  tant qu’aucun compte n’est connecté) ;
- F-034 : consomme capacités et santé pour l’envoi.

## Questions résolues avant développement

- Unipile V1 est le seul fournisseur du périmètre initial ;
- un compte dégradé n’est jamais contourné : la seule issue est la
  reconnexion ou un autre compte ;
- les quotas sont lus du compte et rafraîchis à chaque vérification, pas
  configurés à la main.
