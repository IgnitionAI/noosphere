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

Lire un produit depuis des sources bornées, revoir puis publier son offre et
son ICP, importer une liste, résoudre les doublons, consulter les fiches et
exclure un contact.

**Gate**

- versions publiées immuables ;
- chaque fait produit est sourcé et chaque déduction reste une hypothèse ;
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

## Wave 3 — Première campagne email supervisée

**Features** : F-030, F-031, F-032, F-033, F-034, F-035.

**Démo de sortie**

Connecter un compte email, créer une séquence, sélectionner des prospects avec
un score déterministe, approuver les messages et exécuter la campagne.

**Gate**

- snapshot campagne immuable ;
- une seule séquence active par contact/workspace ;
- double exécution impossible ;
- rate limits, fenêtres, pause et retries testés ;
- aucun message sans approbation exigée.

## Wave 4 — Réponse et inbox

**Features** : F-040, F-041, F-042.

**Démo de sortie**

Recevoir une réponse, suspendre instantanément la campagne, consulter le thread,
rédiger un brouillon et répondre dans la conversation.

**Gate**

- course réponse/envoi couverte par un test d’intégration ;
- webhook relivré sans doublon ;
- brouillon obsolète invalidé ;
- reprise d’automatisation explicitement humaine.

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

## Wave 7 — IA supervisée

**Features** : AI-100, AI-110, AI-120, AI-130, AI-140.

**Ordre recommandé**

1. scoring en mode shadow comparé aux règles ;
2. génération de premiers contacts sans envoi ;
3. classification de réponses en mode suggestion ;
4. génération de réponses avec approbation ;
5. retrieval hybride après benchmark ;
6. recommandations de campagne, jamais appliquées automatiquement.

Chaque capacité franchit un jeu d’évaluation et une comparaison à la baseline
avant d’être visible aux opérateurs.

## Ordre du premier chantier

1. F-001 + F-002 : identité et frontière workspace ;
2. F-004 : shell, tokens et primitives ;
3. F-009 : première vertical slice métier et UX complète ;
4. F-010 + F-011 : publier les deux sorties versionnées ;
5. F-020 + F-021 : première vraie navigation CRM ;
6. F-022 + F-024 + F-026 : sécuriser l’entrée de données.
