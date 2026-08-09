# F-002 — Workspaces, membres et rôles

## Résultat utilisateur

Inviter des collaborateurs dans un workspace, leur attribuer un rôle, et
administrer l’équipe en toute sécurité : une invitation expirée ou consommée
est refusée, un changement de rôle est audité, et le dernier owner ne peut
jamais être retiré.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | liste des membres et invitations | invite, change les rôles, désactive, révoque | non |
| operator/reviewer/viewer | liste des membres (sans les invitations) | non | non |

Règle supplémentaire : un admin ne peut pas promouvoir au rôle `owner`, ni
modifier ou désactiver un owner ; seul un owner administre les owners.

## État d’implémentation

Livré. Le socle comprend les tables `workspaces`, `workspace_members` et
`workspace_invitations`, la résolution stricte du contexte, la création et le
sélecteur multi-workspace, les invitations renouvelables et copiables,
l’acceptation/révocation, l’administration des rôles et statuts, la protection
transactionnelle du dernier owner et l’audit/outbox. L’interface expose
`/w/[workspaceSlug]/settings/members`, `/workspaces/new`, `/onboarding` et
`/invitations/[invitationId]`. Sans transport email configuré, l’API retourne
explicitement `emailDelivery: not_configured` et le lien reste copiable.

## Périmètre

- création d’un workspace par un utilisateur authentifié (nom, slug dérivé
  unique) — le créateur devient owner ;
- invitation par email avec rôle proposé, expiration (7 jours) et usage
  unique ; acceptation par l’invité authentifié ; révocation par owner/admin ;
- administration des membres : liste avec rôles et statuts, changement de
  rôle, désactivation/réactivation d’un accès (sans supprimer l’historique) ;
- protection du dernier owner actif : ni rétrogradation, ni désactivation,
  ni départ volontaire ;
- audit de toute mutation d’équipe (invitation, acceptation, révocation,
  changement de rôle, désactivation) via le journal F-003 ;
- sélecteur de workspace complet : liste, création, mémorisation du dernier
  sélectionné.

## Hors périmètre

- SSO/SCIM et provisioning d’entreprise ;
- transfert de propriété explicite (couvert indirectement : un owner peut
  promouvoir un membre owner, la protection du dernier owner s’applique
  ensuite aux deux) ;
- groupes/équipes à l’intérieur d’un workspace ;
- facturation ou quotas par siège.

## Parcours principal

1. un owner/admin invite `prenom@entreprise.com` avec un rôle ;
2. l’invité authentifié accepte : il devient membre actif avec ce rôle,
   l’invitation est consommée ;
3. un owner change le rôle d’un membre ou le désactive ; chaque mutation est
   auditée avec acteur, avant/après et date ;
4. toute tentative de retirer le dernier owner actif est refusée avec un
   message explicite ;
5. l’utilisateur bascule entre ses workspaces via le sélecteur, ou crée un
   nouveau workspace dont il devient owner.

## Règles métier et invariants

- chaque lecture et mutation reste limitée au workspace de la route et de la
  session — aucun accès transverse, y compris pour l’acceptation
  d’invitation (l’invitation ne donne accès qu’au workspace ciblé) ;
- un membre ne peut jamais s’attribuer un rôle supérieur ni modifier son
  propre rôle ;
- un admin ne gère pas les owners (promotion owner, modification ou
  désactivation d’un owner réservées à un owner) ;
- le dernier owner actif ne peut être ni rétrogradé, ni désactivé, ni
  retiré — contrôle effectué dans la même transaction que la mutation ;
- une invitation expirée, révoquée ou déjà consommée est refusée ;
  l’acceptation est idempotente (rejouer l’acceptation ne crée pas de
  doublon de membership) ;
- inviter un membre déjà actif renvoie un conflit explicite ; inviter à
  nouveau un email déjà invité renouvelle l’invitation existante (expiration
  réinitialisée, un seul enregistrement actif) ;
- la désactivation conserve le membership et l’historique ; le contexte
  workspace refuse immédiatement un membre désactivé ;
- le slug de workspace reste unique globalement et stable après création.

## Critères d’acceptation

- Étant donné une invitation valide, quand l’invité authentifié l’accepte,
  alors il devient membre actif avec le rôle proposé et l’invitation est
  consommée ;
- Étant donné une invitation expirée, révoquée ou consommée, quand on
  l’accepte, alors la réponse est un refus explicite (410/409) ;
- Étant donné un operator, quand il tente d’inviter ou de changer un rôle,
  alors la réponse est 403, même par appel direct API ;
- Étant donné un membre, quand il tente de se promouvoir admin, alors la
  réponse est 403 ;
- Étant donné un admin, quand il tente de rétrograder un owner, alors la
  réponse est 403 ;
- Étant donné un workspace avec un seul owner actif, quand on tente de le
  rétrograder ou de le désactiver, alors la mutation est refusée (409) et le
  workspace conserve son owner ;
- Étant donné deux workspaces, quand un membre de l’un appelle l’API de
  l’autre, alors la réponse est 403 ;
- Étant donné un changement de rôle, quand je consulte le journal d’audit,
  alors je lis acteur, cible, rôle avant/après et date ;
- Étant donné la même acceptation rejouée, quand le doublon arrive, alors un
  seul membership existe ;
- Étant donné un membre désactivé, quand il appelle une route du workspace,
  alors l’accès est refusé immédiatement.

## États et erreurs

- loading : skeleton de la liste des membres ;
- empty : aucune invitation en attente — état neutre avec action « Inviter » ;
- validation : email invalide, rôle inconnu, slug indisponible à la création ;
- forbidden : mutations réservées owner/admin (et owners entre eux), même
  par appel direct API ;
- provider indisponible : envoi de l’email d’invitation en échec →
  l’invitation reste émise et réutilisable (le lien est affichable/copiable),
  l’échec est tracé ;
- conflit métier : 409 pour dernier owner, membre déjà actif, invitation
  consommée ;
- reprise : renvoi d’une invitation = renouvellement idempotent.

## Contrats

**Routes UI** : `/w/[workspaceSlug]/settings/members` (équipe et
invitations), sélecteur de workspace du shell, `/onboarding` (création).

**Use cases** : `CreateWorkspace`, `InviteMember`, `AcceptInvitation`,
`RevokeInvitation`, `ChangeMemberRole`, `SetMemberStatus`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/workspaces` | workspaces de l’utilisateur | implémenté |
| POST | `/api/v1/workspaces` | création (créateur = owner) | à spécifier |
| GET | `/api/v1/workspaces/:id/members` | liste des membres | à spécifier |
| POST | `/api/v1/workspaces/:id/invitations` | invitation (email, rôle) | à spécifier |
| GET | `/api/v1/workspaces/:id/invitations` | invitations en attente (owner/admin) | à spécifier |
| POST | `/api/v1/invitations/:id/actions/accept` | acceptation par l’invité | à spécifier |
| POST | `/api/v1/invitations/:id/actions/revoke` | révocation (owner/admin) | à spécifier |
| POST | `/api/v1/workspaces/:id/members/:userId/actions/change-role` | changement de rôle audité | à spécifier |
| POST | `/api/v1/workspaces/:id/members/:userId/actions/set-status` | désactivation/réactivation | à spécifier |

**Événements sortants** : `WorkspaceMemberInvited` (déjà référencé dans la
matrice de traçabilité), `WorkspaceInvitationAccepted`,
`WorkspaceMemberRoleChanged`, `WorkspaceMemberDeactivated` à ajouter —
chacun émis une seule fois via l’outbox, en phase avec l’audit.

**Ports externes** : envoi d’email d’invitation derrière un port (l’échec
d’envoi ne bloque pas l’invitation).

## Données et confidentialité

- nouvelle table `workspace_invitations` (workspace, email normalisé, rôle
  proposé, statut `pending/accepted/revoked/expired`, jeton ou identifiant,
  `expiresAt`, invitant, `acceptedBy`, timestamps) ; unicité partielle : une
  seule invitation `pending` par (workspace, email) ;
- données personnelles : l’email invité est une donnée personnelle — visible
  aux seuls owner/admin, tronqué pour les autres rôles ; les invitations
  expirées/révoquées sont purgées selon la politique de rétention (F-053) ;
- audit : toutes les mutations d’équipe dans `audit_logs` (acteur, cible,
  avant/après, résultat) ;
- la désactivation ne supprime aucune donnée ; l’anonymisation F-053
  remplacera l’identité sans toucher aux faits.

## Analytics

- événements `workspace_created`, `member_invited`, `invitation_accepted`,
  `member_role_changed`, `member_deactivated` ;
- dimensions : workspace, rôle cible, acteur ;
- métrique de succès : zéro workspace sans owner actif, zéro mutation d’équipe
  non auditée.

## Tests obligatoires

- domaine : hiérarchie des rôles (pas d’auto-promotion, admin ≠ gestion des
  owners), transitions d’invitation (pending → accepted/revoked/expired) ;
- intégration PostgreSQL : protection du dernier owner en transaction
  (rétrogradation, désactivation, départ), unicité invitation pending,
  acceptation idempotente ;
- isolation workspace : invitation d’un workspace refusée sur l’autre, appel
  transverse 403 ;
- permission : toutes les mutations refusées à operator/reviewer/viewer par
  appel direct API ;
- désactivation : effet immédiat sur la résolution du contexte ;
- audit : chaque mutation présente dans le journal avec avant/après ;
- E2E : invitation → acceptation → nouveau membre voit le workspace dans son
  sélecteur → changement de rôle audité → tentative de retrait du dernier
  owner refusée.

## Dépendances

- F-001 (auth Better Auth) : livré ;
- F-003 (audit, outbox) : livré ;
- F-004 (shell, sélecteur) : livré — le sélecteur est complété (création) ;
- consommateur : F-053 (section membres des paramètres s’appuie sur ces
  endpoints).

## Questions résolues avant développement

- expiration d’invitation : 7 jours, usage unique, renouvellement par
  ré-invitation (un seul enregistrement pending par couple workspace/email) ;
- pas de transfert de propriété dédié : la promotion owner par un owner
  suffit, la protection du dernier owner s’applique ensuite à tous ;
- la désactivation est préférée à la suppression : historique et audit
  préservés, effet immédiat ;
- l’échec d’envoi de l’email n’invalide pas l’invitation (lien copiable).
