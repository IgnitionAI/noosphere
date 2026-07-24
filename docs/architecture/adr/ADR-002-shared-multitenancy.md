# ADR-002 — Multi-workspace en tables partagées

## Statut
Accepté.

## Décision
Utiliser PostgreSQL partagé et ajouter `workspace_id` à toute donnée métier.
Repositories, index, unicités et tests sont tenant-aware.

## Motifs et conséquences
Le produit est interne aujourd’hui mais potentiellement commercialisable. Ce
choix évite une refonte future tout en restant simple. Une erreur de scope serait
critique ; middleware, repositories et tests d’isolation sont obligatoires.

## Date
2026-07-24
