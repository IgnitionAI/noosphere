# F-052 — Onboarding guidé

## Résultat utilisateur

Un nouveau workspace devient opérationnel en une session guidée — ou
plusieurs : chaque étape est sauvegardée, le parcours se reprend où on
l’avait quitté, et chaque prérequis manquant est dit explicitement.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner/admin | oui | exécute les étapes | non |
| operator | oui (progression) | exécute les étapes autorisées par son rôle | non |
| reviewer/viewer | progression seule | non | non |

## État d’implémentation

Livré. `/onboarding` expose les sept étapes persistées par workspace et
reprend à la première étape incomplète. Les prérequis sont recalculés côté
serveur depuis les données canoniques (workspace actif, lecture produit ou
offre publiée, ICP publiée, compte Unipile connecté, calendrier, politique
IA et campagne active). Le calendrier peut être sauté explicitement ; le
shell affiche un bandeau de reprise jusqu’à la complétion. La validation et
le saut sont idempotents, isolés par workspace et contrôlés par rôle.

## Périmètre

- parcours en 7 étapes : **1. workspace** (nom/profil) → **2. produit**
  (lecture produit F-009 ou offre manuelle) → **3. ICP** (version publiée
  F-011) → **4. compte d’envoi** (connexion Unipile F-035) →
  **5. calendrier** (connexion Cal.com F-043, optionnelle) →
  **6. prérequis** (récapitulatif de ce qui manque avant activation) →
  **7. autopilote** (politique F-012 + première campagne) ;
- progression persistée par workspace : chaque étape complétée est
  enregistrée ; quitter et reprendre restitue exactement l’état ;
- chaque étape affiche son prérequis manquant de façon explicite (ex.
  « aucun compte d’envoi vérifié — connecter Unipile ») avec le lien direct ;
- étapes optionnelles identifiables (calendrier) : le parcours est
  complétable sans elles, le manque reste visible ;
- les données créées pendant l’onboarding utilisent les **mêmes cas
  d’usage** que l’application (aucune donnée jetable ni mode démo) ;
- la fin du parcours mène à une prochaine action explicite (ex. « découvrir
  des prospects pour votre première campagne ») ;
- l’onboarding reste accessible après complétion (checklist consultable,
  étapes refaisables sans écraser l’existant).

## Hors périmètre

- assistant conversationnel ou aide IA à la configuration ;
- import de données pendant l’onboarding (F-022 reste accessible depuis
  l’app ; le parcours y renvoie) ;
- personnalisation du parcours par secteur ;
- métriques d’onboarding multi-workspaces (analytics internes).

## Parcours principal

1. un nouveau workspace est créé : l’onboarding s’ouvre à l’étape 1 ;
2. chaque étape validée enregistre la progression ; l’utilisateur peut
   quitter à tout moment ;
3. à la reprise (même jours plus tard, même par un autre owner/admin), le
   parcours reprend à la première étape incomplète ;
4. l’étape 6 liste les prérequis manquants avec leurs liens directs ;
5. l’étape 7 active la politique d’autopilote et conclut sur la prochaine
   action explicite.

## Règles métier et invariants

- la progression est par workspace, partagée entre les membres autorisés :
  un owner peut reprendre ce qu’un autre a commencé ;
- une étape n’est validée que si son prérequis réel est satisfait (vérifié
  côté serveur : ex. une version d’ICP publiée existe), jamais sur simple
  clic ;
- le parcours ne crée aucune donnée jetable : tout ce qui est produit
  pendant l’onboarding est une vraie donnée du workspace ;
- l’onboarding n’impose jamais un canal : le workspace reste utilisable sans
  avoir tout connecté (invariant catalogue) ;
- refaire une étape ne duplique pas les données (elle édite ou renvoie vers
  l’existant) ;
- les permissions des étapes suivent les rôles : une étape réservée
  owner/admin (connexion de compte) est marquée telle pour les autres
  rôles ;
- l’état de progression est idempotent à l’écriture (rejouer une validation
  d’étape ne change rien).

## Critères d’acceptation

- Étant donné un onboarding interrompu à l’étape 3, quand l’utilisateur
  revient, alors le parcours reprend à l’étape 3 avec les données déjà
  saisies ;
- Étant donné une étape dont le prérequis manque, quand je l’ouvre, alors le
  prérequis est affiché explicitement avec le lien vers l’écran qui le
  résout ;
- Étant donné un workspace sans compte d’envoi, quand j’atteins l’étape 6,
  alors le manque est listé et l’application reste utilisable ;
- Étant donné un calendrier non connecté (étape optionnelle), quand je
  termine le parcours, alors la complétion est acceptée et le manque reste
  visible ;
- Étant donné un parcours terminé, quand je le rouvre, alors la checklist
  complétée est consultable et chaque étape renvoie vers la donnée réelle
  créée ;
- Étant donné un operator, quand il atteint l’étape de connexion Unipile
  (réservée owner/admin), alors l’étape est marquée comme telle plutôt
  qu’en échec ;
- Étant donné deux workspaces, quand l’un progresse, alors la progression
  de l’autre est inchangée ;
- Étant donné la même validation d’étape soumise deux fois, quand le
  doublon arrive, alors la progression n’avance qu’une fois.

## États et erreurs

- loading : skeleton de l’étape courante ;
- empty : parcours jamais commencé — écran d’accueil avec la promesse et la
  première action ;
- validation : prérequis non satisfait → étape non validable, raison
  explicite (jamais d’erreur générique) ;
- forbidden : étapes réservées owner/admin signalées aux autres rôles ;
- provider indisponible : dépendance externe d’une étape (Unipile, Cal.com)
  injoignable → étape marquée « à réessayer », le reste du parcours reste
  navigable ;
- conflit métier : non applicable ;
- reprise : c’est le cœur de la feature (progression persistée).

## Contrats

**Routes UI** : `/onboarding` (parcours complet) ; bandeau de reprise dans
le shell tant que le parcours est incomplet (« Reprendre la configuration —
étape 3/7 »).

**Use cases** : `GetOnboardingProgress`, `CompleteOnboardingStep`,
`SkipOptionalStep`.

**API** :

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/workspaces/:id/onboarding` | progression (étapes, statuts, prérequis calculés) | livré |
| POST | `/api/v1/workspaces/:id/onboarding/steps/:step/actions/complete` | validation d’étape (vérifiée serveur, idempotente) | livré |
| POST | `/api/v1/workspaces/:id/onboarding/steps/:step/actions/skip` | saut d’étape optionnelle (tracé) | livré |

**Événements sortants** : `OnboardingStepCompleted`,
`OnboardingCompleted` — un seul envoi par étape.

**Ports externes** : aucun nouveau (les étapes consomment les endpoints
existants des features cibles).

## Données et confidentialité

- nouvelle table `workspace_onboarding` (workspace, étape, statut
  `pending/completed/skipped`, auteur de la validation, timestamps) — une
  ligne par (workspace, étape) ;
- données personnelles : l’auteur de validation est un membre (donnée
  interne) ; aucune PII de prospect manipulée par le parcours lui-même ;
- rétention : la progression suit la vie du workspace ;
- audit : complétion du parcours auditée ; les étapes intermédiaires sont
  visibles dans la progression (pas d’audit par étape).

## Analytics

- événements `onboarding_started`, `onboarding_step_completed`,
  `onboarding_step_skipped`, `onboarding_completed` ;
- dimensions : workspace, étape, rôle ;
- métriques de succès : taux de complétion, étape d’abandon la plus
  fréquente, délai création → première campagne.

## Tests obligatoires

- domaine : machine d’états des étapes (pending/completed/skipped),
  validation conditionnée au prérequis réel ;
- application : idempotence de la validation d’étape, reprise à la première
  étape incomplète ;
- intégration PostgreSQL : une ligne par (workspace, étape), progression
  partagée entre membres ;
- permission : étapes owner/admin signalées et contrôlées côté serveur ;
- isolation workspace : deux workspaces progressent indépendamment ;
- cohérence : les prérequis reflètent l’état réel (ex. ICP publiée) et non
  un flag déclaratif ;
- E2E : workspace créé → étapes 1-3 complétées → sortie → reprise à
  l’étape 4 → étape optionnelle sautée → complétion → prochaine action
  affichée.

## Dépendances

- F-002 (workspaces), F-009 (lecture produit), F-011 (ICP), F-035
  (comptes), F-012/F-031 (autopilote) : livrés ou partiels suffisants ;
- F-043 (calendrier) : partiel — l’étape 5 consomme la connexion existante
  et tolère son absence (optionnelle) ;
- F-003 : livré.

## Questions résolues avant développement

- parcours fixe en 7 étapes (ordre ci-dessus) ; seule l’étape calendrier
  est optionnelle ;
- la progression est partagée entre membres autorisés du workspace, pas
  personnelle ;
- aucune donnée jetable : l’onboarding utilise les cas d’usage réels ;
- le parcours reste consultable après complétion (checklist vivante).
