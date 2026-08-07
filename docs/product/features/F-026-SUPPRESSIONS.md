# F-026 — Suppressions et éligibilité canal

## Résultat utilisateur

Garantir qu’aucun contact n’est sollicité contre son gré ou sur un canal
interdit : une opposition enregistrée une fois bloque toute action future,
partout.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | supprime | lève une suppression (justification) |
| operator | oui | supprime | non |
| reviewer | oui | non | non |
| viewer | oui (liste sans contenu sensible) | non | non |

## État d’implémentation

Socle livré : table `contact_suppressions` (empreinte normalisée unique par
workspace, canal `global`/`email`/`linkedin`/`whatsapp`, motif, auteur),
endpoint `POST /contacts/:id/actions/suppress`, blocage 409 au ré-import,
passage du contact au statut `suppressed`, insertion idempotente
(`onConflictDoNothing`). Restent à livrer : liste des suppressions, contrôle
d’éligibilité exposé en API, levage avec justification, et revérification
dans les cas d’usage sensibles (enrollment, avant envoi).

## Périmètre

- suppression globale ou par canal, avec motif ;
- empreintes persistantes (email, LinkedIn, téléphone normalisés) survivant
  à la suppression du contact, à la fusion et à l’anonymisation ;
- contrôle d’éligibilité répété : à l’import (F-022), à l’enrollment (F-032)
  et juste avant l’envoi (F-034) ;
- liste et consultation des suppressions du workspace ;
- levage réservé aux rôles autorisés, avec justification obligatoire.

## Hors périmètre

- listes de suppression inter-workspaces ou globales à la plateforme ;
- gestion des désinscriptions côté fournisseur (webhooks F-035) ;
- scoring de risque de plainte.

## Parcours principal

1. un contact demande à ne plus être contacté (ou un opérateur anticipe) ;
2. l’opérateur enregistre la suppression — globale ou canal — avec motif ;
3. toute action ultérieure (import, enrollment, envoi) revérifie
   l’éligibilité et bloque ;
4. un owner/admin peut lever la suppression en justifiant la décision ;
5. chaque étape est auditée.

## Règles métier et invariants

- une opposition globale bloque immédiatement toute nouvelle action, tous
  canaux ;
- un blocage canal ne laisse passer que les autres canaux, sans fallback
  implicite vers un canal bloqué ;
- le contrôle est répété à l’import, à l’enrollment et juste avant l’envoi —
  jamais mis en cache au-delà de la transaction ;
- une suppression survit à la fusion (F-024) et à l’anonymisation : seules
  les empreintes normalisées persistent ;
- une identité supprimée ne peut pas redevenir éligible par réimport ;
- seul un owner ou admin lève une suppression, avec justification
  obligatoire ;
- suppression et levage sont idempotents et audités.

## Critères d’acceptation

- Étant donné une suppression globale, quand un import contient l’empreinte,
  alors la ligne est rejetée avec le motif « suppression active » ;
- Étant donné un blocage email, quand une séquence tente un fallback email,
  alors l’action est bloquée même si LinkedIn reste éligible ;
- Étant donné une suppression créée après planification d’une action, quand
  l’action devient due, alors elle est annulée avant exécution ;
- Étant donné un contact supprimé puis fusionné, quand je lis le contact
  résultant, alors la suppression s’applique toujours ;
- Étant donné un operator, quand il tente de lever une suppression, alors la
  réponse est 403 ;
- Étant donné un levage sans justification, quand un admin le soumet, alors
  la requête est refusée ;
- Étant donné la même suppression enregistrée deux fois, quand le doublon
  arrive, alors une seule empreinte existe.

## États et erreurs

- loading : skeleton de la liste des suppressions ;
- empty : aucune suppression — état neutre ;
- validation : motif manquant, justification de levage absente ;
- forbidden : levage réservé à owner/admin, même par appel direct API ;
- provider indisponible : non applicable ;
- conflit métier : 409 explicite quand une action rencontre une suppression
  active, avec l’identifiant de la suppression ;
- reprise : non applicable (actions synchrones ou jobs idempotents).

## Contrats

**Routes UI** : `/w/[workspaceSlug]/prospects` (badge et filtres) et section
suppressions dans les réglages ou la fiche prospect.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| POST | `/api/v1/contacts/:id/actions/suppress` | suppression globale ou canal | implémenté |
| POST | `/api/v1/suppressions` | suppression par empreinte sans contact existant | à spécifier |
| GET | `/api/v1/suppressions` | liste paginée du workspace | à spécifier |
| POST | `/api/v1/suppressions/check` | contrôle d’éligibilité (identité, canal) | à spécifier |
| POST | `/api/v1/suppressions/:id/actions/lift` | levage justifié (owner/admin) | à spécifier |

**Événements sortants** : `ContactSuppressed` (implémenté) ; le catalogue
nomme `SuppressionRegistered` — alignement du nom à trancher dans le contrat
d’événements. `SuppressionLifted` à ajouter.

**Ports externes** : aucun.

## Données et confidentialité

- table `contact_suppressions` (workspace, canal, type d’identité, empreinte
  normalisée, motif, auteur) ;
- données personnelles : les empreintes sont conservées après suppression du
  contact — base légale : respect d’une opposition (obligation légale /
  intérêt légitime) ; elles ne sont jamais réutilisées pour contacter ;
- rétention : les empreintes persistent tant que l’opposition n’est pas
  levée ; le motif et la justification sont audités ;
- la liste expose les empreintes tronquées par défaut aux rôles non
  privilégiés.

## Analytics

- événements `suppression_registered`, `suppression_lifted`,
  `action_blocked_by_suppression` ;
- dimensions : workspace, canal, origine (import, enrollment, envoi) ;
- métrique de succès : zéro action exécutée sur une suppression active.

## Tests obligatoires

- domaine : portée globale vs canal, normalisation des empreintes ;
- intégration PostgreSQL : unicité d’empreinte, blocage au ré-import,
  persistance après suppression du contact ;
- suppression tardive : suppression créée après planification, avant envoi —
  l’action est annulée dans la transaction finale ;
- fusion : la suppression survit au merge (F-024) ;
- isolation workspace : une empreinte supprimée dans un workspace n’affecte
  pas l’autre ;
- permission : levage refusé à operator/reviewer/viewer par appel direct
  API ;
- E2E : suppression → import bloqué → levage justifié → import accepté.

## Dépendances

- F-003 (audit) : partiel — audit log à livrer ;
- F-021 (contacts) : socle livré ;
- consommateurs du contrôle : F-022 (import), F-032 (enrollment), F-034
  (avant envoi) — la feature livre le contrat, les consommateurs l’appellent.

## Questions résolues avant développement

- aucune suppression inter-workspaces dans le périmètre initial ;
- le fallback vers un canal bloqué n’est jamais implicite ;
- le levage est une action exceptionnelle, toujours justifiée et auditée.
