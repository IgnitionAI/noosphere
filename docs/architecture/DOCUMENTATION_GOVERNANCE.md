# Gouvernance de la documentation d'architecture

> Statut : **normatif** — 24 août 2026.

L'objectif est d'empêcher qu'une architecture cible, une ancienne maquette ou
un runbook historique soit lu comme l'état réel de Noosphere.

## 1. Statuts obligatoires

Tout document d'architecture doit porter l'un de ces statuts près de son titre :

| Statut | Sens |
|---|---|
| `AS-IS` | décrit le code, le schéma et le déploiement actuels |
| `normatif` | règle que les nouveaux changements doivent respecter |
| `cible` | décision acceptée mais pas encore entièrement implémentée |
| `proposé` | proposition non acceptée |
| `historique` | preuve d'une décision ou mesure passée, non canonique |
| `remplacé` | conservé pour contexte et relié à son successeur |

Un document `cible` ne doit jamais employer « fonctionne » ou « livré » sans
renvoyer vers une preuve observable.

## 2. Sources de vérité

| Sujet | Source canonique |
|---|---|
| topologie et frontières | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| règles normatives | [`ARCHITECTURE_CONTRACT.md`](./ARCHITECTURE_CONTRACT.md) |
| vocabulaire et ownership | [`DOMAIN.md`](./DOMAIN.md) |
| données logiques | [`DATA_MODEL.md`](./DATA_MODEL.md) |
| schéma physique | `packages/infrastructure/src/database/schema.ts` + migrations |
| API publique | [`API_CONTRACT.md`](./API_CONTRACT.md) + OpenAPI |
| flux durables | [`FLOWS.md`](./FLOWS.md) |
| preuve produit | [`PRODUCT_TRUTH_CONTRACTS.md`](./PRODUCT_TRUTH_CONTRACTS.md) |
| abonnements externes | [`../runbooks/required-subscriptions.md`](../runbooks/required-subscriptions.md) |
| déploiement | [`../runbooks/vps-production.md`](../runbooks/vps-production.md) |
| expérience cible/historique | `design/noosphere/` et documents Noosphere datés |

Le code et les migrations arbitrent un désaccord sur l'AS-IS. Un ADR accepté
arbitre un désaccord sur une décision cible.

## 3. Déclencheurs de mise à jour

Une PR met à jour la documentation correspondante lorsqu'elle :

- ajoute ou retire un service, un worker ou un provider ;
- crée un contexte, une table, une migration ou une famille d'endpoints ;
- change le cycle de vie d'un agent ou la construction du contexte ;
- modifie une policy d'envoi/publication ;
- change un modèle, une dimension d'embedding ou le pipeline de recherche ;
- modifie un format documentaire supporté ;
- change la navigation ou un parcours P0 ;
- ajoute, retire ou renomme un abonnement externe obligatoire.

## 4. Contrôle anti-dérive

La revue compare au minimum :

1. services Compose contre le diagramme de déploiement ;
2. `pgTable(...)` contre le catalogue de `DATA_MODEL.md` ;
3. chemins OpenAPI contre les familles d'`API_CONTRACT.md` ;
4. types de jobs et rôles workers contre `ARCHITECTURE.md` ;
5. dépendances et variables contre les runbooks ;
6. modèles/révisions/dimensions contre la section Knowledge ;
7. routes UI et navigation contre les maquettes actives ;
8. assertions produit contre les Product Truth Contracts.

Les nombres instantanés, comme le total de tables ou de routes, sont datés. Ils
servent de signal de dérive, pas de contrat immuable.

## 5. Niveau de preuve

| Niveau | Formulation autorisée |
|---|---|
| lecture statique | « présent dans le code » |
| test unitaire/HTTP | « couvert par le test X » |
| intégration locale | « validé localement sur la fixture X » |
| canary provider | « validé en canary borné le… » |
| production | « observé en production sur la fenêtre… » |

Un healthcheck vert ne prouve ni un envoi, ni une publication, ni la qualité du
RAG. Une capture UI ne prouve pas la durabilité d'un job.

## 6. Documents historiques

Les audits, benchmarks et plans datés restent versionnés. Leur en-tête précise
qu'ils sont historiques et renvoie vers la source canonique actuelle. Ils ne
sont pas réécrits pour faire croire qu'une ancienne mesure a été exécutée sur
la nouvelle architecture.

## 7. Revue périodique

- à chaque lot : documents touchés par la PR ;
- avant un déploiement VPS : topologie, variables, abonnements et runbook ;
- mensuellement : recherche de termes retirés (`Docling`, ancien embedding,
  approbation obligatoire, ancien nom produit) ;
- avant un nouveau canal : capacité provider, policy, Product Truth Contract et
  canary spécifique.
