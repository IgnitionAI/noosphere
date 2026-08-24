# F-043 — Calendrier produit (complétion)

## Résultat utilisateur

Gérer les rendez-vous sans quitter l’app : déplacer ou annuler depuis la
fiche, marquer un no-show, proposer plusieurs types de rendez-vous — chaque
rendez-vous restant rattaché au contact, à l’opportunité et à son historique.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | configure la connexion, déplace/annule, marque no-show | non |
| operator | oui | déplace/annule ses rendez-vous, marque no-show | non |
| reviewer | oui | non | non |
| viewer | oui (agenda sans détails personnels) | non | non |

## État d’implémentation

**Livré le 9 août 2026**, hors OAuth explicitement planifié comme extension
indépendante : connexions Cal.com (`GET/PUT/DELETE
/api/v1/calendar-connection`), client avec `cancelBooking`/
`rescheduleBooking`, webhook signé (`/api/v1/webhooks/calendar/calcom`,
mapping des statuts dont `BOOKING_CANCELLED`), tables `calendar_bookings` et
`meeting_proposals` avec manager, page `settings/calendar`, transitions
pipeline automatiques (F-044 : `meeting_booked`, `meeting_no_show`). Restent
et les actions de déplacement/annulation/no-show sont exposées dans l’UI
prospect et pipeline. Plusieurs types de RDV peuvent être activés, chaque
rendez-vous garde contact/opportunité, fuseaux et historique append-only. Les
tests prouvent qu’un nouvel UID Cal.com ou un webhook relivré conserve le même
identifiant interne.

## Périmètre

- déplacement et annulation d’un rendez-vous depuis la fiche prospect et la
  vue pipeline (le client Cal.com existe — il s’agit de l’exposer) ;
- no-show : marquage manuel (operator) et réconciliation par webhook ;
  un no-show fait passer l’opportunité en `meeting_no_show` (déjà câblé)
  et propose la replanification ;
- multi types de RDV : plusieurs event types Cal.com par workspace (ex.
  découverte 20 min, démo 45 min), choisis à la proposition de créneaux ;
- rattachement : tout rendez-vous porte contact + workspace, et opportunité
  quand elle existe ;
- idempotence webhook : un événement relivré ne crée ni doublon ni double
  transition ;
- fuseaux horaires affichés explicitement (celui du prospect et celui de
  l’utilisateur) à la proposition comme à l’affichage ;
- historique : annulations, déplacements et no-shows restent visibles après
  déconnexion du calendrier ;
- OAuth Cal.com : remplacement de la clé API par un flux OAuth — extension
  produit, spécifiée mais planifiable à part.

## Hors périmètre

- calendrier générique (Google/Outlook natifs) au-delà de Cal.com ;
- rappels automatiques aux prospects (notifications sortantes) ;
- disponibilités d’équipe / round-robin multi-membres ;
- modification du moteur de propositions existant (il est étendu, pas refait).

## Parcours principal

1. un rendez-vous est réservé (flux existant) : il apparaît sur la fiche
   prospect avec date, fuseau et type ;
2. le prospect demande à déplacer : l’operator replanifie depuis la fiche —
   le même rendez-vous est mis à jour (Cal.com + historique) ;
3. le prospect ne vient pas : l’operator marque no-show (ou le webhook le
   réconcilie) — l’opportunité passe en `meeting_no_show`, la
   replanification est proposée ;
4. l’annulation conserve le rendez-vous dans l’historique avec son motif ;
5. la déconnexion du calendrier n’efface aucun historique.

## Règles métier et invariants

- un déplacement ou une annulation met à jour le **même** rendez-vous :
  jamais de suppression/re-création (l’historique et le rattachement
  survivent) ;
- un webhook relivré ne produit qu’un seul effet (dédup sur l’identifiant
  d’événement fournisseur) ; une signature invalide est rejetée (401) sans
  persistance métier ;
- tout rendez-vous affiche son fuseau explicitement ; les calculs de
  créneaux restent en UTC en interne ;
- un no-show ne supprime pas le rendez-vous : statut dédié + proposition de
  replanification ; les relances automatiques liées s’arrêtent (invariant
  catalogue) ;
- la déconnexion du calendrier est sans effet sur l’historique ;
- les actions sont idempotentes (double appel = un seul effet côté Cal.com
  et en base) et auditées ;
- isolation workspace stricte.

## Critères d’acceptation

- Étant donné un rendez-vous réservé, quand l’operator le déplace depuis la
  fiche, alors le même enregistrement est mis à jour et l’opportunité reste
  rattachée ;
- Étant donné un webhook `BOOKING_CANCELLED` relivré deux fois, quand le
  doublon arrive, alors une seule annulation est enregistrée ;
- Étant donné un no-show marqué, quand l’opportunité existe, alors elle
  passe en `meeting_no_show` et la replanification est proposée ;
- Étant donné un rendez-vous affiché, quand je le lis, alors le fuseau du
  prospect et le mien sont explicites ;
- Étant donné une déconnexion du calendrier, quand je consulte la fiche,
  alors tout l’historique des rendez-vous reste visible ;
- Étant donné un webhook à signature invalide, quand il arrive, alors 401 et
  aucun effet ;
- Étant donné un viewer, quand il tente une annulation par appel direct API,
  alors 403 ;
- Étant donné plusieurs types de RDV configurés, quand je propose des
  créneaux, alors le type choisi détermine durée et lien ;
- Étant donné deux workspaces, quand l’un annule, alors l’autre ne voit
  rien.

## États et erreurs

- loading : skeleton de la section rendez-vous ;
- empty : aucun rendez-vous — action principale « proposer des créneaux » ;
- validation : nouveau créneau dans le passé, type de RDV inconnu (400) ;
- forbidden : mutations réservées owner/admin/operator, contrôlé serveur ;
- provider indisponible : Cal.com injoignable → action en échec avec retry,
  le statut local reste cohérent (jamais « déplacé » sans confirmation
  fournisseur) ;
- conflit métier : 409 sur action sur un rendez-vous déjà annulé ou déplacé
  entre-temps (état lu avant écriture) ;
- reprise : actions idempotentes via clé dédiée par action.

## Contrats

**Routes UI** : fiche prospect (section rendez-vous), vue pipeline, page
`settings/calendar` (connexion + types de RDV).

**Use cases** : `RescheduleBooking`, `CancelBooking`, `MarkNoShow`,
`ConfigureMeetingTypes`, `StartCalendarOAuth`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET/PUT/DELETE | `/api/v1/calendar-connection` | connexion Cal.com | implémenté |
| POST | `/api/v1/webhooks/calendar/calcom` | webhook signé, idempotent | implémenté |
| GET | `/api/v1/calendar-bookings` | rendez-vous du workspace (filtres contact/opportunité) | livré |
| POST | `/api/v1/calendar-bookings/:id/actions/reschedule` | déplacement (fuseau explicite) | livré |
| POST | `/api/v1/calendar-bookings/:id/actions/cancel` | annulation avec motif | livré |
| POST | `/api/v1/calendar-bookings/:id/actions/no-show` | marquage no-show | livré |
| GET/PUT | `/api/v1/calendar-connection/meeting-types` | multi types de RDV | livré |
| POST | `/api/v1/calendar-connection/oauth/start` | flux OAuth (extension) | à spécifier (planifiable à part) |

**Événements sortants** : `CalendarMeetingBooked` et
`CalendarMeetingCancelled` (existants) ; `CalendarMeetingRescheduled`,
`CalendarMeetingNoShow` à ajouter — un seul envoi par transition.

**Ports externes** : `CalComClient` (existant, déjà cancel/reschedule) ;
webhook signé existant.

## Données et confidentialité

- extensions : `calendar_bookings` (type de RDV, fuseau prospect, motif
  d’annulation, statut no-show) et `calendar_connections` (plusieurs event
  types ; champs OAuth en extension) — migrations additives ;
- données personnelles : un rendez-vous référence un contact (PII
  minimale : nom, créneau) ; l’historique suit la rétention F-053 et
  l’anonymisation du contact ;
- audit : déplacement, annulation, no-show, changement de types, OAuth.

## Analytics

- événements `meeting_rescheduled`, `meeting_cancelled`, `meeting_no_show` ;
- dimensions : workspace, type de RDV, origine (UI/webhook) ;
- métriques de succès : taux de no-show par type de RDV (exposé à F-051),
  zéro doublon de webhook, zéro perte d’historique après déconnexion.

## Tests obligatoires

- domaine : transitions de statut de rendez-vous (booked →
  rescheduled/cancelled/no_show), fuseaux ;
- application : idempotence des actions et du webhook relivré ;
- intégration PostgreSQL : mise à jour du même enregistrement, rattachement
  opportunité, historique après déconnexion ;
- contrat fournisseur : payload partiel, retardé, invalide et relivré
  (transverse QUALITY_GATES) ;
- permission : mutations refusées à reviewer/viewer par appel direct ;
- isolation workspace ;
- E2E : réservation → déplacement UI → no-show → replanification →
  historique complet visible après déconnexion.

## Dépendances

- F-044 (pipeline) : livré socle — les transitions d’étape existent ;
- F-040 (conversations) : livré — contexte des échanges ;
- F-003 (audit, idempotence) : livré ;
- F-035 (comptes connectés) : livré — pattern de connexion réutilisé pour
  OAuth.

## Questions résolues avant développement

- non bloquant V1 (décision user) : ce chantier peut glisser après le lot 5
  sans impact sur la chaîne principale ;
- déplacement/annulation = mise à jour du même rendez-vous, jamais
  suppression/re-création ;
- le no-show est un statut explicite avec replanification proposée, pas une
  annulation ;
- l’OAuth est spécifié ici mais planifiable en sous-lot indépendant ;
- les fuseaux sont affichés explicitement partout, calculs internes en UTC.
