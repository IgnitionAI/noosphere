# ADR-007 — Recherche et RAG progressifs

## Statut
Accepté.

## Décision
Commencer par PostgreSQL full-text. Ajouter pgvector si la sémantique l’exige,
puis ParadeDB pour un besoin hybride démontré. `KnowledgeRetriever` masque
l’implémentation.

## Motifs et conséquences
La complexité et les contraintes de licence/opération sont différées. Un
benchmark doit précéder chaque palier.

## Date
2026-07-24
