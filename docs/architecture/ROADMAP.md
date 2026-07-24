# Roadmap d’implémentation

Le découpage exécutable, les identifiants de features et leurs quality gates
sont définis dans [`docs/product/DELIVERY_PLAN.md`](../product/DELIVERY_PLAN.md).
Le présent document conserve la vue d’architecture générale.

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
- templates contrôlés et rédaction humaine ;
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

- qualification humaine de réponses ;
- brouillons humains obligatoirement approuvés ;
- calendrier et rendez-vous ;
- opportunités, historique, revenu et motifs de perte ;
- analytics par ICP, rôle, signal, canal et variante.

**Sortie** : mesurer jusqu’au rendez-vous et au revenu.

## Phase 5 — WhatsApp et pilotage

- WhatsApp comme canal de continuité autorisé ;
- comparaison des résultats sur des métriques déterministes ;
- collecte structurée du feedback humain.

## Phase 6 — IA supervisée

- scoring en mode shadow ;
- génération de premiers contacts soumise à approbation ;
- classification et brouillons de réponse soumis à approbation ;
- évaluations IA, feedback, coûts et latence ;
- éventuelle recherche hybride pgvector/ParadeDB après benchmark.

## Phase 7 — Productisation SaaS

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
