# Roadmap d’implémentation

## Principe

Construire des vertical slices utilisables, pas toutes les tables puis toute
l’UI. Chaque phase se termine par un parcours démontrable et instrumenté.

## Phase 0 — Socle

- monorepo Bun ;
- Next.js, worker et packages de couches ;
- PostgreSQL + Drizzle + migrations ;
- Better Auth, workspace et RBAC ;
- outbox, `JobQueue` et observabilité minimale ;
- Guardian CI et tests d’isolation.

**Sortie** : un utilisateur se connecte, crée un workspace et invite un membre.

## Phase 1 — Stratégie et CRM

- offres/ICP et publication de versions ;
- entreprises, contacts, identités et emplois ;
- import manuel/CSV ;
- enrichissement via un premier fournisseur ;
- déduplication certaine et revue des matches probables ;
- suppressions.

**Sortie** : partir d’un ICP et obtenir une liste propre, scorée et explicable.

## Phase 2 — Première boucle email

- connected accounts email via Unipile ;
- séquences versionnées ;
- génération IA avec preuves ;
- approbation en une fois ;
- scheduler, limites, retries et idempotence ;
- inbox email et suspension sur réponse.

**Sortie** : campagne email supervisée de bout en bout.

## Phase 3 — LinkedIn et inbox unifiée

- sourcing et signaux LinkedIn autorisés par le connecteur ;
- messages/invitations ;
- threads LinkedIn dans l’inbox ;
- fallback email/LinkedIn ;
- santé et quotas par compte.

**Sortie** : séquence LinkedIn + email avec arrêt fiable.

## Phase 4 — Qualification et pipeline

- classification de réponses ;
- brouillons IA obligatoirement approuvés ;
- calendrier et rendez-vous ;
- opportunités, historique, revenu et motifs de perte ;
- analytics par ICP, rôle, signal, canal et variante.

**Sortie** : mesurer jusqu’au rendez-vous et au revenu.

## Phase 5 — WhatsApp et apprentissage

- WhatsApp comme canal de continuité autorisé ;
- recommandations de campagne fondées sur les résultats ;
- évaluations IA et feedback ;
- éventuelle recherche hybride pgvector/ParadeDB après benchmark.

## Phase 6 — Productisation SaaS

- onboarding self-service ;
- quotas et plans ;
- billing ;
- SSO/SCIM selon demande ;
- administration plateforme ;
- politiques de rétention/export ;
- isolation et observabilité à 100 workspaces.

## Hors périmètre V1

- warmup email maison ;
- facturation, devis et contrats ;
- delivery client et support ;
- workflow visuel arbitraire ;
- autonomie IA totale sur les réponses ;
- microservices ;
- RAG/ParadeDB sans besoin mesuré.
