# Plan de livraison des features

## Méthode

Chaque wave livre un parcours utilisable. Une wave ne commence pas par toutes
ses tables : elle traverse UI, use cases, domaine, persistance, jobs et tests.
Les capacités IA sont volontairement repoussées après la boucle commerciale.

## Wave 0 — Socle navigable

**Features** : F-001, F-002, F-003, F-004.

**Démo de sortie**

Un utilisateur se connecte, crée un workspace, invite un membre, change de
workspace et voit une navigation conforme à son rôle.

**Gate**

- isolation inter-workspace testée ;
- audit visible en base ;
- job et outbox relivrables sans doublon ;
- shell responsive et états standards disponibles.

## Wave 1 — Stratégie et CRM manuel

**Features** : F-009, F-010, F-011, F-012, F-020, F-021, F-022, F-024, F-026.

**Démo de sortie**

Lire un produit, obtenir un rapport complet ou partiel, publier automatiquement
le premier ICP classé par V3, lancer sa découverte de prospects, importer une
liste, résoudre les doublons, consulter les fiches et exclure un contact.

**Gate**

- versions publiées immuables ;
- seul le rang 1 issu d'un `objective_ranking` V3 terminé est publié
  automatiquement ; une hypothèse issue d'un rapport partiel ne l'est jamais ;
- import idempotent ;
- fusion annulable ;
- suppression revérifiée dans les cas d’usage sensibles.

## Wave 2 — Découverte et enrichissement

**Features** : F-023, F-025, puis F-027.

**Démo de sortie**

Lancer une recherche depuis un ICP, sélectionner des candidats, les enrichir et
obtenir une liste propre avec sources, confiance et données manquantes.

**Gate**

- premier `ProspectSource` remplaçable ;
- premier `ContactEnrichment` remplaçable ;
- coût, quota, erreurs et fraîcheur mesurés ;
- aucune donnée fournisseur sans provenance.

## Wave 3 — Campagnes autonomes mono-canal

**Features** : F-030, F-031, F-032, F-033, F-034, F-035.

**Démo de sortie**

À partir d’un canal recommandé, sourcer les prospects, les enrichir, les
dédupliquer, les scorer, générer des messages personnalisés, publier la
séquence et planifier les actions sans validation intermédiaire.

**Gate**

- snapshot campagne immuable ;
- une seule séquence active par contact/workspace ;
- double exécution impossible ;
- rate limits, fenêtres, pause et retries testés ;
- aucun message sans identité, score, preflight et snapshot immuable ;
- aucun clic humain requis dans le chemin normal.

## Wave 4 — Réponse et inbox

**Features** : F-040, F-041, F-042.

**Démo de sortie**

Recevoir une réponse, suspendre instantanément les relances, classifier avec
K3, répondre automatiquement, arrêter ou créer une opportunité de rendez-vous.

**Gate**

- course réponse/envoi couverte par un test d’intégration ;
- webhook relivré sans doublon ;
- réponse automatique liée au message entrant et envoyée dans le même thread ;
- opposition ou refus converti en suppression durable ;
- rendez-vous demandé converti en opportunité et proposition de réservation.

## Wave 5 — LinkedIn, WhatsApp et fallback

**Features** : extension de F-030, F-034, F-035 et F-040 aux deux canaux.

**Démo de sortie**

Exécuter une séquence LinkedIn → email ou email → WhatsApp selon les capacités
réelles du compte et l’éligibilité du contact.

**Gate**

- capacités fournisseurs découvertes ;
- fallback sans double contact ;
- historique unifié sans écraser les threads ;
- quotas indépendants par compte et canal.

## Wave 6 — Pipeline et pilotage

**Features** : F-043, F-044, F-050, F-051, F-052, F-053.

**Démo de sortie**

Transformer une conversation en rendez-vous et opportunité, clôturer gagné ou
perdu, puis analyser les résultats par campagne, ICP, rôle, signal et canal.

**Gate**

- métriques avec dénominateurs vérifiés ;
- revenu rattaché à la campagne et à la version d’offre ;
- exports et rétention testés ;
- onboarding reprenable.

## Wave 7 — Évaluation et optimisation IA

**Features** : AI-100, AI-110, AI-120, AI-130, AI-140.

La génération de contenu et la classification sont déjà intégrées à
l’autopilote supervisé (Waves 3 et 4, D-003/D-005). Cette wave ne couvre plus
que l’évaluation et l’optimisation.

**Ordre recommandé**

1. scoring en mode shadow comparé aux règles ;
2. jeux d’évaluation sur les premiers contacts et réponses déjà générés ;
3. retrieval hybride après benchmark ;
4. recommandations de campagne, jamais appliquées automatiquement.

Chaque capacité franchit un jeu d’évaluation et une comparaison à la baseline
avant d’être visible aux opérateurs.

## Ordre du premier chantier

1. F-001 + F-002 : identité et frontière workspace ;
2. F-004 : shell, tokens et primitives ;
3. F-009 : première vertical slice métier et UX complète ;
4. F-010 + F-011 : publier les deux sorties versionnées ;
5. F-020 + F-021 : première vraie navigation CRM ;
6. F-022 + F-024 + F-026 : sécuriser l’entrée de données.
