# ADR-013 — Recherche de connaissance Qwen versionnée

Statut : accepté

## Décision

La recherche documentaire utilise exclusivement Qwen3 Embedding 0.6B,
normalisé en 1 024 dimensions, servi par TEI gRPC. ParadeDB fournit BM25 et
pgvector ; les candidats sont fusionnés par RRF puis rerankés par
BGE reranker v2-m3 via un second TEI.

Le modèle sémantique amont et l'artefact d'exécution ONNX INT8 ont chacun un
identifiant et un SHA épinglés. L'adaptateur vérifie l'artefact réellement servi
avec `Info`. Aucun fallback OpenAI n'existe.

Les documents, chunk sets immuables, chunks stables et embeddings versionnés
sont séparés. Une recherche ne lit qu'une révision active. Une future migration
peut calculer une nouvelle révision en parallèle, la valider, basculer le pointeur
actif atomiquement puis supprimer l'ancienne après quatorze jours.

## Dégradation

Une panne du reranker conserve la recherche hybride. Une panne de l'embedding
de requête conserve la recherche lexicale. Les workers sans tâche documentaire
ne dépendent pas du démarrage de TEI.

## Conséquences

- dimension initiale unique : 1 024 ;
- aucun vecteur OpenAI importé ou conservé ;
- index HNSW partiel dimensionné par révision ;
- provenance et isolation workspace obligatoires ;
- activation conditionnée par couverture, qualité, capacité et tests bilingues.
